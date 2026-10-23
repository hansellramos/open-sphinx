// Passkeys desde el navegador. Se usa la API nativa (no @simplewebauthn/browser) para controlar la
// extensión PRF: el secreto PRF se queda aquí y NUNCA se manda al servidor.
import { b64u, fromB64u, PRF_SALT } from '@shared/crypto.js'

export const soportaPasskeys = () => !!window.PublicKeyCredential

function aJSON(cred) {
  const r = cred.response
  const json = {
    id: cred.id,
    rawId: b64u(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    clientExtensionResults: {}, // a propósito vacío: no filtrar el PRF
    response: { clientDataJSON: b64u(r.clientDataJSON) },
  }
  if (r.attestationObject) {
    json.response.attestationObject = b64u(r.attestationObject)
    json.response.transports = r.getTransports?.() ?? []
  } else {
    json.response.authenticatorData = b64u(r.authenticatorData)
    json.response.signature = b64u(r.signature)
    if (r.userHandle) json.response.userHandle = b64u(r.userHandle)
  }
  return json
}

function prfDe(cred) {
  const first = cred.getClientExtensionResults?.()?.prf?.results?.first
  return first ? new Uint8Array(first) : null
}

const listaIds = (lista) => (lista ?? []).map((c) => ({ ...c, id: fromB64u(c.id) }))

export async function crearPasskey(opts) {
  const publicKey = {
    ...opts,
    challenge: fromB64u(opts.challenge),
    user: { ...opts.user, id: fromB64u(opts.user.id) },
    excludeCredentials: listaIds(opts.excludeCredentials),
    extensions: { ...(opts.extensions ?? {}), prf: { eval: { first: PRF_SALT } } },
  }
  const cred = await navigator.credentials.create({ publicKey })
  return { json: aJSON(cred), prf: prfDe(cred), prfHabilitado: cred.getClientExtensionResults?.()?.prf?.enabled ?? null }
}

export async function usarPasskey(opts, soloId = null) {
  const publicKey = {
    ...opts,
    challenge: fromB64u(opts.challenge),
    allowCredentials: soloId ? [{ type: 'public-key', id: fromB64u(soloId) }] : listaIds(opts.allowCredentials),
    extensions: { prf: { eval: { first: PRF_SALT } } },
  }
  const cred = await navigator.credentials.get({ publicKey })
  return { json: aJSON(cred), prf: prfDe(cred) }
}

// Mensajes entendibles para los errores típicos de WebAuthn.
export function errorPasskey(e) {
  if (e?.name === 'NotAllowedError') return 'Cancelaste o se agotó el tiempo de la passkey'
  if (e?.name === 'InvalidStateError') return 'Esta passkey ya está registrada'
  if (e?.name === 'SecurityError') return 'Las passkeys necesitan HTTPS y el dominio correcto'
  return e?.message ?? 'Error con la passkey'
}
