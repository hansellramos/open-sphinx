// Elementos (videos, fotos y archivos; la tabla se llama Video por historia): subida reanudable (tus),
// lista, archivos cifrados y borrado. El tipo de cada uno va dentro de los metadatos cifrados.
import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Server as TusServer } from '@tus/server'
import { prisma } from '../db.ts'
import { ARCHIVO_VALIDO, borrarSubida, videoDir } from '../lib/paths.ts'
import { ALTOS, FILTROS, exportPublica, guardarClave } from '../lib/exportar.ts'
import { SubidasCifradas } from '../lib/temporal.ts'

const MAX_BYTES = 20 * 1024 ** 3 // 20 GB

const tus = new TusServer({
  path: '/api/subidas',
  datastore: new SubidasCifradas(), // cifradas al llegar; la llave temporal vive en RAM
  maxSize: MAX_BYTES,
  respectForwardedHeaders: true,
  relativeLocation: true, // detrás de Tailscale Serve: evita URLs http:// absolutas
  async onUploadFinish(req, upload) {
    // El nombre del archivo queda en texto plano solo hasta que el worker lo mete en los metadatos cifrados.
    const name = upload.metadata?.filename || 'archivo'
    // extra: etiquetas elegidas al subir, selladas por el navegador con la pública (el servidor no las lee).
    const extra = selladoValido(upload.metadata?.extra)
    const video = await prisma.video.create({
      data: {
        originalName: name.slice(0, 255),
        mime: upload.metadata?.filetype?.slice(0, 100) || null,
        extra,
        size: upload.size ?? upload.offset,
        uploadId: upload.id,
        jobs: { create: { type: 'procesar' } },
      },
    })
    console.log(`[subida] ${((upload.size ?? 0) / 1e6).toFixed(1)} MB → ${video.id} en cola`)
    return {}
  },
})

// Datos sellados por el navegador con la pública ({k: {epk…}, d}); el servidor no los puede leer.
function selladoValido(extra?: string | null) {
  try {
    const x = extra && JSON.parse(extra)
    return x?.k?.epk && typeof x.d === 'string' && extra.length <= 8000 ? extra : null
  } catch {
    return null
  }
}

// Monta tus (antes de express.json) en /api/subidas.
export const subidas = (req, res) => tus.handle(req, res)

const r = Router()

// Etiquetas/fecha cambiadas después de empezar a subir: se guardan selladas con el elemento (reemplazan a las de
// la subida) y el worker las mete en los metadatos. Así no se pierden si se recarga la página. 404: la subida
// todavía no termina (el navegador lo reintenta al terminar) o ya se procesó (el navegador lo aplica él).
r.put('/por-subida/:uploadId/ajuste', async (req, res) => {
  const extra = selladoValido(typeof req.body?.extra === 'string' ? req.body.extra : null)
  if (!extra) return res.status(400).json({ error: 'Datos no válidos' })
  const v = await prisma.video.findFirst({ where: { uploadId: req.params.uploadId } })
  if (!v) return res.status(404).json({ error: 'No hay una subida en proceso con ese id' })
  await prisma.video.update({ where: { id: v.id }, data: { extra } })
  res.json({ ok: true })
})

// Solo lo cifrado + estado. Los campos "legado" (MVP sin cifrar) se mandan mientras el navegador no los migre.
const publico = (v) => ({
  id: v.id,
  size: v.size,
  status: v.status,
  error: v.error,
  keyWrap: v.keyWrap ? JSON.parse(v.keyWrap) : null,
  meta: v.meta,
  createdAt: v.createdAt,
  readyAt: v.readyAt,
  ...(v.title || v.tags?.length
    ? { legado: { title: v.title, originalName: v.originalName, duration: v.duration, width: v.width, height: v.height, videoCodec: v.videoCodec, tags: (v.tags ?? []).map((t) => ({ name: t.name, color: t.color })) } }
    : {}),
})

r.get('/', async (req, res) => {
  const vs = await prisma.video.findMany({ orderBy: { createdAt: 'desc' }, include: { tags: true } })
  res.json(vs.map(publico))
})

r.get('/:id', async (req, res) => {
  const v = await prisma.video.findUnique({ where: { id: req.params.id }, include: { tags: true } })
  if (!v) return res.status(404).json({ error: 'No encontrado' })
  res.json(publico(v))
})

// Guarda los metadatos (ya cifrados por el navegador). También vacía los campos legado y actualiza key.json.
r.put('/:id/meta', async (req, res) => {
  const meta = String(req.body?.meta ?? '')
  if (!/^[A-Za-z0-9_-]{20,}$/.test(meta) || meta.length > 200_000) return res.status(400).json({ error: 'Metadatos no válidos' })
  const v = await prisma.video.update({
    where: { id: req.params.id },
    data: { meta, title: null, originalName: null, mime: null, duration: null, width: null, height: null, videoCodec: null, tags: { set: [] } },
    include: { tags: true },
  })
  if (v.keyWrap) {
    const kj = path.join(videoDir(v.id), 'key.json')
    await writeFile(kj, JSON.stringify({ v: 2, keyWrap: JSON.parse(v.keyWrap), meta })).catch(() => {})
  }
  res.json(publico(v))
})

// Reintentar un elemento que falló (si el archivo subido sigue ahí).
r.post('/:id/reintentar', async (req, res) => {
  const v = await prisma.video.findUnique({ where: { id: req.params.id } })
  if (!v || v.status !== 'error') return res.status(400).json({ error: 'Solo se reintenta lo que tuvo error' })
  await prisma.video.update({ where: { id: v.id }, data: { status: 'en_cola', error: null, jobs: { create: { type: 'procesar' } } } })
  res.json({ ok: true })
})

r.delete('/:id', async (req, res) => {
  const v = await prisma.video.findUnique({ where: { id: req.params.id } })
  if (!v) return res.status(404).json({ error: 'No encontrado' })
  if (v.status === 'procesando') return res.status(409).json({ error: 'Se está procesando; espera a que termine' })
  await rm(videoDir(v.id), { recursive: true, force: true })
  if (v.uploadId) await borrarSubida(v.uploadId)
  await prisma.video.delete({ where: { id: v.id } })
  res.json({ ok: true })
})

// Exportar (más pequeño y/o con filtro). El navegador presta la clave del video solo para este trabajo: queda en
// RAM (nunca en la base) y el worker la borra al terminar o fallar. Si ya hay una igual, se devuelve esa; si
// esa tuvo error, se reanuda desde donde quedó.
r.post('/:id/exportar', async (req, res) => {
  const clave = String(req.body?.clave ?? '')
  const duracion = Number(req.body?.duracion)
  const alto = req.body?.alto == null ? null : Number(req.body.alto)
  const filtro = req.body?.filtro == null ? null : String(req.body.filtro)
  if (!/^[A-Za-z0-9_-]{43}$/.test(clave)) return res.status(400).json({ error: 'Clave no válida' })
  if (alto !== null && !ALTOS.includes(alto)) return res.status(400).json({ error: 'Tamaño no válido' })
  if (filtro !== null && !(filtro in FILTROS)) return res.status(400).json({ error: 'Filtro no válido' })
  if (alto === null && filtro === null) return res.status(400).json({ error: 'Elige un tamaño menor o un filtro' })
  const v = await prisma.video.findUnique({ where: { id: req.params.id } })
  if (!v || v.status !== 'listo' || !v.segments) return res.status(404).json({ error: 'No hay un video listo con ese id' })
  const igual = await prisma.exportacion.findFirst({ where: { videoId: v.id, alto, filtro } })
  if (igual && igual.status !== 'error') return res.json(exportPublica(igual))
  const data = { status: 'en_cola', error: null, clave: null, duracion: Number.isFinite(duracion) && duracion > 0 ? duracion : null, createdAt: new Date() }
  const id = igual?.id ?? randomUUID()
  await guardarClave(id, clave) // antes de quedar en cola, para que el worker la encuentre
  const e = igual ? await prisma.exportacion.update({ where: { id }, data }) : await prisma.exportacion.create({ data: { ...data, id, videoId: v.id, alto, filtro } })
  res.json(exportPublica(e))
})

// Archivos cifrados (y el index.m3u8, que solo lista nombres y duraciones).
r.get('/:id/archivo/:nombre', (req, res) => {
  const { id, nombre } = req.params
  if (!/^[0-9a-f-]{36}$/.test(id) || !ARCHIVO_VALIDO.test(nombre)) return res.status(400).end()
  const file = path.join(videoDir(id), nombre === 'index.m3u8' ? nombre : `${nombre}.enc`)
  res.set('Cache-Control', 'private, max-age=31536000, immutable')
  res.type(nombre === 'index.m3u8' ? 'application/vnd.apple.mpegurl' : 'application/octet-stream')
  res.sendFile(file, (err) => err && !res.headersSent && res.status(404).end())
})

export default r
