// Cola de subidas (una a la vez, reanudables con tus). Vive en un store para que siga
// subiendo aunque navegues a otra pantalla.
// Antes de subir cada archivo se calcula su huella (SHA-256) y se compara con las de la bóveda (que van en
// los metadatos cifrados): si ya está, no se sube. Las etiquetas elegidas viajan selladas con la pública.
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import * as tus from 'tus-js-client'
import { createSHA256 } from 'hash-wasm'
import { useBovedaStore } from '@/stores/boveda'

const PEDAZO = 8 * 1024 * 1024
let seq = 0

async function huella(file, progreso) {
  const h = await createSHA256()
  h.init()
  for (let i = 0; i < file.size; i += PEDAZO) {
    h.update(new Uint8Array(await file.slice(i, i + PEDAZO).arrayBuffer()))
    progreso?.(Math.min(1, (i + PEDAZO) / file.size))
  }
  return h.digest('hex')
}

export const useSubidasStore = defineStore('subidas', () => {
  const items = ref([])
  const etiquetas = ref([]) // nombres que se ponen a lo que se agregue (opcional)
  const activa = computed(() => items.value.some((i) => i.estado === 'subiendo'))
  let revisando = false

  function agregar(files) {
    const tags = [...etiquetas.value]
    for (const file of files)
      items.value.push({ id: ++seq, file, nombre: file.name, tam: file.size, progreso: 0, estado: 'revisando', error: null, tags, sha: null, igual: null })
    revisar()
  }

  // Huellas de una en una (leer el archivo cuesta); al terminar cada una, a la cola de subida.
  async function revisar() {
    if (revisando) return
    revisando = true
    const boveda = useBovedaStore()
    try {
      let it
      while ((it = items.value.find((i) => i.estado === 'revisando'))) {
        try {
          await boveda.cargar()
          it.sha = await huella(it.file, (p) => (it.progreso = Math.round(p * 100)))
          it.progreso = 0
          const ya = boveda.huellas.get(it.sha)
          const enCola = items.value.find((o) => o !== it && o.sha === it.sha && o.estado !== 'duplicado' && o.estado !== 'revisando')
          if (ya || enCola) {
            it.estado = 'duplicado'
            it.igual = ya ? { id: ya.id, title: ya.m.title } : { title: enCola.nombre }
          } else it.estado = 'esperando'
        } catch (e) {
          it.estado = 'esperando' // si no se pudo revisar, se sube igual
          console.warn('No se pudo calcular la huella', e)
        }
        siguiente()
      }
    } finally {
      revisando = false
    }
  }

  async function siguiente() {
    if (activa.value) return
    const it = items.value.find((i) => i.estado === 'esperando')
    if (!it) return
    it.estado = 'subiendo'
    const boveda = useBovedaStore()
    let extra = ''
    try {
      if (it.tags.length) extra = JSON.stringify(await boveda.sellar({ tags: await boveda.etiquetasPara(it.tags) }))
    } catch (e) {
      it.estado = 'error'
      it.error = `No se pudieron preparar las etiquetas: ${e.message}`
      return siguiente()
    }
    const up = new tus.Upload(it.file, {
      endpoint: '/api/subidas',
      chunkSize: 32 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000, 10000, 30000],
      removeFingerprintOnSuccess: true,
      metadata: { filename: it.nombre, filetype: it.file.type || '', ...(extra && { extra }) },
      onProgress: (sent, total) => (it.progreso = Math.round((sent / total) * 1000) / 10),
      onSuccess: () => {
        it.estado = 'listo'
        it.progreso = 100
        it.file = null
        boveda.cargar(true).catch(() => {}) // aparece "En cola" y empieza el sondeo
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

  // Un duplicado que igual se quiere subir.
  function subirIgual(it) {
    it.estado = 'esperando'
    it.igual = null
    siguiente()
  }

  function cancelar(it) {
    it.upload?.abort(true)
    items.value = items.value.filter((i) => i !== it)
    siguiente()
  }

  const limpiarListos = () => (items.value = items.value.filter((i) => i.estado !== 'listo' && i.estado !== 'duplicado'))

  window.addEventListener('beforeunload', (e) => {
    if (activa.value) e.preventDefault()
  })

  return { items, etiquetas, activa, agregar, reintentar, subirIgual, cancelar, limpiarListos }
})
