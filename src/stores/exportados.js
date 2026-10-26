// Exportaciones de videos (más pequeños y/o con filtro): se piden a la NAS prestándole la clave de ese video, se
// hacen de a una y se borran solas a los 7 días. Aquí: la lista, pedir, borrar y el sondeo mientras alguna se hace.
import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { mbpsSugerida } from '@/lib/peso'

export const useExportadosStore = defineStore('exportados', () => {
  const auth = useAuthStore()
  const items = ref([])
  const cargada = ref(false)
  const tasas = ref({}) // { ninguno|a|b|c: { tasa, n } } de las exportaciones ya hechas
  let timer = null

  const de = (videoId) => items.value.filter((e) => e.videoId === videoId)
  const ocupado = computed(() => items.value.reduce((s, e) => s + (e.size || 0), 0))
  const pendientes = computed(() => items.value.some((e) => e.status === 'en_cola' || e.status === 'procesando'))

  async function cargar() {
    const [es, ts] = await Promise.all([api.get('/exportados'), api.get('/exportados/tasas').catch(() => tasas.value)])
    items.value = es
    tasas.value = ts
    cargada.value = true
    programar()
  }
  function programar() {
    clearTimeout(timer)
    if (pendientes.value) timer = setTimeout(() => cargar().catch(() => programar()), 3000)
  }

  // opciones: { alto: 720 | 540 | 480 | null, filtro: 'a' | 'b' | 'c' | null, mbps: tasa máxima | null (la sugerida) }
  async function pedir(v, { alto = null, filtro = null, mbps = null }) {
    const e = await api.post(`/videos/${v.id}/exportar`, { clave: await auth.claveCrudaDe(v), duracion: v.m?.duration ?? null, alto, filtro, mbps })
    items.value = [e, ...items.value.filter((x) => x.id !== e.id)]
    programar()
    return e
  }

  // Usar una exportación como el video: el original queda 5 días en la papelera.
  async function reemplazar(e) {
    const r = await api.post(`/exportados/${e.id}/reemplazar`)
    items.value = items.value.filter((x) => x.id !== e.id)
    return r
  }

  async function borrar(e) {
    await api.del(`/exportados/${e.id}`)
    items.value = items.value.filter((x) => x.id !== e.id)
  }

  watch(
    () => auth.desbloqueada,
    (d) => {
      if (d) return
      clearTimeout(timer)
      items.value = []
      cargada.value = false
    },
  )

  // Cuánto pesará, antes de pedirla: duración × píxeles de salida × bytes por píxel y segundo. Sin datos propios se
  // usa una tasa típica (H.264 CRF 26 de video de celular; con filtro mucho menos, por los colores planos) con un
  // rango amplio; con exportaciones ya hechas se usa lo que pesaron, y el rango se cierra a medida que hay más.
  function estimar(v, { alto = null, filtro = null, mbps = null }) {
    const dur = v?.m?.duration, w = v?.m?.width, h = v?.m?.height
    if (!dur || !w || !h) return null
    const corto = Math.min(w, h)
    const k = alto && alto < corto ? alto / corto : 1
    const pix = Math.round((w * k) / 2) * 2 * Math.round((h * k) / 2) * 2
    const propia = tasas.value[filtro ?? 'ninguno']
    const [tasa, bajo, alto_, audio] = propia
      ? [propia.tasa, propia.n >= 3 ? 0.8 : 0.7, propia.n >= 3 ? 1.25 : 1.4, 0]
      : filtro
        ? [0.08, 0.4, 2.5, 12_500]
        : [0.33, 0.5, 1.6, 12_500]
    // La NAS le pone tope a la tasa (la sugerida: ~3 Mbps a 720p, proporcional a los píxeles; ver calidad() en
    // exportar.ts). Con otra tasa también cambia la calidad: más o menos peso, aunque no en proporción exacta.
    const sug = mbpsSugerida(v.m, alto)
    const m = mbps ?? sug
    const base = dur * (Math.min(pix * tasa * (m / sug) ** 0.7, (m * 1e6) / 8) + audio)
    return { min: base * bajo, max: base * alto_, propia: !!propia, n: propia?.n ?? 0 }
  }

  return { items, cargada, tasas, de, ocupado, cargar, pedir, reemplazar, borrar, estimar }
})
