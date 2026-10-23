// ffprobe/ffmpeg/libheif. Cortar videos en fragmentos es con -c copy (sin recodificar): casi solo disco, poca CPU.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, rm } from 'node:fs/promises'
import path from 'node:path'
import exifr from 'exifr'
import { TAM_PARTE, aadParte, encryptBlob, nombreParte } from '../../shared/crypto.js'

// En la NAS: prioridad mínima de CPU y de disco para no molestar a Immich/Jellyfin.
const tieneNice = spawnSync('nice', ['true']).status === 0
const tieneIonice = spawnSync('ionice', ['-c3', 'true']).status === 0

function run(cmd: string, args: string[]): Promise<string> {
  const pre = [...(tieneIonice ? ['ionice', '-c3'] : []), ...(tieneNice ? ['nice', '-n', '19'] : [])]
  const [bin, ...rest] = [...pre, cmd, ...args]
  return new Promise((ok, ko) => {
    const p = spawn(bin, rest, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    p.stdout.on('data', (d) => (out += d))
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
  }
}

const VIDEO_OK = ['h264', 'hevc', 'av1', 'vp9']
const AUDIO_COPIA = ['aac', 'mp3', 'opus', 'ac3', 'eac3']

// HLS con fragmentos fMP4 de ~6 s: index.m3u8 + init.mp4 + seg_00000.m4s…
export async function segmentar(input: string, outDir: string, p: Probe) {
  if (!VIDEO_OK.includes(p.videoCodec)) throw new Error(`Formato de video no soportado todavía: ${p.videoCodec}`)
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy']
  if (p.videoCodec === 'hevc') args.push('-tag:v', 'hvc1') // Safari/Chrome exigen hvc1 en MP4
  if (p.audioCodec && !AUDIO_COPIA.includes(p.audioCodec)) args.push('-c:a', 'aac', '-b:a', '160k')
  else args.push('-c:a', 'copy')
  args.push(
    '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_filename', `${outDir}/seg_%05d.m4s`, `${outDir}/index.m3u8`,
  )
  await run('ffmpeg', args)
}

export async function miniatura(input: string, outFile: string, p: Probe) {
  const t = Math.min(1, p.duration / 2)
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(t), '-i', input, '-frames:v', '1', '-vf', "scale='min(640,iw)':-2", '-q:v', '4', outFile])
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

async function exif(file: string) {
  const e = await exifr.parse(file, { tiff: true, exif: true, gps: true, reviveValues: false, translateValues: false }).catch(() => null)
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

// Cifra el archivo en partes (orig_00000.enc…) leyéndolo por pedazos: no lo carga entero en RAM.
export async function cifrarEnPartes(input: string, outDir: string, key: CryptoKey, tam: number) {
  const total = Math.max(1, Math.ceil(tam / TAM_PARTE))
  const fh = await open(input, 'r')
  try {
    const buf = Buffer.alloc(Math.min(TAM_PARTE, Math.max(tam, 1)))
    for (let i = 0; i < total; i++) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, i * TAM_PARTE)
      const out = await open(path.join(outDir, `${nombreParte(i)}.enc`), 'w')
      await out.writeFile(await encryptBlob(key, buf.subarray(0, bytesRead), aadParte(i, total)))
      await out.close()
    }
  } finally {
    await fh.close()
  }
  return total
}

// Huella del original (para detectar duplicados). Va dentro de los metadatos cifrados, nunca en claro.
export async function sha256(file: string) {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(file)) h.update(chunk)
  return h.digest('hex')
}
