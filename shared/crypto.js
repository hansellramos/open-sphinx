// Criptografía compartida entre el navegador y el servidor (Web Crypto API, igual en ambos lados).
//
// Esquema:
// - La bóveda tiene un par de claves X25519. La pública vive en el servidor (para cifrar);
//   la privada solo existe descifrada en memoria del navegador, y en el servidor se guarda
//   envuelta (AES-GCM) con secretos que solo tú tienes: el PRF de cada passkey y el código de recuperación.
// - Cada video tiene su propia clave AES-256-GCM al azar. Se "sella" con la clave pública:
//   ECDH con una clave efímera + HKDF → clave que cifra la clave del video. Solo la privada la abre.
// - Cada archivo cifrado (fragmento, init, miniatura) = [iv 12 bytes][ciphertext + tag].

const subtle = globalThis.crypto.subtle
const enc = new TextEncoder()

export const INFO_PRF = 'boveda/unlock/prf/v1'
export const INFO_RECOVERY = 'boveda/unlock/recovery/v1'
const INFO_FILEKEY = 'boveda/filekey/v1'

// Sal fija que se le pasa a la extensión PRF de WebAuthn: misma passkey + misma sal = mismo secreto.
export const PRF_SALT = enc.encode('boveda/prf/v1'.padEnd(32, '.'))

// ---------------- utilidades ----------------

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n))
}

export function b64u(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64u(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4))
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

async function hkdfAesKey(secret, salt, info, usages) {
  const base = await subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey'])
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, usages)
}

// ---------------- código de recuperación ----------------
// 32 bytes al azar en base32 Crockford, en grupos de 4: XXXX-XXXX-… (13 grupos).

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function newRecoveryCode() {
  return formatRecoveryCode(randomBytes(32))
}

export function formatRecoveryCode(bytes) {
  let bits = 0, value = 0, out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out.match(/.{1,4}/g).join('-')
}

export function parseRecoveryCode(code) {
  const clean = code.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (clean.length !== 52) throw new Error('El código de recuperación debe tener 52 caracteres')
  const out = new Uint8Array(32)
  let bits = 0, value = 0, i = 0
  for (const ch of clean) {
    const v = B32.indexOf(ch)
    if (v < 0) throw new Error(`Carácter inválido en el código: ${ch}`)
    value = (value << 5) | v
    bits += 5
    if (bits >= 8) {
      if (i < 32) out[i++] = (value >>> (bits - 8)) & 255
      bits -= 8
    }
  }
  return out
}

// ---------------- clave de la bóveda ----------------

export async function generateVaultKeys() {
  const kp = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])
  return {
    publicKey: b64u(await subtle.exportKey('raw', kp.publicKey)),
    privatePkcs8: new Uint8Array(await subtle.exportKey('pkcs8', kp.privateKey)),
  }
}

// Envuelve la clave privada (pkcs8) con un secreto (PRF o código de recuperación).
export async function wrapPrivateKey(privatePkcs8, secret, info) {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const kek = await hkdfAesKey(secret, salt, info, ['encrypt'])
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, kek, privatePkcs8)
  return { salt: b64u(salt), iv: b64u(iv), ct: b64u(ct) }
}

// Devuelve los bytes pkcs8; falla si el secreto no corresponde.
export async function unwrapPrivateKey(wrap, secret, info) {
  const kek = await hkdfAesKey(secret, fromB64u(wrap.salt), info, ['decrypt'])
  try {
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: fromB64u(wrap.iv) }, kek, fromB64u(wrap.ct)))
  } catch {
    throw new Error('La clave no corresponde a esta bóveda')
  }
}

export function importPrivateKey(privatePkcs8) {
  return subtle.importKey('pkcs8', privatePkcs8, { name: 'X25519' }, false, ['deriveBits'])
}

// ---------------- clave de cada video ----------------

export async function newFileKey() {
  const raw = randomBytes(32)
  return { raw, key: await subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']) }
}

// Sella la clave del video con la clave pública de la bóveda (lo hace el servidor).
export async function sealFileKey(vaultPublicKeyB64u, fileKeyRaw) {
  const pub = await subtle.importKey('raw', fromB64u(vaultPublicKeyB64u), { name: 'X25519' }, false, [])
  const eph = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])
  const epk = new Uint8Array(await subtle.exportKey('raw', eph.publicKey))
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: pub }, eph.privateKey, 256))
  const kek = await hkdfAesKey(shared, epk, INFO_FILEKEY, ['encrypt'])
  const iv = randomBytes(12)
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, kek, fileKeyRaw)
  return { epk: b64u(epk), iv: b64u(iv), ct: b64u(ct) }
}

// Abre la clave del video con la clave privada (lo hace el navegador).
export async function openFileKey(privateKey, sealed) {
  const epk = fromB64u(sealed.epk)
  const ephPub = await subtle.importKey('raw', epk, { name: 'X25519' }, false, [])
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: ephPub }, privateKey, 256))
  const kek = await hkdfAesKey(shared, epk, INFO_FILEKEY, ['decrypt'])
  const raw = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64u(sealed.iv) }, kek, fromB64u(sealed.ct))
  // encrypt también: el navegador re-cifra los metadatos del video al editarlos.
  return subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

// ---------------- archivos ----------------

export async function encryptBlob(fileKey, bytes) {
  const iv = randomBytes(12)
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, fileKey, bytes))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv, 0)
  out.set(ct, 12)
  return out
}

export async function decryptBlob(fileKey, data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data)
  return subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(0, 12) }, fileKey, u8.subarray(12))
}

// ---------------- JSON cifrado (metadatos) ----------------

export async function encryptJSON(key, obj) {
  return b64u(await encryptBlob(key, enc.encode(JSON.stringify(obj))))
}

export async function decryptJSON(key, b64) {
  return JSON.parse(new TextDecoder().decode(await decryptBlob(key, fromB64u(b64))))
}
