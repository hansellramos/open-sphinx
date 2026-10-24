// Versión ligera (720p H.264) de un video, a pedido. La NAS no tiene la llave privada: el navegador le presta
// la clave del video para este trabajo (llega en la fila y se borra al tomarlo). Los fragmentos se descifran en
// memoria y van por stdin a ffmpeg; lo que sale se cifra con la misma clave en videos/<id>/ligera/.
// Vence a los 7 días (el worker la borra).
import { spawn } from 'node:child_process'
import { readFile, readdir, rename, rm, mkdir, writeFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '../db.ts'
import { paths, videoDir } from './paths.ts'
import { conPrioridadBaja } from './media.ts'
import { decryptBlob, encryptBlob, fromB64u, importFileKey } from '../../shared/crypto.js'

export const VIDA_MS = 7 * 24 * 3600 * 1000
export const ligeraDir = (videoId: string) => path.join(videoDir(videoId), 'ligera')
// Lo que ve el navegador: nunca la clave.
export const ligeraPublica = ({ clave, ...l }: { clave: string | null; [k: string]: unknown }) => l

// Toma la siguiente en cola (de a una) y le quita la clave a la fila en el mismo paso.
export async function tomarLigera() {
  const l = await prisma.ligera.findFirst({ where: { status: 'en_cola' }, orderBy: { createdAt: 'asc' } })
  if (!l) return null
  const { count } = await prisma.ligera.updateMany({
    where: { id: l.id, status: 'en_cola', clave: l.clave },
    data: { status: 'procesando', clave: null, progreso: 0, error: null },
  })
  return count ? l : null
}

// Lado corto a 720 si es mayor (respeta videos verticales).
const ESCALA = "scale='if(gte(iw,ih),-2,min(720,iw))':'if(gte(iw,ih),min(720,ih),-2)'"

export async function hacerLigera(l: { id: string; videoId: string; clave: string | null; duracion: number | null }) {
  if (!l.clave) throw new Error('Sin clave: vuelve a pedirla')
  const key = await importFileKey(fromB64u(l.clave))
  const origen = videoDir(l.videoId)
  const lista = await readFile(path.join(origen, 'index.m3u8'), 'utf8')
  const segs = lista.split('\n').map((x) => x.trim()).filter((x) => /^seg_\d{5}\.m4s$/.test(x))
  if (!segs.length) throw new Error('El video no tiene fragmentos')
  const work = path.join(paths.tmp, `ligera-${l.id}`)
  const destinoTmp = path.join(origen, '.ligera.parcial')
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  try {
    let init: Uint8Array
    try {
      init = new Uint8Array(await decryptBlob(key, await readFile(path.join(origen, 'init.mp4.enc'))))
    } catch {
      throw new Error('La clave no corresponde a este video')
    }
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-y', '-f', 'mp4', '-i', 'pipe:0',
      '-map', '0:v:0', '-map', '0:a:0?', '-vf', ESCALA,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-force_key_frames', 'expr:gte(t,n_forced*2)',
      '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
      '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4',
      '-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_filename', `${work}/seg_%05d.m4s`, `${work}/index.m3u8`,
    ]
    const [bin, ...rest] = conPrioridadBaja('ffmpeg', args)
    const ff = spawn(bin, rest, { stdio: ['pipe', 'pipe', 'pipe'] })
    let err = ''
    let ultimo = 0
    ff.stderr.on('data', (d) => (err = (err + d).slice(-2000)))
    ff.stdout.on('data', (d) => {
      const us = /out_time_us=(\d+)/.exec(String(d))?.[1]
      if (!us || !l.duracion || Date.now() - ultimo < 3000) return
      ultimo = Date.now()
      const progreso = Math.min(99, Math.round((Number(us) / 1e6 / l.duracion) * 100))
      prisma.ligera.update({ where: { id: l.id }, data: { progreso } }).catch(() => {})
    })
    const fin = new Promise<void>((ok, ko) => {
      ff.on('error', ko)
      ff.on('close', (code) => (code === 0 ? ok() : ko(new Error(`ffmpeg salió con ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`))))
    })
    fin.catch(() => {})
    ff.stdin.on('error', () => {}) // si ffmpeg se cae, el error sale por `fin`
    // Espera a que ffmpeg lea (o a que se cierre, para no quedar colgado si se cae).
    const escribir = (b: Uint8Array) =>
      new Promise<void>((ok) => {
        if (ff.stdin.write(b)) return ok()
        const seguir = () => {
          ff.stdin.off('drain', seguir)
          ff.off('close', seguir)
          ok()
        }
        ff.stdin.once('drain', seguir)
        ff.once('close', seguir)
      })
    try {
      await escribir(init)
      for (const s of segs) {
        if (ff.exitCode !== null) break
        await escribir(new Uint8Array(await decryptBlob(key, await readFile(path.join(origen, `${s}.enc`)))))
      }
      ff.stdin.end()
    } catch (e) {
      ff.kill('SIGKILL') // que no quede esperando datos
      throw e
    }
    await fin

    await rm(destinoTmp, { recursive: true, force: true })
    await mkdir(destinoTmp, { recursive: true })
    let size = 0
    for (const f of await readdir(work)) {
      if (f === 'index.m3u8') {
        await copyFile(path.join(work, f), path.join(destinoTmp, f))
        continue
      }
      const cifrado = await encryptBlob(key, await readFile(path.join(work, f)))
      await writeFile(path.join(destinoTmp, `${f}.enc`), cifrado)
      size += cifrado.length
    }
    await rm(ligeraDir(l.videoId), { recursive: true, force: true })
    await rename(destinoTmp, ligeraDir(l.videoId))
    const ahora = new Date()
    await prisma.ligera.update({
      where: { id: l.id },
      data: { status: 'lista', progreso: 100, size, readyAt: ahora, expiresAt: new Date(ahora.getTime() + VIDA_MS), clave: null, error: null },
    })
  } finally {
    await rm(work, { recursive: true, force: true })
    await rm(destinoTmp, { recursive: true, force: true })
  }
}

export async function borrarLigera(l: { id: string; videoId: string }) {
  await rm(ligeraDir(l.videoId), { recursive: true, force: true })
  await prisma.ligera.delete({ where: { id: l.id } }).catch(() => {})
}

// Borra las vencidas. Devuelve cuántas.
export async function vencerLigeras(ahora = new Date()) {
  const vencidas = await prisma.ligera.findMany({ where: { expiresAt: { lte: ahora } } })
  for (const l of vencidas) await borrarLigera(l)
  return vencidas.length
}

// Un trabajo de ligera (si hay). Al fallar queda en error, sin clave.
export async function cicloLigera() {
  const l = await tomarLigera()
  if (!l) return false
  const t0 = Date.now()
  console.log(`[worker] versión ligera ${l.id} del video ${l.videoId}`)
  try {
    await hacerLigera(l)
    console.log(`[worker] versión ligera ${l.id} lista en ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  } catch (e) {
    console.error(`[worker] versión ligera ${l.id} falló: ${e.message}`)
    await prisma.ligera.update({ where: { id: l.id }, data: { status: 'error', error: String(e.message).slice(0, 300), clave: null } }).catch(() => {})
  }
  return true
}

// Al arrancar: lo que quedó a medias ya no tiene clave.
export async function recuperarLigeras() {
  await prisma.ligera.updateMany({ where: { status: 'procesando' }, data: { status: 'error', error: 'Se interrumpió: vuelve a pedirla', clave: null } })
}
