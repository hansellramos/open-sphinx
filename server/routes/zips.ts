// ZIP con contraseña (tipo Takeout): pedir, ver avance, reanudar, bajar y borrar. El cuerpo trae la lista con las
// claves prestadas (va a RAM, nunca a la base); por eso esta ruta acepta cuerpos más grandes que el resto.
import { Router } from 'express'
import { existsSync } from 'node:fs'
import { prisma } from '../db.ts'
import { borrarZip, guardarManifiesto, manifiestoValido, zipArchivo } from '../lib/zips.ts'

const r = Router()
const B64U = /^[A-Za-z0-9_-]+$/
const sellado = (x: any) => x && typeof x === 'object' && ['epk', 'iv', 'ct'].every((k) => typeof x[k] === 'string' && B64U.test(x[k]) && x[k].length < 400)
const altoOk = (x: any, lista: number[]) => (x == null ? null : lista.includes(Number(x)) ? Number(x) : undefined)

r.get('/', async (req, res) => {
  res.json(await prisma.zip.findMany({ orderBy: { createdAt: 'desc' } }))
})

r.post('/', async (req, res) => {
  const { meta, claveSellada } = req.body ?? {}
  const m = manifiestoValido(req.body?.manifiesto)
  const fotos = altoOk(req.body?.fotos, [1080, 720])
  const videos = altoOk(req.body?.videos, [720, 540, 480])
  if (typeof meta !== 'string' || !B64U.test(meta) || meta.length > 2_000_000 || !sellado(claveSellada) || !m || fotos === undefined || videos === undefined)
    return res.status(400).json({ error: 'Datos no válidos' })
  const vistos = new Set(m.items.map((i) => i.id))
  if ((await prisma.video.count({ where: { id: { in: [...vistos] }, status: 'listo' } })) !== vistos.size) return res.status(400).json({ error: 'Algún elemento no existe o no está listo' })
  const z = await prisma.zip.create({ data: { meta, claveSellada: JSON.stringify(claveSellada), fotos, videos, total: m.items.length, status: 'creando' } })
  await guardarManifiesto(z.id, m) // antes de quedar en cola, para que el worker lo encuentre
  res.json(await prisma.zip.update({ where: { id: z.id }, data: { status: 'en_cola' } }))
})

// Tras un reinicio (la lista con las claves se perdió) o un error: el navegador la vuelve a mandar.
r.post('/:id/reanudar', async (req, res) => {
  const z = await prisma.zip.findUnique({ where: { id: req.params.id } })
  if (!z) return res.status(404).json({ error: 'No encontrado' })
  if (z.status !== 'error') return res.status(409).json({ error: 'Solo se reanuda lo que tuvo error' })
  const m = manifiestoValido(req.body?.manifiesto)
  if (!m) return res.status(400).json({ error: 'Datos no válidos' })
  await guardarManifiesto(z.id, m)
  res.json(await prisma.zip.update({ where: { id: z.id }, data: { status: 'en_cola', error: null, hechos: 0, size: 0, total: m.items.length } }))
})

r.get('/:id/archivo', async (req, res) => {
  const z = await prisma.zip.findUnique({ where: { id: req.params.id } })
  if (!z || z.status !== 'lista' || !existsSync(zipArchivo(z.id))) return res.status(404).json({ error: 'No está listo' })
  // El nombre real va cifrado; aquí uno genérico con la fecha.
  res.download(zipArchivo(z.id), `boveda-${z.createdAt.toISOString().slice(0, 10)}-${z.id.slice(0, 6)}.zip`)
})

r.delete('/:id', async (req, res) => {
  const z = await prisma.zip.findUnique({ where: { id: req.params.id } })
  if (!z) return res.status(404).json({ error: 'No encontrado' })
  if (z.status === 'procesando') return res.status(409).json({ error: 'Se está armando; espera a que termine' })
  await borrarZip(z.id)
  res.json({ ok: true })
})

export default r
