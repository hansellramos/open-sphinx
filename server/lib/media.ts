// ffprobe/ffmpeg/libheif. Cortar videos en fragmentos es con -c copy (sin recodificar): casi solo disco, poca CPU.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { open, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import exifr from 'exifr'
import { TAM_PARTE, aadParte, encryptBlob, nombreParte } from '../../shared/crypto.js'
import type { Lector } from './temporal.ts'

// En la NAS: prioridad mínima de CPU y de disco para no molestar a Immich/Jellyfin.
const tieneNice = spawnSync('nice', ['true']).status === 0
const tieneIonice = spawnSync('ionice', ['-c3', 'true']).status === 0

export const conPrioridadBaja = (cmd: string, args: string[]) => [...(tieneIonice ? ['ionice', '-c3'] : []), ...(tieneNice ? ['nice', '-n', '19'] : []), cmd, ...args]

// alSalida: cada pedazo de stdout según llega (p. ej. el -progress de ffmpeg).
export function run(cmd: string, args: string[], alSalida?: (s: string) => void): Promise<string> {
  const [bin, ...rest] = conPrioridadBaja(cmd, args)
  return new Promise((ok, ko) => {
    const p = spawn(bin, rest, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    p.stdout.on('data', (d) => (alSalida ? alSalida(String(d)) : (out += d)))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', ko)
    p.on('close', (code) => (code === 0 ? ok(out) : ko(new Error(`${cmd} salió con ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`))))
  })
}

export type Probe = {
  duration: number
  width: number
  height: number
  videoCodec: string
  audioCodec: string | null
  fps: number | null // cuadros por segundo (promedio)
  takenAt: string | null // ISO
  location: { lat: number; lon: number; alt?: number } | null
  device: string | null
}

// "+04.6534-074.0836+2581.123/" (ISO 6709, lo que guarda el iPhone y Android)
export function parseISO6709(v?: string) {
  const m = v?.match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?/)
  if (!m) return null
  const lat = Number(m[1]), lon = Number(m[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null
  return m[3] ? { lat, lon, alt: Math.round(Number(m[3])) } : { lat, lon }
}

// "2021-12-24T19:03:12-0500" (iPhone, hora local con zona) o creation_time en UTC.
export function parseFecha(v?: string) {
  if (!v) return null
  const d = new Date(v.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  return Number.isNaN(d.getTime()) || d.getFullYear() < 1990 ? null : d.toISOString()
}

// "30000/1001" → 29.97; null si no es un número razonable.
function cuadros(r?: string) {
  const [a, b = 1] = String(r ?? '').split('/').map(Number)
  const f = a / b
  return Number.isFinite(f) && f > 0 && f < 1000 ? Math.round(f * 100) / 100 : null
}

export async function probe(file: string): Promise<Probe> {
  const j = JSON.parse(await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]))
  const v = j.streams?.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
  if (!v) throw new Error('El archivo no tiene video')
  const a = j.streams?.find((s) => s.codec_type === 'audio')
  const rot = Math.abs(Number(v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0))
  const girado = rot === 90 || rot === 270
  const t = Object.fromEntries(Object.entries({ ...(v.tags ?? {}), ...(j.format?.tags ?? {}) }).map(([k, val]) => [k.toLowerCase(), String(val)]))
  const make = t['com.apple.quicktime.make'] ?? t.make
  const model = t['com.apple.quicktime.model'] ?? t.model
  return {
    takenAt: parseFecha(t['com.apple.quicktime.creationdate']) ?? parseFecha(t.creation_time),
    location: parseISO6709(t['com.apple.quicktime.location.iso6709'] ?? t.location ?? t['location-eng']),
    device: [make, model].filter(Boolean).join(' ') || null,
    duration: Number(j.format?.duration ?? v.duration ?? 0),
    width: girado ? v.height : v.width,
    height: girado ? v.width : v.height,
    videoCodec: v.codec_name,
    audioCodec: a?.codec_name ?? null,
    fps: cuadros(v.avg_frame_rate) ?? cuadros(v.r_frame_rate),
  }
}

const VIDEO_OK = ['h264', 'hevc', 'av1', 'vp9']
const AUDIO_COPIA = ['aac', 'mp3', 'opus', 'ac3', 'eac3']

// HLS con fragmentos fMP4 de ~6 s: index.m3u8 + init.mp4 + seg_00000.m4s… La lista es tipo EVENT: ffmpeg la
// reescribe con cada fragmento que cierra, así cifradorHLS sabe cuáles ya están completos.
export const HLS = ['-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'event', '-hls_flags', 'temp_file', '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4']
// progreso: fracción (0–1) de lo segmentado, según el tiempo que va.
export async function segmentar(input: string, outDir: string, p: Probe, progreso?: (f: number) => void) {
  if (!VIDEO_OK.includes(p.videoCodec)) throw new Error(`Formato de video no soportado todavía: ${p.videoCodec}`)
  const args = ['-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy']
  if (p.videoCodec === 'hevc') args.push('-tag:v', 'hvc1') // Safari/Chrome exigen hvc1 en MP4
  if (p.audioCodec && !AUDIO_COPIA.includes(p.audioCodec)) args.push('-c:a', 'aac', '-b:a', '160k')
  else args.push('-c:a', 'copy')
  args.push(...HLS, '-hls_segment_filename', `${outDir}/seg_%05d.m4s`, `${outDir}/index.m3u8`)
  await run('ffmpeg', args, (s) => {
    const us = [...s.matchAll(/^out_time_us=(\d+)/gm)].at(-1)?.[1]
    if (us && p.duration > 0) progreso?.(Math.min(1, Number(us) / 1e6 / p.duration))
  })
}

export async function miniatura(input: string, outFile: string, p: Probe) {
  const t = Math.min(1, p.duration / 2)
  // Un solo hilo: con todos, un 4K HEVC de 10 bits (Dolby Vision del iPhone) usaba ~750 MB solo para este cuadro y
  // llevó al worker a su límite (la NAS se quedó sin memoria). Con uno, ~210 MB.
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-threads', '1', '-ss', String(t), '-i', input, '-frames:v', '1', '-filter_threads', '1', '-vf', "scale='min(640,iw)':-2", '-q:v', '4', outFile])
}

// ---------------- tipo de elemento ----------------

export type Tipo = 'video' | 'imagen' | 'archivo'
const EXT_VIDEO = /\.(mp4|mov|m4v|mkv|webm|avi|3gp)$/i
const EXT_IMAGEN = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|tiff?)$/i
const EXT_HEIF = /\.(heic|heif|avif)$/i
// Las que cualquier navegador muestra tal cual (el resto se convierte a JPEG para verla).
const EXT_NATIVA = /\.(jpe?g|png|gif|webp)$/i

export function tipoDe(nombre: string, mime?: string | null): Tipo {
  if (mime?.startsWith('image/') || EXT_IMAGEN.test(nombre)) return 'imagen'
  if (mime?.startsWith('video/') || EXT_VIDEO.test(nombre)) return 'video'
  return 'archivo'
}

// ---------------- imágenes ----------------

export type InfoImagen = {
  width: number
  height: number
  vista: boolean // true: hay una copia JPEG para ver (vista.jpg) porque el original no se ve en el navegador
  takenAt: string | null
  location: { lat: number; lon: number; alt?: number } | null
  device: string | null
}

// "2021:12:24 19:03:12" + "-05:00" (EXIF) → ISO. Sin zona se toma la hora local del contenedor (TZ).
function fechaExif(d?: string, zona?: string) {
  if (!d || typeof d !== 'string') return null
  return parseFecha(d.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T') + (zona ?? ''))
}

// exifr con una ruta abre el archivo y, con algunos PNG, no lo cierra: desde Node 26.12 eso tumba el proceso
// ("FileHandle closed during garbage collection"). Por eso se le pasa el inicio del archivo ya leído (el EXIF va
// al principio; en PNG puede ir más adelante, por eso hasta 16 MB).
const MAX_EXIF = 16 * 1024 * 1024
async function exif(file: string) {
  const fh = await open(file, 'r')
  let buf: Buffer
  try {
    buf = Buffer.alloc(Math.min((await fh.stat()).size, MAX_EXIF))
    await fh.read(buf, 0, buf.length, 0)
  } finally {
    await fh.close()
  }
  const e = await exifr.parse(buf, { tiff: true, exif: true, gps: true, reviveValues: false, translateValues: false }).catch(() => null)
  if (!e) return { takenAt: null, location: null, device: null, orientation: 1 }
  const lat = e.latitude, lon = e.longitude
  const okGps = Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  const alt = Number(e.GPSAltitude)
  return {
    takenAt: fechaExif(e.DateTimeOriginal ?? e.CreateDate, e.OffsetTimeOriginal ?? e.OffsetTime),
    location: okGps ? { lat: +lat.toFixed(6), lon: +lon.toFixed(6), ...(Number.isFinite(alt) && { alt: Math.round(e.GPSAltitudeRef === 1 ? -alt : alt) }) } : null,
    device: [e.Make, e.Model].filter(Boolean).map((x) => String(x).trim()).join(' ') || null,
    orientation: Number(e.Orientation) || 1,
  }
}

async function dimensiones(file: string) {
  const j = JSON.parse(await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-select_streams', 'v:0', file]))
  const v = j.streams?.[0]
  if (!v?.width) throw new Error('No es una imagen que se pueda leer')
  return { width: v.width, height: v.height }
}

const MINI = ['-frames:v', '1', '-vf', "scale='min(640,iw)':-2", '-q:v', '4']

// Deja en outDir thumb.jpg (y vista.jpg si hace falta). ffmpeg aplica la rotación EXIF de los JPEG;
// libheif ya entrega las HEIC giradas, por eso ahí se usa -noautorotate.
export async function prepararImagen(input: string, nombre: string, outDir: string): Promise<InfoImagen> {
  const ex = await exif(input)
  const thumb = path.join(outDir, 'thumb.jpg')
  const vista = path.join(outDir, 'vista.jpg')
  if (EXT_NATIVA.test(nombre)) {
    const d = await dimensiones(input)
    const girada = ex.orientation >= 5 && ex.orientation <= 8
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, ...MINI, thumb])
    return { ...(girada ? { width: d.height, height: d.width } : d), vista: false, takenAt: ex.takenAt, location: ex.location, device: ex.device }
  }
  let fuente = input
  const auto: string[] = []
  if (EXT_HEIF.test(nombre)) {
    fuente = path.join(outDir, 'heif.png')
    await run('heif-dec', [input, fuente])
    auto.push('-noautorotate')
  }
  try {
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...auto, '-i', fuente, '-frames:v', '1', '-q:v', '2', vista])
  } finally {
    if (fuente !== input) await rm(fuente, { force: true })
  }
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', vista, ...MINI, thumb])
  return { ...(await dimensiones(vista)), vista: true, takenAt: ex.takenAt, location: ex.location, device: ex.device }
}

// ---------------- originales en partes ----------------

// Cifra el original en partes (orig_00000.enc…) leyéndolo por pedazos de la subida: no lo carga entero en RAM.
export async function cifrarEnPartes(l: Lector, outDir: string, key: CryptoKey, progreso?: (f: number) => void) {
  const total = Math.max(1, Math.ceil(l.size / TAM_PARTE))
  for (let i = 0; i < total; i++) {
    const plano = await l.leer(i * TAM_PARTE, TAM_PARTE)
    await writeFile(path.join(outDir, `${nombreParte(i)}.enc`), await encryptBlob(key, plano, aadParte(i, total)))
    plano.fill(0)
    progreso?.((i + 1) / total)
  }
  return total
}

// Huella del original (para detectar duplicados). Va dentro de los metadatos cifrados, nunca en claro.
export async function sha256(l: Lector, progreso?: (f: number) => void) {
  const h = createHash('sha256')
  let leido = 0
  for await (const chunk of l.flujo()) {
    h.update(chunk)
    leido += chunk.length
    progreso?.(l.size ? leido / l.size : 1)
  }
  return h.digest('hex')
}

// ---------------- HLS cifrado al vuelo ----------------

// Fragmentos completos de una lista HLS (con su duración), en orden.
export function entradasHLS(lista: string) {
  const out: { nombre: string; dur: number }[] = []
  const lineas = lista.split('\n').map((x) => x.trim())
  for (let i = 0; i < lineas.length - 1; i++) {
    const m = /^#EXTINF:([\d.]+),?$/.exec(lineas[i])
    if (m && /^seg_\d{5}\.m4s$/.test(lineas[i + 1])) out.push({ nombre: lineas[i + 1], dur: Number(m[1]) })
  }
  return out
}

export function listaVOD(segs: { nombre: string; dur: number }[]) {
  const max = Math.max(1, ...segs.map((x) => Math.ceil(x.dur)))
  return [
    '#EXTM3U', '#EXT-X-VERSION:7', `#EXT-X-TARGETDURATION:${max}`, '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-INDEPENDENT-SEGMENTS', '#EXT-X-MAP:URI="init.mp4"', ...segs.flatMap((x) => [`#EXTINF:${x.dur.toFixed(6)},`, x.nombre]), '#EXT-X-ENDLIST', '',
  ].join('\n')
}

// Mientras ffmpeg escribe HLS en `dir` (en RAM), cifra cada fragmento apenas aparece en la lista (ya está
// completo) y borra el que quedó en claro; así en RAM hay uno o dos a la vez. init.mp4 se cifra con el primero
// (si `conInit`). `alCifrar` se llama por cada uno, en orden. `terminar()` hace la última pasada (al salir ffmpeg).
// `ajustar` puede cambiar cada fragmento en claro antes de cifrarlo (p. ej. corregir sus tiempos).
export function cifradorHLS(
  dir: string,
  destino: string,
  key: CryptoKey,
  { conInit = true, alCifrar, ajustar }: { conInit?: boolean; alCifrar?: (s: { nombre: string; dur: number; size: number }) => Promise<void> | void; ajustar?: (plano: Buffer) => void } = {},
) {
  const hechos = new Set<string>()
  let initHecho = !conInit
  let cola = Promise.resolve()
  let error: Error | null = null
  const pasada = () =>
    (cola = cola.then(async () => {
      if (error) return
      try {
        const entradas = entradasHLS(await readFile(path.join(dir, 'index.m3u8'), 'utf8').catch(() => ''))
        if (!entradas.length) return
        const init = path.join(dir, 'init.mp4')
        if (!initHecho && existsSync(init)) {
          const plano = await readFile(init)
          await writeFile(path.join(destino, 'init.mp4.enc'), await encryptBlob(key, plano))
          initHecho = true
        }
        if (existsSync(init) && initHecho) await rm(init, { force: true })
        for (const e of entradas) {
          if (hechos.has(e.nombre)) continue
          const f = path.join(dir, e.nombre)
          const plano = await readFile(f)
          ajustar?.(plano)
          const cifrado = await encryptBlob(key, plano)
          await writeFile(path.join(destino, `${e.nombre}.enc`), cifrado)
          await rm(f, { force: true })
          plano.fill(0)
          hechos.add(e.nombre)
          await alCifrar?.({ ...e, size: cifrado.length })
        }
      } catch (e) {
        error = e
      }
    }))
  const timer = setInterval(pasada, 500)
  return {
    async terminar() {
      clearInterval(timer)
      await pasada()
      if (error) throw error
      if (!initHecho) throw new Error('ffmpeg no produjo init.mp4')
    },
    parar() {
      clearInterval(timer)
      return cola
    },
  }
}
