// Worker de la cola: toma un trabajo a la vez. Videos: los corta en fragmentos; fotos: miniatura (y copia
// JPEG si es HEIC); archivos: tal cual. Todo se cifra con una clave nueva por elemento, esa clave se sella
// con la clave pública de la bóveda. La subida llega cifrada con una llave temporal (lib/temporal.ts) y lo que
// hace falta en claro vive en RAM (paths.tmp) solo mientras se usa. En otra fila, a la vez, hace las
// exportaciones pedidas (de a una) y borra las vencidas.
import 'dotenv/config'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { prisma } from './db.ts'
import { borrarSubida, paths, videoDir } from './lib/paths.ts'
import { cifradorHLS, cifrarEnPartes, listaVOD, miniatura, prepararImagen, probe, segmentar, sha256, tipoDe, type InfoImagen, type Probe } from './lib/media.ts'
import { abrirSubida, leerLlave, servir } from './lib/temporal.ts'
import { encryptBlob, encryptJSON, newFileKey, sealFileKey } from '../shared/crypto.js'
import { cicloExportacion, recuperarExportaciones, vencerExportaciones } from './lib/exportar.ts'

const ESPERA_MS = 5_000
const MAX_INTENTOS = 3
const MAX_IMAGEN = 200 * 1024 * 1024 // más grande que esto no se descifra en RAM: se guarda como archivo

export async function procesar(videoId: string) {
  const video = await prisma.video.findUniqueOrThrow({ where: { id: videoId } })
  const vault = await prisma.vault.findUnique({ where: { id: 1 } })
  if (!vault) throw new Error('La bóveda no está creada')
  if (!video.uploadId) {
    // Ya se había procesado (p. ej. el worker se cayó justo después de guardar): solo queda marcarlo listo.
    if (video.meta && video.keyWrap) {
      await prisma.video.update({ where: { id: video.id }, data: { status: 'listo', error: null } })
      return
    }
    throw new Error('No se encontró el archivo subido')
  }
  // La subida está cifrada con una llave temporal (en RAM); se lee descifrando al vuelo.
  const subida = await abrirSubida(video.uploadId)
  const work = path.join(paths.tmp, video.id) // en RAM
  const destinoTmp = path.join(paths.videos, `.${video.id}.parcial`)
  const nombre = video.originalName ?? 'archivo'
  const limpiarWork = async () => {
    await rm(work, { recursive: true, force: true })
    await mkdir(work, { recursive: true, mode: 0o700 })
  }
  await rm(destinoTmp, { recursive: true, force: true })
  await limpiarWork()
  await mkdir(destinoTmp, { recursive: true })
  const fk = await newFileKey()
  const local = await servir(subida)
  try {
    // Qué es: un video que no se puede reproducir o una imagen que no se puede leer se guardan como archivo.
    const huella = await sha256(subida)
    let tipo = tipoDe(nombre, video.mime)
    let p: Probe | null = null
    let img: InfoImagen | null = null
    const segmentos: { nombre: string; dur: number }[] = []
    if (tipo === 'video') {
      // Los fragmentos se cifran apenas ffmpeg los cierra: en RAM quedan uno o dos a la vez.
      const c = cifradorHLS(work, destinoTmp, fk.key, { alCifrar: (s) => void segmentos.push(s) })
      try {
        p = await probe(local.url)
        await segmentar(local.url, work, p)
        await c.terminar()
      } catch (e) {
        await c.parar()
        console.warn(`[worker] no se pudo preparar como video (${e.message}); se guarda como archivo`)
        tipo = 'archivo'
        p = null
        segmentos.length = 0
        await limpiarWork()
        await rm(destinoTmp, { recursive: true, force: true })
        await mkdir(destinoTmp, { recursive: true })
      }
      if (p) await miniatura(local.url, path.join(work, 'thumb.jpg'), p).catch((e) => console.warn(`[worker] sin miniatura: ${e.message}`))
    } else if (tipo === 'imagen') {
      // Las imágenes se descifran enteras en RAM (las herramientas necesitan el archivo); una enorme va como archivo.
      if (subida.size > MAX_IMAGEN) tipo = 'archivo'
      else {
        const original = path.join(work, 'original')
        try {
          await pipeline(subida.flujo(), createWriteStream(original, { mode: 0o600 }))
          img = await prepararImagen(original, nombre, work)
        } catch (e) {
          console.warn(`[worker] no se pudo preparar como imagen (${e.message}); se guarda como archivo`)
          tipo = 'archivo'
          await limpiarWork()
        } finally {
          await rm(original, { force: true })
        }
      }
    }

    // Miniatura y copia para ver (lo que quede en work, que es poco).
    for (const f of (await readdir(work)).filter((f) => /^(thumb|vista)\.jpg$/.test(f))) {
      const plano = await readFile(path.join(work, f))
      await writeFile(path.join(destinoTmp, `${f}.enc`), await encryptBlob(fk.key, plano))
      await rm(path.join(work, f)) // lo sin cifrar se borra apenas se cifra
    }
    if (p) await writeFile(path.join(destinoTmp, 'index.m3u8'), listaVOD(segmentos))
    // Fotos y archivos: también el original, en partes.
    const parts = p ? null : await cifrarEnPartes(subida, destinoTmp, fk.key)
    const keyWrap = await sealFileKey(vault.publicKey, fk.raw)
    const datos = p
      ? { takenAt: p.takenAt, location: p.location, device: p.device, duration: p.duration, width: p.width, height: p.height, videoCodec: p.videoCodec }
      : img
        ? { takenAt: img.takenAt, location: img.location, device: img.device, width: img.width, height: img.height, vista: img.vista, parts }
        : { takenAt: null, location: null, device: null, parts }
    console.log(`[worker] ${tipo}: fecha ${datos.takenAt ? 'sí' : 'no'}, ubicación ${datos.location ? 'sí' : 'no'}, equipo ${datos.device ? 'sí' : 'no'}`)

    // Metadatos (incluido el tipo y la fecha/ubicación/equipo) cifrados con la clave del elemento.
    // sellado: lo que el navegador mandó sellado (etiquetas, fecha); lo aplica el navegador al abrirlo. Se puede
    // cambiar mientras se procesa (PUT /subidas/:id/ajuste), así que se relee y se guarda solo si no cambió.
    for (;;) {
      const { extra } = await prisma.video.findUniqueOrThrow({ where: { id: video.id }, select: { extra: true } })
      const comunes = {
        v: 1, kind: tipo, title: nombre.replace(/\.[^.]+$/, '') || nombre, originalName: nombre, mime: video.mime || null,
        sha256: huella, tags: [], favorite: false, ...(extra && { sellado: JSON.parse(extra) }),
      }
      const meta = await encryptJSON(fk.key, { ...comunes, ...datos })
      // La carpeta queda autocontenida: con ella + el código de recuperación se puede abrir aunque se pierda la base.
      await writeFile(path.join(destinoTmp, 'key.json'), JSON.stringify({ v: 2, keyWrap, meta }))
      await rm(videoDir(video.id), { recursive: true, force: true })
      await rename(destinoTmp, videoDir(video.id))
      const { count } = await prisma.video.updateMany({
        where: { id: video.id, extra },
        data: {
          status: 'listo',
          error: null,
          meta,
          title: null,
          originalName: null,
          mime: null,
          extra: null,
          segments: p ? segmentos.length : null,
          keyWrap: JSON.stringify(keyWrap),
          readyAt: new Date(),
          uploadId: null,
        },
      })
      if (count) break
      await rename(videoDir(video.id), destinoTmp) // cambiaron las etiquetas justo ahora: otra vuelta
    }
    fk.raw.fill(0)
    await borrarSubida(video.uploadId)
  } finally {
    local.cerrar()
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

// Subidas huérfanas: una completa sin elemento que la use (p. ej. el worker se cayó después de procesarla y antes
// de borrarla) se borra a los 10 min; una incompleta abandonada, a los 7 días (mientras tanto se puede reanudar).
// Una sin llave (se reinició la NAS) ya no sirve: se borra. También lo que quedó en RAM sin subida.
export async function limpiarSubidas(ahora = Date.now()) {
  let borradas = 0
  const enDisco = (await readdir(paths.subidas)).filter((x) => !x.endsWith('.json'))
  for (const id of enDisco) {
    if (await prisma.video.count({ where: { uploadId: id } })) continue
    const info = await stat(path.join(paths.subidas, id)).catch(() => null)
    const declarado = JSON.parse(await readFile(path.join(paths.llavesSubida, `${id}.json`), 'utf8').catch(() => '{}')).size
    const edad = ahora - (info?.mtimeMs ?? 0)
    const completa = info && Number.isFinite(declarado) && info.size === declarado
    const sinLlave = !(await leerLlave(id))
    if (sinLlave || (completa && edad > 10 * 60_000) || edad > 7 * 24 * 3600_000) {
      await borrarSubida(id)
      borradas++
    }
  }
  for (const f of await readdir(paths.llavesSubida)) {
    const id = f.replace(/\.(json|key)$/, '')
    if (enDisco.includes(id)) continue
    const info = await stat(path.join(paths.llavesSubida, f)).catch(() => null)
    if (info && ahora - info.mtimeMs > 60_000 && !(await prisma.video.count({ where: { uploadId: id } }))) await borrarSubida(id)
  }
  if (borradas) console.log(`[worker] subidas huérfanas borradas: ${borradas}`)
  return borradas
}
let ultimaLimpieza = 0

async function tomarTrabajo() {
  const job = await prisma.job.findFirst({ where: { status: 'pendiente' }, orderBy: { createdAt: 'asc' } })
  if (!job) return null
  const { count } = await prisma.job.updateMany({
    where: { id: job.id, status: 'pendiente' },
    data: { status: 'corriendo', startedAt: new Date(), attempts: { increment: 1 } },
  })
  return count ? { ...job, attempts: job.attempts + 1 } : null
}

export async function ciclo() {
  const job = await tomarTrabajo()
  if (!job) return false
  const t0 = Date.now()
  // Si el proceso se cae a mitad (no alcanza a anotar el error), el trabajo vuelve a "pendiente" al arrancar:
  // sin este tope, un archivo que tumba el worker lo dejaría reiniciándose para siempre y la cola no avanzaría.
  if (job.attempts > MAX_INTENTOS) {
    const error = 'El procesamiento se interrumpió varias veces'
    await prisma.job.update({ where: { id: job.id }, data: { status: 'error', error, finishedAt: new Date() } })
    await prisma.video.update({ where: { id: job.videoId }, data: { status: 'error', error } }).catch(() => {})
    console.error(`[worker] trabajo ${job.id}: ${error}`)
    return true
  }
  console.log(`[worker] trabajo ${job.id}: ${job.type} ${job.videoId} (intento ${job.attempts})`)
  await prisma.video.update({ where: { id: job.videoId }, data: { status: 'procesando' } }).catch(() => {})
  try {
    await procesar(job.videoId)
    await prisma.job.update({ where: { id: job.id }, data: { status: 'hecho', finishedAt: new Date(), error: null } })
    console.log(`[worker] trabajo ${job.id} listo en ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  } catch (e) {
    console.error(`[worker] trabajo ${job.id} falló: ${e.message}`)
    const reintentar = job.attempts < MAX_INTENTOS && !/no soportado|no tiene video|no se encontró el archivo subido|la subida se perdió/i.test(e.message)
    await prisma.job.update({ where: { id: job.id }, data: { status: reintentar ? 'pendiente' : 'error', error: e.message, finishedAt: new Date() } })
    if (!reintentar) await prisma.video.update({ where: { id: job.videoId }, data: { status: 'error', error: e.message } }).catch(() => {})
    else await prisma.video.update({ where: { id: job.videoId }, data: { status: 'en_cola' } }).catch(() => {})
  }
  return true
}

// Dos filas independientes: lo que subes (rápido) y las exportaciones (pueden tardar horas). Una no frena a la otra.
async function fila(nombre: string, paso: () => Promise<boolean>, debeParar: () => boolean) {
  while (!debeParar()) {
    const hubo = await paso().catch((e) => (console.error(`[worker] ${nombre}:`, e), false))
    if (!hubo) await new Promise((r) => setTimeout(r, ESPERA_MS))
  }
}

if (import.meta.main) {
  // Si el worker murió a mitad de un trabajo, se vuelve a encolar. Lo que quedó en RAM a medias se borra.
  await prisma.job.updateMany({ where: { status: 'corriendo' }, data: { status: 'pendiente' } })
  await rm(paths.tmp, { recursive: true, force: true })
  await mkdir(paths.tmp, { recursive: true, mode: 0o700 })
  await recuperarExportaciones()
  console.log('[worker] esperando trabajos…')
  let parar = false
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => (parar = true))
  const mantenimiento = async () => {
    let ultimoVencer = 0
    while (!parar) {
      await respaldoDiario().catch((e) => console.error('[worker] respaldo falló:', e.message))
      if (Date.now() - ultimaLimpieza > 10 * 60_000) {
        ultimaLimpieza = Date.now()
        await limpiarSubidas().catch((e) => console.error('[worker] limpieza de subidas falló:', e.message))
      }
      if (Date.now() - ultimoVencer > 60_000) {
        ultimoVencer = Date.now()
        await vencerExportaciones().then((n) => n && console.log(`[worker] ${n} exportación(es) vencida(s) borrada(s)`), (e) => console.error('[worker] vencer exportaciones:', e.message))
      }
      await new Promise((r) => setTimeout(r, ESPERA_MS))
    }
  }
  await Promise.all([fila('subidas', ciclo, () => parar), fila('exportaciones', cicloExportacion, () => parar), mantenimiento()])
  await prisma.$disconnect()
}
