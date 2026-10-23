<script setup>
// Miniatura: se baja cifrada y se descifra aquí.
import { ref, watch, onBeforeUnmount } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { decryptBlob } from '@shared/crypto.js'
import { duracion } from '@/lib/formato'

const props = defineProps({ video: Object })
const auth = useAuthStore()
const url = ref(null)

async function cargar() {
  if (props.video.status !== 'listo' || url.value) return
  try {
    const res = await fetch(`/api/videos/${props.video.id}/archivo/thumb.jpg`, { credentials: 'include' })
    if (!res.ok) return
    const plano = await decryptBlob(await auth.claveDe(props.video), await res.arrayBuffer())
    url.value = URL.createObjectURL(new Blob([plano], { type: 'image/jpeg' }))
  } catch {
    /* sin miniatura */
  }
}
watch(() => props.video.status, cargar, { immediate: true })
onBeforeUnmount(() => url.value && URL.revokeObjectURL(url.value))
</script>

<template>
  <div class="thumb">
    <img v-if="url" :src="url" alt="" />
    <CSpinner v-else-if="video.status === 'procesando' || video.status === 'en_cola'" color="light" size="sm" />
    <CIcon v-else icon="cil-video" size="xl" class="text-secondary" />
    <span v-if="video.duration" class="dur">{{ duracion(video.duration) }}</span>
  </div>
</template>
