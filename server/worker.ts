// Worker de la cola: toma un trabajo a la vez. Videos: los corta en fragmentos; fotos: miniatura (y copia
// JPEG si es HEIC); archivos: tal cual. Todo se cifra con una clave nueva por elemento, esa clave se sella
// con la clave pública de la bóveda y se borra lo que quedó sin cifrar.
import 'dotenv/config'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from './db.ts'
import { borrarSubida, paths, videoDir } from './lib/paths.ts'
import { cifrarEnPartes, miniatura, prepararImagen, probe, segmentar, sha256, tipoDe, type InfoImagen, type Probe } from './lib/media.ts'
import { encryptBlob, encryptJSON, newFileKey, sealFileKey } from '../shared/crypto.js'

const ESPERA_MS = 5_000
const MAX_INTENTOS = 3

export async function procesar(videoId: string) {
  const video = await prisma.video.findUniqueOrThrow({ where: { id: videoId } })
  const vault = await prisma.vault.findUnique({ where: { id: 1 } })
  if (!vault) throw new Error('La bóveda no está creada')
  const input = path.join(paths.subidas, video.uploadId ?? '')
  const work = path.join(paths.tmp, video.id)
  const destinoTmp = path.join(paths.videos, `.${video.id}.parcial`)
  const nombre = video.originalName ?? 'archivo'
  const limpiarWork = async () => {
    await rm(work, { recursive: true, force: true })
    await mkdir(work, { recursive: true })
  }
  await rm(destinoTmp, { recursive: true, force: true })
  await limpiarWork()
  await mkdir(destinoTmp, { recursive: true })
  try {
    // Qué es: un video que no se puede reproducir o una imagen que no se puede leer se guardan como archivo.
    const huella = await sha256(input)
    let tipo = tipoDe(nombre, video.mime)
    let p: Probe | null = null
    let img: InfoImagen | null = null
    if (tipo === 'video') {
      try {
        p = await probe(input)
        await segmentar(input, work, p)
        await miniatura(input, path.join(work, 'thumb.jpg'), p).catch((e) => console.warn(`[worker] sin miniatura: ${e.message}`))
      } catch (e) {
        console.warn(`[worker] no se pudo preparar como video (${e.message}); se guarda como archivo`)
        tipo = 'archivo'
        p = null
        await limpiarWork()
      }
    } else if (tipo === 'imagen') {
      try {
        img = await prepararImagen(input, nombre, work)
      } catch (e) {
        console.warn(`[worker] no se pudo preparar como imagen (${e.message}); se guarda como archivo`)
        tipo = 'archivo'
        await limpiarWork()
      }
    }

    const fk = await newFileKey()
    const archivos = (await readdir(work)).filter((f) => f !== 'index.m3u8')
    for (const f of archivos) {
      const plano = await readFile(path.join(work, f))
      await writeFile(path.join(destinoTmp, `${f}.enc`), await encryptBlob(fk.key, plano))
      await rm(path.join(work, f)) // lo sin cifrar se borra apenas se cifra
    }
    if (p) await copyFile(path.join(work, 'index.m3u8'), path.join(destinoTmp, 'index.m3u8'))
    // Fotos y archivos: también el original, en partes.
    const parts = p ? null : await cifrarEnPartes(input, destinoTmp, fk.key, (await stat(input)).size)
    const keyWrap = await sealFileKey(vault.publicKey, fk.raw)
    fk.raw.fill(0)
    // Metadatos (incluido el tipo y la fecha/ubicación/equipo) cifrados con la clave del elemento.
    // sellado: lo que el navegador mandó sellado al subir (etiquetas); lo aplica el navegador al abrirlo.
    const comunes = {
      v: 1, kind: tipo, title: nombre.replace(/\.[^.]+$/, '') || nombre, originalName: nombre, mime: video.mime || null,
      sha256: huella, tags: [], favorite: false, ...(video.extra && { sellado: JSON.parse(video.extra) }),
    }
    const datos = p
      ? { takenAt: p.takenAt, location: p.location, device: p.device, duration: p.duration, width: p.width, height: p.height, videoCodec: p.videoCodec }
      : img
        ? { takenAt: img.takenAt, location: img.location, device: img.device, width: img.width, height: img.height, vista: img.vista, parts }
        : { takenAt: null, location: null, device: null, parts }
    const meta = await encryptJSON(fk.key, { ...comunes, ...datos })
    console.log(`[worker] ${tipo}: fecha ${datos.takenAt ? 'sí' : 'no'}, ubicación ${datos.location ? 'sí' : 'no'}, equipo ${datos.device ? 'sí' : 'no'}`)
    // La carpeta queda autocontenida: con ella + el código de recuperación se puede abrir aunque se pierda la base.
    await writeFile(path.join(destinoTmp, 'key.json'), JSON.stringify({ v: 2, keyWrap, meta }))

    await rm(videoDir(video.id), { recursive: true, force: true })
    await rename(destinoTmp, videoDir(video.id))
    await prisma.video.update({
      where: { id: video.id },
      data: {
        status: 'listo',
        error: null,
        meta,
        title: null,
        originalName: null,
        mime: null,
        extra: null,
        segments: p ? archivos.filter((f) => f.startsWith('seg_')).length : null,
        keyWrap: JSON.stringify(keyWrap),
        readyAt: new Date(),
        uploadId: null,
      },
    })
    if (video.uploadId) await borrarSubida(video.uploadId)
  } finally {
    await rm(work, { recursive: true, force: true })
    await rm(destinoTmp, { recursive: true, force: true })
  }
}

// Respaldo diario de la base (03:30) con VACUUM INTO; se conservan 7. Solo tiene claves envueltas y títulos.
let ultimoRespaldo = ''
async function respaldoDiario() {
  const ahora = new Date()
  const hoy = ahora.toLocaleDateString('sv', { timeZone: process.env.TZ || 'America/Bogota' })
  const hora = Number(ahora.toLocaleTimeString('en-GB', { timeZone: process.env.TZ || 'America/Bogota', hour: '2-digit', hour12: false }))
  if (hoy === ultimoRespaldo || hora < 3) return
  const dir = path.join(paths.root, 'backups')
  await mkdir(dir, { recursive: true })
  const destino = path.join(dir, `boveda-${hoy}.db`)
  await rm(destino, { force: true })
  await prisma.$executeRawUnsafe(`VACUUM INTO '${destino.replace(/'/g, "''")}'`)
  ultimoRespaldo = hoy
  const viejos = (await readdir(dir)).filter((f) => /^boveda-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -7)
  for (const f of viejos) await rm(path.join(dir, f), { force: true })
  console.log(`[worker] respaldo de la base: ${destino}`)
}

async function tomarTrabajo() {
  const job = await prisma.job.findFirst({ where: { status: 'pendiente' }, orderBy: { createdAt: 'asc' } })
  if (!job) return null
  const { count } = await prisma.job.updateMany({
    where: { id: job.id, status: 'pendiente' },
    data: { status: 'corriendo', startedAt: new Date(), attempts: { increment: 1 } },
  })
  return count ? { ...job, attempts: job.attempts + 1 } : null
}

async function ciclo() {
  const job = await tomarTrabajo()
  if (!job) return false
  const t0 = Date.now()
  console.log(`[worker] trabajo ${job.id}: ${job.type} ${job.videoId} (intento ${job.attempts})`)
  await prisma.video.update({ where: { id: job.videoId }, data: { status: 'procesando' } }).catch(() => {})
  try {
    await procesar(job.videoId)
    await prisma.job.update({ where: { id: job.id }, data: { status: 'hecho', finishedAt: new Date(), error: null } })
    console.log(`[worker] trabajo ${job.id} listo en ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  } catch (e) {
    console.error(`[worker] trabajo ${job.id} falló: ${e.message}`)
    const reintentar = job.attempts < MAX_INTENTOS && !/no soportado|no tiene video/.test(e.message)
    await prisma.job.update({ where: { id: job.id }, data: { status: reintentar ? 'pendiente' : 'error', error: e.message, finishedAt: new Date() } })
    if (!reintentar) await prisma.video.update({ where: { id: job.videoId }, data: { status: 'error', error: e.message } }).catch(() => {})
    else await prisma.video.update({ where: { id: job.videoId }, data: { status: 'en_cola' } }).catch(() => {})
  }
  return true
}

if (import.meta.main) {
  // Si el worker murió a mitad de un trabajo, se vuelve a encolar.
  await prisma.job.updateMany({ where: { status: 'corriendo' }, data: { status: 'pendiente' } })
  console.log('[worker] esperando trabajos…')
  let parar = false
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => (parar = true))
  while (!parar) {
    await respaldoDiario().catch((e) => console.error('[worker] respaldo falló:', e.message))
    const hubo = await ciclo().catch((e) => (console.error('[worker]', e), false))
    if (!hubo) await new Promise((r) => setTimeout(r, ESPERA_MS))
  }
  await prisma.$disconnect()
}
