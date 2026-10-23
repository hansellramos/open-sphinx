// Etiquetas: lista con conteo, renombrar/color y borrar.
import { Router } from 'express'
import { prisma } from '../db.ts'
import { normalizarEtiqueta } from './videos.ts'

const COLORES = ['primary', 'success', 'danger', 'warning', 'info', 'secondary', 'dark']
const r = Router()

r.get('/', async (req, res) => {
  const tags = await prisma.tag.findMany({ include: { _count: { select: { videos: true } } } })
  res.json(tags.map((t) => ({ id: t.id, name: t.name, color: t.color, videos: t._count.videos })).sort((a, b) => a.name.localeCompare(b.name, 'es')))
})

r.put('/:id', async (req, res) => {
  const data: { name?: string; color?: string } = {}
  if (req.body?.name !== undefined) {
    data.name = normalizarEtiqueta(req.body.name)
    if (!data.name) return res.status(400).json({ error: 'El nombre no puede estar vacío' })
    const otra = await prisma.tag.findUnique({ where: { name: data.name } })
    if (otra && otra.id !== Number(req.params.id)) return res.status(409).json({ error: 'Ya existe una etiqueta con ese nombre' })
  }
  if (req.body?.color !== undefined) {
    if (!COLORES.includes(req.body.color)) return res.status(400).json({ error: 'Color no válido' })
    data.color = req.body.color
  }
  const t = await prisma.tag.update({ where: { id: Number(req.params.id) }, data })
  res.json({ id: t.id, name: t.name, color: t.color })
})

// Borra la etiqueta (los videos no se tocan).
r.delete('/:id', async (req, res) => {
  await prisma.tag.delete({ where: { id: Number(req.params.id) } })
  res.json({ ok: true })
})

export default r
