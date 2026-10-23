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
      '-t', '20', '-c:v', codec, '-pix_fmt', 'yuv420p', '-g', '30', '-c:a', 'aac', '-f', 'mp4', input])
    writeFileSync(`${input}.json`, '{}')
    const v = await prisma.video.create({ data: { title: 't', originalName: 'a.mp4', uploadId } })

    await procesar(v.id)

    const listo = await prisma.video.findUniqueOrThrow({ where: { id: v.id } })
    assert.equal(listo.status, 'listo')
    assert.ok(Math.abs(listo.duration - 20) < 0.5)
    assert.ok(listo.segments >= 3)
    assert.ok(!existsSync(input) && !existsSync(`${input}.json`), 'borra la subida sin cifrar')
    assert.deepEqual(readdirSync(paths.tmp), [], 'no deja temporales')
    const vdir = path.join(paths.videos, v.id)
    const files = readdirSync(vdir)
    assert.ok(files.every((f) => f === 'index.m3u8' || f === 'key.json' || f.endsWith('.enc')))
    assert.deepEqual(JSON.parse(readFileSync(path.join(vdir, 'key.json'), 'utf8')).keyWrap, JSON.parse(listo.keyWrap))

    // Descifrar con la privada y reconstruir un MP4 reproducible.
    const key = await c.openFileKey(await c.importPrivateKey(privatePkcs8), JSON.parse(listo.keyWrap))
    const plano = []
    for (const f of ['init.mp4.enc', ...files.filter((f) => f.startsWith('seg_')).sort()])
      plano.push(Buffer.from(await c.decryptBlob(key, readFileSync(path.join(vdir, f)))))
    const out = path.join(dir, `rearmado-${codec}.mp4`)
    writeFileSync(out, Buffer.concat(plano))
    const d = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString())
    assert.ok(Math.abs(d - 20) < 0.5, `duración rearmada ${d}`)
    const thumb = Buffer.from(await c.decryptBlob(key, readFileSync(path.join(vdir, 'thumb.jpg.enc'))))
    assert.equal(thumb.subarray(0, 2).toString('hex'), 'ffd8', 'miniatura JPEG')
    if (codec === 'libx265') assert.equal(listo.videoCodec, 'hevc')
  })
}
