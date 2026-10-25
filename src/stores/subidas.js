// Cola de subidas (una a la vez, reanudables con tus). Vive en un store para que siga
// subiendo aunque navegues a otra pantalla.
// Antes de subir cada archivo se calcula su huella (SHA-256) y se compara con las de la bóveda (que van en
// los metadatos cifrados): si ya está, no se sube. Etiquetas y fecha (la del nombre, p. ej. de WhatsApp, o la
// elegida) viajan selladas con la pública. Si se cambian cuando ya se está subiendo, se guardan selladas en la
// NAS junto a la subida (no se pierden si se recarga la página) y el worker las mete en el elemento.
import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import * as tus from 'tus-js-client'
import { createSHA256 } from 'hash-wasm'
import { useBovedaStore } from '@/stores/boveda'
import { deLocal, fechaDelNombre } from '@/lib/formato'
import { api } from '@/services/api'

const PEDAZO = 8 * 1024 * 1024
let seq = 0

// Fecha del archivo según el navegador (lastModified). El iPhone a veces pone ahí la fecha que muestra Fotos (útil
// para lo guardado de WhatsApp, que no trae EXIF); otras veces la de ahora, que no sirve. Respaldo si no hay otra.
function fechaArchivo(f) {
  const t = Number(f.lastModified)
  return Number.isFinite(t) && t > 0 && Date.now() - t > 10 * 60_000 ? new Date(t).toISOString() : null
}

// Reducir videos al subirlos (lado corto 720 o 540; null = dejar el original). Se recuerda en este navegador.
const esVideo = (f) => f.type?.startsWith('video/') || /\.(mov|mp4|m4v|mkv|webm|avi|3gp)$/i.test(f.name)
function leerReducir() {
  try {
    const x = Number(localStorage.getItem('boveda.reducir'))
    return [720, 540].includes(x) ? x : null
  } catch {
    return null
  }
}

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
  const reducir = ref(leerReducir()) // para los videos que se agreguen
  watch(reducir, (x) => {
    try {
      localStorage.setItem('boveda.reducir', x ?? '')
    } catch {}
  })
  const activa = computed(() => items.value.some((i) => i.estado === 'subiendo'))
  let revisando = false

  function agregar(files) {
    for (const file of files)
      items.value.push({
        id: ++seq, file, nombre: file.name, tam: file.size, progreso: 0, estado: 'revisando', error: null,
        tags: [...etiquetas.value], fecha: fechaDelNombre(file.name), manual: false, titulo: null, sha: null, igual: null, archivo: fechaArchivo(file),
        video: esVideo(file), reducir: esVideo(file) ? reducir.value : null,
      })
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
      const datos = {}
      Object.assign(datos, await ajustesDe(it))
      if (Object.keys(datos).length) extra = JSON.stringify(await boveda.sellar(datos))
    } catch (e) {
      it.estado = 'error'
      it.error = `No se pudieron preparar las etiquetas y la fecha: ${e.message}`
      return siguiente()
    }
    const up = new tus.Upload(it.file, {
      endpoint: '/api/subidas',
      chunkSize: 32 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000, 10000, 30000],
      removeFingerprintOnSuccess: true,
      metadata: { filename: it.nombre, filetype: it.file.type || '', ...(extra && { extra }), ...(it.reducir && { reducir: String(it.reducir) }) },
      onProgress: (sent, total) => {
        it.progreso = Math.round((sent / total) * 1000) / 10
        medir(it, sent, total)
      },
      onSuccess: () => {
        it.estado = 'listo'
        it.progreso = 100
        it.velocidad = it.restante = null
        it.file = null
        if (it.ajustePendiente) guardarAjuste(it) // cambió algo mientras subía: ahora ya hay elemento
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
    it.medida = null
    // Si esta misma subida quedó a medias (se cerró la pestaña), sigue donde iba.
    up.findPreviousUploads().then((prev) => {
      if (prev.length) up.resumeFromPreviousUpload(prev[0])
      up.start()
    })
  }

  // Etiquetas o fecha de un archivo de la lista. Antes de empezar a subirlo basta con guardarlas aquí; si ya
  // salió, quedan pendientes en la bóveda y se aplican cuando termine de procesarse.
  function cambiar(it, c) {
    if ('tags' in c) it.tags = c.tags
    if ('reducir' in c) it.reducir = c.reducir
    if ('fecha' in c) {
      it.fecha = c.fecha || null
      it.manual = true
      // Lo pegado lleva la hora de pegar en el nombre: se cambia por la fecha elegida.
      const m = /^pegado-.*?(\.\w+)$/.exec(it.nombre)
      if (m && it.fecha) {
        const nuevo = `pegado-${it.fecha.replace('T', '_').replace(/:/g, '-')}`
        if (it.estado === 'subiendo' || it.estado === 'listo') it.titulo = nuevo
        it.nombre = nuevo + m[1]
      }
    }
    if (it.estado === 'subiendo' || it.estado === 'listo') guardarAjuste(it)
  }

  // Lo que va sellado con la subida (etiquetas como ids, fecha, título si se renombró).
  async function ajustesDe(it) {
    const boveda = useBovedaStore()
    const datos = {}
    if (it.tags.length) datos.tags = await boveda.etiquetasPara(it.tags)
    if (it.fecha) Object.assign(datos, { takenAt: deLocal(it.fecha), manual: it.manual })
    else if (it.archivo) datos.archivo = it.archivo // solo si la foto no trae la suya (EXIF)
    if (it.titulo) datos.title = it.titulo
    return datos
  }

  // Ya salió: se guarda sellado en la NAS con la subida (reemplaza lo de antes). Si la subida no ha terminado
  // (todavía no hay elemento), se manda al terminar; si ya se procesó, lo aplica este navegador.
  async function guardarAjuste(it) {
    const boveda = useBovedaStore()
    it.ajustePendiente = false
    try {
      const id = it.upload?.url?.split('/').pop()
      if (id) {
        const extra = JSON.stringify(await boveda.sellar(await ajustesDe(it)))
        try {
          return await api.put(`/videos/por-subida/${encodeURIComponent(id)}/ajuste`, { extra, reducir: it.reducir })
        } catch (e) {
          if (e.status !== 404) throw e
        }
      }
      if (it.estado === 'subiendo') {
        it.ajustePendiente = true
        return
      }
      if (it.sha) await boveda.ajustarPorHuella(it.sha, { tags: it.tags, takenAt: deLocal(it.fecha), manual: it.manual, archivo: it.fecha ? null : it.archivo, ...(it.titulo && { title: it.titulo }) })
    } catch (e) {
      console.warn('No se pudo guardar el cambio', e)
    }
  }

  // Velocidad: promedio móvil de los últimos segundos (tus avisa cada pedazo enviado al socket, que puede
  // llegar a saltos). También lo que falta, en segundos.
  function medir(it, sent, total) {
    const ahora = performance.now()
    const m = (it.medida ??= { t: ahora, b: sent, vel: null })
    const dt = (ahora - m.t) / 1000
    if (dt < 1) return
    const inst = (sent - m.b) / dt
    m.vel = m.vel == null ? inst : m.vel * 0.7 + inst * 0.3
    m.t = ahora
    m.b = sent
    it.velocidad = m.vel
    it.restante = m.vel > 0 ? (total - sent) / m.vel : null
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

  return { items, etiquetas, reducir, activa, agregar, cambiar, reintentar, subirIgual, cancelar, limpiarListos }
})
