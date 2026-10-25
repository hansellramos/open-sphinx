<script setup>
// La cola, desde cualquier dispositivo: lo que se está recibiendo (subidas en curso), lo que espera cifrarse, lo que
// se está cifrando (con avance) y lo que falló. Se actualiza sola mientras hay algo en curso.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { api } from '@/services/api'
import { useBovedaStore } from '@/stores/boveda'
import { useToastStore } from '@/stores/toast'
import PageHeader from '@/components/common/PageHeader.vue'
import { duracion, tamano } from '@/lib/formato'

const boveda = useBovedaStore()
const toast = useToastStore()
const cola = ref(null)
const velocidades = ref({}) // id de subida → bytes/s (entre dos consultas)
let previo = new Map() // id → { recibido, t }
let timer = null

const hayAlgo = computed(() => !!cola.value && (cola.value.recibiendo.length || cola.value.elementos.length))
const enFila = computed(() => cola.value?.elementos.filter((e) => e.status === 'en_cola') ?? [])
const ESTADO = { en_cola: 'En cola', procesando: 'Cifrando', error: 'Error' }
const COLOR = { en_cola: 'secondary', procesando: 'info', error: 'danger' }

async function cargar() {
  clearTimeout(timer)
  try {
    const c = await api.get('/cola')
    const ahora = Date.now()
    const vel = {}
    for (const r of c.recibiendo) {
      const p = previo.get(r.id)
      if (p && ahora > p.t) vel[r.id] = Math.max(0, ((r.recibido - p.recibido) * 1000) / (ahora - p.t))
    }
    previo = new Map(c.recibiendo.map((r) => [r.id, { recibido: r.recibido, t: ahora }]))
    velocidades.value = vel
    // Si algo terminó de cifrarse, la galería lo trae.
    if (cola.value && cola.value.elementos.length > c.elementos.length) boveda.cargar(true).catch(() => {})
    cola.value = c
  } catch (e) {
    toast.error(e)
  } finally {
    timer = setTimeout(cargar, hayAlgo.value ? 2500 : 10_000)
  }
}

const pct = (r) => (r.total ? Math.min(100, Math.floor((r.recibido / r.total) * 100)) : null)
// Sin bytes nuevos en un rato: la subida está detenida (se cerró la pestaña, se cortó la red…).
const detenida = (r) => Date.now() - new Date(r.actualizado) > 90_000
const posicion = (e) => enFila.value.indexOf(e) + 1

const accion = (fn, msj) => async (e) => {
  try {
    await fn(e)
    if (msj) toast.ok(msj)
    await cargar()
    boveda.cargar(true).catch(() => {})
  } catch (err) {
    toast.error(err)
  }
}
const reintentar = accion((e) => api.post(`/videos/${e.id}/reintentar`), 'Otra vez en cola')
const borrar = accion((e) => api.del(`/videos/${e.id}`), 'Borrado')

onMounted(cargar)
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <PageHeader title="Cola" subtitle="Lo que está llegando a la NAS y lo que espera cifrarse, desde cualquier dispositivo" />
  <div v-if="!cola" class="text-center py-5"><CSpinner /></div>
  <CCard v-else-if="!hayAlgo" class="text-center py-5">
    <CCardBody>
      <CIcon icon="cil-check-circle" size="3xl" class="text-success mb-3" />
      <p class="mb-0">No hay nada en cola: todo lo subido ya está cifrado.</p>
    </CCardBody>
  </CCard>

  <template v-if="cola?.recibiendo.length">
    <div class="grupo-mes">Recibiendo ({{ cola.recibiendo.length }})</div>
    <CListGroup class="mb-4">
      <CListGroupItem v-for="r in cola.recibiendo" :key="r.id" class="cola-fila">
        <div class="d-flex align-items-center gap-2 mb-1">
          <CIcon icon="cil-cloud-upload" class="text-body-secondary flex-shrink-0" />
          <span class="fw-semibold text-truncate flex-grow-1" :title="r.nombre">{{ r.nombre }}</span>
          <span class="small text-body-secondary text-nowrap">{{ pct(r) ?? '?' }}%</span>
        </div>
        <CProgress :value="pct(r) ?? 0" height="6" :color="detenida(r) ? 'warning' : 'primary'" />
        <div class="small text-body-secondary mt-1">
          {{ tamano(r.recibido) }}<template v-if="r.total"> de {{ tamano(r.total) }}</template>
          <template v-if="detenida(r)"> · detenida (se reanuda cuando el dispositivo que la sube vuelva a conectarse)</template>
          <template v-else-if="velocidades[r.id]"> · {{ tamano(velocidades[r.id]) }}/s<template v-if="r.total"> · faltan {{ duracion((r.total - r.recibido) / velocidades[r.id]) }}</template></template>
        </div>
      </CListGroupItem>
    </CListGroup>
  </template>

  <template v-if="cola?.elementos.length">
    <div class="grupo-mes">Para cifrar ({{ cola.elementos.length }})</div>
    <CListGroup class="mb-4">
      <CListGroupItem v-for="e in cola.elementos" :key="e.id" class="cola-fila">
        <div class="d-flex align-items-center gap-2 mb-1">
          <CBadge :color="COLOR[e.status]">{{ ESTADO[e.status] }}</CBadge>
          <span class="fw-semibold text-truncate flex-grow-1" :title="e.nombre">{{ e.nombre }}</span>
          <span class="small text-body-secondary text-nowrap">{{ tamano(e.size) }}</span>
        </div>
        <template v-if="e.status === 'procesando'">
          <CProgress :value="e.progreso" height="6" color="info" />
          <div class="small text-body-secondary mt-1">{{ e.progreso }}%</div>
        </template>
        <div v-else-if="e.status === 'en_cola'" class="small text-body-secondary">{{ posicion(e) }}º en la fila</div>
        <div v-else class="small text-danger d-flex flex-wrap align-items-center gap-2">
          <span class="text-truncate">{{ e.error }}</span>
          <CButton color="link" size="sm" class="p-0 ms-auto" @click="reintentar(e)">Reintentar</CButton>
          <CButton color="link" size="sm" class="p-0 text-danger" @click="borrar(e)">Borrar</CButton>
        </div>
      </CListGroupItem>
    </CListGroup>
  </template>

  <p v-if="cola && (cola.exportaciones || cola.zips)" class="small">
    <RouterLink to="/exportados">En Exportaciones: {{ [cola.exportaciones && `${cola.exportaciones} exportación(es)`, cola.zips && `${cola.zips} ZIP`].filter(Boolean).join(' y ') }} en curso →</RouterLink>
  </p>
</template>
