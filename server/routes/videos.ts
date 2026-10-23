// Videos: subida reanudable (tus), lista, archivos cifrados y borrado.
import { Router } from 'express'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { Server as TusServer } from '@tus/server'
import { FileStore } from '@tus/file-store'
import { prisma } from '../db.ts'
import { ARCHIVO_VALIDO, borrarSubida, paths, videoDir } from '../lib/paths.ts'

export const normalizarEtiqueta = (n) => String(n ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)

const MAX_BYTES = 20 * 1024 ** 3 // 20 GB

const tus = new TusServer({
  path: '/api/subidas',
  datastore: new FileStore({ directory: paths.subidas }),
  maxSize: MAX_BYTES,
  respectForwardedHeaders: true,
  relativeLocation: true, // detrás de Tailscale Serve: evita URLs http:// absolutas
  async onUploadFinish(req, upload) {
    const name = upload.metadata?.filename || 'video'
    const video = await prisma.video.create({
      data: {
        title: (upload.metadata?.title || name.replace(/\.[^.]+$/, '')).slice(0, 200),
        originalName: name.slice(0, 255),
        mime: upload.metadata?.filetype || null,
        size: upload.size ?? upload.offset,
        uploadId: upload.id,
        jobs: { create: { type: 'procesar' } },
      },
    })
    console.log(`[subida] ${name} (${((upload.size ?? 0) / 1e6).toFixed(1)} MB) → video ${video.id} en cola`)
    return {}
  },
})

// Monta tus (antes de express.json) en /api/subidas.
export const subidas = (req, res) => tus.handle(req, res)

const r = Router()

const publico = (v) => ({
  id: v.id,
  title: v.title,
  originalName: v.originalName,
  size: v.size,
  status: v.status,
  error: v.error,
  duration: v.duration,
  width: v.width,
  height: v.height,
  videoCodec: v.videoCodec,
  keyWrap: v.keyWrap ? JSON.parse(v.keyWrap) : null,
  tags: (v.tags ?? []).map((t) => ({ id: t.id, name: t.name, color: t.color })).sort((a, b) => a.name.localeCompare(b.name, 'es')),
  createdAt: v.createdAt,
  readyAt: v.readyAt,
})

r.get('/', async (req, res) => {
  const vs = await prisma.video.findMany({ orderBy: { createdAt: 'desc' }, include: { tags: true } })
  res.json(vs.map(publico))
})

r.get('/:id', async (req, res) => {
  const v = await prisma.video.findUnique({ where: { id: req.params.id }, include: { tags: true } })
  if (!v) return res.status(404).json({ error: 'Video no encontrado' })
  res.json(publico(v))
})

r.put('/:id', async (req, res) => {
  const title = String(req.body?.title ?? '').trim().slice(0, 200)
  if (!title) return res.status(400).json({ error: 'El título no puede estar vacío' })
  res.json(publico(await prisma.video.update({ where: { id: req.params.id }, data: { title }, include: { tags: true } })))
})

// Reemplaza las etiquetas del video por las de la lista (crea las que no existan).
r.put('/:id/etiquetas', async (req, res) => {
  const nombres = [...new Set((Array.isArray(req.body?.nombres) ? req.body.nombres : []).map(normalizarEtiqueta).filter(Boolean))].slice(0, 30)
  const v = await prisma.video.update({
    where: { id: req.params.id },
    data: { tags: { set: [], connectOrCreate: nombres.map((name) => ({ where: { name }, create: { name } })) } },
    include: { tags: true },
  })
  res.json(publico(v))
})

// Reintentar un video que falló (si el archivo subido sigue ahí).
r.post('/:id/reintentar', async (req, res) => {
  const v = await prisma.video.findUnique({ where: { id: req.params.id } })
  if (!v || v.status !== 'error') return res.status(400).json({ error: 'Solo se reintentan videos con error' })
  await prisma.video.update({ where: { id: v.id }, data: { status: 'en_cola', error: null, jobs: { create: { type: 'procesar' } } } })
  res.json({ ok: true })
})

r.delete('/:id', async (req, res) => {
  const v = await prisma.video.findUnique({ where: { id: req.params.id } })
  if (!v) return res.status(404).json({ error: 'Video no encontrado' })
  if (v.status === 'procesando') return res.status(409).json({ error: 'Se está procesando; espera a que termine' })
  await rm(videoDir(v.id), { recursive: true, force: true })
  if (v.uploadId) await borrarSubida(v.uploadId)
  await prisma.video.delete({ where: { id: v.id } })
  res.json({ ok: true })
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
