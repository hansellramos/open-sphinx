<script setup>
// Reproductor: hls.js baja cada fragmento cifrado, este loader lo descifra y se lo pasa al video.
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Hls from 'hls.js'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { decryptBlob } from '@shared/crypto.js'
import { duracion, fecha, tamano } from '@/lib/formato'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const video = ref(null)
const el = ref(null)
const error = ref('')
let hls = null

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

onMounted(async () => {
  try {
    video.value = await api.get(`/videos/${route.params.id}`)
    if (video.value.status !== 'listo') return (error.value = 'El video todavía se está procesando')
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
    <CButton color="secondary" variant="ghost" @click="router.push('/videos')"><CIcon icon="cil-arrow-left" /></CButton>
    <h1 class="page-title text-truncate h4 mb-0">{{ video?.title }}</h1>
  </div>
  <CAlert v-if="error" color="danger">{{ error }}</CAlert>
  <!-- disableremoteplayback: requerido por ManagedMediaSource en iPhone -->
  <video v-show="!error" ref="el" class="player" controls playsinline autoplay disableremoteplayback></video>
  <div v-if="video" class="small text-body-secondary mt-2 mb-4">
    {{ duracion(video.duration) }} · {{ video.width }}×{{ video.height }} · {{ video.videoCodec?.toUpperCase() }} · {{ tamano(video.size) }} · {{ video.originalName }} · subido {{ fecha(video.createdAt) }}
  </div>
</template>
