// Rotación en el init.mp4: leerla y reescribirla (shared/rotacion.js), con videos de prueba hechos con ffmpeg.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { leerRotacion, conRotacion, sumarRotacion } from '../../shared/rotacion.js'

const dir = mkdtempSync(path.join(tmpdir(), 'boveda-rot-'))
after(() => rmSync(dir, { recursive: true, force: true }))

execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30', '-t', '2', '-c:v', 'libx264', '-g', '30', '-pix_fmt', 'yuv420p', path.join(dir, 'a.mp4')])

// Igual que el worker: HLS fMP4 con -c copy. Devuelve el init.mp4.
function initCon(displayRotation: number) {
  const sub = path.join(dir, `r${displayRotation}`)
  execFileSync('mkdir', ['-p', sub])
  execFileSync('ffmpeg', ['-loglevel', 'error', '-display_rotation', String(displayRotation), '-i', path.join(dir, 'a.mp4'), '-c', 'copy',
    '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', `${sub}/seg_%05d.m4s`, `${sub}/index.m3u8`])
  return { init: new Uint8Array(readFileSync(path.join(sub, 'init.mp4'))), seg: readFileSync(path.join(sub, 'seg_00000.m4s')) }
}

// ffprobe da la rotación en sentido antihorario; la nuestra es horaria.
function rotacionFfprobe(init: Uint8Array, seg: Buffer) {
  const f = path.join(dir, `p-${Math.random()}.mp4`)
  writeFileSync(f, Buffer.concat([init, seg]))
  const s = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream_side_data=rotation', '-of', 'csv=p=0', f]).toString().trim()
  return ((360 - (Number(s) || 0)) % 360 + 360) % 360
}

test('lee la rotación del init (como la del iPhone: girar 90° a la derecha)', () => {
  assert.equal(leerRotacion(initCon(0).init), 0)
  assert.equal(leerRotacion(initCon(-90).init), 90)
  assert.equal(leerRotacion(initCon(90).init), 270)
  assert.equal(leerRotacion(initCon(180).init), 180)
})

test('reescribe la rotación sin tocar el original y ffprobe la entiende', () => {
  const { init, seg } = initCon(-90)
  const copia = new Uint8Array(init)
  for (const g of [0, 90, 180, 270]) {
    const nuevo = conRotacion(init, g)
    assert.equal(leerRotacion(nuevo), g)
    assert.equal(rotacionFfprobe(nuevo, seg), g)
    assert.equal(nuevo.length, init.length)
  }
  assert.deepEqual(init, copia, 'no modifica el que recibe')
})

test('sin pista de video o con basura: 0 y sin romper', () => {
  assert.equal(leerRotacion(new Uint8Array(0)), 0)
  assert.equal(leerRotacion(new Uint8Array([0, 0, 0, 3, 1, 2, 3])), 0)
  assert.equal(conRotacion(new Uint8Array([1, 2, 3]), 90).length, 3)
})

test('suma de rotaciones', () => {
  assert.equal(sumarRotacion(90, 270), 0)
  assert.equal(sumarRotacion(270, 180), 90)
  assert.equal(sumarRotacion(undefined, 90), 90)
})
