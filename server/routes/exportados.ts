// Exportaciones: lista (sin claves), archivos cifrados y borrado manual. Se piden desde /api/videos/:id/exportar.
import { Router } from 'express'
import path from 'node:path'
import { prisma } from '../db.ts'
import { borrarExportacion, exportDir, exportPublica } from '../lib/exportar.ts'

const r = Router()

r.get('/', async (req, res) => {
  const es = await prisma.exportacion.findMany({ orderBy: { createdAt: 'desc' } })
  res.json(es.map(exportPublica))
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

r.delete('/:id', async (req, res) => {
  const e = await prisma.exportacion.findUnique({ where: { id: req.params.id } })
  if (!e) return res.status(404).json({ error: 'No encontrada' })
  if (e.status === 'procesando') return res.status(409).json({ error: 'Se está creando; espera a que termine' })
  await borrarExportacion(e)
  res.json({ ok: true })
})

export default r
