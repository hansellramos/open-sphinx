// Prueba de punta a punta del worker: video, foto y archivo de prueba → cifrados → descifrar y verificar.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const dir = mkdtempSync(path.join(tmpdir(), 'boveda-test-'))
process.env.DATA_DIR = dir
process.env.DATABASE_URL = `file:${dir}/db/boveda.db`

let prisma, procesar, c, paths
before(async () => {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: process.env, stdio: 'ignore' })
  ;({ prisma } = await import('../db.ts'))
  ;({ procesar } = await import('../worker.ts'))
  ;({ paths } = await import('../lib/paths.ts'))
  c = await import('../../shared/crypto.js')
})
after(async () => {
  await prisma?.$disconnect()
  rmSync(dir, { recursive: true, force: true })
})

for (const codec of ['libx264', 'libx265']) {
  test(`procesa un video ${codec} y solo deja material cifrado`, async () => {
    const { publicKey, privatePkcs8 } = await c.generateVaultKeys()
    await prisma.vault.upsert({ where: { id: 1 }, create: { publicKey, recoveryWrap: '{}' }, update: { publicKey } })
    const uploadId = `up-${codec}`
    const input = path.join(paths.subidas, uploadId)
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440',
      '-t', '20', '-c:v', codec, '-pix_fmt', 'yuv420p', '-g', '30', '-c:a', 'aac',
      // Metadatos como los del iPhone
      '-metadata', 'com.apple.quicktime.location.ISO6709=+04.6534-074.0836+2581.123/',
      '-metadata', 'com.apple.quicktime.creationdate=2021-12-24T19:03:12-0500',
      '-metadata', 'com.apple.quicktime.make=Apple', '-metadata', 'com.apple.quicktime.model=iPhone 12',
      '-movflags', 'use_metadata_tags', '-f', 'mov', input])
    writeFileSync(`${input}.json`, '{}')
    const v = await prisma.video.create({ data: { originalName: 'IMG_0001.MOV', uploadId } })

    await procesar(v.id)

    const listo = await prisma.video.findUniqueOrThrow({ where: { id: v.id } })
    assert.equal(listo.status, 'listo')
    assert.equal(listo.originalName, null, 'el nombre en claro se borra')
    assert.ok(listo.segments >= 3)
    assert.ok(!existsSync(input) && !existsSync(`${input}.json`), 'borra la subida sin cifrar')
    assert.deepEqual(readdirSync(paths.tmp), [], 'no deja temporales')
    const vdir = path.join(paths.videos, v.id)
    const files = readdirSync(vdir)
    assert.ok(files.every((f) => f === 'index.m3u8' || f === 'key.json' || f.endsWith('.enc')))
    const kj = JSON.parse(readFileSync(path.join(vdir, 'key.json'), 'utf8'))
    assert.deepEqual(kj.keyWrap, JSON.parse(listo.keyWrap))
    assert.equal(kj.meta, listo.meta)

    // Descifrar con la privada y reconstruir un MP4 reproducible.
    const key = await c.openFileKey(await c.importPrivateKey(privatePkcs8), JSON.parse(listo.keyWrap))
    const meta = await c.decryptJSON(key, listo.meta)
    assert.equal(meta.kind, 'video')
    assert.equal(meta.title, 'IMG_0001')
    assert.ok(Math.abs(meta.duration - 20) < 0.5)
    assert.deepEqual(meta.location, { lat: 4.6534, lon: -74.0836, alt: 2581 })
    assert.equal(meta.takenAt, '2021-12-25T00:03:12.000Z')
    assert.equal(meta.device, 'Apple iPhone 12')
    const plano = []
    for (const f of ['init.mp4.enc', ...files.filter((f) => f.startsWith('seg_')).sort()])
      plano.push(Buffer.from(await c.decryptBlob(key, readFileSync(path.join(vdir, f)))))
    const out = path.join(dir, `rearmado-${codec}.mp4`)
    writeFileSync(out, Buffer.concat(plano))
    const d = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString())
    assert.ok(Math.abs(d - 20) < 0.5, `duración rearmada ${d}`)
    const thumb = Buffer.from(await c.decryptBlob(key, readFileSync(path.join(vdir, 'thumb.jpg.enc'))))
    assert.equal(thumb.subarray(0, 2).toString('hex'), 'ffd8', 'miniatura JPEG')
    if (codec === 'libx265') assert.equal(meta.videoCodec, 'hevc')
  })
}

async function nuevaBoveda() {
  const { publicKey, privatePkcs8 } = await c.generateVaultKeys()
  await prisma.vault.upsert({ where: { id: 1 }, create: { publicKey, recoveryWrap: '{}' }, update: { publicKey } })
  return privatePkcs8
}

async function abrir(privatePkcs8, id) {
  const listo = await prisma.video.findUniqueOrThrow({ where: { id } })
  assert.equal(listo.status, 'listo', listo.error ?? '')
  const key = await c.openFileKey(await c.importPrivateKey(privatePkcs8), JSON.parse(listo.keyWrap))
  return { listo, key, meta: await c.decryptJSON(key, listo.meta), vdir: path.join(paths.videos, id) }
}

async function original(key, vdir, parts) {
  const out = []
  for (let i = 0; i < parts; i++) out.push(Buffer.from(await c.decryptBlob(key, readFileSync(path.join(vdir, `${c.nombreParte(i)}.enc`)), c.aadParte(i, parts))))
  return Buffer.concat(out)
}

test('procesa una foto con EXIF de celular (fecha, GPS, equipo, girada) y guarda el original', async () => {
  const priv = await nuevaBoveda()
  const { conExif } = await import('./exif.ts')
  const uploadId = 'up-foto'
  const input = path.join(paths.subidas, uploadId)
  const base = path.join(dir, 'base.jpg')
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=800x400', '-frames:v', '1', base])
  const foto = conExif(readFileSync(base), { fecha: '2023:07:14 16:20:05', zona: '-05:00', lat: 6.2442, lon: -75.5812, alt: 1495, make: 'Apple', model: 'iPhone 15 Pro', orientacion: 6 })
  writeFileSync(input, foto)
  writeFileSync(`${input}.json`, '{}')
  const v = await prisma.video.create({ data: { originalName: 'IMG_2000.JPG', mime: 'image/jpeg', uploadId } })

  await procesar(v.id)

  const { listo, key, meta, vdir } = await abrir(priv, v.id)
  assert.equal(listo.mime, null, 'el tipo en claro se borra')
  assert.equal(meta.kind, 'imagen')
  assert.equal(meta.title, 'IMG_2000')
  assert.equal(meta.takenAt, '2023-07-14T21:20:05.000Z')
  assert.equal(meta.device, 'Apple iPhone 15 Pro')
  assert.equal(meta.location.lat.toFixed(4), '6.2442')
  assert.equal(meta.location.lon.toFixed(4), '-75.5812')
  assert.equal(meta.location.alt, 1495)
  assert.deepEqual([meta.width, meta.height], [400, 800], 'girada según EXIF')
  assert.equal(meta.vista, false, 'un JPEG se ve tal cual')
  assert.equal(meta.parts, 1)
  assert.ok(readdirSync(vdir).every((f) => f === 'key.json' || f.endsWith('.enc')))
  assert.ok((await original(key, vdir, meta.parts)).equals(foto), 'el original queda idéntico')
  const thumb = path.join(dir, 'thumb-foto.jpg')
  writeFileSync(thumb, Buffer.from(await c.decryptBlob(key, readFileSync(path.join(vdir, 'thumb.jpg.enc')))))
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', thumb]).toString().trim().split(',').map(Number)
  assert.ok(h > w, `miniatura derecha (${w}x${h})`)
})

test('procesa un archivo cualquiera en partes, sin poder reordenarlas', async () => {
  const priv = await nuevaBoveda()
  const uploadId = 'up-archivo'
  const input = path.join(paths.subidas, uploadId)
  const datos = Buffer.alloc(c.TAM_PARTE * 2 + 12345)
  for (let i = 0; i < datos.length; i += 4096) datos.writeUInt32BE(i, i)
  writeFileSync(input, datos)
  writeFileSync(`${input}.json`, '{}')
  const sellado = { k: { epk: 'x', iv: 'y', ct: 'z' }, d: 'cifrado-por-el-navegador' }
  const v = await prisma.video.create({ data: { originalName: 'contrato.pdf', mime: 'application/pdf', uploadId, extra: JSON.stringify(sellado) } })

  await procesar(v.id)

  const { key, meta, vdir } = await abrir(priv, v.id)
  assert.equal(meta.kind, 'archivo')
  assert.equal(meta.mime, 'application/pdf')
  assert.equal(meta.parts, 3)
  assert.ok((await original(key, vdir, 3)).equals(datos))
  assert.equal(meta.sha256, createHash('sha256').update(datos).digest('hex'), 'huella del original, cifrada')
  assert.deepEqual(meta.sellado, sellado, 'lo sellado al subir pasa a los metadatos')
  assert.equal((await prisma.video.findUniqueOrThrow({ where: { id: v.id } })).extra, null)
  await assert.rejects(c.decryptBlob(key, readFileSync(path.join(vdir, 'orig_00001.enc')), c.aadParte(0, 3)), 'una parte no sirve en otra posición')
  assert.ok(!existsSync(input))
})

test('un video que no se puede reproducir se guarda como archivo', async () => {
  const priv = await nuevaBoveda()
  const uploadId = 'up-roto'
  const input = path.join(paths.subidas, uploadId)
  writeFileSync(input, Buffer.from('no es un video de verdad'))
  writeFileSync(`${input}.json`, '{}')
  const v = await prisma.video.create({ data: { originalName: 'roto.mp4', mime: 'video/mp4', uploadId } })
  await procesar(v.id)
  const { key, meta, vdir } = await abrir(priv, v.id)
  assert.equal(meta.kind, 'archivo')
  assert.equal((await original(key, vdir, meta.parts)).toString(), 'no es un video de verdad')
})

test('tamaño de exportación: lado corto pedido, nunca agrandar, respeta verticales', async () => {
  const { tamanoSalida } = await import('../lib/exportar.ts')
  assert.deepEqual(tamanoSalida(1920, 1080, 720), { W: 1280, H: 720 })
  assert.deepEqual(tamanoSalida(1080, 1920, 480), { W: 480, H: 854 })
  assert.deepEqual(tamanoSalida(640, 360, 720), { W: 640, H: 360 })
  assert.deepEqual(tamanoSalida(1920, 1080, null), { W: 1920, H: 1080 })
})

// Rearma el MP4 de una exportación descifrando sus archivos.
async function rearmar(key, edir, nombre) {
  const segs = readFileSync(path.join(edir, 'index.m3u8'), 'utf8').split('\n').filter((x) => /^seg_\d{5}\.m4s$/.test(x))
  const plano = [Buffer.from(await c.decryptBlob(key, readFileSync(path.join(edir, 'init.mp4.enc'))))]
  for (const s of segs) plano.push(Buffer.from(await c.decryptBlob(key, readFileSync(path.join(edir, `${s}.enc`)))))
  const out = path.join(dir, nombre)
  writeFileSync(out, Buffer.concat(plano))
  return out
}
const dimensiones = (f) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', f]).toString().trim()

test('exportar: 720p y 480p con filtro, cifrado con la clave prestada, sin dejar la clave, y vence', async () => {
  const priv = await nuevaBoveda()
  const { cicloExportacion, vencerExportaciones, recuperarExportaciones, exportDir } = await import('../lib/exportar.ts')
  const uploadId = 'up-exportar'
  const input = path.join(paths.subidas, uploadId)
  execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440',
    '-t', '14', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', '-c:a', 'aac', '-f', 'mov', input])
  writeFileSync(`${input}.json`, '{}')
  const v = await prisma.video.create({ data: { originalName: 'GRANDE.MOV', uploadId } })
  await procesar(v.id)
  const { listo, key, vdir } = await abrir(priv, v.id)

  // El navegador presta los bytes de la clave del video.
  const clave = c.b64u(await c.openFileKeyRaw(await c.importPrivateKey(priv), JSON.parse(listo.keyWrap)))
  const e720 = await prisma.exportacion.create({ data: { videoId: v.id, clave, duracion: 14, alto: 720 } })
  const eFiltro = await prisma.exportacion.create({ data: { videoId: v.id, clave, duracion: 14, alto: 480, filtro: 'a' } })
  assert.equal(await cicloExportacion(), true)
  assert.equal((await prisma.exportacion.findUniqueOrThrow({ where: { id: eFiltro.id } })).status, 'en_cola', 'de a una')
  assert.equal(await cicloExportacion(), true)
  for (const e of [e720, eFiltro]) {
    const hecha = await prisma.exportacion.findUniqueOrThrow({ where: { id: e.id } })
    assert.equal(hecha.status, 'lista', hecha.error ?? '')
    assert.equal(hecha.clave, null, 'no queda la clave')
    assert.ok(hecha.size > 0 && hecha.expiresAt.getTime() - Date.now() > 6.9 * 24 * 3600e3)
    assert.ok(readdirSync(exportDir(v.id, e.id)).every((f) => f === 'index.m3u8' || f.endsWith('.enc')), 'solo cifrado')
  }
  assert.deepEqual(readdirSync(paths.tmp), [], 'no deja temporales')

  const mp4 = await rearmar(key, exportDir(v.id, e720.id), 'exp-720.mp4')
  assert.equal(dimensiones(mp4), 'h264,1280,720')
  const d = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).toString())
  assert.ok(Math.abs(d - 14) < 0.6, `duración ${d}`)

  // Con filtro: 480p y todos los píxeles en la paleta verde→amarillo (verde manda, poco azul).
  const filtrado = await rearmar(key, exportDir(v.id, eFiltro.id), 'exp-480-a.mp4')
  assert.equal(dimensiones(filtrado), 'h264,854,480')
  const crudo = execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', '5', '-i', filtrado, '-frames:v', '1', '-vf', 'scale=107:60', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  let fuera = 0
  for (let i = 0; i < crudo.length; i += 3) {
    const [r, g, b] = [crudo[i], crudo[i + 1], crudo[i + 2]]
    if (!(g >= r - 12 && g >= b + 20)) fuera++
  }
  assert.ok(fuera / (crudo.length / 3) < 0.03, `píxeles fuera de la paleta: ${fuera}`)

  // Clave equivocada → error y sin clave guardada.
  await prisma.exportacion.update({ where: { id: e720.id }, data: { status: 'en_cola', clave: c.b64u(new Uint8Array(32)) } })
  await cicloExportacion()
  const mala = await prisma.exportacion.findUniqueOrThrow({ where: { id: e720.id } })
  assert.equal(mala.status, 'error')
  assert.match(mala.error, /clave no corresponde/)
  assert.equal(mala.clave, null)

  // Interrumpida: al arrancar queda en error.
  await prisma.exportacion.update({ where: { id: e720.id }, data: { status: 'procesando' } })
  await recuperarExportaciones()
  assert.equal((await prisma.exportacion.findUniqueOrThrow({ where: { id: e720.id } })).status, 'error')

  // Vencen: se borran las carpetas y las filas; el video completo sigue.
  await prisma.exportacion.updateMany({ data: { status: 'lista', expiresAt: new Date(Date.now() - 1000) } })
  assert.equal(await vencerExportaciones(), 2)
  assert.ok(!existsSync(exportDir(v.id, eFiltro.id)))
  assert.equal(await prisma.exportacion.count(), 0)
  assert.ok(existsSync(path.join(vdir, 'init.mp4.enc')))
})

test('usar una exportación como original: reemplaza los fragmentos, conserva la miniatura y borra el original', async () => {
  const priv = await nuevaBoveda()
  const { cicloExportacion, reemplazarOriginal, exportDir } = await import('../lib/exportar.ts')
  const uploadId = 'up-reemplazar'
  const input = path.join(paths.subidas, uploadId)
  execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440',
    '-t', '8', '-c:v', 'libx264', '-crf', '15', '-pix_fmt', 'yuv420p', '-g', '30', '-c:a', 'aac', '-f', 'mov', input])
  writeFileSync(`${input}.json`, '{}')
  const v = await prisma.video.create({ data: { originalName: 'REEMPLAZO.MOV', uploadId } })
  await procesar(v.id)
  const { listo, key, vdir } = await abrir(priv, v.id)
  const thumbAntes = readFileSync(path.join(vdir, 'thumb.jpg.enc'))
  const pesoAntes = readdirSync(vdir).filter((f) => f.startsWith('seg_') || f === 'init.mp4.enc').reduce((s, f) => s + readFileSync(path.join(vdir, f)).length, 0)
  const clave = c.b64u(await c.openFileKeyRaw(await c.importPrivateKey(priv), JSON.parse(listo.keyWrap)))
  const e = await prisma.exportacion.create({ data: { videoId: v.id, clave, duracion: 8, alto: 480 } })
  await cicloExportacion()
  assert.equal((await prisma.exportacion.findUniqueOrThrow({ where: { id: e.id } })).status, 'lista')

  const nuevo = await reemplazarOriginal(e)
  assert.ok(nuevo.size > 0 && nuevo.size < pesoAntes, `más liviano: ${nuevo.size} < ${pesoAntes}`)
  assert.ok(nuevo.readyAt > listo.readyAt, 'readyAt cambia (marca para la caché del navegador)')
  assert.equal(await prisma.exportacion.count({ where: { id: e.id } }), 0)
  assert.ok(!existsSync(exportDir(v.id, e.id)) && !existsSync(path.join(vdir, '.original-reemplazado')))
  const segs = readdirSync(vdir).filter((f) => f.startsWith('seg_'))
  assert.equal(nuevo.segments, segs.length)
  assert.deepEqual(readFileSync(path.join(vdir, 'thumb.jpg.enc')), thumbAntes, 'la miniatura se conserva')
  assert.ok(existsSync(path.join(vdir, 'key.json')))
  const mp4 = await rearmar(key, vdir, 'reemplazado.mp4')
  assert.equal(dimensiones(mp4), 'h264,854,480')
  const d = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).toString())
  assert.ok(Math.abs(d - 8) < 0.6, `duración ${d}`)
})

test('captura PNG grande (sin EXIF): se procesa; si el worker se cayó justo después, se marca lista sin reprocesar', async () => {
  const priv = await nuevaBoveda()
  const uploadId = 'up-captura'
  const input = path.join(paths.subidas, uploadId)
  execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'cellauto=s=1170x2532:rule=110,format=rgb24,noise=alls=60:allf=t', '-frames:v', '1', '-f', 'image2', '-c:v', 'png', input])
  writeFileSync(`${input}.json`, '{}')
  const v = await prisma.video.create({ data: { originalName: 'pegado-2026-10-23_23-20-00.png', mime: 'image/png', uploadId } })
  await procesar(v.id)
  const { listo, meta } = await abrir(priv, v.id)
  assert.equal(listo.status, 'listo')
  assert.equal(meta.kind, 'imagen')
  assert.deepEqual([meta.width, meta.height], [1170, 2532])

  // El worker se cayó después de guardar: al reintentar ya no está la subida, pero sí el resultado.
  await prisma.video.update({ where: { id: v.id }, data: { status: 'procesando' } })
  await procesar(v.id)
  const otra = await prisma.video.findUniqueOrThrow({ where: { id: v.id } })
  assert.equal(otra.status, 'listo')
  assert.equal(otra.meta, listo.meta, 'no se reprocesa')

  // Sin resultado ni subida: error que no se reintenta.
  const perdido = await prisma.video.create({ data: { originalName: 'x.png', uploadId: null } })
  await assert.rejects(procesar(perdido.id), /No se encontró el archivo subido/)
})

test('un trabajo que tumbó el worker varias veces se marca con error y la cola sigue', async () => {
  const { ciclo } = await import('../worker.ts')
  const v = await prisma.video.create({ data: { originalName: 'tumba.png', uploadId: 'no-existe', jobs: { create: { type: 'procesar', attempts: 3 } } } })
  assert.equal(await ciclo(), true)
  const job = await prisma.job.findFirstOrThrow({ where: { videoId: v.id } })
  assert.equal(job.status, 'error')
  assert.equal((await prisma.video.findUniqueOrThrow({ where: { id: v.id } })).status, 'error')
})
