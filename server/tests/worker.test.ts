// Prueba de punta a punta del worker: video de prueba → fragmentos cifrados → descifrar y verificar.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
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
