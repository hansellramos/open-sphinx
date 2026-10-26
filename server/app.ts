// Aplicación Express (API + frontend compilado). index.ts la pone a escuchar.
import 'dotenv/config'
import express from 'express'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { authRoutes, isAuthenticated, leerSesion, sesion, setupAuth } from './auth.ts'
import bovedaRoutes from './routes/boveda.ts'
import videoRoutes, { subidas } from './routes/videos.ts'
import etiquetaRoutes from './routes/etiquetas.ts'
import exportadosRoutes from './routes/exportados.ts'
import zipsRoutes from './routes/zips.ts'
import colaRoutes from './routes/cola.ts'
import horusRoutes from './routes/horus.ts'
import { filtroHorus } from './lib/horus.ts'

const app = express()
app.disable('x-powered-by')
setupAuth(app)

// Subidas tus: van antes de express.json porque leen el cuerpo crudo.
app.all(['/api/subidas', '/api/subidas/*splat'], leerSesion, isAuthenticated, subidas)

app.use(sesion)

app.use('/api/zips', express.json({ limit: '25mb' })) // la lista con las claves de cada elemento del ZIP
app.use(express.json({ limit: '1mb' }))
app.get('/api/health', (req, res) => res.json({ ok: true }))
app.use('/api/auth', authRoutes)

const api = express.Router()
api.use(isAuthenticated)
api.use(filtroHorus)
api.use('/horus', horusRoutes)
api.use('/boveda', bovedaRoutes)
api.use('/videos', videoRoutes)
api.use('/etiquetas', etiquetaRoutes)
api.use('/exportados', exportadosRoutes)
api.use('/zips', zipsRoutes)
api.use('/cola', colaRoutes)
app.use('/api', api)

// En producción la API también sirve el frontend compilado (npm run build → dist/).
const dist = fileURLToPath(new URL('../dist', import.meta.url))
if (existsSync(dist)) app.use(express.static(dist))

app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: 'Error interno del servidor' })
})

export default app
