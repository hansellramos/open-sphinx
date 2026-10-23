<script setup>
// Mapa con la ubicación (descifrada) de cada foto y video. Las coordenadas nunca salen del navegador;
// solo se piden las imágenes del mapa base a OpenStreetMap.
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import { useBovedaStore } from '@/stores/boveda'
import { usePrivacidadStore } from '@/stores/privacidad'
import { useToastStore } from '@/stores/toast'
import PageHeader from '@/components/common/PageHeader.vue'
import { fecha } from '@/lib/formato'

const route = useRoute()
const router = useRouter()
const boveda = useBovedaStore()
const priv = usePrivacidadStore()
const toast = useToastStore()
const el = ref(null)
const enVista = ref(0)
let mapa = null
let capa = null
const marcadores = new Map()

const conUbicacion = computed(() => boveda.listos.filter((v) => v.m.location))

const icono = L.divIcon({ className: '', html: '<div class="mapa-marca"></div>', iconSize: [18, 18], iconAnchor: [9, 9] })
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

function contar() {
  if (!mapa?._loaded) return
  const b = mapa.getBounds()
  enVista.value = conUbicacion.value.filter((v) => b.contains([v.m.location.lat, v.m.location.lon])).length
}

function pintar() {
  capa.clearLayers()
  marcadores.clear()
  for (const v of conUbicacion.value) {
    const mk = L.marker([v.m.location.lat, v.m.location.lon], { icon: icono })
    mk.bindPopup(
      () => {
        const div = document.createElement('div')
        div.className = 'mapa-pop'
        div.innerHTML = `<a href="#/ver/${v.id}"><img alt=""><div class="fw-semibold mt-1 text-body">${esc(v.m.title)}</div><div class="small text-body-secondary">${esc(fecha(boveda.fechaDe(v)))}</div></a>`
        const img = div.querySelector('img')
        img.classList.toggle('difuminada', priv.difuminar)
        boveda.thumbUrl(v).then((u) => u && (img.src = u)).catch(() => {})
        return div
      },
      { minWidth: 200 },
    )
    capa.addLayer(mk)
    marcadores.set(v.id, mk)
  }
  contar()
}

function encuadrar() {
  const z = String(route.query.zona ?? '').split(',').map(Number)
  if (z.length === 4 && z.every(Number.isFinite)) return mapa.fitBounds([[z[0], z[1]], [z[2], z[3]]])
  const v = route.query.v && conUbicacion.value.find((x) => x.id === route.query.v)
  if (v) {
    mapa.setView([v.m.location.lat, v.m.location.lon], 16)
    capa.zoomToShowLayer(marcadores.get(v.id), () => marcadores.get(v.id).openPopup())
    return
  }
  if (conUbicacion.value.length) mapa.fitBounds(L.latLngBounds(conUbicacion.value.map((v) => [v.m.location.lat, v.m.location.lon])).pad(0.2), { maxZoom: 14 })
  else mapa.setView([4.65, -74.08], 5)
}

function verZona() {
  const b = mapa.getBounds()
  const r = (n) => n.toFixed(5)
  router.push({ path: '/galeria', query: { zona: [r(b.getSouth()), r(b.getWest()), r(b.getNorth()), r(b.getEast())].join(',') } })
}

onMounted(async () => {
  // leaflet.markercluster se cuelga de window.L: hay que exponerlo antes de cargarlo.
  window.L = L
  await import('leaflet.markercluster')
  mapa = L.map(el.value, { zoomControl: true, worldCopyJump: true })
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(mapa)
  capa = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45 })
  mapa.addLayer(capa)
  mapa.on('moveend', contar)
  try {
    await boveda.cargar()
  } catch (e) {
    toast.error(e)
  }
  pintar()
  encuadrar()
})
watch(() => conUbicacion.value.length, () => mapa && pintar())
watch(() => priv.difuminar, (d) => el.value?.querySelectorAll('.mapa-pop img').forEach((i) => i.classList.toggle('difuminada', d)))
onBeforeUnmount(() => mapa?.remove())
</script>

<template>
  <PageHeader title="Mapa" :subtitle="`${conUbicacion.length} de ${boveda.galeria.length} fotos y videos tienen ubicación`">
    <CButton color="primary" :disabled="!enVista" @click="verZona"><CIcon icon="cil-filter" class="me-1" />Ver los {{ enVista }} de esta zona</CButton>
  </PageHeader>
  <div ref="el" class="mapa mb-4"></div>
</template>
