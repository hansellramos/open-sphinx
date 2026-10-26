// La bóveda: clave pública (para que el worker cifre), la privada envuelta con el código de recuperación,
// la clave de metadatos (sellada) y el catálogo cifrado (etiquetas). El servidor no puede leer nada de esto.
import { Router } from 'express'
import { writeFile } from 'node:fs/promises'
import { prisma } from '../db.ts'
import { bovedaJson } from '../lib/paths.ts'
import { cambiarCatalogo } from '../lib/horus.ts'

const r = Router()
const B64U = /^[A-Za-z0-9_-]+$/

// Copia en disco (por si se pierde la base): con ella + videos/ + el código se recupera todo.
async function guardarCopia() {
  const v = await prisma.vault.findUnique({ where: { id: 1 } })
  if (!v) return
  const json = { v: 2, publicKey: v.publicKey, recoveryWrap: JSON.parse(v.recoveryWrap), metaKeyWrap: v.metaKeyWrap ? JSON.parse(v.metaKeyWrap) : null, catalog: v.catalog }
  await writeFile(bovedaJson(), JSON.stringify(json, null, 1), { mode: 0o600 })
}

// En modo Horus el catálogo es el reducido (solo lo elegido); el completo no sale de aquí.
r.get('/', async (req, res) => {
  const v = await prisma.vault.findUnique({ where: { id: 1 } })
  const h = req.horus
  res.json(
    v
      ? {
          publicKey: v.publicKey,
          recoveryWrap: JSON.parse(v.recoveryWrap),
          metaKeyWrap: v.metaKeyWrap ? JSON.parse(v.metaKeyWrap) : null,
          catalog: h ? h.catalogo : v.catalog,
          horus: h ? { desde: h.desde, n: h.ids.length } : null,
          catalogoPendiente: h ? null : v.catalogoPendiente,
        }
      : null,
  )
})

// Se crea una sola vez, justo después de registrar la primera passkey.
r.post('/', async (req, res) => {
  if (await prisma.vault.findUnique({ where: { id: 1 } })) return res.status(409).json({ error: 'La bóveda ya existe' })
  const { publicKey, recoveryWrap, prfWrap } = req.body ?? {}
  if (!publicKey || !recoveryWrap?.ct) return res.status(400).json({ error: 'Datos incompletos' })
  await prisma.vault.create({ data: { publicKey, recoveryWrap: JSON.stringify(recoveryWrap) } })
  if (prfWrap?.ct) await prisma.credential.update({ where: { id: req.session.credentialId }, data: { prfWrap: JSON.stringify(prfWrap) } })
  await guardarCopia()
  res.json({ ok: true })
})

// Cambiar el código de recuperación (la clave privada no cambia, solo cómo se envuelve).
r.put('/recuperacion', async (req, res) => {
  const { recoveryWrap } = req.body ?? {}
  if (!recoveryWrap?.ct) return res.status(400).json({ error: 'Datos incompletos' })
  await prisma.vault.update({ where: { id: 1 }, data: { recoveryWrap: JSON.stringify(recoveryWrap) } })
  await guardarCopia()
  res.json({ ok: true })
})

// La clave de metadatos la genera el navegador una sola vez y la sella con la pública.
r.put('/meta-key', async (req, res) => {
  const w = req.body?.metaKeyWrap
  if (!w?.epk || !w?.iv || !w?.ct) return res.status(400).json({ error: 'Datos incompletos' })
  const { count } = await prisma.vault.updateMany({ where: { id: 1, metaKeyWrap: null }, data: { metaKeyWrap: JSON.stringify(w) } })
  if (!count) return res.status(409).json({ error: 'La clave de metadatos ya existe' })
  await guardarCopia()
  res.json({ ok: true })
})

// fusion: el navegador ya unió el catálogo que quedó del modo Horus (catalogoPendiente) con este.
r.put('/catalogo', async (req, res) => {
  const catalog = String(req.body?.catalog ?? '')
  if (!B64U.test(catalog) || catalog.length > 2_000_000) return res.status(400).json({ error: 'Catálogo no válido' })
  if (req.horus) {
    await cambiarCatalogo(catalog)
    return res.json({ ok: true })
  }
  await prisma.vault.update({ where: { id: 1 }, data: { catalog, ...(req.body?.fusion && { catalogoPendiente: null }) } })
  await guardarCopia()
  res.json({ ok: true })
})

export default r
