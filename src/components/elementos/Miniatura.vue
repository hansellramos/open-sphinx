<script setup>
// Miniatura: se baja cifrada y se descifra solo cuando aparece en pantalla. Respeta el difuminado.
// Los archivos no tienen miniatura: se muestra un ícono con la extensión.
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useBovedaStore } from '@/stores/boveda'
import { usePrivacidadStore } from '@/stores/privacidad'
import { duracion, extension, iconoArchivo } from '@/lib/formato'

const props = defineProps({ item: Object })
const boveda = useBovedaStore()
const priv = usePrivacidadStore()
const url = ref(null)
const el = ref(null)
const tipo = computed(() => (props.item.m ? boveda.tipo(props.item) : null))
let obs = null

async function cargar() {
  if (url.value || props.item.status !== 'listo' || tipo.value === 'archivo') return
  url.value = await boveda.thumbUrl(props.item).catch(() => null)
}
onMounted(() => {
  obs = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (cargar(), obs.disconnect()), { rootMargin: '300px' })
  obs.observe(el.value)
})
watch(() => props.item.status, () => obs && (obs.disconnect(), obs.observe(el.value)))
onBeforeUnmount(() => obs?.disconnect())
</script>

<template>
  <div ref="el" class="thumb">
    <img v-if="url" :src="url" alt="" :class="{ difuminada: priv.difuminar }" />
    <CSpinner v-else-if="item.status === 'procesando' || item.status === 'en_cola'" color="light" size="sm" />
    <div v-else-if="tipo === 'archivo'" class="text-center text-secondary">
      <CIcon :icon="iconoArchivo(item.m.originalName, item.m.mime ?? '')" size="3xl" />
      <div class="small fw-semibold mt-1">{{ extension(item.m.originalName) }}</div>
    </div>
    <CIcon v-else :icon="tipo === 'imagen' ? 'cil-image' : 'cil-video'" size="xl" class="text-secondary" />
    <span v-if="tipo === 'video' && item.m?.duration" class="dur">{{ duracion(item.m.duration) }}</span>
    <slot />
  </div>
</template>
