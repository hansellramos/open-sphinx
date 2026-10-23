// Difuminado de miniaturas: encendido por defecto, se vuelve a encender al bloquear y tras N segundos
// sin actividad (configurable por dispositivo; 0 = nunca).
import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useAuthStore } from '@/stores/auth'

const CLAVE = 'boveda-redifuminar-seg'
const CLAVE_BLOQUEO = 'boveda-autobloqueo-seg'
const leer = (clave = CLAVE, def = 20) => {
  try {
    const n = Number(localStorage.getItem(clave))
    return Number.isFinite(n) && localStorage.getItem(clave) !== null ? n : def
  } catch {
    return def
  }
}
const guardar = (clave, v) => {
  try {
    localStorage.setItem(clave, String(v))
  } catch {
    /* sin almacenamiento */
  }
}

export const usePrivacidadStore = defineStore('privacidad', () => {
  const difuminar = ref(true)
  const segundos = ref(leer())
  // Cortina: tapa toda la app cuando pierde el foco o pasa a segundo plano (app switcher de iOS).
  const cortina = ref(false)
  const autobloqueo = ref(leer(CLAVE_BLOQUEO, 60)) // segundos fuera de la app antes de pedir Face ID (0 = al salir)
  let ocultaDesde = 0
  let timer = null
  let ultima = 0

  function programar() {
    clearTimeout(timer)
    if (!difuminar.value && segundos.value > 0) timer = setTimeout(() => (difuminar.value = true), segundos.value * 1000)
  }
  function set(v) {
    difuminar.value = v
    programar()
  }
  function setSegundos(n) {
    segundos.value = Math.max(0, Math.round(Number(n) || 0))
    guardar(CLAVE, segundos.value)
    programar()
  }
  function actividad() {
    const ahora = Date.now()
    if (difuminar.value || ahora - ultima < 1000) return
    ultima = ahora
    programar()
  }
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'])
    window.addEventListener(ev, actividad, { passive: true, capture: true })

  function setAutobloqueo(n) {
    autobloqueo.value = Math.max(0, Math.round(Number(n) || 0))
    guardar(CLAVE_BLOQUEO, autobloqueo.value)
  }

  const auth = useAuthStore()
  function ocultar() {
    cortina.value = true
    difuminar.value = true
    document.querySelectorAll('video').forEach((v) => v.pause())
    if (!ocultaDesde) ocultaDesde = Date.now()
  }
  function mostrar() {
    if (document.visibilityState !== 'visible') return
    if (ocultaDesde && auth.desbloqueada && Date.now() - ocultaDesde >= autobloqueo.value * 1000) auth.bloquear()
    ocultaDesde = 0
    cortina.value = false
  }
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? ocultar() : mostrar()))
  window.addEventListener('pagehide', ocultar)
  // En iOS, blur llega al abrir el app switcher, antes de que se tome la captura.
  window.addEventListener('blur', () => {
    cortina.value = true
    difuminar.value = true
  })
  window.addEventListener('focus', mostrar)

  watch(
    () => auth.desbloqueada,
    (d) => !d && set(true),
  )

  return { difuminar, segundos, cortina, autobloqueo, set, setSegundos, setAutobloqueo }
})
