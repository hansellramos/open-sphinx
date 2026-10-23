<script setup>
// Miniatura: se baja cifrada y se descifra solo cuando aparece en pantalla. Respeta el difuminado.
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useBovedaStore } from '@/stores/boveda'
import { usePrivacidadStore } from '@/stores/privacidad'
import { duracion } from '@/lib/formato'

const props = defineProps({ video: Object })
const boveda = useBovedaStore()
const priv = usePrivacidadStore()
const url = ref(null)
const el = ref(null)
let obs = null

async function cargar() {
  if (url.value || props.video.status !== 'listo') return
  url.value = await boveda.thumbUrl(props.video).catch(() => null)
}
onMounted(() => {
  obs = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (cargar(), obs.disconnect()), { rootMargin: '300px' })
  obs.observe(el.value)
})
watch(() => props.video.status, () => obs && (obs.disconnect(), obs.observe(el.value)))
onBeforeUnmount(() => obs?.disconnect())
</script>

<template>
  <div ref="el" class="thumb">
    <img v-if="url" :src="url" alt="" :class="{ difuminada: priv.difuminar }" />
    <CSpinner v-else-if="video.status === 'procesando' || video.status === 'en_cola'" color="light" size="sm" />
    <CIcon v-else icon="cil-video" size="xl" class="text-secondary" />
    <span v-if="video.m?.duration" class="dur">{{ duracion(video.m.duration) }}</span>
    <slot />
  </div>
</template>
