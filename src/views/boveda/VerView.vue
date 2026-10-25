<script>
// Pedido de reproducir al cargar (sobrevive a que la vista se vuelva a montar).
let reproducirId = null
const pedirReproducir = (id) => (reproducirId = id)
function tomarReproducir(id) {
  const si = reproducirId === id
  reproducirId = null
  return si
}
</script>

<script setup>
// Ver un elemento. Video: hls.js baja cada fragmento cifrado y este loader lo descifra. Foto: se baja y
// descifra la imagen (al tocarla, pantalla completa con zoom). Archivo: vista previa si el navegador la sabe
// mostrar, y descarga del original. Se pasa al anterior/siguiente deslizando o con las flechas.
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Hls from 'hls.js'
import { useAuthStore } from '@/stores/auth'
import { useBovedaStore } from '@/stores/boveda'
import { useToastStore } from '@/stores/toast'
import { useExportadosStore } from '@/stores/exportados'
import { decryptBlob } from '@shared/crypto.js'
import { aLocal, deLocal, duracion, extension, fechaCorta, fechaHora, iconoArchivo, tamano, venceEn, vistaPrevia, etiquetaExport } from '@/lib/formato'
import EtiquetasEditor from '@/components/elementos/EtiquetasEditor.vue'
import UbicacionModal from '@/components/elementos/UbicacionModal.vue'
import AlbumElegirModal from '@/components/elementos/AlbumElegirModal.vue'
import AlbumModal from '@/components/elementos/AlbumModal.vue'
import VisorCompleto from '@/components/elementos/VisorCompleto.vue'
import { useCompartir } from '@/lib/compartir'
import { conRotacion, leerRotacion, sumarRotacion } from '@/lib/rotacion'

const PREVIA_AUTO = 50 * 1024 * 1024 // más grande que esto, la vista previa se pide a mano

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const boveda = useBovedaStore()
const toast = useToastStore()
const el = ref(null)
const error = ref('')
const editando = ref(false)
const titulo = ref('')
const ubicando = ref(false)
const cambiandoFecha = ref(false)
const nuevaFecha = ref('')
const urlPrevia = ref(null) // blob URL de la foto o del archivo
const texto = ref(null)
const cargando = ref(false)
const progreso = ref(null)
const visor = ref(false)
let archivoFoto = null // la foto ya descifrada, para compartirla sin volver a bajarla
let hls = null
const { progreso: progresoCompartir, compartir } = useCompartir()
const { progreso: progresoExp, compartir: compartirExp } = useCompartir()
const exportados = useExportadosStore()
const exportaciones = computed(() => (item.value ? exportados.de(item.value.id) : []))
const viendo = ref(typeof route.query.exp === 'string' ? route.query.exp : null) // id de la exportación que se reproduce
const viendoExp = computed(() => exportaciones.value.find((e) => e.id === viendo.value) ?? null)
const exportando = ref(null) // { alto, filtro } con el diálogo abierto
const compartiendo = ref(null) // id de la exportación que se está preparando para compartir
// Tamaños que de verdad reducen (nunca agrandar).
const estimacion = computed(() => (exportando.value && (exportando.value.alto !== null || exportando.value.filtro !== null) ? exportados.estimar(item.value, exportando.value) : null))
const altosPosibles = computed(() => [720, 540, 480].filter((a) => a < Math.min(m.value?.width ?? 0, m.value?.height ?? 0)))
const FILTROS = [
  ['a', 'A', 'manchas medianas, 6 tonos'],
  ['b', 'B', 'más detalle, 8 tonos'],
  ['c', 'C', 'más difuso, 5 tonos'],
]

const item = computed(() => boveda.items.find((v) => v.id === route.params.id))
const m = computed(() => item.value?.m)
const tipo = computed(() => (m.value ? boveda.tipo(item.value) : null))
const previa = computed(() => (tipo.value === 'archivo' ? vistaPrevia(m.value.mime ?? '', m.value.originalName) : null))
// Orden para pasar al anterior/siguiente: el de la lista desde la que se abrió, o por fecha.
const secuencia = computed(() => {
  const id = route.params.id
  const ids = boveda.secuencia.filter((x) => boveda.items.some((v) => v.id === x && v.m))
  if (ids.includes(id)) return ids
  const lista = tipo.value === 'archivo' ? boveda.archivos : boveda.galeria
  return [...lista].sort((a, b) => new Date(boveda.fechaDe(b)) - new Date(boveda.fechaDe(a))).map((v) => v.id)
})
const pos = computed(() => secuencia.value.indexOf(route.params.id))
const anterior = computed(() => (pos.value > 0 ? secuencia.value[pos.value - 1] : null))
const siguiente = computed(() => (pos.value >= 0 ? secuencia.value[pos.value + 1] ?? null : null))
const ir = (id) => id && router.replace(`/ver/${id}`)
// Atrás: a la pantalla anterior de la app; si se entró directo (p. ej. tras desbloquear), a la galería.
const volver = () => (window.history.state?.back ? router.back() : router.push('/galeria'))
const idsVisor = computed(() => secuencia.value.filter((id) => boveda.tipo(boveda.items.find((v) => v.id === id)) !== 'archivo'))
// Los videos no arrancan solos; sí cuando se pide (▶ en pantalla completa, «Ver» de una exportación). La vista
// se vuelve a montar al cambiar de elemento, por eso el pedido va en una variable del módulo.
function cerrarVisor(id, reproducir = false) {
  visor.value = false
  if (id === route.params.id) {
    if (reproducir) el.value?.play().catch(() => {})
    return
  }
  if (reproducir) pedirReproducir(id)
  ir(id)
}

// Deslizar a los lados sobre la foto o el archivo (en el video no, que choca con la barra de tiempo).
let toque = null
const toqueInicio = (e) => (toque = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null)
function toqueFin(e) {
  if (!toque) return
  const dx = e.changedTouches[0].clientX - toque.x
  const dy = e.changedTouches[0].clientY - toque.y
  toque = null
  if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) ir(dx < 0 ? siguiente.value : anterior.value)
}
function tecla(e) {
  if (e.key === 'Escape' && completo.value) return (completo.value = false)
  if (visor.value || editando.value || ubicando.value || e.target.closest('input, textarea, [contenteditable]')) return
  if (e.key === 'ArrowRight') ir(siguiente.value)
  else if (e.key === 'ArrowLeft') ir(anterior.value)
}
const compartirEste = () => compartir(item.value, tipo.value === 'imagen' ? archivoFoto : null)

const etiquetaFecha = computed(() => (tipo.value === 'video' ? 'Grabado' : tipo.value === 'imagen' ? 'Tomada' : 'Fecha'))

// En el init.mp4 viene la rotación del celular (p. ej. vertical del iPhone): hls.js la ignora, así que se lee,
// se pone en cero (para que ningún navegador la aplique dos veces) y se gira el <video> con CSS.
function loaderDescifrador(key, sufijo = '', alInit = null) {
  const Base = Hls.DefaultConfig.loader
  return class extends Base {
    load(context, config, callbacks) {
      const ruta = context.url.split('?')[0]
      const lista = ruta.endsWith('.m3u8')
      const init = ruta.endsWith('/init.mp4')
      if (sufijo && !context.url.includes('?')) context.url += `?${sufijo}`
      if (lista) return super.load(context, config, callbacks)
      const onSuccess = callbacks.onSuccess
      super.load(context, config, {
        ...callbacks,
        onSuccess: (response, stats, ctx, details) => {
          decryptBlob(key, response.data)
            .then((plano) => {
              if (!init) return plano
              alInit?.(leerRotacion(plano))
              return conRotacion(plano, 0).buffer
            })
            .then((plano) => onSuccess({ ...response, data: plano }, stats, ctx, details))
            .catch(() => callbacks.onError({ code: 0, text: 'No se pudo descifrar el fragmento' }, ctx, details, stats))
        },
      })
    }
  }
}

const accion = (fn) => async (...a) => {
  try {
    await fn(...a)
  } catch (e) {
    toast.error(e)
  }
}
function cambiarFecha() {
  nuevaFecha.value = aLocal(boveda.fechaDe(item.value))
  cambiandoFecha.value = true
}
const guardarFecha = accion(async () => {
  if (!nuevaFecha.value) return
  await boveda.guardarMeta(item.value, { takenAt: deLocal(nuevaFecha.value), fechaOrigen: undefined })
  cambiandoFecha.value = false
  toast.ok('Fecha guardada')
})
function renombrar() {
  titulo.value = m.value.title
  editando.value = true
  window.scrollTo({ top: 0 })
}
const guardarTitulo = accion(async () => {
  await boveda.renombrar(item.value, titulo.value)
  editando.value = false
})
const guardarEtiquetas = accion((nombres) => boveda.asignarEtiquetas(item.value, nombres))
// Álbumes de este elemento.
const eligiendoAlbumes = ref(false)
const creandoAlbum = ref(false)
const crearAlbumConEste = accion(async (datos) => {
  const a = await boveda.crearAlbum(datos, [item.value.id])
  creandoAlbum.value = false
  toast.ok(`Álbum «${a.name}» creado`)
})
const favorito = accion(() => boveda.favorito(item.value))
const guardarUbicacion = accion(async (location) => {
  await boveda.guardarMeta(item.value, { location })
  ubicando.value = false
  toast.ok(location ? 'Ubicación guardada' : 'Ubicación quitada')
})
const descargar = accion(async () => {
  progreso.value = 0
  try {
    await boveda.descargar(item.value, (p) => (progreso.value = Math.round(p * 100)))
  } finally {
    progreso.value = null
  }
})

async function reproducir() {
  if (!Hls.isSupported()) return (error.value = 'Este navegador no soporta el reproductor (en iPhone se necesita iOS 17.1 o superior)')
  const key = await auth.claveDe(item.value)
  await nextTick() // el <video> aparece cuando ya se sabe el tipo
  hls?.destroy()
  error.value = ''
  rotInit.value = 0
  hls = new Hls({
    // Las exportaciones ya salen derechas (ffmpeg aplica la rotación al recodificar): su base es 0.
    loader: loaderDescifrador(key, viendoExp.value ? '' : boveda.marca(item.value), viendoExp.value ? null : (g) => (rotInit.value = g)),
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
  })
  hls.on(Hls.Events.ERROR, (_, d) => {
    if (d.fatal) error.value = `Error de reproducción: ${d.details}`
  })
  hls.loadSource(viendoExp.value ? `/api/exportados/${viendoExp.value.id}/index.m3u8` : `/api/videos/${item.value.id}/archivo/index.m3u8`)
  hls.attachMedia(el.value)
  if (tomarReproducir(item.value.id)) {
    hls.once(Hls.Events.MANIFEST_PARSED, () => el.value?.play().catch(() => {}))
  }
}

// ---------------- rotación ----------------
// giro = la del archivo (rotInit) + la que eligió el usuario (meta.rotacion), en sentido horario. Con giro el
// <video> se gira con CSS y los controles nativos quedarían de lado: se usan unos propios debajo.
const rotInit = ref(0)
const giro = computed(() => (tipo.value === 'video' ? sumarRotacion(rotInit.value, m.value?.rotacion) : 0))
const tumbado = computed(() => giro.value % 180 === 90)
const codificado = ref(null) // { w, h } del video tal como viene (sin girar)
const completo = ref(false) // pantalla completa propia (la nativa del iPhone no respeta el giro)
const estado = ref({ pausado: true, t: 0, total: 0, mudo: false })
const proporcion = computed(() => {
  const c = codificado.value
  if (c?.w && c?.h) return tumbado.value ? c.h / c.w : c.w / c.h
  // Antes de saberlo: meta.width/height ya vienen derechos (sin el giro del usuario).
  const w = m.value?.width || 16, h = m.value?.height || 9
  return (m.value?.rotacion ?? 0) % 180 === 90 ? h / w : w / h
})
const estiloMarco = computed(() =>
  giro.value && !completo.value ? { aspectRatio: String(proporcion.value), width: `min(100%, calc(80vh * ${proporcion.value}))` } : null,
)
const estiloVideo = computed(() =>
  giro.value
    ? { width: tumbado.value ? '100cqh' : '100cqw', height: tumbado.value ? '100cqw' : '100cqh', transform: `translate(-50%, -50%) rotate(${giro.value}deg)` }
    : null,
)
function medirVideo() {
  codificado.value = { w: el.value.videoWidth, h: el.value.videoHeight }
  sincronizar()
}
function sincronizar() {
  const v = el.value
  if (v) estado.value = { pausado: v.paused, t: v.currentTime, total: Number.isFinite(v.duration) ? v.duration : 0, mudo: v.muted }
}
const alternar = () => (el.value.paused ? el.value.play() : el.value.pause())
const buscar = (e) => (el.value.currentTime = Number(e.target.value))
const mudo = () => (el.value.muted = !el.value.muted)
const hora = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const rotar = accion(async () => {
  await boveda.guardarMeta(item.value, { rotacion: sumarRotacion(m.value.rotacion, 90) })
})

// Exportar (más pequeño y/o con filtro): lo hace la NAS con la clave de este video, que se le presta solo para eso.
const pedirExport = accion(async () => {
  await exportados.pedir(item.value, exportando.value)
  exportando.value = null
  toast.info('En cola: la NAS lo está preparando. Dura 7 días.')
})
const reintentarExport = accion((e) => exportados.pedir(item.value, { alto: e.alto, filtro: e.filtro }))
const borrarExport = accion(async (e) => {
  await exportados.borrar(e)
  if (viendo.value === e.id) await ver(null)
  toast.ok('Exportación borrada')
})
// Reemplazar el original por una exportación (más liviana): el original se borra para siempre.
const reemplazando = ref(null) // exportación a confirmar
const reemplazarOriginal = accion(async () => {
  const e = reemplazando.value
  const v = item.value
  await exportados.reemplazar(e)
  reemplazando.value = null
  // Medidas y códec nuevos (mismo cálculo que la NAS: lado corto = alto pedido, pares).
  const corto = Math.min(m.value.width, m.value.height)
  const k = e.alto && e.alto < corto ? e.alto / corto : 1
  const par = (x) => 2 * Math.round(x / 2)
  await boveda.cargar(true) // trae el tamaño y la marca nuevos
  await boveda.guardarMeta(boveda.items.find((x) => x.id === v.id), {
    width: par(m.value.width * k), height: par(m.value.height * k), videoCodec: 'h264',
    reemplazado: { alto: e.alto, filtro: e.filtro, fecha: new Date().toISOString(), antes: v.size },
  })
  viendo.value = null
  await reproducir()
  toast.ok(`Listo: ahora ocupa ${tamano(item.value.size)} (antes ${tamano(v.size)})`)
})

const ver = accion(async (id) => {
  viendo.value = id
  pedirReproducir(item.value.id)
  await reproducir()
})
async function compartirE(e) {
  compartiendo.value = e.id
  try {
    await compartirExp(item.value, null, e)
  } finally {
    compartiendo.value = null
  }
}

const mostrarPrevia = accion(async () => {
  cargando.value = true
  try {
    const blob = tipo.value === 'imagen' ? (archivoFoto = await boveda.paraCompartir(item.value)) : await boveda.original(item.value, (p) => (progreso.value = Math.round(p * 100)))
    if (previa.value === 'texto') texto.value = (await blob.slice(0, 1024 * 1024).text()) + (blob.size > 1024 * 1024 ? '\n…' : '')
    else urlPrevia.value = URL.createObjectURL(blob)
  } finally {
    cargando.value = false
    progreso.value = null
  }
})

onMounted(async () => {
  window.addEventListener('keydown', tecla, true)
  try {
    await boveda.cargar()
    if (!item.value) return (error.value = 'No encontrado')
    if (!m.value) return (error.value = 'Todavía se está procesando')
    if (tipo.value === 'video') {
      await exportados.cargar().catch(() => {})
      if (viendoExp.value?.status !== 'lista') viendo.value = null
      await reproducir()
    }
    else if (tipo.value === 'imagen' || (previa.value && item.value.size <= PREVIA_AUTO)) await mostrarPrevia()
  } catch (e) {
    error.value = e.message
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', tecla, true)
  hls?.destroy()
  if (urlPrevia.value) URL.revokeObjectURL(urlPrevia.value)
})
</script>

<template>
  <div class="d-flex align-items-center gap-2 mb-3">
    <CButton color="secondary" variant="ghost" title="Atrás" @click="volver"><CIcon icon="cil-arrow-left" /></CButton>
    <template v-if="m">
      <form v-if="editando" class="d-flex gap-2 flex-grow-1" @submit.prevent="guardarTitulo">
        <CFormInput v-model="titulo" maxlength="200" autofocus />
        <CButton type="submit" color="primary">Guardar</CButton>
        <CButton color="secondary" variant="ghost" @click="editando = false">Cancelar</CButton>
      </form>
      <h1 v-else-if="tipo === 'archivo'" class="page-title text-truncate h4 mb-0" role="button" title="Renombrar" @click="renombrar">{{ m.title }}</h1>
      <h1 v-else class="page-title text-truncate h5 mb-0">{{ fechaCorta(boveda.fechaDe(item)) }}</h1>
      <template v-if="!editando">
        <CButton v-if="tipo !== 'video'" color="secondary" variant="ghost" class="ms-auto" :disabled="progreso !== null" title="Descargar el original" @click="descargar">
          <CIcon icon="cil-cloud-download" size="lg" /><span v-if="progreso !== null" class="ms-1 small">{{ progreso }}%</span>
        </CButton>
        <CButton color="secondary" variant="ghost" :class="{ 'ms-auto': tipo === 'video' }" :disabled="progresoCompartir !== null" title="Compartir" @click="compartirEste">
          <CIcon icon="cil-share-boxed" size="lg" /><span v-if="progresoCompartir !== null" class="ms-1 small">{{ progresoCompartir }}%</span>
        </CButton>
        <CButton color="link" :class="[m.favorite ? 'text-warning' : 'text-body-secondary']" :title="m.favorite ? 'Quitar de favoritos' : 'Marcar como favorito'" @click="favorito">
          <CIcon icon="cil-star" size="xl" />
        </CButton>
      </template>
    </template>
  </div>
  <CAlert v-if="error" color="danger">{{ error }}</CAlert>

  <div class="ver-medio" @touchstart.passive="toqueInicio" @touchend.passive="tipo !== 'video' && toqueFin($event)">
  <!-- disableremoteplayback: requerido por ManagedMediaSource en iPhone -->
  <div v-if="tipo === 'video'" v-show="!error" class="marco-video" :class="{ girado: giro, completo: giro && completo }" :style="estiloMarco">
    <video ref="el" class="player" :style="estiloVideo" :controls="!giro" playsinline disableremoteplayback
      @loadedmetadata="medirVideo" @play="sincronizar" @pause="sincronizar" @timeupdate="sincronizar" @volumechange="sincronizar" @durationchange="sincronizar" @click="giro && alternar()"></video>
    <div v-if="giro" class="controles-video">
      <button type="button" :title="estado.pausado ? 'Reproducir' : 'Pausar'" @click="alternar"><CIcon :icon="estado.pausado ? 'cil-media-play' : 'cil-media-pause'" /></button>
      <span class="small">{{ hora(estado.t) }}</span>
      <input type="range" class="form-range flex-grow-1" min="0" :max="estado.total || 0" step="0.1" :value="estado.t" aria-label="Posición" @input="buscar" />
      <span class="small">{{ hora(estado.total) }}</span>
      <button type="button" :title="estado.mudo ? 'Activar sonido' : 'Silenciar'" @click="mudo"><CIcon :icon="estado.mudo ? 'cil-volume-off' : 'cil-volume-high'" /></button>
      <button type="button" :title="completo ? 'Salir de pantalla completa' : 'Pantalla completa'" @click="completo = !completo"><CIcon :icon="completo ? 'cil-fullscreen-exit' : 'cil-fullscreen'" /></button>
    </div>
  </div>
  <div v-if="tipo === 'video' && viendoExp" class="small text-body-secondary mt-1">
    <CIcon icon="cil-share-all" size="sm" class="me-1" />Viendo la exportación ({{ etiquetaExport(viendoExp) }})
    <CButton color="link" size="sm" class="py-0" @click="ver(null)">Ver el original</CButton>
  </div>

  <template v-else-if="m">
    <div v-if="cargando" class="visor d-flex align-items-center justify-content-center">
      <CSpinner /><span v-if="progreso !== null" class="ms-2 small">{{ progreso }}%</span>
    </div>
    <img v-else-if="urlPrevia && tipo === 'imagen'" :src="urlPrevia" class="foto foto-ampliable" :alt="m.title" title="Ver en pantalla completa" @click="visor = true" />
    <img v-else-if="urlPrevia && previa === 'imagen'" :src="urlPrevia" class="foto" :alt="m.title" />
    <iframe v-else-if="urlPrevia && previa === 'pdf'" :src="urlPrevia" class="visor visor-doc" :title="m.title"></iframe>
    <audio v-else-if="urlPrevia && previa === 'audio'" :src="urlPrevia" controls class="w-100"></audio>
    <video v-else-if="urlPrevia && previa === 'video'" :src="urlPrevia" controls playsinline class="player"></video>
    <pre v-else-if="texto !== null" class="visor visor-texto">{{ texto }}</pre>
    <div v-else-if="tipo === 'archivo'" class="visor d-flex flex-column align-items-center justify-content-center gap-2 text-center">
      <CIcon :icon="iconoArchivo(m.originalName, m.mime ?? '')" size="5xl" class="text-secondary" />
      <div class="fw-semibold">{{ m.originalName }}</div>
      <div class="small text-body-secondary">{{ extension(m.originalName) || 'Archivo' }} · {{ tamano(item.size) }}</div>
      <div class="d-flex gap-2 mt-2">
        <CButton v-if="previa" color="secondary" variant="outline" @click="mostrarPrevia">Ver aquí</CButton>
        <CButton color="primary" :disabled="progreso !== null" @click="descargar"><CIcon icon="cil-cloud-download" class="me-1" />Descargar</CButton>
      </div>
    </div>
  </template>
  <button v-if="m && anterior" type="button" class="ver-nav ver-ant" title="Anterior" @click="ir(anterior)"><CIcon icon="cil-chevron-left" size="lg" /></button>
  <button v-if="m && siguiente" type="button" class="ver-nav ver-sig" title="Siguiente" @click="ir(siguiente)"><CIcon icon="cil-chevron-right" size="lg" /></button>
  </div>

  <CRow v-if="m" class="mt-3 mb-4 g-3">
    <CCol md="7">
      <div class="small text-body-secondary mb-1">Etiquetas</div>
      <EtiquetasEditor :model-value="boveda.nombresDe(item)" :sugerencias="boveda.etiquetas" @update:model-value="guardarEtiquetas" />
      <div class="small text-body-secondary mt-3 mb-1">Álbumes</div>
      <div class="d-flex flex-wrap gap-1 align-items-center">
        <RouterLink v-for="a in boveda.albumesDe(item)" :key="a.id" :to="`/albumes/${a.id}`" class="badge rounded-pill text-bg-secondary text-decoration-none fw-normal">
          <CIcon icon="cil-library" size="sm" class="me-1" />{{ a.name }}
        </RouterLink>
        <CButton color="link" size="sm" class="py-0" @click="eligiendoAlbumes = true">{{ boveda.albumesDe(item).length ? 'Cambiar' : 'Agregar a un álbum' }}</CButton>
      </div>
    </CCol>
    <CCol md="5" class="small">
      <form v-if="cambiandoFecha" class="mb-1 d-flex align-items-center gap-2" @submit.prevent="guardarFecha">
        <CIcon icon="cil-calendar" class="text-body-secondary flex-shrink-0" />
        <input v-model="nuevaFecha" type="datetime-local" class="form-control form-control-sm subir-fecha" aria-label="Fecha" required />
        <CButton type="submit" color="primary" size="sm">Guardar</CButton>
        <CButton color="secondary" variant="ghost" size="sm" @click="cambiandoFecha = false">Cancelar</CButton>
      </form>
      <div v-else class="mb-1">
        <CIcon icon="cil-calendar" class="me-2 text-body-secondary" />{{ m.takenAt ? `${etiquetaFecha} el ${fechaHora(m.takenAt)}` : `Subido el ${fechaHora(item.createdAt)}` }}<span v-if="m.takenAt && m.fechaOrigen === 'archivo'" class="text-body-secondary" title="La foto no traía fecha: es la del archivo según el iPhone"> (del archivo)</span>
        <CButton color="link" size="sm" class="py-0" title="Cambiar la fecha" aria-label="Cambiar la fecha" @click="cambiarFecha">Cambiar</CButton>
      </div>
      <div v-if="tipo !== 'archivo'" class="mb-1">
        <CIcon icon="cil-location-pin" class="me-2 text-body-secondary" />
        <RouterLink v-if="m.location" :to="`/mapa?v=${item.id}`">{{ m.location.lat.toFixed(5) }}, {{ m.location.lon.toFixed(5) }} · ver en el mapa</RouterLink>
        <span v-else class="text-body-secondary">Sin ubicación</span>
        <CButton color="link" size="sm" class="py-0" @click="ubicando = true">{{ m.location ? 'Cambiar' : 'Agregar' }}</CButton>
      </div>
      <div v-if="tipo !== 'archivo'" class="mb-1 d-flex align-items-center min-w-0">
        <CIcon icon="cil-description" class="me-2 text-body-secondary flex-shrink-0" /><span class="text-truncate">{{ m.title }}</span>
        <CButton color="link" size="sm" class="py-0" @click="renombrar">Renombrar</CButton>
      </div>
      <div v-if="m.device" class="mb-1"><CIcon icon="cil-devices" class="me-2 text-body-secondary" />{{ m.device }}</div>
      <div v-if="tipo === 'video'" class="mb-1">
        <CIcon icon="cil-action-redo" class="me-2 text-body-secondary" />{{ m.rotacion ? `Girado ${m.rotacion}°` : 'Sin girar' }}
        <CButton color="link" size="sm" class="py-0" title="Girar 90° a la derecha" aria-label="Rotar el video" @click="rotar">Rotar</CButton>
      </div>
      <div v-if="tipo === 'video'" class="mb-1">
        <CIcon icon="cil-share-all" class="me-2 text-body-secondary" />Exportar
        <CButton color="link" size="sm" class="py-0" title="Exportar más pequeño o con filtro" @click="exportando = { alto: altosPosibles[0] ?? null, filtro: null }">Nueva…</CButton>
        <div v-for="e in exportaciones" :key="e.id" class="ms-4 mt-1">
          <span class="fw-semibold">{{ etiquetaExport(e) }}</span>
          <span v-if="e.status === 'en_cola'" class="text-body-secondary ms-1">· en cola…</span>
          <span v-else-if="e.status === 'procesando'" class="text-body-secondary ms-1">· creando… {{ e.progreso }}%{{ e.estimado ? ` · pesará ~${tamano(e.estimado)}` : '' }}</span>
          <template v-else-if="e.status === 'error'">
            <span class="text-danger ms-1">· {{ e.progreso ? `quedó en ${e.progreso}% · ` : '' }}{{ e.error }}</span>
            <CButton color="link" size="sm" class="py-0" @click="reintentarExport(e)">{{ e.progreso ? 'Reanudar' : 'Reintentar' }}</CButton>
          </template>
          <span v-else class="text-body-secondary ms-1">· {{ tamano(e.size) }} · {{ venceEn(e.expiresAt) }}</span>
          <div v-if="e.status === 'lista'" class="d-flex flex-wrap gap-1 mt-1">
            <CButton color="secondary" variant="outline" size="sm" :disabled="viendo === e.id" @click="ver(e.id)"><CIcon icon="cil-media-play" class="me-1" />Ver</CButton>
            <CButton color="secondary" variant="outline" size="sm" :disabled="compartiendo !== null" :title="`Compartir ${etiquetaExport(e)}`" @click="compartirE(e)">
              <CIcon icon="cil-share-boxed" class="me-1" />{{ compartiendo === e.id && progresoExp !== null ? `${progresoExp}%` : 'Compartir' }}
            </CButton>
            <CButton color="secondary" variant="outline" size="sm" title="Reemplazar el original por esta versión" @click="reemplazando = e"><CIcon icon="cil-swap-horizontal" class="me-1" />Usar como original</CButton>
            <CButton color="danger" variant="ghost" size="sm" :title="`Borrar ${etiquetaExport(e)}`" @click="borrarExport(e)"><CIcon icon="cil-trash" /></CButton>
          </div>
          <CButton v-else-if="e.status === 'error'" color="danger" variant="ghost" size="sm" class="py-0" @click="borrarExport(e)">Quitar</CButton>
        </div>
      </div>
      <div class="text-body-secondary">
        <template v-if="tipo === 'video'">{{ duracion(m.duration) }} · {{ m.width }}×{{ m.height }} · {{ m.videoCodec?.toUpperCase() }} · </template>
        <template v-else-if="tipo === 'imagen'">{{ m.width }}×{{ m.height }} · </template>
        {{ tamano(item.size) }} · {{ m.originalName }}
      </div>
    </CCol>
  </CRow>
  <CModal :visible="!!exportando" alignment="center" @close="exportando = null">
    <CModalHeader><CModalTitle>Exportar video</CModalTitle></CModalHeader>
    <CModalBody v-if="exportando">
      <div class="fw-semibold mb-1">Tamaño</div>
      <div v-for="[a, txt] in [[null, 'Original (sin reducir)'], [720, '720p'], [540, '540p'], [480, '480p']]" :key="String(a)" class="form-check">
        <input :id="`alto-${a}`" v-model="exportando.alto" class="form-check-input" type="radio" :value="a" :disabled="a !== null && !altosPosibles.includes(a)" />
        <label class="form-check-label" :for="`alto-${a}`">{{ txt }}</label>
      </div>
      <div class="fw-semibold mt-3 mb-1">Filtro</div>
      <div v-for="[k, txt] in [[null, 'Ninguno'], ...FILTROS.map(([k, n, d]) => [k, `${n}: posterizado verde/amarillo, ${d}`])]" :key="String(k)" class="form-check">
        <input :id="`filtro-${k}`" v-model="exportando.filtro" class="form-check-input" type="radio" :value="k" />
        <label class="form-check-label" :for="`filtro-${k}`">{{ txt }}</label>
      </div>
      <div v-if="estimacion" class="mt-3 export-estimado">
        Pesará aprox. <strong>{{ tamano(estimacion.min) }} – {{ tamano(estimacion.max) }}</strong>
        <span class="text-body-secondary">(el original: {{ tamano(item.size) }})</span>
        <div class="small text-body-secondary">{{ estimacion.propia ? `Según ${estimacion.n === 1 ? 'tu exportación anterior' : `tus ${estimacion.n} exportaciones anteriores`} con este filtro.` : 'Estimación general: se afina con tus próximas exportaciones.' }}</div>
      </div>
      <div class="small text-body-secondary mt-3">Lo hace la NAS (puede tardar varias veces lo que dura el video) y se borra solo a los 7 días.</div>
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="ghost" @click="exportando = null">Cancelar</CButton>
      <CButton color="primary" :disabled="!exportando || (exportando.alto === null && exportando.filtro === null)" @click="pedirExport">Exportar</CButton>
    </CModalFooter>
  </CModal>
  <CModal :visible="!!reemplazando" alignment="center" @close="reemplazando = null">
    <CModalHeader><CModalTitle>¿Usar como original?</CModalTitle></CModalHeader>
    <CModalBody v-if="reemplazando">
      El video pasa a ser la versión <strong>{{ etiquetaExport(reemplazando) }}</strong> ({{ tamano(reemplazando.size) }} en vez de {{ tamano(item.size) }}).
      <strong>El original se borra para siempre</strong> y no se puede recuperar.
      <div v-if="reemplazando.filtro" class="text-danger mt-2">Tiene filtro: el video quedará con el filtro puesto.</div>
      <div class="small text-body-secondary mt-2">Fecha, ubicación, etiquetas y miniatura se conservan.</div>
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="ghost" @click="reemplazando = null">Cancelar</CButton>
      <CButton color="danger" @click="reemplazarOriginal">Reemplazar</CButton>
    </CModalFooter>
  </CModal>
  <VisorCompleto v-if="visor" :ids="idsVisor" :inicial="item.id" @cerrar="cerrarVisor" />
  <UbicacionModal v-if="m && tipo !== 'archivo'" :item="item" :visible="ubicando" @close="ubicando = false" @save="guardarUbicacion" />
  <AlbumElegirModal :visible="eligiendoAlbumes" :ids="item ? [item.id] : []" @close="eligiendoAlbumes = false" @listo="eligiendoAlbumes = false" @nuevo="eligiendoAlbumes = false; creandoAlbum = true" />
  <AlbumModal :visible="creandoAlbum" :ids="item ? [item.id] : []" @close="creandoAlbum = false" @save="crearAlbumConEste" />
</template>
