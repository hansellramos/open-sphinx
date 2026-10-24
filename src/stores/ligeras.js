// Versiones ligeras (720p) de videos: se piden a la NAS prestándole la clave de ese video, se hacen de a una
// y se borran solas a los 7 días. Aquí: la lista, pedir, borrar y el sondeo mientras alguna se está haciendo.
import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/auth'

export const useLigerasStore = defineStore('ligeras', () => {
  const auth = useAuthStore()
  const items = ref([])
  const cargada = ref(false)
  let timer = null

  const de = (videoId) => items.value.find((l) => l.videoId === videoId) ?? null
  const ocupado = computed(() => items.value.reduce((s, l) => s + (l.size || 0), 0))
  const pendientes = computed(() => items.value.some((l) => l.status === 'en_cola' || l.status === 'procesando'))

  async function cargar() {
    items.value = await api.get('/ligeras')
    cargada.value = true
    programar()
  }
  function programar() {
    clearTimeout(timer)
    if (pendientes.value) timer = setTimeout(() => cargar().catch(() => programar()), 3000)
  }

  async function pedir(v) {
    const l = await api.post(`/videos/${v.id}/ligera`, { clave: await auth.claveCrudaDe(v), duracion: v.m?.duration ?? null })
    items.value = [l, ...items.value.filter((x) => x.id !== l.id)]
    programar()
    return l
  }

  async function borrar(l) {
    await api.del(`/ligeras/${l.id}`)
    items.value = items.value.filter((x) => x.id !== l.id)
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

  return { items, cargada, de, ocupado, cargar, pedir, borrar }
})
