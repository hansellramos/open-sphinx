// Estado de la sesión y de la bóveda. La clave privada solo vive aquí, en memoria: al recargar la
// página o bloquear, se pierde y hay que volver a abrirla con la passkey o el código de recuperación.
import { ref, shallowRef, computed } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/services/api'
import { crearPasskey, usarPasskey } from '@/lib/webauthn'
import * as c from '@shared/crypto.js'

export const useAuthStore = defineStore('auth', () => {
  const estado = ref(null) // { configurada, passkeys, sesion }
  const privateKey = shallowRef(null)
  let pkcs8 = null // para envolver la clave con passkeys nuevas
  let prfPendiente = null // PRF de una passkey que aún no tiene la clave envuelta
  const fileKeys = new Map()

  const desbloqueada = computed(() => !!privateKey.value)

  async function cargar() {
    estado.value = await api.get('/auth/estado')
    return estado.value
  }

  async function abrir(bytes) {
    pkcs8 = bytes
    privateKey.value = await c.importPrivateKey(bytes)
    if (prfPendiente) {
      const { credentialId, prf } = prfPendiente
      prfPendiente = null
      const prfWrap = await c.wrapPrivateKey(pkcs8, prf, c.INFO_PRF)
      await api.put(`/auth/credenciales/${encodeURIComponent(credentialId)}/prf`, { prfWrap }).catch(() => {})
    }
  }

  // Entra con passkey y, si el navegador da PRF, abre la bóveda en el mismo paso.
  async function entrar() {
    const opts = await api.post('/auth/login/opciones')
    const { json, prf } = await usarPasskey(opts)
    const r = await api.post('/auth/login/verificar', { response: json })
    estado.value = { ...estado.value, sesion: true }
    if (prf && r.prfWrap) await abrir(await c.unwrapPrivateKey(r.prfWrap, prf, c.INFO_PRF))
    else if (prf) prfPendiente = { credentialId: r.credentialId, prf }
    return { conPrf: !!prf, desbloqueada: desbloqueada.value }
  }

  async function conRecuperacion(codigo) {
    const vault = await api.get('/boveda')
    if (!vault) throw new Error('La bóveda no existe todavía')
    await abrir(await c.unwrapPrivateKey(vault.recoveryWrap, c.parseRecoveryCode(codigo), c.INFO_RECOVERY))
  }

  // Primera vez: registra la passkey y crea la bóveda. Devuelve el código de recuperación.
  async function registrarPasskey(nombre) {
    const opts = await api.post('/auth/registro/opciones')
    const reg = await crearPasskey(opts)
    const cred = await api.post('/auth/registro/verificar', { response: reg.json, name: nombre })
    let prf = reg.prf
    if (!prf && reg.prfHabilitado !== false) {
      // Muchos navegadores solo entregan el PRF al usar la passkey: se pide una segunda vez.
      const o = await api.post('/auth/login/opciones')
      const r = await usarPasskey(o, cred.id)
      await api.post('/auth/login/verificar', { response: r.json })
      prf = r.prf
    }
    return { credentialId: cred.id, prf }
  }

  async function crearBoveda({ prf }) {
    const keys = await c.generateVaultKeys()
    const codigo = c.newRecoveryCode()
    const recoveryWrap = await c.wrapPrivateKey(keys.privatePkcs8, c.parseRecoveryCode(codigo), c.INFO_RECOVERY)
    const prfWrap = prf ? await c.wrapPrivateKey(keys.privatePkcs8, prf, c.INFO_PRF) : null
    await api.post('/boveda', { publicKey: keys.publicKey, recoveryWrap, prfWrap })
    await abrir(keys.privatePkcs8)
    await cargar()
    return codigo
  }

  // Agregar otra passkey (con la bóveda abierta) y envolver la clave con su PRF.
  async function agregarPasskey(nombre) {
    const { credentialId, prf } = await registrarPasskey(nombre)
    if (prf) await api.put(`/auth/credenciales/${encodeURIComponent(credentialId)}/prf`, { prfWrap: await c.wrapPrivateKey(pkcs8, prf, c.INFO_PRF) })
    return { conPrf: !!prf }
  }

  async function nuevoCodigo() {
    const codigo = c.newRecoveryCode()
    await api.put('/boveda/recuperacion', { recoveryWrap: await c.wrapPrivateKey(pkcs8, c.parseRecoveryCode(codigo), c.INFO_RECOVERY) })
    return codigo
  }

  // Abre una clave sellada con la pública (la de un video o la de metadatos).
  const abrirSellado = (sealed) => c.openFileKey(privateKey.value, sealed)

  // Bytes de la clave de un video (para la versión ligera, que hace la NAS). No se guardan.
  const claveCrudaDe = async (video) => c.b64u(await c.openFileKeyRaw(privateKey.value, video.keyWrap))

  async function claveDe(video) {
    if (!fileKeys.has(video.id)) fileKeys.set(video.id, await abrirSellado(video.keyWrap))
    return fileKeys.get(video.id)
  }

  function bloquear() {
    privateKey.value = null
    pkcs8?.fill(0)
    pkcs8 = null
    fileKeys.clear()
  }

  async function salir() {
    await api.post('/auth/logout').catch(() => {})
    bloquear()
    estado.value = { ...estado.value, sesion: false }
  }

  return { estado, desbloqueada, cargar, entrar, conRecuperacion, registrarPasskey, crearBoveda, agregarPasskey, nuevoCodigo, abrirSellado, claveDe, claveCrudaDe, bloquear, salir }
})
