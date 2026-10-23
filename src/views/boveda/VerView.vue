<script setup>
// Ver un elemento. Video: hls.js baja cada fragmento cifrado y este loader lo descifra. Foto: se baja y
// descifra la imagen. Archivo: vista previa si el navegador la sabe mostrar, y descarga del original.
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Hls from 'hls.js'
import { useAuthStore } from '@/stores/auth'
import { useBovedaStore } from '@/stores/boveda'
import { useToastStore } from '@/stores/toast'
import { decryptBlob } from '@shared/crypto.js'
import { duracion, extension, fechaHora, iconoArchivo, tamano, vistaPrevia } from '@/lib/formato'
import EtiquetasEditor from '@/components/elementos/EtiquetasEditor.vue'
import UbicacionModal from '@/components/elementos/UbicacionModal.vue'

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
const urlPrevia = ref(null) // blob URL de la foto o del archivo
const texto = ref(null)
const cargando = ref(false)
const progreso = ref(null)
let hls = null

const item = computed(() => boveda.items.find((v) => v.id === route.params.id))
const m = computed(() => item.value?.m)
const tipo = computed(() => (m.value ? boveda.tipo(item.value) : null))
const previa = computed(() => (tipo.value === 'archivo' ? vistaPrevia(m.value.mime ?? '', m.value.originalName) : null))
const etiquetaFecha = computed(() => (tipo.value === 'video' ? 'Grabado' : tipo.value === 'imagen' ? 'Tomada' : 'Fecha'))

function loaderDescifrador(key) {
  const Base = Hls.DefaultConfig.loader
  return class extends Base {
    load(context, config, callbacks) {
      if (context.url.endsWith('.m3u8')) return super.load(context, config, callbacks)
      const onSuccess = callbacks.onSuccess
      super.load(context, config, {
        ...callbacks,
        onSuccess: (response, stats, ctx, details) => {
          decryptBlob(key, response.data)
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
const guardarTitulo = accion(async () => {
  await boveda.renombrar(item.value, titulo.value)
  editando.value = false
})
const guardarEtiquetas = accion((nombres) => boveda.asignarEtiquetas(item.value, nombres))
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
  hls = new Hls({ loader: loaderDescifrador(key), maxBufferLength: 30, maxMaxBufferLength: 60 })
  hls.on(Hls.Events.ERROR, (_, d) => {
    if (d.fatal) error.value = `Error de reproducción: ${d.details}`
  })
  hls.loadSource(`/api/videos/${item.value.id}/archivo/index.m3u8`)
  hls.attachMedia(el.value)
}

const mostrarPrevia = accion(async () => {
  cargando.value = true
  try {
    const blob = tipo.value === 'imagen' ? await boveda.imagen(item.value) : await boveda.original(item.value, (p) => (progreso.value = Math.round(p * 100)))
    if (previa.value === 'texto') texto.value = (await blob.slice(0, 1024 * 1024).text()) + (blob.size > 1024 * 1024 ? '\n…' : '')
    else urlPrevia.value = URL.createObjectURL(blob)
  } finally {
    cargando.value = false
    progreso.value = null
  }
})

onMounted(async () => {
  try {
    await boveda.cargar()
    if (!item.value) return (error.value = 'No encontrado')
    if (!m.value) return (error.value = 'Todavía se está procesando')
    if (tipo.value === 'video') await reproducir()
    else if (tipo.value === 'imagen' || (previa.value && item.value.size <= PREVIA_AUTO)) await mostrarPrevia()
  } catch (e) {
    error.value = e.message
  }
})
onBeforeUnmount(() => {
  hls?.destroy()
  if (urlPrevia.value) URL.revokeObjectURL(urlPrevia.value)
})
</script>

<template>
  <div class="d-flex align-items-center gap-2 mb-3">
    <CButton color="secondary" variant="ghost" @click="router.back()"><CIcon icon="cil-arrow-left" /></CButton>
    <template v-if="m">
      <form v-if="editando" class="d-flex gap-2 flex-grow-1" @submit.prevent="guardarTitulo">
        <CFormInput v-model="titulo" maxlength="200" autofocus />
        <CButton type="submit" color="primary">Guardar</CButton>
        <CButton color="secondary" variant="ghost" @click="editando = false">Cancelar</CButton>
      </form>
      <h1 v-else class="page-title text-truncate h4 mb-0" role="button" title="Renombrar" @click="titulo = m.title; editando = true">{{ m.title }}</h1>
      <template v-if="!editando">
        <CButton v-if="tipo !== 'video'" color="secondary" variant="ghost" class="ms-auto" :disabled="progreso !== null" title="Descargar el original" @click="descargar">
          <CIcon icon="cil-cloud-download" size="lg" /><span v-if="progreso !== null" class="ms-1 small">{{ progreso }}%</span>
        </CButton>
        <CButton color="link" :class="[m.favorite ? 'text-warning' : 'text-body-secondary', { 'ms-auto': tipo === 'video' }]" :title="m.favorite ? 'Quitar de favoritos' : 'Marcar como favorito'" @click="favorito">
          <CIcon icon="cil-star" size="xl" />
        </CButton>
      </template>
    </template>
  </div>
  <CAlert v-if="error" color="danger">{{ error }}</CAlert>

  <!-- disableremoteplayback: requerido por ManagedMediaSource en iPhone -->
  <video v-if="tipo === 'video'" v-show="!error" ref="el" class="player" controls playsinline autoplay disableremoteplayback></video>

  <template v-else-if="m">
    <div v-if="cargando" class="visor d-flex align-items-center justify-content-center">
      <CSpinner /><span v-if="progreso !== null" class="ms-2 small">{{ progreso }}%</span>
    </div>
    <img v-else-if="urlPrevia && (tipo === 'imagen' || previa === 'imagen')" :src="urlPrevia" class="foto" :alt="m.title" />
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

  <CRow v-if="m" class="mt-3 mb-4 g-3">
    <CCol md="7">
      <div class="small text-body-secondary mb-1">Etiquetas</div>
      <EtiquetasEditor :model-value="boveda.nombresDe(item)" :sugerencias="boveda.etiquetas" @update:model-value="guardarEtiquetas" />
    </CCol>
    <CCol md="5" class="small">
      <div class="mb-1"><CIcon icon="cil-calendar" class="me-2 text-body-secondary" />{{ m.takenAt ? `${etiquetaFecha} el ${fechaHora(m.takenAt)}` : `Subido el ${fechaHora(item.createdAt)}` }}</div>
      <div v-if="tipo !== 'archivo'" class="mb-1">
        <CIcon icon="cil-location-pin" class="me-2 text-body-secondary" />
        <RouterLink v-if="m.location" :to="`/mapa?v=${item.id}`">{{ m.location.lat.toFixed(5) }}, {{ m.location.lon.toFixed(5) }} · ver en el mapa</RouterLink>
        <span v-else class="text-body-secondary">Sin ubicación</span>
        <CButton color="link" size="sm" class="py-0" @click="ubicando = true">{{ m.location ? 'Cambiar' : 'Agregar' }}</CButton>
      </div>
      <div v-if="m.device" class="mb-1"><CIcon icon="cil-devices" class="me-2 text-body-secondary" />{{ m.device }}</div>
      <div class="text-body-secondary">
        <template v-if="tipo === 'video'">{{ duracion(m.duration) }} · {{ m.width }}×{{ m.height }} · {{ m.videoCodec?.toUpperCase() }} · </template>
        <template v-else-if="tipo === 'imagen'">{{ m.width }}×{{ m.height }} · </template>
        {{ tamano(item.size) }} · {{ m.originalName }}
      </div>
    </CCol>
  </CRow>
  <UbicacionModal v-if="m && tipo !== 'archivo'" :item="item" :visible="ubicando" @close="ubicando = false" @save="guardarUbicacion" />
</template>
