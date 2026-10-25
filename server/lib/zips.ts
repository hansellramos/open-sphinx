// ZIP con contraseña de varios elementos (tipo Google Takeout). El navegador elige qué va, genera la contraseña y
// manda, para este trabajo, la lista con las claves de cada elemento, los nombres dentro del ZIP y metadatos.json:
// eso vive solo en RAM (paths.claves/zip-<id>.json) y se borra al terminar o fallar. En la base quedan el nombre y
// la lista cifrados con la clave de metadatos y la contraseña sellada con la pública (solo la abre el navegador).
// El ZIP se escribe ya cifrado (WinZip AES-256): cada elemento se descifra en memoria y entra directo. Fotos y
// videos se pueden pedir más pequeños: las fotos se recomprimen en RAM; los videos usan una exportación de ese
// tamaño (la que ya exista, o se crea y queda en Exportaciones). Lista: vence a los 7 días.
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { Writable } from 'node:stream'
import { ZipWriter, configure } from '@zip.js/zip.js'
import { prisma } from '../db.ts'
import { paths, videoDir } from './paths.ts'
import { entradasHLS, run } from './media.ts'
import { VIDA_MS, exportDir, guardarClave, hacerExportacion } from './exportar.ts'
import { aadParte, decryptBlob, fromB64u, importFileKey, nombreParte } from '../../shared/crypto.js'
import { conRotacion, leerRotacion, sumarRotacion } from '../../shared/rotacion.js'
import { numerarFragmentos } from '../../shared/fragmentos.js'

configure({ useWebWorkers: false })

export type ItemZip = {
  id: string
  clave: string // clave del elemento (b64u), prestada
  nombre: string // ruta dentro del ZIP
  tipo: 'imagen' | 'video' | 'archivo'
  parts?: number // fotos y archivos: en cuántas partes está el original
  heic?: boolean // foto HEIC/HEIF (para recomprimirla hay que decodificarla aparte)
  alto?: number | null // pedirla más pequeña: lado corto (si es más grande)
  rotacion?: number // giro elegido en la bóveda (videos)
  duracion?: number | null
}
export type Manifiesto = { password: string; items: ItemZip[]; metadatos: string }

export const zipDir = () => path.join(paths.root, 'zips')
export const zipArchivo = (id: string) => path.join(zipDir(), `${id}.zip`)
const archivoManifiesto = (id: string) => path.join(paths.claves, `zip-${id}.json`)
export const guardarManifiesto = (id: string, m: Manifiesto) => writeFile(archivoManifiesto(id), JSON.stringify(m), { mode: 0o600 })
const leerManifiesto = async (id: string): Promise<Manifiesto | null> => JSON.parse(await readFile(archivoManifiesto(id), 'utf8').catch(() => 'null'))
const borrarManifiesto = (id: string) => rm(archivoManifiesto(id), { force: true })

// Lo que el navegador puede mandar: nombres sin rutas raras, claves con forma de clave, nada de más.
const UUID = /^[0-9a-f-]{36}$/
const NOMBRE_OK = (n: unknown) => typeof n === 'string' && n.length > 0 && n.length <= 240 && !n.startsWith('/') && !n.split('/').some((p) => !p || p === '.' || p === '..') && !/[\\\0]/.test(n)
export function manifiestoValido(m: any): Manifiesto | null {
  if (!m || typeof m.password !== 'string' || m.password.length < 16 || m.password.length > 200) return null
  if (typeof m.metadatos !== 'string' || m.metadatos.length > 20_000_000) return null
  if (!Array.isArray(m.items) || !m.items.length || m.items.length > 20_000) return null
  const nombres = new Set<string>()
  for (const it of m.items) {
    if (!UUID.test(it?.id) || !/^[A-Za-z0-9_-]{43}$/.test(it.clave) || !NOMBRE_OK(it.nombre) || !['imagen', 'video', 'archivo'].includes(it.tipo)) return null
    if (nombres.has(it.nombre) || it.nombre === 'metadatos.json') return null
    nombres.add(it.nombre)
  }
  return { password: m.password, metadatos: m.metadatos, items: m.items.map((it) => ({ id: it.id, clave: it.clave, nombre: it.nombre, tipo: it.tipo, parts: Number(it.parts) || 1, heic: !!it.heic, alto: [1080, 720, 540, 480].includes(it.alto) ? it.alto : null, rotacion: Number(it.rotacion) || 0, duracion: Number(it.duracion) || null })) }
}

// ---------------- contenido de cada elemento ----------------

async function* original(dir: string, key: CryptoKey, parts: number) {
  for (let i = 0; i < parts; i++) yield new Uint8Array(await decryptBlob(key, await readFile(path.join(dir, `${nombreParte(i)}.enc`)), aadParte(i, parts)))
}

// Foto más pequeña: se descifra en RAM, se decodifica (HEIC aparte) y sale como JPEG con el lado corto pedido.
async function fotoReducida(it: ItemZip, key: CryptoKey, trabajo: string) {
  const orig = path.join(trabajo, 'orig')
  const chunks: Uint8Array[] = []
  for await (const c of original(videoDir(it.id), key, it.parts ?? 1)) chunks.push(c)
  await writeFile(orig, Buffer.concat(chunks), { mode: 0o600 })
  let fuente = orig
  const auto: string[] = []
  try {
    if (it.heic) {
      fuente = path.join(trabajo, 'heif.png')
      await run('heif-dec', [orig, fuente])
      auto.push('-noautorotate') // libheif ya la entrega girada
    }
    const A = it.alto!
    const salida = path.join(trabajo, 'foto.jpg')
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...auto, '-i', fuente, '-frames:v', '1', '-vf', `scale=w='if(lt(iw,ih),min(${A},iw),-2)':h='if(lt(iw,ih),-2,min(${A},ih))'`, '-q:v', '3', salida])
    return new Uint8Array(await readFile(salida))
  } finally {
    await rm(trabajo, { recursive: true, force: true })
    await mkdir(trabajo, { recursive: true, mode: 0o700 })
  }
}

// De dónde salen los fragmentos de un video: el original, o una exportación de ese tamaño (la que haya, o una nueva).
async function origenVideo(it: ItemZip) {
  if (!it.alto) return { dir: videoDir(it.id), exportada: false }
  const hay = await prisma.exportacion.findFirst({ where: { videoId: it.id, alto: it.alto, filtro: null, status: 'lista' } })
  if (hay && existsSync(path.join(exportDir(it.id, hay.id), 'index.m3u8'))) return { dir: exportDir(it.id, hay.id), exportada: true }
  // Una en cola o con error del mismo tamaño se toma (y se reanuda); si no, se crea. Queda en Exportaciones.
  const previa = await prisma.exportacion.findFirst({ where: { videoId: it.id, alto: it.alto, filtro: null, status: { in: ['en_cola', 'error'] } } })
  const id = previa?.id ?? randomUUID()
  await guardarClave(id, it.clave)
  const data = { status: 'procesando', error: null, duracion: it.duracion ?? null }
  const e = previa ? await prisma.exportacion.update({ where: { id }, data }) : await prisma.exportacion.create({ data: { ...data, id, videoId: it.id, alto: it.alto, filtro: null } })
  console.log(`[worker] zip: exportación ${id} del video ${it.id} (${it.alto})`)
  try {
    await hacerExportacion(e)
  } catch (err) {
    await prisma.exportacion.update({ where: { id }, data: { status: 'error', error: String(err.message).slice(0, 300) } }).catch(() => {})
    throw err
  } finally {
    await rm(path.join(paths.claves, id), { force: true })
  }
  return { dir: exportDir(it.id, id), exportada: true }
}

// El video como un solo MP4 (init + fragmentos), igual que al compartir: con el giro elegido y la numeración seguida.
async function* video(it: ItemZip, key: CryptoKey) {
  const { dir, exportada } = await origenVideo(it)
  const segs = entradasHLS(await readFile(path.join(dir, 'index.m3u8'), 'utf8'))
  const init = new Uint8Array(await decryptBlob(key, await readFile(path.join(dir, 'init.mp4.enc'))))
  yield conRotacion(init, sumarRotacion(exportada ? 0 : leerRotacion(init), it.rotacion ?? 0))
  let n = 1
  for (const s of segs) {
    const seg = new Uint8Array(await decryptBlob(key, await readFile(path.join(dir, `${s.nombre}.enc`))))
    n = numerarFragmentos(seg, n)
    yield seg
  }
}

async function* uno(c: Uint8Array) {
  yield c
}

// ---------------- el trabajo ----------------

export async function tomarZip() {
  const z = await prisma.zip.findFirst({ where: { status: 'en_cola' }, orderBy: { createdAt: 'asc' } })
  if (!z) return null
  const { count } = await prisma.zip.updateMany({ where: { id: z.id, status: 'en_cola' }, data: { status: 'procesando', error: null } })
  return count ? z : null
}

export async function hacerZip(z: { id: string }) {
  const m = await leerManifiesto(z.id)
  if (!m) throw new Error('Falta la lista con las claves (se reinició la NAS): reanúdalo')
  await mkdir(zipDir(), { recursive: true })
  const parcial = `${zipArchivo(z.id)}.parcial`
  const trabajo = path.join(paths.tmp, `zip-${z.id}`)
  await rm(parcial, { force: true })
  await mkdir(trabajo, { recursive: true, mode: 0o700 })
  await prisma.zip.update({ where: { id: z.id }, data: { total: m.items.length, hechos: 0, size: 0 } })
  const zip = new ZipWriter(Writable.toWeb(createWriteStream(parcial, { mode: 0o600 })), { password: m.password, encryptionStrength: 3, zip64: true, level: 0 })
  try {
    for (const [i, it] of m.items.entries()) {
      const key = await importFileKey(fromB64u(it.clave))
      const fuente = it.tipo === 'video' ? video(it, key) : it.tipo === 'imagen' && it.alto ? uno(await fotoReducida(it, key, trabajo)) : original(videoDir(it.id), key, it.parts ?? 1)
      await zip.add(it.nombre, ReadableStream.from(fuente))
      const size = (await stat(parcial)).size
      await prisma.zip.update({ where: { id: z.id }, data: { hechos: i + 1, size } })
    }
    await zip.add('metadatos.json', ReadableStream.from(uno(new TextEncoder().encode(m.metadatos))), { level: 6 })
    await zip.close()
  } catch (err) {
    await zip.close().catch(() => {})
    await rm(parcial, { force: true })
    throw err
  } finally {
    await rm(trabajo, { recursive: true, force: true })
  }
  await rename(parcial, zipArchivo(z.id))
  const ahora = new Date()
  const { size } = await stat(zipArchivo(z.id))
  await prisma.zip.update({ where: { id: z.id }, data: { status: 'lista', size, readyAt: ahora, expiresAt: new Date(ahora.getTime() + VIDA_MS), error: null } })
}

export async function cicloZip() {
  const z = await tomarZip()
  if (!z) return false
  const t0 = Date.now()
  console.log(`[worker] zip ${z.id}`)
  try {
    await hacerZip(z)
    console.log(`[worker] zip ${z.id} listo en ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  } catch (err) {
    console.error(`[worker] zip ${z.id} falló: ${err.message}`)
    await prisma.zip.update({ where: { id: z.id }, data: { status: 'error', error: String(err.message).slice(0, 300) } }).catch(() => {})
  } finally {
    await borrarManifiesto(z.id)
  }
  return true
}

export async function borrarZip(id: string) {
  await rm(zipArchivo(id), { force: true })
  await rm(`${zipArchivo(id)}.parcial`, { force: true })
  await borrarManifiesto(id)
  await prisma.zip.delete({ where: { id } }).catch(() => {})
}

// Vencidos, y los que quedaron con error hace más de 7 días.
export async function vencerZips(ahora = new Date()) {
  const vencidos = await prisma.zip.findMany({ where: { OR: [{ expiresAt: { lte: ahora } }, { status: 'error', createdAt: { lte: new Date(ahora.getTime() - VIDA_MS) } }] } })
  for (const z of vencidos) await borrarZip(z.id)
  return vencidos.length
}

// Al arrancar: lo que se estaba armando vuelve a la cola (si la lista sigue en RAM, sigue solo; si no, error).
export async function recuperarZips() {
  await prisma.zip.updateMany({ where: { status: 'procesando' }, data: { status: 'en_cola' } })
}
