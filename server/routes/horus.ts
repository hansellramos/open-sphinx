// Modo Horus (ver lib/horus.ts): activarlo con lo permitido y el catálogo reducido (los arma el navegador, que es el
// que sabe qué tiene cada etiqueta) y salir con una passkey (verificada aquí, no basta con tener la sesión abierta).
import { Router } from 'express'
import { prisma } from '../db.ts'
import { guardarHorus, leerHorus } from '../lib/horus.ts'
import { opcionesPasskey, verificarPasskey } from '../auth.ts'

const r = Router()
const UUID = /^[0-9a-f-]{36}$/
const B64U = /^[A-Za-z0-9_-]+$/

r.post('/', async (req, res) => {
  if (await leerHorus()) return res.status(409).json({ error: 'El modo Horus ya está activo' })
  const vault = await prisma.vault.findUnique({ where: { id: 1 }, select: { catalogoPendiente: true } })
  if (vault?.catalogoPendiente) return res.status(409).json({ error: 'Falta unir lo del modo Horus anterior; recarga la página' })
  const ids = req.body?.ids
  const catalogo = String(req.body?.catalogo ?? '')
  if (!Array.isArray(ids) || !ids.length || ids.length > 50_000 || !ids.every((x) => typeof x === 'string' && UUID.test(x))) return res.status(400).json({ error: 'Elige algo que mostrar' })
  if (!B64U.test(catalogo) || catalogo.length > 2_000_000) return res.status(400).json({ error: 'Catálogo no válido' })
  const existen = await prisma.video.count({ where: { id: { in: ids } } })
  if (existen !== new Set(ids).size) return res.status(400).json({ error: 'Hay elementos que no existen' })
  const desde = new Date().toISOString()
  await guardarHorus({ desde, ids: [...new Set(ids)], catalogo })
  console.log(`[horus] activo: ${existen} elemento(s)`)
  res.json({ desde })
})

r.post('/salir/opciones', async (req, res) => {
  if (!(await leerHorus())) return res.status(409).json({ error: 'El modo Horus no está activo' })
  const options = await opcionesPasskey()
  req.session.horusChallenge = options.challenge
  res.json(options)
})

r.post('/salir', async (req, res) => {
  const expectedChallenge = req.session.horusChallenge
  delete req.session.horusChallenge
  const h = await leerHorus()
  if (!h) return res.status(409).json({ error: 'El modo Horus no está activo' })
  const v = await verificarPasskey(req.body?.response, expectedChallenge)
  if (!v.c) return res.status(v.status).json({ error: v.error })
  // El catálogo reducido (con las etiquetas creadas durante el modo) queda para unirlo al completo.
  await guardarHorus(null, { catalogoPendiente: h.catalogo })
  console.log(`[horus] salió con la passkey «${v.c.name}»`)
  res.json({ ok: true })
})

export default r
