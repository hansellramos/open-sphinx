// Exportar un video: más pequeño (lado corto 720/480, nunca agrandar) y/o con el filtro "posterizado", a pedido.
// La NAS no tiene la llave privada: el navegador le presta la clave del video para este trabajo (llega en la
// fila y se borra al tomarlo). Los fragmentos se descifran en memoria y van por stdin a ffmpeg; lo que sale se
// cifra con la misma clave en videos/<video>/exportados/<id>/. Vence a los 7 días (el worker la borra).
import { spawn } from 'node:child_process'
import { readFile, readdir, rename, rm, mkdir, writeFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '../db.ts'
import { paths, videoDir } from './paths.ts'
import { conPrioridadBaja } from './media.ts'
import { decryptBlob, encryptBlob, fromB64u, importFileKey } from '../../shared/crypto.js'

export const VIDA_MS = 7 * 24 * 3600 * 1000
export const ALTOS = [720, 480]
export const exportDir = (videoId: string, id: string) => path.join(videoDir(videoId), 'exportados', id)
// Lo que ve el navegador: nunca la clave.
export const exportPublica = ({ clave, ...e }: { clave: string | null; [k: string]: unknown }) => e

// ---------------- filtro "posterizado" ----------------
// Por cuadro: desenfoque (reducir a `chico` px el lado corto y volver a agrandar + gaussiano), luminancia con el
// contraste estirado, `niveles` bandas (con `mezcla` del tono continuo para que no queden planas) y paleta.
export const FILTROS = {
  a: { chico: 20, niveles: 6, mezcla: 0.15 },
  b: { chico: 32, niveles: 8, mezcla: 0.15 },
  c: { chico: 14, niveles: 5, mezcla: 0.25 },
} as const
export type Filtro = keyof typeof FILTROS
const VERDE = [[15, 45, 5], [40, 90, 20], [70, 140, 40], [110, 180, 55], [190, 215, 75], [240, 248, 90]]

const par = (n: number) => Math.max(2, Math.round(n / 2) * 2)
const num = (x: number) => Number(x.toFixed(4))

// Paleta interpolada por tramos para un canal: val (0..255) → color.
function canal(c: number) {
  const n = VERDE.length - 1
  let expr = String(VERDE[n][c])
  for (let i = n - 1; i >= 0; i--) {
    const a = VERDE[i][c], b = VERDE[i + 1][c]
    expr = `if(lt(val*${n}/255,${i + 1}),${a}+(${b - a})*(val*${n}/255-${i}),${expr})`
  }
  return expr
}

export function cadenaFiltro(W: number, H: number, f: Filtro) {
  const { chico, niveles: N, mezcla: M } = FILTROS[f]
  const k = chico / Math.min(W, H)
  const sigma = num((2 * Math.max(W, H)) / 200)
  const q = `min(floor(val/255*${N}),${N - 1})/${N - 1}`
  return [
    `scale=${Math.max(2, Math.round(W * k))}:${Math.max(2, Math.round(H * k))}:flags=area`,
    `scale=${W}:${H}:flags=bicubic`,
    `gblur=sigma=${sigma}`,
    'format=rgb24',
    'normalize=smoothing=30:independence=0',
    'format=gray',
    `lut=y='clip((${q}*${num(1 - M)}+val/255*${M})*255,0,255)'`,
    'format=rgb24',
    `lutrgb=r='${canal(0)}':g='${canal(1)}':b='${canal(2)}'`,
  ].join(',')
}

// Tamaño de salida: lado corto = alto pedido (si es menor que el original), pares para H.264.
export function tamanoSalida(w: number, h: number, alto: number | null) {
  const corto = Math.min(w, h)
  if (!alto || alto >= corto) return { W: par(w), H: par(h) }
  return { W: par((w * alto) / corto), H: par((h * alto) / corto) }
}

export function cadena(w: number, h: number, alto: number | null, filtro: Filtro | null) {
  const { W, H } = tamanoSalida(w, h, alto)
  const partes = [`scale=${W}:${H}`]
  if (filtro) partes.push(cadenaFiltro(W, H, filtro))
  partes.push('format=yuv420p')
  return partes.join(',')
}

// ---------------- trabajo ----------------

// Toma la siguiente en cola (de a una) y le quita la clave a la fila en el mismo paso.
export async function tomarExportacion() {
  const e = await prisma.exportacion.findFirst({ where: { status: 'en_cola' }, orderBy: { createdAt: 'asc' } })
  if (!e) return null
  const { count } = await prisma.exportacion.updateMany({
    where: { id: e.id, status: 'en_cola', clave: e.clave },
    data: { status: 'procesando', clave: null, progreso: 0, error: null },
  })
  return count ? e : null
}

// Corre un proceso pasándole `datos` por stdin (sin tocar disco). Devuelve stdout.
function conStdin(cmd: string, args: string[], datos: AsyncIterable<Uint8Array>, alSalir?: (linea: string) => void) {
  const [bin, ...rest] = conPrioridadBaja(cmd, args)
  const p = spawn(bin, rest, { stdio: ['pipe', 'pipe', 'pipe'] })
  let out = '', err = ''
  p.stderr.on('data', (d) => (err = (err + d).slice(-2000)))
  p.stdout.on('data', (d) => {
    out += d
    alSalir?.(String(d))
  })
  const fin = new Promise<string>((ok, ko) => {
    p.on('error', ko)
    p.on('close', (code) => (code === 0 ? ok(out) : ko(new Error(`${cmd} salió con ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`))))
  })
  fin.catch(() => {})
  p.stdin.on('error', () => {}) // si el proceso termina antes (ffprobe), el resultado sale por `fin`
  // Espera a que lea (o a que se cierre, para no quedar colgado si se cae).
  const escribir = (b: Uint8Array) =>
    new Promise<void>((ok) => {
      if (p.stdin.write(b)) return ok()
      const seguir = () => {
        p.stdin.off('drain', seguir)
        p.off('close', seguir)
        ok()
      }
      p.stdin.once('drain', seguir)
      p.once('close', seguir)
    })
  const alimentar = (async () => {
    try {
      for await (const b of datos) {
        if (p.exitCode !== null) break
        await escribir(b)
      }
      p.stdin.end()
    } catch (e) {
      p.kill('SIGKILL')
      throw e
    }
  })()
  return Promise.all([alimentar, fin]).then(([, o]) => o)
}

export async function hacerExportacion(e: { id: string; videoId: string; clave: string | null; duracion: number | null; alto: number | null; filtro: string | null }) {
  if (!e.clave) throw new Error('Sin clave: vuelve a pedirla')
  const filtro = e.filtro && e.filtro in FILTROS ? (e.filtro as Filtro) : null
  const key = await importFileKey(fromB64u(e.clave))
  const origen = videoDir(e.videoId)
  const lista = await readFile(path.join(origen, 'index.m3u8'), 'utf8')
  const segs = lista.split('\n').map((x) => x.trim()).filter((x) => /^seg_\d{5}\.m4s$/.test(x))
  if (!segs.length) throw new Error('El video no tiene fragmentos')
  let init: Uint8Array
  try {
    init = new Uint8Array(await decryptBlob(key, await readFile(path.join(origen, 'init.mp4.enc'))))
  } catch {
    throw new Error('La clave no corresponde a este video')
  }
  async function* fragmentos(cuantos = segs.length) {
    yield init
    for (const s of segs.slice(0, cuantos)) yield new Uint8Array(await decryptBlob(key, await readFile(path.join(origen, `${s}.enc`))))
  }

  // Tamaño que se ve (con la rotación del celular aplicada), leído del inicio del video en memoria.
  const sondeo = JSON.parse(
    await conStdin('ffprobe', ['-v', 'error', '-f', 'mp4', '-i', 'pipe:0', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_side_data=rotation', '-of', 'json'], fragmentos(1)),
  )
  const st = sondeo.streams?.[0]
  if (!st?.width) throw new Error('No se pudo leer el tamaño del video')
  const rot = Math.abs(Number(st.side_data_list?.find((d) => 'rotation' in d)?.rotation ?? 0)) % 180 === 90
  const [w, h] = rot ? [st.height, st.width] : [st.width, st.height]

  const work = path.join(paths.tmp, `exportar-${e.id}`)
  const final = exportDir(e.videoId, e.id)
  const destinoTmp = `${final}.parcial`
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  try {
    let ultimo = 0
    await conStdin(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-y', '-f', 'mp4', '-i', 'pipe:0',
        '-map', '0:v:0', '-map', '0:a:0?', '-vf', cadena(w, h, e.alto, filtro),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-force_key_frames', 'expr:gte(t,n_forced*2)',
        '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
        '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4',
        '-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_filename', `${work}/seg_%05d.m4s`, `${work}/index.m3u8`,
      ],
      fragmentos(),
      (linea) => {
        const us = /out_time_us=(\d+)/.exec(linea)?.[1]
        if (!us || !e.duracion || Date.now() - ultimo < 3000) return
        ultimo = Date.now()
        const progreso = Math.min(99, Math.max(0, Math.round((Number(us) / 1e6 / e.duracion) * 100)))
        prisma.exportacion.update({ where: { id: e.id }, data: { progreso } }).catch(() => {})
      },
    )

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
    await rm(final, { recursive: true, force: true })
    await rename(destinoTmp, final)
    const ahora = new Date()
    await prisma.exportacion.update({
      where: { id: e.id },
      data: { status: 'lista', progreso: 100, size, readyAt: ahora, expiresAt: new Date(ahora.getTime() + VIDA_MS), clave: null, error: null },
    })
  } finally {
    await rm(work, { recursive: true, force: true })
    await rm(destinoTmp, { recursive: true, force: true })
  }
}

export async function borrarExportacion(e: { id: string; videoId: string }) {
  await rm(exportDir(e.videoId, e.id), { recursive: true, force: true })
  await prisma.exportacion.delete({ where: { id: e.id } }).catch(() => {})
}

// Borra las vencidas. Devuelve cuántas.
export async function vencerExportaciones(ahora = new Date()) {
  const vencidas = await prisma.exportacion.findMany({ where: { expiresAt: { lte: ahora } } })
  for (const e of vencidas) await borrarExportacion(e)
  return vencidas.length
}

// Un trabajo (si hay). Al fallar queda en error, sin clave.
export async function cicloExportacion() {
  const e = await tomarExportacion()
  if (!e) return false
  const t0 = Date.now()
  console.log(`[worker] exportación ${e.id} del video ${e.videoId} (${e.alto ?? 'original'}${e.filtro ? `, filtro ${e.filtro}` : ''})`)
  try {
    await hacerExportacion(e)
    console.log(`[worker] exportación ${e.id} lista en ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  } catch (err) {
    console.error(`[worker] exportación ${e.id} falló: ${err.message}`)
    await prisma.exportacion.update({ where: { id: e.id }, data: { status: 'error', error: String(err.message).slice(0, 300), clave: null } }).catch(() => {})
  }
  return true
}

// Al arrancar: lo que quedó a medias ya no tiene clave.
export async function recuperarExportaciones() {
  await prisma.exportacion.updateMany({ where: { status: 'procesando' }, data: { status: 'error', error: 'Se interrumpió: vuelve a pedirla', clave: null } })
}
