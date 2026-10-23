// La bóveda: clave pública (para que el worker cifre) y la privada envuelta con el código de recuperación.
import { Router } from 'express'
import { writeFile } from 'node:fs/promises'
import { prisma } from '../db.ts'
import { bovedaJson } from '../lib/paths.ts'

// Copia en disco de la clave pública + la privada envuelta con el código (por si se pierde la base).
const guardarCopia = (publicKey, recoveryWrap) => writeFile(bovedaJson(), JSON.stringify({ v: 1, publicKey, recoveryWrap }, null, 1), { mode: 0o600 })

const r = Router()

r.get('/', async (req, res) => {
  const v = await prisma.vault.findUnique({ where: { id: 1 } })
  res.json(v ? { publicKey: v.publicKey, recoveryWrap: JSON.parse(v.recoveryWrap) } : null)
})

// Se crea una sola vez, justo después de registrar la primera passkey.
r.post('/', async (req, res) => {
  if (await prisma.vault.findUnique({ where: { id: 1 } })) return res.status(409).json({ error: 'La bóveda ya existe' })
  const { publicKey, recoveryWrap, prfWrap } = req.body ?? {}
  if (!publicKey || !recoveryWrap?.ct) return res.status(400).json({ error: 'Datos incompletos' })
  await prisma.vault.create({ data: { publicKey, recoveryWrap: JSON.stringify(recoveryWrap) } })
  await guardarCopia(publicKey, recoveryWrap)
  if (prfWrap?.ct) await prisma.credential.update({ where: { id: req.session.credentialId }, data: { prfWrap: JSON.stringify(prfWrap) } })
  res.json({ ok: true })
})

// Cambiar el código de recuperación (la clave privada no cambia, solo cómo se envuelve).
r.put('/recuperacion', async (req, res) => {
  const { recoveryWrap } = req.body ?? {}
  if (!recoveryWrap?.ct) return res.status(400).json({ error: 'Datos incompletos' })
  const v = await prisma.vault.update({ where: { id: 1 }, data: { recoveryWrap: JSON.stringify(recoveryWrap) } })
  await guardarCopia(v.publicKey, recoveryWrap)
  res.json({ ok: true })
})

export default r
