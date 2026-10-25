<script setup>
// Crear un ZIP con contraseña (tipo Takeout) de los elegidos, eligiendo el tamaño de fotos y videos.
import { ref, computed, watch } from 'vue'
import { useBovedaStore } from '@/stores/boveda'
import { useZipsStore } from '@/stores/zips'
import { useToastStore } from '@/stores/toast'
import { tamano } from '@/lib/formato'

const props = defineProps({ items: { type: Array, default: () => [] }, visible: Boolean, nombre: String })
const emit = defineEmits(['close', 'listo'])
const boveda = useBovedaStore()
const zips = useZipsStore()
const toast = useToastStore()
const f = ref({ nombre: '', fotos: null, videos: null })
const creando = ref(false)

watch(
  () => props.visible,
  (v) => v && (f.value = { nombre: props.nombre || 'Mis fotos', fotos: null, videos: null }),
)
const cuenta = computed(() => {
  const c = { imagen: 0, video: 0, archivo: 0 }
  for (const v of props.items) c[boveda.tipo(v)]++
  return c
})
const n = (k, palabra) => `${k} ${palabra}${k === 1 ? '' : 's'}`
const pesoOriginal = computed(() => props.items.reduce((t, v) => t + (v.size || 0), 0))
// Cuántos se achican con lo elegido (los que ya son de ese tamaño o menos van igual).
const corto = (v) => Math.min(v.m.width ?? 0, v.m.height ?? 0)
const seReducen = computed(() => ({
  fotos: f.value.fotos ? props.items.filter((v) => boveda.tipo(v) === 'imagen' && corto(v) > f.value.fotos).length : 0,
  videos: f.value.videos ? props.items.filter((v) => boveda.tipo(v) === 'video' && corto(v) > f.value.videos).length : 0,
}))

async function crear() {
  creando.value = true
  try {
    await zips.crear(props.items, f.value)
    toast.ok('En cola: lo ves en Exportaciones con su contraseña')
    emit('listo')
  } catch (e) {
    toast.error(e)
  } finally {
    creando.value = false
  }
}
</script>

<template>
  <CModal :visible="visible" alignment="center" backdrop="static" @close="!creando && emit('close')">
    <CModalHeader :close-button="!creando"><CModalTitle>ZIP con contraseña</CModalTitle></CModalHeader>
    <CModalBody>
      <p class="small mb-2">
        {{ n(items.length, 'elemento') }}: {{ [cuenta.imagen && n(cuenta.imagen, 'foto'), cuenta.video && n(cuenta.video, 'video'), cuenta.archivo && n(cuenta.archivo, 'archivo')].filter(Boolean).join(', ') }} ·
        {{ tamano(pesoOriginal) }} en original
      </p>
      <CFormLabel for="zip-nombre" class="small mb-1">Nombre (solo lo ves tú; va cifrado)</CFormLabel>
      <CFormInput id="zip-nombre" v-model="f.nombre" maxlength="120" class="mb-3" />
      <div class="d-flex flex-wrap gap-3">
        <div v-if="cuenta.imagen">
          <CFormLabel for="zip-fotos" class="small mb-1">Fotos</CFormLabel>
          <select id="zip-fotos" v-model="f.fotos" class="form-select form-select-sm">
            <option :value="null">Original</option>
            <option :value="1080">1080p</option>
            <option :value="720">720p</option>
          </select>
        </div>
        <div v-if="cuenta.video">
          <CFormLabel for="zip-videos" class="small mb-1">Videos</CFormLabel>
          <select id="zip-videos" v-model="f.videos" class="form-select form-select-sm">
            <option :value="null">Original</option>
            <option :value="720">720p</option>
            <option :value="540">540p</option>
            <option :value="480">480p</option>
          </select>
        </div>
      </div>
      <div v-if="seReducen.fotos || seReducen.videos" class="small text-body-secondary mt-2">
        Se achican {{ [seReducen.fotos && n(seReducen.fotos, 'foto'), seReducen.videos && n(seReducen.videos, 'video')].filter(Boolean).join(' y ') }}; lo que ya es de ese tamaño o menos va igual.
        <template v-if="seReducen.videos"> Los videos usan la exportación de ese tamaño (si no existe, se crea y queda en Exportaciones; tarda).</template>
      </div>
      <div class="small text-body-secondary mt-3">
        <CIcon icon="cil-lock-locked" size="sm" class="me-1" />La NAS lo arma cifrado (AES-256) con una contraseña al azar que ves en Exportaciones. Fotos y videos van con
        la fecha como nombre, y un <code>metadatos.json</code> con fechas, lugares, etiquetas, álbumes y notas. Para abrirlo: 7-Zip (Windows), Keka o
        The Unarchiver (Mac) o una app como iZip (iPhone); la app Archivos no abre ZIP con AES.
      </div>
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="ghost" :disabled="creando" @click="emit('close')">Cancelar</CButton>
      <CButton color="primary" :disabled="creando || !items.length" @click="crear">{{ creando ? 'Preparando…' : 'Crear ZIP' }}</CButton>
    </CModalFooter>
  </CModal>
</template>
