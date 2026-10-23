// Prueba de punta a punta en Chrome con una passkey virtual (con PRF):
// configurar → subir → el worker cifra → miniatura y reproducción descifradas → bloquear → código de recuperación.
// Uso: npm run build && node scripts/e2e.mjs
import { chromium } from 'playwright-core'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const dir = mkdtempSync(path.join(tmpdir(), 'boveda-e2e-'))
const PORT = 3199
const env = { ...process.env, DATA_DIR: dir, DATABASE_URL: `file:${dir}/db/boveda.db`, PORT: String(PORT), RP_ID: 'localhost', ORIGIN: `http://localhost:${PORT}`, SESSION_SECRET: 'e2e' }
execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env, stdio: 'ignore' })
const video = path.join(dir, 'prueba.mov')
execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '30', '-c:v', process.argv[2] ?? 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', '-c:a', 'aac',
  '-metadata', 'com.apple.quicktime.location.ISO6709=+04.6534-074.0836+2581.123/', '-metadata', 'com.apple.quicktime.creationdate=2021-12-24T19:03:12-0500',
  '-metadata', 'com.apple.quicktime.make=Apple', '-metadata', 'com.apple.quicktime.model=iPhone 12', '-movflags', 'use_metadata_tags', video])

const procs = [spawn('node', ['server/index.ts'], { env, stdio: 'inherit' }), spawn('node', ['server/worker.ts'], { env, stdio: 'inherit' })]
const fin = (code) => {
  procs.forEach((p) => p.kill())
  rmSync(dir, { recursive: true, force: true })
  process.exit(code)
}
await new Promise((r) => setTimeout(r, 2500))

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', e.message)); page.on('console', (m) => m.type() !== 'log' && console.log('[console]', m.text().slice(0, 300)))
const cdp = await page.context().newCDPSession(page)
await cdp.send('WebAuthn.enable')
await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
})
const paso = (t) => console.log(`✔ ${t}`)
try {
  const base = `http://localhost:${PORT}`
  await page.goto(base)
  await page.waitForURL(/#\/configurar/)
  await page.getByRole('button', { name: /Crear passkey/ }).click()
  const codigo = (await page.locator('.recovery-code').innerText({ timeout: 15000 })).trim()
  if (codigo.replace(/-/g, '').length !== 52) throw new Error(`código raro: ${codigo}`)
  paso('passkey con PRF + bóveda creada, código de recuperación mostrado')
  await page.getByLabel('Ya lo guardé').check()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.waitForURL(/#\/videos/)

  await page.goto(`${base}/#/subir`)
  await page.locator('input[type=file]').setInputFiles(video)
  await page.getByText('Subido · en cola para cifrar').waitFor({ timeout: 60000 })
  paso('subida tus completa')
  await page.goto(`${base}/#/videos`)
  await page.locator('.thumb img').waitFor({ timeout: 90000 })
  if (!(await page.locator('.thumb img').getAttribute('class'))?.includes('difuminada')) throw new Error('la miniatura no está difuminada por defecto')
  await page.getByText('Diciembre de 2021').waitFor()
  paso('worker cifró; miniatura descifrada y difuminada; agrupada por la fecha del iPhone')
  await page.locator('#difuminar').click()
  if ((await page.locator('.thumb img').getAttribute('class'))?.includes('difuminada')) throw new Error('el toggle no quita el difuminado')
  paso('toggle de difuminar')

  // Etiquetas: desde el menú de la tarjeta, luego filtrar.
  await page.getByRole('button', { name: 'Opciones' }).first().click()
  await page.getByRole('button', { name: 'Etiquetas' }).click()
  const campo = page.getByPlaceholder('Escribe y Enter…')
  await campo.fill('Viajes'); await campo.press('Enter')
  await campo.fill('2024'); await campo.press('Enter')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await page.locator('.video-card .badge', { hasText: 'Viajes' }).waitFor()
  await page.locator('.sidebar a', { hasText: '2024' }).click()
  await page.waitForURL(/#\/etiquetas\//)
  if ((await page.locator('.video-card').count()) !== 1) throw new Error('la etiqueta del menú no muestra el video')
  // Lo que ve el servidor: nada legible.
  const crudo = await page.evaluate(async () => JSON.stringify([await (await fetch('/api/videos')).json(), await (await fetch('/api/boveda')).json()]))
  for (const x of ['Viajes', '2024', 'prueba', 'iPhone', '4.65']) if (crudo.includes(x)) throw new Error(`el servidor ve "${x}" en claro`)
  paso('etiquetas cifradas en el menú lateral; el servidor no ve título, etiquetas, fecha ni ubicación')
  await page.locator('.video-card .fav').click()
  await page.locator('.sidebar a', { hasText: 'Favoritos' }).click()
  await page.waitForURL(/#\/favoritos/)
  if ((await page.locator('.video-card').count()) !== 1) throw new Error('favoritos vacío')
  paso('favoritos')
  await page.locator('.sidebar a', { hasText: 'Mapa' }).click()
  await page.locator('.mapa-marca').waitFor()
  await page.getByRole('button', { name: /Ver los 1 videos de esta zona/ }).click()
  await page.waitForURL(/zona=/)
  if ((await page.locator('.video-card').count()) !== 1) throw new Error('filtro por zona vacío')
  paso('mapa con la ubicación descifrada y filtro por zona')

  await page.locator('.sidebar a', { hasText: 'Todos los videos' }).click()
  await page.locator('.video-card').first().click()
  await page.waitForURL(/#\/videos\/[0-9a-f-]+/)
  await page.locator('video').evaluate((v) => { v.muted = true; return v.play().catch(() => {}) })
  await page.waitForFunction(() => document.querySelector('video')?.currentTime > 2, null, { timeout: 30000 })
  // Saltar al final: pide fragmentos del medio sin bajar todo.
  await page.locator('video').evaluate((v) => (v.currentTime = 25))
  await page.waitForFunction(() => document.querySelector('video')?.currentTime > 26, null, { timeout: 30000 })
  paso('reproduce descifrando por fragmentos, y salta a minuto distinto')
  const campo2 = page.getByPlaceholder('Escribe y Enter…')
  await campo2.fill('Familia'); await campo2.press('Enter')
  await page.waitForResponse((r) => r.url().includes('/meta') && r.request().method() === 'PUT')
  await page.getByText('Grabado el').waitFor()
  await page.getByText('Apple iPhone 12').waitFor()
  await page.reload()
  await page.waitForURL(/#\/entrar/)
  await page.getByRole('button', { name: /Desbloquear con passkey/ }).click()
  await page.locator('.sidebar a', { hasText: 'Familia' }).waitFor()
  paso('etiquetas desde el reproductor (persisten tras recargar) y metadatos del iPhone visibles')
  await page.goto(`${base}/#/videos`)

  await page.getByRole('button', { name: /Bloquear/ }).click()
  await page.waitForURL(/#\/entrar/)
  await page.getByRole('button', { name: /Usar el código/ }).click()
  await page.locator('textarea').fill(codigo.toLowerCase())
  await page.getByRole('button', { name: /Abrir con el código/ }).click()
  await page.waitForURL(/#\/videos/)
  await page.locator('.thumb img').waitFor()
  paso('abre con el código de recuperación')

  await page.getByRole('button', { name: /Bloquear/ }).click()
  await page.getByRole('button', { name: /Desbloquear con passkey/ }).click()
  await page.waitForURL(/#\/videos/)
  await page.locator('.thumb img').waitFor()
  paso('desbloquea con la passkey (PRF)')

  // Migración de un video del MVP (título y etiqueta sin cifrar en la base).
  const Database = (await import('better-sqlite3')).default
  const db = new Database(`${dir}/db/boveda.db`)
  const vid = db.prepare('SELECT id FROM Video').get().id
  db.prepare("UPDATE Video SET meta = NULL, title = 'Video viejo', originalName = 'IMG_9.MOV', duration = 30 WHERE id = ?").run(vid)
  db.prepare("INSERT INTO Tag (name, color, createdAt) VALUES ('Legado', 'danger', 0)").run()
  db.prepare('INSERT INTO _TagToVideo (A, B) VALUES ((SELECT id FROM Tag WHERE name = ?), ?)').run('Legado', vid)
  db.close()
  await page.reload()
  await page.getByRole('button', { name: /Desbloquear con passkey/ }).click()
  await page.locator('.sidebar a', { hasText: 'Legado' }).waitFor()
  await page.getByText('Video viejo').waitFor()
  const tras = await page.evaluate(async () => JSON.stringify(await (await fetch('/api/videos')).json()))
  if (tras.includes('Video viejo') || tras.includes('Legado') || tras.includes('legado')) throw new Error('quedó texto plano tras migrar')
  paso('migra videos del MVP: cifra título y etiquetas y el servidor borra lo plano')
  await browser.close()
  fin(0)
} catch (e) {
  console.error('✖', e.message)
  await page.screenshot({ path: 'test-results-e2e.png' }).catch(() => {})
  await browser.close()
  fin(1)
}
