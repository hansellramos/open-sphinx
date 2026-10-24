// Exportar un video: más pequeño (lado corto 720/480, nunca agrandar) y/o con el filtro "posterizado", a pedido.
// La NAS no tiene la llave privada: el navegador le presta la clave del video para este trabajo. Vive solo en
// RAM (paths.claves) y se borra al terminar o fallar. Los fragmentos se descifran en memoria y van por stdin a
// ffmpeg; cada fragmento que sale se cifra apenas se cierra (en RAM queda uno o dos) y se va guardando en
// videos/<video>/exportados/<id>.parcial/ con su duración en estado.json. Si se corta (memoria, reinicio), se
// reanuda desde el último fragmento cifrado volviendo a pedirla. Lista: vence a los 7 días.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readdir, rename, rm, mkdir, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '../db.ts'
import { paths, videoDir } from './paths.ts'
import { HLS, cifradorHLS, conPrioridadBaja, entradasHLS, listaVOD } from './media.ts'
import { decryptBlob, fromB64u, importFileKey } from '../../shared/crypto.js'

export const VIDA_MS = 7 * 24 * 3600 * 1000
export const ALTOS = [720, 480]
export const exportDir = (videoId: string, id: string) => path.join(videoDir(videoId), 'exportados', id)
// Lo que ve el navegador. (La columna clave ya no se usa: la clave va en RAM.)
export const exportPublica = ({ clave, ...e }: { clave: string | null; [k: string]: unknown }) => e

// ---------------- clave prestada (en RAM) ----------------
const archivoClave = (id: string) => path.join(paths.claves, id)
export const guardarClave = (id: string, clave: string) => writeFile(archivoClave(id), clave, { mode: 0o600 })
const leerClave = (id: string) => readFile(archivoClave(id), 'utf8').catch(() => null)
export const borrarClave = (id: string) => rm(archivoClave(id), { force: true })

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

// Toma la siguiente en cola (de a una).
export async function tomarExportacion() {
  const e = await prisma.exportacion.findFirst({ where: { status: 'en_cola' }, orderBy: { createdAt: 'asc' } })
  if (!e) return null
  const { count } = await prisma.exportacion.updateMany({ where: { id: e.id, status: 'en_cola' }, data: { status: 'procesando', error: null } })
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
    p.on('close', (code, signal) => {
      if (code === 0) return ok(out)
      // SIGKILL sin que lo pidamos: casi siempre es el sistema por falta de memoria.
      if (signal === 'SIGKILL') return ko(new Error(`${cmd} se quedó sin memoria y el sistema lo detuvo`))
      ko(new Error(`${cmd} salió con ${code ?? signal}: ${err.trim().split('\n').slice(-3).join(' | ')}`))
    })
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
        if (p.exitCode !== null || p.signalCode !== null) break
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

type Estado = { segs: { nombre: string; dur: number; size: number }[] }

export async function hacerExportacion(e: { id: string; videoId: string; duracion: number | null; alto: number | null; filtro: string | null }) {
  const clave = await leerClave(e.id)
  if (!clave) throw new Error('Falta la clave (se reinició la NAS): reanúdala')
  const filtro = e.filtro && e.filtro in FILTROS ? (e.filtro as Filtro) : null
  const key = await importFileKey(fromB64u(clave))
  const origen = videoDir(e.videoId)
  const fuente = entradasHLS(await readFile(path.join(origen, 'index.m3u8'), 'utf8'))
  if (!fuente.length) throw new Error('El video no tiene fragmentos')
  let init: Uint8Array
  try {
    init = new Uint8Array(await decryptBlob(key, await readFile(path.join(origen, 'init.mp4.enc'))))
  } catch {
    throw new Error('La clave no corresponde a este video')
  }
  async function* fragmentos(desde = 0, hasta = fuente.length) {
    yield init
    for (const s of fuente.slice(desde, hasta)) yield new Uint8Array(await decryptBlob(key, await readFile(path.join(origen, `${s.nombre}.enc`))))
  }

  // Tamaño que se ve (con la rotación del celular aplicada), leído del inicio del video en memoria.
  const sondeo = JSON.parse(
    await conStdin('ffprobe', ['-v', 'error', '-f', 'mp4', '-i', 'pipe:0', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_side_data=rotation', '-of', 'json'], fragmentos(0, 1)),
  )
  const st = sondeo.streams?.[0]
  if (!st?.width) throw new Error('No se pudo leer el tamaño del video')
  const rot = Math.abs(Number(st.side_data_list?.find((d) => 'rotation' in d)?.rotation ?? 0)) % 180 === 90
  const [w, h] = rot ? [st.height, st.width] : [st.width, st.height]

  // Lo ya hecho (si se está reanudando): fragmentos cifrados + su duración.
  const final = exportDir(e.videoId, e.id)
  const parcial = `${final}.parcial`
  await mkdir(parcial, { recursive: true })
  const archivoEstado = path.join(parcial, 'estado.json')
  let estado: Estado = JSON.parse(await readFile(archivoEstado, 'utf8').catch(() => '{"segs":[]}'))
  if (estado.segs.length && !existsSync(path.join(parcial, 'init.mp4.enc'))) estado = { segs: [] }
  const hecho = estado.segs.reduce((t, x) => t + x.dur, 0)
  // Desde qué fragmento del original seguir y cuánto saltar dentro de él.
  let k = 0, inicioK = 0
  for (let i = 0, t = 0; i < fuente.length; t += fuente[i].dur, i++) {
    if (t > hecho + 0.001) break
    k = i
    inicioK = t
  }
  const salto = hecho - inicioK
  if (hecho) console.log(`[worker] exportación ${e.id}: reanuda en ${hecho.toFixed(1)} s (fragmento ${estado.segs.length})`)

  const work = path.join(paths.tmp, `exportar-${e.id}`) // en RAM
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true, mode: 0o700 })
  let ultimo = 0
  const progreso = async (t: number) => {
    if (!e.duracion || Date.now() - ultimo < 3000) return
    ultimo = Date.now()
    await prisma.exportacion.update({ where: { id: e.id }, data: { progreso: Math.min(99, Math.max(0, Math.round((t / e.duracion) * 100))) } }).catch(() => {})
  }
  const c = cifradorHLS(work, parcial, key, {
    conInit: estado.segs.length === 0,
    alCifrar: async (s) => {
      estado.segs.push(s)
      await writeFile(archivoEstado, JSON.stringify(estado))
    },
  })
  try {
    await conStdin(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-y',
        // Pocos hilos: decodificar 4K con muchos hilos se come la memoria del contenedor.
        '-threads', '2', '-f', 'mp4', '-i', 'pipe:0', ...(salto > 0.01 ? ['-ss', salto.toFixed(3)] : []),
        '-map', '0:v:0', '-map', '0:a:0?', '-filter_threads', '1', '-vf', cadena(w, h, e.alto, filtro),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-threads', '2', '-force_key_frames', 'expr:gte(t,n_forced*2)',
        '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
        ...(hecho ? ['-output_ts_offset', hecho.toFixed(3)] : []),
        ...HLS, '-start_number', String(estado.segs.length), '-hls_segment_filename', `${work}/seg_%05d.m4s`, `${work}/index.m3u8`,
      ],
      fragmentos(k),
      (linea) => {
        const us = /out_time_us=(\d+)/.exec(linea)?.[1]
        if (us) progreso(hecho + Number(us) / 1e6)
      },
    )
    await c.terminar()
  } catch (err) {
    await c.parar()
    throw err
  } finally {
    await rm(work, { recursive: true, force: true })
  }

  await writeFile(path.join(parcial, 'index.m3u8'), listaVOD(estado.segs))
  await rm(archivoEstado, { force: true })
  let size = 0
  for (const f of await readdir(parcial)) if (f.endsWith('.enc')) size += (await stat(path.join(parcial, f))).size
  await rm(final, { recursive: true, force: true })
  await rename(parcial, final)
  const ahora = new Date()
  await prisma.exportacion.update({
    where: { id: e.id },
    data: { status: 'lista', progreso: 100, size, readyAt: ahora, expiresAt: new Date(ahora.getTime() + VIDA_MS), clave: null, error: null },
  })
}

export async function borrarExportacion(e: { id: string; videoId: string }) {
  await rm(exportDir(e.videoId, e.id), { recursive: true, force: true })
  await rm(`${exportDir(e.videoId, e.id)}.parcial`, { recursive: true, force: true })
  await borrarClave(e.id)
  await prisma.exportacion.delete({ where: { id: e.id } }).catch(() => {})
}

// Reemplaza el video original por una exportación lista (para ahorrar espacio). Ya está cifrada con la misma
// clave, así que solo se mueven archivos: el original va a una carpeta aparte, entra la exportación y, si todo
// salió bien, se borra el original (si algo falla, se devuelve). La miniatura y key.json se quedan.
// No tiene vuelta atrás. La exportación deja de existir como tal (ya no vence).
const ES_VIDEO = (f: string) => f === 'index.m3u8' || f === 'init.mp4.enc' || /^seg_\d{5}\.m4s\.enc$/.test(f)
export async function reemplazarOriginal(e: { id: string; videoId: string }) {
  const dir = videoDir(e.videoId)
  const origen = exportDir(e.videoId, e.id)
  const nuevos = (await readdir(origen)).filter(ES_VIDEO)
  if (!nuevos.includes('index.m3u8') || !nuevos.includes('init.mp4.enc')) throw new Error('La exportación está incompleta')
  const viejo = path.join(dir, '.original-reemplazado')
  await rm(viejo, { recursive: true, force: true })
  await mkdir(viejo)
  const actuales = (await readdir(dir)).filter(ES_VIDEO)
  const movidos: string[] = []
  try {
    for (const f of actuales) await rename(path.join(dir, f), path.join(viejo, f))
    for (const f of nuevos) {
      await rename(path.join(origen, f), path.join(dir, f))
      movidos.push(f)
    }
  } catch (err) {
    for (const f of movidos) await rename(path.join(dir, f), path.join(origen, f)).catch(() => {})
    for (const f of await readdir(viejo)) await rename(path.join(viejo, f), path.join(dir, f)).catch(() => {})
    await rm(viejo, { recursive: true, force: true })
    throw err
  }
  let size = 0
  for (const f of nuevos) if (f !== 'index.m3u8') size += (await stat(path.join(dir, f))).size
  const v = await prisma.video.update({
    where: { id: e.videoId },
    // readyAt cambia: el navegador lo usa para no servirse fragmentos viejos de su caché.
    data: { size, segments: nuevos.filter((f) => f.startsWith('seg_')).length, readyAt: new Date() },
  })
  await rm(viejo, { recursive: true, force: true })
  await borrarExportacion(e)
  return v
}

// Borra las vencidas (y las que quedaron con error hace más de 7 días, con lo hecho a medias). Devuelve cuántas.
export async function vencerExportaciones(ahora = new Date()) {
  const vencidas = await prisma.exportacion.findMany({
    where: { OR: [{ expiresAt: { lte: ahora } }, { status: 'error', createdAt: { lte: new Date(ahora.getTime() - VIDA_MS) } }] },
  })
  for (const e of vencidas) await borrarExportacion(e)
  return vencidas.length
}

// Un trabajo (si hay). Al fallar queda en error (se puede reanudar) y la clave se borra.
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
  } finally {
    await borrarClave(e.id)
  }
  return true
}

// Al arrancar: lo que quedó a medias se puede reanudar (si la clave sigue en RAM, sigue sola). Y ninguna clave en
// la base (antes se guardaban ahí mientras esperaban).
export async function recuperarExportaciones() {
  await prisma.exportacion.updateMany({ where: { status: 'procesando' }, data: { status: 'en_cola' } })
  await prisma.exportacion.updateMany({ where: { clave: { not: null } }, data: { clave: null } })
}
