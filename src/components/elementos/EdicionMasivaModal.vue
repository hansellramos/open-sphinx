<script setup>
// Cambiar a varios elementos a la vez: la fecha (poner una o quitarla) o las etiquetas (agregar unas, quitar otras).
// Cada uno se vuelve a cifrar con su clave.
import { ref, computed, watch } from 'vue'
import { useBovedaStore } from '@/stores/boveda'
import { useToastStore } from '@/stores/toast'
import EtiquetasEditor from '@/components/elementos/EtiquetasEditor.vue'
import { deLocal, rangoFechas } from '@/lib/formato'

const props = defineProps({ modo: String, items: { type: Array, default: () => [] } }) // modo: fecha | etiquetas | null
const emit = defineEmits(['close', 'listo'])
const boveda = useBovedaStore()
const toast = useToastStore()
const fecha = ref('')
const agregar = ref([]) // nombres
const quitar = ref([]) // ids
const progreso = ref(null)

watch(
  () => props.modo,
  (m) => {
    if (!m) return
    fecha.value = ''
    agregar.value = []
    quitar.value = []
    progreso.value = null
  },
)
const n = computed(() => props.items.length)
const conFecha = computed(() => props.items.filter((v) => v.m.takenAt).length)
const rango = computed(() => {
  const fs = props.items.map((v) => boveda.fechaDe(v)).sort()
  return fs.length ? rangoFechas({ desde: fs[0], hasta: fs.at(-1) }) : ''
})
// Etiquetas que tiene alguno de los elegidos (para poder quitarlas), con cuántos la tienen.
const presentes = computed(() =>
  boveda.etiquetas.map((t) => ({ ...t, en: props.items.filter((v) => v.m.tags?.includes(t.id)).length })).filter((t) => t.en),
)
const alternarQuitar = (id) => (quitar.value = quitar.value.includes(id) ? quitar.value.filter((x) => x !== id) : [...quitar.value, id])

async function correr(fn, msj) {
  progreso.value = 0
  try {
    await fn((h, total) => (progreso.value = Math.round((h / total) * 100)))
    toast.ok(msj)
    emit('listo')
  } catch (e) {
    toast.error(e)
  } finally {
    progreso.value = null
  }
}
const plural = (k) => `${k} ${k === 1 ? 'elemento' : 'elementos'}`
const ponerFecha = () => fecha.value && correr((p) => boveda.fechaVarios(props.items, deLocal(fecha.value), p), `Fecha puesta a ${plural(n.value)}`)
const quitarFecha = () => correr((p) => boveda.fechaVarios(props.items, null, p), `Fecha quitada a ${plural(n.value)} (queda la de subida)`)
const guardarEtiquetas = () => correr((p) => boveda.etiquetasVarios(props.items, agregar.value, quitar.value, p), `Etiquetas cambiadas en ${plural(n.value)}`)
</script>

<template>
  <CModal :visible="!!modo" alignment="center" backdrop="static" @close="progreso === null && emit('close')">
    <CModalHeader :close-button="progreso === null">
      <CModalTitle>{{ modo === 'fecha' ? 'Fecha' : 'Etiquetas' }} · {{ plural(n) }}</CModalTitle>
    </CModalHeader>
    <CModalBody>
      <template v-if="modo === 'fecha'">
        <p class="small text-body-secondary mb-2">Ahora: {{ rango }}<template v-if="conFecha < n"> ({{ n - conFecha }} sin fecha propia: usan la de subida)</template></p>
        <form id="form-fecha-masiva" class="d-flex flex-wrap gap-2 align-items-center" @submit.prevent="ponerFecha">
          <input v-model="fecha" type="datetime-local" class="form-control form-control-sm subir-fecha" aria-label="Nueva fecha" required />
          <CButton type="submit" color="primary" size="sm" :disabled="progreso !== null || !fecha">Poner esta fecha a todos</CButton>
        </form>
        <hr />
        <CButton color="danger" variant="outline" size="sm" :disabled="progreso !== null || !conFecha" @click="quitarFecha">Quitar la fecha ({{ conFecha }})</CButton>
        <div class="small text-body-secondary mt-1">Sin fecha se ordenan por cuándo se subieron.</div>
      </template>
      <template v-else-if="modo === 'etiquetas'">
        <div class="small fw-semibold mb-1">Agregar a todos</div>
        <EtiquetasEditor v-model="agregar" :sugerencias="boveda.etiquetas" />
        <template v-if="presentes.length">
          <div class="small fw-semibold mt-3 mb-1">Quitar (toca las que quieres quitar)</div>
          <div class="d-flex flex-wrap gap-1">
            <button v-for="t in presentes" :key="t.id" type="button" class="btn btn-sm py-0 px-2 rounded-pill" :class="quitar.includes(t.id) ? 'btn-danger text-decoration-line-through' : `btn-outline-${t.color}`" :aria-pressed="quitar.includes(t.id)" @click="alternarQuitar(t.id)">
              {{ t.name }} <span class="opacity-75">{{ t.en }}</span>
            </button>
          </div>
        </template>
      </template>
      <CProgress v-if="progreso !== null" :value="progreso" class="mt-3" height="6" />
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="ghost" :disabled="progreso !== null" @click="emit('close')">{{ modo === 'fecha' ? 'Cerrar' : 'Cancelar' }}</CButton>
      <CButton v-if="modo === 'etiquetas'" color="primary" :disabled="progreso !== null || (!agregar.length && !quitar.length)" @click="guardarEtiquetas">Guardar</CButton>
    </CModalFooter>
  </CModal>
</template>
