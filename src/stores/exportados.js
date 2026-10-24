// Exportaciones de videos (más pequeños y/o con filtro): se piden a la NAS prestándole la clave de ese video, se
// hacen de a una y se borran solas a los 7 días. Aquí: la lista, pedir, borrar y el sondeo mientras alguna se hace.
import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/auth'

export const useExportadosStore = defineStore('exportados', () => {
  const auth = useAuthStore()
  const items = ref([])
  const cargada = ref(false)
  let timer = null

  const de = (videoId) => items.value.filter((e) => e.videoId === videoId)
  const ocupado = computed(() => items.value.reduce((s, e) => s + (e.size || 0), 0))
  const pendientes = computed(() => items.value.some((e) => e.status === 'en_cola' || e.status === 'procesando'))

  async function cargar() {
    items.value = await api.get('/exportados')
    cargada.value = true
    programar()
  }
  function programar() {
    clearTimeout(timer)
    if (pendientes.value) timer = setTimeout(() => cargar().catch(() => programar()), 3000)
  }

  // opciones: { alto: 720 | 480 | null, filtro: 'a' | 'b' | 'c' | null }
  async function pedir(v, { alto = null, filtro = null }) {
    const e = await api.post(`/videos/${v.id}/exportar`, { clave: await auth.claveCrudaDe(v), duracion: v.m?.duration ?? null, alto, filtro })
    items.value = [e, ...items.value.filter((x) => x.id !== e.id)]
    programar()
    return e
  }

  // Usar una exportación como el video: la NAS borra el original para siempre.
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

  return { items, cargada, de, ocupado, cargar, pedir, reemplazar, borrar }
})
