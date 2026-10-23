<script setup>
// Elegir la ubicación de un elemento a mano: tocando el mapa o el punto de otro (copia su ubicación).
// Se guarda cifrada como el resto de los metadatos.
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useBovedaStore } from '@/stores/boveda'

const props = defineProps({ item: { type: Object, required: true }, visible: Boolean })
const emit = defineEmits(['close', 'save'])
const boveda = useBovedaStore()
const el = ref(null)
const punto = ref(null) // { lat, lon, alt? }
const origen = ref('')
let mapa = null
let marca = null

const otros = computed(() => boveda.listos.filter((v) => v.id !== props.item.id && v.m.location))
const icono = (clase) => L.divIcon({ className: '', html: `<div class="${clase}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] })

function elegir(p, desde = '') {
  punto.value = p
  origen.value = desde
  marca ??= L.marker([p.lat, p.lon], { icon: icono('mapa-marca mapa-marca-nueva') }).addTo(mapa)
  marca.setLatLng([p.lat, p.lon])
}

async function abrir() {
  await nextTick()
  mapa = L.map(el.value, { worldCopyJump: true })
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(mapa)
  for (const v of otros.value) {
    L.marker([v.m.location.lat, v.m.location.lon], { icon: icono('mapa-marca'), title: v.m.title })
      .bindTooltip(v.m.title)
      .on('click', () => elegir({ ...v.m.location }, v.m.title))
      .addTo(mapa)
  }
  mapa.on('click', (e) => elegir({ lat: +e.latlng.lat.toFixed(6), lon: +e.latlng.lng.toFixed(6) }))
  const actual = props.item.m.location
  if (actual) elegir({ ...actual })
  const pts = [...otros.value.map((v) => v.m.location), ...(actual ? [actual] : [])]
  if (actual) mapa.setView([actual.lat, actual.lon], 15)
  else if (pts.length) mapa.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon])).pad(0.3), { maxZoom: 15 })
  else mapa.setView([4.65, -74.08], 5)
  // El modal anima al abrir: hay que recalcular el tamaño cuando termina.
  setTimeout(() => mapa?.invalidateSize(), 300)
}

function cerrar() {
  mapa?.remove()
  mapa = marca = null
  punto.value = null
}

watch(() => props.visible, (v) => (v ? abrir() : cerrar()))
onBeforeUnmount(cerrar)
</script>

<template>
  <CModal :visible="visible" size="lg" @close="emit('close')">
    <CModalHeader><CModalTitle>Ubicación</CModalTitle></CModalHeader>
    <CModalBody>
      <p class="small text-body-secondary mb-2">Toca el punto de otra foto o video para copiar su ubicación, o toca cualquier lugar del mapa.</p>
      <div ref="el" class="mapa mapa-chico"></div>
      <div class="small mt-2" style="min-height: 1.5em">
        <template v-if="punto">
          <CIcon icon="cil-location-pin" class="me-1" />{{ punto.lat.toFixed(5) }}, {{ punto.lon.toFixed(5) }}
          <span v-if="origen" class="text-body-secondary"> · la misma de «{{ origen }}»</span>
        </template>
      </div>
    </CModalBody>
    <CModalFooter>
      <CButton v-if="item.m.location" color="danger" variant="ghost" class="me-auto" @click="emit('save', null)">Quitar ubicación</CButton>
      <CButton color="secondary" variant="ghost" @click="emit('close')">Cancelar</CButton>
      <CButton color="primary" :disabled="!punto" @click="emit('save', punto)">Guardar</CButton>
    </CModalFooter>
  </CModal>
</template>
