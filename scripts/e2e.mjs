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
execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '30', '-c:v', process.argv[2] ?? 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', '-c:a', 'aac', video])

const procs = [spawn('node', ['server/index.ts'], { env, stdio: 'inherit' }), spawn('node', ['server/worker.ts'], { env, stdio: 'inherit' })]
const fin = (code) => {
  procs.forEach((p) => p.kill())
  rmSync(dir, { recursive: true, force: true })
  process.exit(code)
}
await new Promise((r) => setTimeout(r, 2500))

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
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
  paso('worker cifró y la miniatura se descifra en el navegador')

  // Etiquetas: desde el menú de la tarjeta, luego filtrar.
  await page.getByRole('button', { name: 'Opciones' }).first().click()
  await page.getByRole('button', { name: 'Etiquetas' }).click()
  const campo = page.getByPlaceholder('Escribe y Enter…')
  await campo.fill('Viajes'); await campo.press('Enter')
  await campo.fill('2024'); await campo.press('Enter')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await page.locator('.video-card .badge', { hasText: 'Viajes' }).waitFor()
  await page.locator('button.rounded-pill', { hasText: '2024' }).click()
  if ((await page.locator('.video-card').count()) !== 1) throw new Error('el filtro por etiqueta no muestra el video')
  paso('etiquetas: agregar y filtrar')

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
  await page.waitForResponse((r) => r.url().includes('/etiquetas') && r.request().method() === 'PUT')
  const tags = await page.evaluate(async () => (await (await fetch(location.pathname.replace(/\/$/, '') + '/api/videos')).json())[0].tags.map((t) => t.name))
  if (tags.join() !== '2024,Familia,Viajes') throw new Error(`etiquetas desde el reproductor: ${tags}`)
  paso('etiquetas desde el reproductor')

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
  await browser.close()
  fin(0)
} catch (e) {
  console.error('✖', e.message)
  await page.screenshot({ path: 'test-results-e2e.png' }).catch(() => {})
  await browser.close()
  fin(1)
}
