// Exportaciones: lista (sin claves), archivos cifrados y borrado manual. Se piden desde /api/videos/:id/exportar.
import { Router } from 'express'
import path from 'node:path'
import { prisma } from '../db.ts'
import { borrarExportacion, exportDir, exportPublica, reemplazarOriginal } from '../lib/exportar.ts'

const r = Router()

r.get('/', async (req, res) => {
  const es = await prisma.exportacion.findMany({ orderBy: { createdAt: 'desc' } })
  res.json(es.map(exportPublica))
})

// Para estimar cuánto pesará una exportación antes de pedirla (lo que pesaron las anteriores, por filtro).
r.get('/tasas', async (req, res) => {
  const ts = await prisma.tasaExport.findMany()
  res.json(Object.fromEntries(ts.filter((t) => t.pixSeg > 0).map((t) => [t.filtro, { tasa: t.bytes / t.pixSeg, n: t.n }])))
})

const VALIDO = /^(index\.m3u8|init\.mp4|seg_\d{5}\.m4s)$/
r.get('/:id/:nombre', async (req, res) => {
  const { id, nombre } = req.params
  if (!/^[0-9a-f-]{36}$/.test(id) || !VALIDO.test(nombre)) return res.status(400).end()
  const e = await prisma.exportacion.findUnique({ where: { id } })
  if (!e || e.status !== 'lista') return res.status(404).end()
  res.set('Cache-Control', 'private, max-age=604800, immutable') // cada exportación tiene su id
  res.type(nombre === 'index.m3u8' ? 'application/vnd.apple.mpegurl' : 'application/octet-stream')
  res.sendFile(path.join(exportDir(e.videoId, e.id), nombre === 'index.m3u8' ? nombre : `${nombre}.enc`), (err) => err && !res.headersSent && res.status(404).end())
})

// Usar esta exportación como el video (borra el original para siempre).
r.post('/:id/reemplazar', async (req, res) => {
  const e = await prisma.exportacion.findUnique({ where: { id: req.params.id } })
  if (!e) return res.status(404).json({ error: 'No encontrada' })
  if (e.status !== 'lista') return res.status(409).json({ error: 'Todavía no está lista' })
  const ocupadas = await prisma.exportacion.count({ where: { videoId: e.videoId, status: { in: ['en_cola', 'procesando'] } } })
  if (ocupadas) return res.status(409).json({ error: 'Hay otra exportación de este video en curso; espera a que termine' })
  const v = await reemplazarOriginal(e)
  res.json({ ok: true, size: v.size, segments: v.segments, readyAt: v.readyAt })
})

r.delete('/:id', async (req, res) => {
  const e = await prisma.exportacion.findUnique({ where: { id: req.params.id } })
  if (!e) return res.status(404).json({ error: 'No encontrada' })
  if (e.status === 'procesando') return res.status(409).json({ error: 'Se está creando; espera a que termine' })
  await borrarExportacion(e)
  res.json({ ok: true })
})

export default r
