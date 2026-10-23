// Autenticación con passkeys (WebAuthn) y sesión. Reemplaza el login usuario/clave de AirCore:
// la app es personal, así que no hay usuarios, solo las passkeys registradas.
// El secreto PRF (que abre la bóveda) lo calcula el navegador y nunca llega aquí.
import session from 'express-session'
import { Router } from 'express'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { prisma } from './db.ts'
import { PrismaSessionStore } from './lib/session-store.ts'

const RP_ID = process.env.RP_ID ?? 'localhost'
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:5181'
const USER_ID = new TextEncoder().encode('boveda-owner')

export const sesion = session({
  store: new PrismaSessionStore(),
  secret: process.env.SESSION_SECRET ?? 'dev-secret',
  name: 'boveda.sid',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'strict', secure: 'auto', maxAge: 12 * 3_600_000 },
})

// Solo lee la sesión, sin envolver la respuesta: express-session parchea res.write/end y eso
// rompe a tus, que escribe la respuesta por su cuenta.
const resFalsa = { writeHead() {}, write() {}, end() {}, on() {}, once() {}, emit() {}, getHeader() {}, setHeader() {} }
export const leerSesion = (req, res, next) => sesion(req, resFalsa, next)

export function setupAuth(app) {
  app.set('trust proxy', 1)
}

export function isAuthenticated(req, res, next) {
  if (req.session?.ok) return next()
  res.status(401).json({ error: 'Sesión expirada' })
}

const credencialPublica = (c) => ({ id: c.id, name: c.name, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt, prf: !!c.prfWrap })

export const authRoutes = Router()

authRoutes.get('/estado', async (req, res) => {
  const [vault, credenciales] = await Promise.all([prisma.vault.findUnique({ where: { id: 1 } }), prisma.credential.count()])
  res.json({ configurada: !!vault && credenciales > 0, passkeys: credenciales, sesion: !!req.session?.ok })
})

// ---- Registro de passkey: solo si no hay ninguna (primera vez) o con sesión abierta (agregar otra) ----

authRoutes.post('/registro/opciones', async (req, res) => {
  const existentes = await prisma.credential.findMany()
  if (existentes.length && !req.session?.ok) return res.status(403).json({ error: 'Ya hay passkeys registradas; entra primero' })
  const options = await generateRegistrationOptions({
    rpName: 'Bóveda',
    rpID: RP_ID,
    userName: 'boveda',
    userDisplayName: 'Bóveda',
    userID: USER_ID,
    attestationType: 'none',
    excludeCredentials: existentes.map((c) => ({ id: c.id, transports: c.transports ? JSON.parse(c.transports) : undefined })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  })
  req.session.regChallenge = options.challenge
  res.json(options)
})

authRoutes.post('/registro/verificar', async (req, res) => {
  const existentes = await prisma.credential.count()
  if (existentes && !req.session?.ok) return res.status(403).json({ error: 'No autorizado' })
  const expectedChallenge = req.session.regChallenge
  delete req.session.regChallenge
  if (!expectedChallenge) return res.status(400).json({ error: 'Vuelve a intentarlo' })
  let v
  try {
    v = await verifyRegistrationResponse({ response: req.body.response, expectedChallenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true })
  } catch (e) {
    return res.status(400).json({ error: `Passkey no válida: ${e.message}` })
  }
  if (!v.verified) return res.status(400).json({ error: 'Passkey no verificada' })
  const { credential } = v.registrationInfo
  const c = await prisma.credential.create({
    data: {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ? JSON.stringify(credential.transports) : null,
      name: String(req.body.name || 'Passkey').slice(0, 60),
    },
  })
  req.session.ok = true
  req.session.credentialId = c.id
  res.json(credencialPublica(c))
})

// ---- Entrar con passkey (discoverable: no hace falta escribir nada) ----

authRoutes.post('/login/opciones', async (req, res) => {
  const options = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: 'required' })
  req.session.authChallenge = options.challenge
  res.json(options)
})

authRoutes.post('/login/verificar', async (req, res) => {
  const expectedChallenge = req.session.authChallenge
  delete req.session.authChallenge
  const resp = req.body.response
  const c = resp?.id && (await prisma.credential.findUnique({ where: { id: resp.id } }))
  if (!expectedChallenge || !c) return res.status(400).json({ error: 'Passkey desconocida' })
  let v
  try {
    v = await verifyAuthenticationResponse({
      response: resp,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
      credential: { id: c.id, publicKey: new Uint8Array(c.publicKey), counter: c.counter, transports: c.transports ? JSON.parse(c.transports) : undefined },
    })
  } catch (e) {
    return res.status(400).json({ error: `Passkey no válida: ${e.message}` })
  }
  if (!v.verified) return res.status(401).json({ error: 'Passkey no verificada' })
  await prisma.credential.update({ where: { id: c.id }, data: { counter: v.authenticationInfo.newCounter, lastUsedAt: new Date() } })
  await new Promise((ok, ko) => req.session.regenerate((e) => (e ? ko(e) : ok())))
  req.session.ok = true
  req.session.credentialId = c.id
  res.json({ credentialId: c.id, prfWrap: c.prfWrap ? JSON.parse(c.prfWrap) : null })
})

authRoutes.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }))
})

// ---- Con sesión ----

authRoutes.get('/credenciales', isAuthenticated, async (req, res) => {
  const cs = await prisma.credential.findMany({ orderBy: { createdAt: 'asc' } })
  res.json(cs.map((c) => ({ ...credencialPublica(c), actual: c.id === req.session.credentialId })))
})

// Guarda la clave privada envuelta con el PRF de una passkey (lo calcula el navegador).
authRoutes.put('/credenciales/:id/prf', isAuthenticated, async (req, res) => {
  const { salt, iv, ct } = req.body.prfWrap ?? {}
  if (!salt || !iv || !ct) return res.status(400).json({ error: 'Datos incompletos' })
  const c = await prisma.credential.update({ where: { id: req.params.id }, data: { prfWrap: JSON.stringify({ salt, iv, ct }) } })
  res.json(credencialPublica(c))
})

authRoutes.put('/credenciales/:id', isAuthenticated, async (req, res) => {
  const c = await prisma.credential.update({ where: { id: req.params.id }, data: { name: String(req.body.name || 'Passkey').slice(0, 60) } })
  res.json(credencialPublica(c))
})

authRoutes.delete('/credenciales/:id', isAuthenticated, async (req, res) => {
  if ((await prisma.credential.count()) <= 1) return res.status(400).json({ error: 'No puedes borrar la única passkey' })
  if (req.params.id === req.session.credentialId) return res.status(400).json({ error: 'No puedes borrar la passkey con la que entraste' })
  await prisma.credential.delete({ where: { id: req.params.id } })
  res.json({ ok: true })
})
