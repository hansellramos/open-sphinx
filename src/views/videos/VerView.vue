<script setup>
// Reproductor: hls.js baja cada fragmento cifrado, este loader lo descifra y se lo pasa al video.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Hls from 'hls.js'
import { useAuthStore } from '@/stores/auth'
import { useBovedaStore } from '@/stores/boveda'
import { useToastStore } from '@/stores/toast'
import { decryptBlob } from '@shared/crypto.js'
import { duracion, fechaHora, tamano } from '@/lib/formato'
import EtiquetasEditor from '@/components/videos/EtiquetasEditor.vue'
import UbicacionModal from '@/components/videos/UbicacionModal.vue'

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
let hls = null

const video = computed(() => boveda.videos.find((v) => v.id === route.params.id))
const m = computed(() => video.value?.m)

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
  await boveda.renombrar(video.value, titulo.value)
  editando.value = false
})
const guardarEtiquetas = accion((nombres) => boveda.asignarEtiquetas(video.value, nombres))
const favorito = accion(() => boveda.favorito(video.value))
const guardarUbicacion = accion(async (location) => {
  await boveda.guardarMeta(video.value, { location })
  ubicando.value = false
  toast.ok(location ? 'Ubicación guardada' : 'Ubicación quitada')
})

onMounted(async () => {
  try {
    await boveda.cargar()
    if (!video.value) return (error.value = 'Video no encontrado')
    if (!m.value) return (error.value = 'El video todavía se está procesando')
    if (!Hls.isSupported()) return (error.value = 'Este navegador no soporta el reproductor (en iPhone se necesita iOS 17.1 o superior)')
    const key = await auth.claveDe(video.value)
    hls = new Hls({ loader: loaderDescifrador(key), maxBufferLength: 30, maxMaxBufferLength: 60 })
    hls.on(Hls.Events.ERROR, (_, d) => {
      if (d.fatal) error.value = `Error de reproducción: ${d.details}`
    })
    hls.loadSource(`/api/videos/${video.value.id}/archivo/index.m3u8`)
    hls.attachMedia(el.value)
  } catch (e) {
    error.value = e.message
  }
})
onBeforeUnmount(() => hls?.destroy())
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
      <CButton v-if="!editando" color="link" class="ms-auto" :class="m.favorite ? 'text-warning' : 'text-body-secondary'" :title="m.favorite ? 'Quitar de favoritos' : 'Marcar como favorito'" @click="favorito">
        <CIcon icon="cil-star" size="xl" />
      </CButton>
    </template>
  </div>
  <CAlert v-if="error" color="danger">{{ error }}</CAlert>
  <!-- disableremoteplayback: requerido por ManagedMediaSource en iPhone -->
  <video v-show="!error" ref="el" class="player" controls playsinline autoplay disableremoteplayback></video>

  <CRow v-if="m" class="mt-3 mb-4 g-3">
    <CCol md="7">
      <div class="small text-body-secondary mb-1">Etiquetas</div>
      <EtiquetasEditor :model-value="boveda.nombresDe(video)" :sugerencias="boveda.etiquetas" @update:model-value="guardarEtiquetas" />
    </CCol>
    <CCol md="5" class="small">
      <div class="mb-1"><CIcon icon="cil-calendar" class="me-2 text-body-secondary" />{{ m.takenAt ? `Grabado el ${fechaHora(m.takenAt)}` : `Subido el ${fechaHora(video.createdAt)} (sin fecha de grabación)` }}</div>
      <div class="mb-1">
        <CIcon icon="cil-location-pin" class="me-2 text-body-secondary" />
        <RouterLink v-if="m.location" :to="`/mapa?v=${video.id}`">{{ m.location.lat.toFixed(5) }}, {{ m.location.lon.toFixed(5) }} · ver en el mapa</RouterLink>
        <span v-else class="text-body-secondary">Sin ubicación</span>
        <CButton color="link" size="sm" class="py-0" @click="ubicando = true">{{ m.location ? 'Cambiar' : 'Agregar' }}</CButton>
      </div>
      <div v-if="m.device" class="mb-1"><CIcon icon="cil-devices" class="me-2 text-body-secondary" />{{ m.device }}</div>
      <div class="text-body-secondary">
        {{ duracion(m.duration) }} · {{ m.width }}×{{ m.height }} · {{ m.videoCodec?.toUpperCase() }} · {{ tamano(video.size) }} · {{ m.originalName }}
      </div>
    </CCol>
  </CRow>
  <UbicacionModal v-if="m" :video="video" :visible="ubicando" @close="ubicando = false" @save="guardarUbicacion" />
</template>
