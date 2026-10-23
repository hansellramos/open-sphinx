// ffprobe/ffmpeg. Cortar en fragmentos es con -c copy (sin recodificar): casi solo disco, poca CPU.
import { spawn, spawnSync } from 'node:child_process'

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

export type Probe = { duration: number; width: number; height: number; videoCodec: string; audioCodec: string | null }

export async function probe(file: string): Promise<Probe> {
  const j = JSON.parse(await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]))
  const v = j.streams?.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
  if (!v) throw new Error('El archivo no tiene video')
  const a = j.streams?.find((s) => s.codec_type === 'audio')
  const rot = Math.abs(Number(v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0))
  const girado = rot === 90 || rot === 270
  return {
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
