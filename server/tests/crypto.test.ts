import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as c from '../../shared/crypto.js'

test('código de recuperación: ida y vuelta, tolera minúsculas y espacios', () => {
  const bytes = c.randomBytes(32)
  const code = c.formatRecoveryCode(bytes)
  assert.equal(code.replace(/-/g, '').length, 52)
  assert.deepEqual(c.parseRecoveryCode(code.toLowerCase().replace(/-/g, ' ')), bytes)
})

test('clave privada envuelta: abre con el secreto correcto y falla con otro', async () => {
  const { privatePkcs8 } = await c.generateVaultKeys()
  const secret = c.randomBytes(32)
  const wrap = await c.wrapPrivateKey(privatePkcs8, secret, c.INFO_RECOVERY)
  assert.deepEqual(await c.unwrapPrivateKey(wrap, secret, c.INFO_RECOVERY), privatePkcs8)
  await assert.rejects(c.unwrapPrivateKey(wrap, c.randomBytes(32), c.INFO_RECOVERY))
  await assert.rejects(c.unwrapPrivateKey(wrap, secret, c.INFO_PRF))
})

test('sellar con la pública y abrir con la privada', async () => {
  const { publicKey, privatePkcs8 } = await c.generateVaultKeys()
  const fk = await c.newFileKey()
  const data = new Uint8Array(100_000).map((_, i) => i * 7)
  const blob = await c.encryptBlob(fk.key, data)
  const sealed = await c.sealFileKey(publicKey, fk.raw)
  const priv = await c.importPrivateKey(privatePkcs8)
  const key = await c.openFileKey(priv, sealed)
  assert.deepEqual(new Uint8Array(await c.decryptBlob(key, blob)), data)
  const otra = await c.importPrivateKey((await c.generateVaultKeys()).privatePkcs8)
  await assert.rejects(c.openFileKey(otra, sealed))
})
