// Versiones ligeras: lista (sin claves) y borrado manual. Se piden desde /api/videos/:id/ligera.
import { Router } from 'express'
import { prisma } from '../db.ts'
import { borrarLigera, ligeraPublica } from '../lib/ligera.ts'

const r = Router()

r.get('/', async (req, res) => {
  const ls = await prisma.ligera.findMany({ orderBy: { createdAt: 'desc' } })
  res.json(ls.map(ligeraPublica))
})

r.delete('/:id', async (req, res) => {
  const l = await prisma.ligera.findUnique({ where: { id: req.params.id } })
  if (!l) return res.status(404).json({ error: 'No encontrada' })
  if (l.status === 'procesando') return res.status(409).json({ error: 'Se está creando; espera a que termine' })
  await borrarLigera(l)
  res.json({ ok: true })
})

export default r
