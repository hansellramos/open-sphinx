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
