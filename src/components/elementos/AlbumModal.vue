<script setup>
// Crear o editar un álbum: nombre, descripción, fechas (las de sus fotos o elegidas a mano) y una o más
// ubicaciones (tocando el mapa, el punto de una foto, o las de las fotos del álbum). Todo va cifrado en el catálogo.
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useBovedaStore } from '@/stores/boveda'
import { diaLocal, rangoFechas } from '@/lib/formato'

const props = defineProps({ album: Object, visible: Boolean, ids: { type: Array, default: () => [] } })
const emit = defineEmits(['close', 'save', 'borrar'])
const boveda = useBovedaStore()
const el = ref(null)
const f = ref(null) // { name, descripcion, manual, desde, hasta, ubicaciones }
let mapa = null
let capa = null

// Las fotos que tendrá (las del álbum o las elegidas para crearlo): de ahí salen las fechas y ubicaciones sugeridas.
const elementos = computed(() => (props.album ? props.album.elementos : props.ids.map((id) => boveda.listos.find((v) => v.id === id)).filter(Boolean)))
const deLasFotos = computed(() => {
  const fs = elementos.value.map((v) => boveda.fechaDe(v)).sort()
  return fs.length ? { desde: fs[0], hasta: fs.at(-1) } : null
})
const otros = computed(() => boveda.listos.filter((v) => v.m.location))
const icono = (clase, txt = '') => L.divIcon({ className: '', html: `<div class="${clase}">${txt}</div>`, iconSize: [18, 18], iconAnchor: [9, 9] })

// Ubicaciones de las fotos agrupadas (a menos de ~1 km son el mismo lugar), sin las que ya están.
const cerca = (a, b) => Math.hypot(a.lat - b.lat, (a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180)) < 0.009
const sugeridas = computed(() => {
  const out = []
  for (const v of elementos.value.filter((x) => x.m.location)) {
    const p = v.m.location
    if (!out.some((o) => cerca(o, p))) out.push({ lat: p.lat, lon: p.lon, nombre: '' })
  }
  return out.filter((p) => !f.value?.ubicaciones.some((u) => cerca(u, p)))
})

function pintar() {
  if (!mapa) return
  capa.clearLayers()
  f.value.ubicaciones.forEach((u, i) => {
    L.marker([u.lat, u.lon], { icon: icono('mapa-marca mapa-marca-nueva mapa-marca-num', i + 1), title: 'Quitar' })
      .on('click', () => quitar(i))
      .addTo(capa)
  })
}
function agregar(p) {
  f.value.ubicaciones.push({ lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), nombre: p.nombre ?? '' })
  pintar()
}
function quitar(i) {
  f.value.ubicaciones.splice(i, 1)
  pintar()
}
function agregarSugeridas() {
  sugeridas.value.forEach(agregar)
  encuadrar()
}
function encuadrar() {
  const pts = f.value.ubicaciones.length ? f.value.ubicaciones : otros.value.map((v) => v.m.location)
  if (pts.length) mapa.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon])).pad(0.3), { maxZoom: 14 })
  else mapa.setView([4.65, -74.08], 5)
}

async function abrir() {
  const a = props.album
  f.value = {
    name: a?.name ?? '',
    descripcion: a?.descripcion ?? '',
    manual: !!a?.fechas,
    desde: a?.fechas?.desde ?? (deLasFotos.value ? diaLocal(deLasFotos.value.desde) : ''),
    hasta: a?.fechas?.hasta ?? (deLasFotos.value ? diaLocal(deLasFotos.value.hasta) : ''),
    ubicaciones: (a?.ubicaciones ?? []).map((u) => ({ ...u })),
  }
  await nextTick()
  mapa = L.map(el.value, { worldCopyJump: true })
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(mapa)
  for (const v of otros.value) {
    L.marker([v.m.location.lat, v.m.location.lon], { icon: icono('mapa-marca'), title: v.m.title }).on('click', () => agregar(v.m.location)).addTo(mapa)
  }
  capa = L.layerGroup().addTo(mapa)
  mapa.on('click', (e) => agregar({ lat: e.latlng.lat, lon: e.latlng.lng }))
  pintar()
  encuadrar()
  setTimeout(() => mapa?.invalidateSize(), 300) // el modal anima al abrir
}
function cerrar() {
  mapa?.remove()
  mapa = capa = null
}
function guardar() {
  const x = f.value
  emit('save', { name: x.name, descripcion: x.descripcion, fechas: x.manual && x.desde && x.hasta ? { desde: x.desde, hasta: x.hasta } : null, ubicaciones: x.ubicaciones })
}

watch(() => props.visible, (v) => (v ? abrir() : cerrar()))
onBeforeUnmount(cerrar)
</script>

<template>
  <CModal :visible="visible" size="lg" backdrop="static" @close="emit('close')">
    <CModalHeader><CModalTitle>{{ album ? 'Editar álbum' : 'Nuevo álbum' }}</CModalTitle></CModalHeader>
    <CModalBody v-if="f">
      <form id="form-album" @submit.prevent="guardar">
        <CFormLabel for="album-nombre" class="small mb-1">Nombre</CFormLabel>
        <CFormInput id="album-nombre" v-model="f.name" maxlength="80" required placeholder="Vacaciones en la costa" class="mb-2" />
        <CFormLabel for="album-desc" class="small mb-1">Descripción (opcional)</CFormLabel>
        <CFormTextarea id="album-desc" v-model="f.descripcion" maxlength="500" rows="2" class="mb-3" />

        <div class="small fw-semibold mb-1">Fechas</div>
        <div class="form-check">
          <input id="fechas-fotos" v-model="f.manual" class="form-check-input" type="radio" name="fechas" :value="false" />
          <label class="form-check-label" for="fechas-fotos">Las de sus fotos{{ deLasFotos ? ` (${rangoFechas(deLasFotos)})` : ' (todavía no tiene)' }}</label>
        </div>
        <div class="form-check">
          <input id="fechas-manual" v-model="f.manual" class="form-check-input" type="radio" name="fechas" :value="true" />
          <label class="form-check-label" for="fechas-manual">Elegirlas</label>
        </div>
        <div v-if="f.manual" class="d-flex flex-wrap gap-2 align-items-center mt-1 mb-1">
          <input v-model="f.desde" type="date" class="form-control form-control-sm subir-fecha" aria-label="Desde" required />
          <span class="small">a</span>
          <input v-model="f.hasta" type="date" class="form-control form-control-sm subir-fecha" aria-label="Hasta" required />
        </div>

        <div class="d-flex align-items-center gap-2 mt-3 mb-1">
          <span class="small fw-semibold">Ubicaciones</span>
          <CButton v-if="sugeridas.length" color="link" size="sm" class="py-0 ms-auto" @click="agregarSugeridas">
            <CIcon icon="cil-location-pin" class="me-1" />Agregar las de sus fotos ({{ sugeridas.length }})
          </CButton>
        </div>
        <p class="small text-body-secondary mb-2">Toca el mapa o el punto de una foto para agregar un lugar; toca un número para quitarlo.</p>
        <div ref="el" class="mapa mapa-chico"></div>
        <div v-for="(u, i) in f.ubicaciones" :key="i" class="d-flex align-items-center gap-2 mt-2 album-ubic">
          <span class="badge rounded-pill text-bg-primary">{{ i + 1 }}</span>
          <CFormInput v-model="u.nombre" size="sm" maxlength="80" :placeholder="`${u.lat.toFixed(4)}, ${u.lon.toFixed(4)}`" :aria-label="`Nombre del lugar ${i + 1}`" />
          <CButton color="danger" variant="ghost" size="sm" :title="`Quitar el lugar ${i + 1}`" @click="quitar(i)"><CIcon icon="cil-x" /></CButton>
        </div>
      </form>
    </CModalBody>
    <CModalFooter>
      <CButton v-if="album" color="danger" variant="ghost" class="me-auto" @click="emit('borrar')">Borrar álbum</CButton>
      <CButton color="secondary" variant="ghost" @click="emit('close')">Cancelar</CButton>
      <CButton type="submit" form="form-album" color="primary">{{ album ? 'Guardar' : 'Crear' }}</CButton>
    </CModalFooter>
  </CModal>
</template>
