// Cola de subidas (una a la vez, reanudables con tus). Vive en un store para que siga
// subiendo aunque navegues a otra pantalla.
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import * as tus from 'tus-js-client'
import { useBovedaStore } from '@/stores/boveda'

let seq = 0

export const useSubidasStore = defineStore('subidas', () => {
  const items = ref([])
  const activa = computed(() => items.value.some((i) => i.estado === 'subiendo'))

  function agregar(files) {
    for (const file of files) items.value.push({ id: ++seq, file, nombre: file.name, tam: file.size, progreso: 0, estado: 'esperando', error: null })
    siguiente()
  }

  function siguiente() {
    if (activa.value) return
    const it = items.value.find((i) => i.estado === 'esperando')
    if (!it) return
    it.estado = 'subiendo'
    const up = new tus.Upload(it.file, {
      endpoint: '/api/subidas',
      chunkSize: 32 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000, 10000, 30000],
      removeFingerprintOnSuccess: true,
      metadata: { filename: it.nombre, filetype: it.file.type || 'video/mp4' },
      onProgress: (sent, total) => (it.progreso = Math.round((sent / total) * 1000) / 10),
      onSuccess: () => {
        it.estado = 'listo'
        it.progreso = 100
        it.file = null
        useBovedaStore().cargar(true).catch(() => {}) // aparece "En cola" y empieza el sondeo
        siguiente()
      },
      onError: (e) => {
        it.estado = 'error'
        it.error = e?.originalResponse?.getStatus?.() === 401 ? 'Sesión vencida: entra de nuevo y reintenta' : String(e?.message ?? e).slice(0, 200)
        siguiente()
      },
    })
    it.upload = up
    // Si esta misma subida quedó a medias (se cerró la pestaña), sigue donde iba.
    up.findPreviousUploads().then((prev) => {
      if (prev.length) up.resumeFromPreviousUpload(prev[0])
      up.start()
    })
  }

  function reintentar(it) {
    if (!it.file) return
    it.estado = 'esperando'
    it.error = null
    siguiente()
  }

  function cancelar(it) {
    it.upload?.abort(true)
    items.value = items.value.filter((i) => i !== it)
    siguiente()
  }

  const limpiarListos = () => (items.value = items.value.filter((i) => i.estado !== 'listo'))

  window.addEventListener('beforeunload', (e) => {
    if (activa.value) e.preventDefault()
  })

  return { items, activa, agregar, reintentar, cancelar, limpiarListos }
})
