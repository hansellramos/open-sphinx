<script setup>
// Exportaciones de videos (más pequeños y/o con filtro) y ZIP con contraseña: de un solo uso, se borran solos a
// los 7 días. Aquí se ven, se comparten o bajan y se borran a mano para no llenar el disco.
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useBovedaStore } from '@/stores/boveda'
import { useExportadosStore } from '@/stores/exportados'
import { useZipsStore } from '@/stores/zips'
import { useToastStore } from '@/stores/toast'
import { useCompartir } from '@/lib/compartir'
import PageHeader from '@/components/common/PageHeader.vue'
import Miniatura from '@/components/elementos/Miniatura.vue'
import { etiquetaExport, fechaCorta, tamano, venceEn } from '@/lib/formato'

const router = useRouter()
const boveda = useBovedaStore()
const exportados = useExportadosStore()
const zips = useZipsStore()
const viendoClave = ref({}) // id → contraseña a la vista
async function mostrarClave(z) {
  if (viendoClave.value[z.id]) return (viendoClave.value = { ...viendoClave.value, [z.id]: null })
  try {
    viendoClave.value = { ...viendoClave.value, [z.id]: await zips.contrasena(z) }
  } catch (e) {
    toast.error(e)
  }
}
async function copiarClave(z) {
  try {
    await navigator.clipboard.writeText(viendoClave.value[z.id] ?? (await zips.contrasena(z)))
    toast.ok('Contraseña copiada')
  } catch (e) {
    toast.error(e)
  }
}
const accionZip = (fn, msj) => async (z) => {
  try {
    await fn(z)
    if (msj) toast.ok(msj)
  } catch (e) {
    toast.error(e)
  }
}
const reanudarZip = accionZip((z) => zips.reanudar(z), 'Otra vez en cola')
const borrarZip = accionZip((z) => zips.borrar(z), 'ZIP borrado')
const opcionesZip = (z) => [z.fotos && `fotos ${z.fotos}p`, z.videos && `videos ${z.videos}p`].filter(Boolean).join(' · ') || 'en original'
const toast = useToastStore()
const { progreso, compartir } = useCompartir()
const compartiendo = ref(null)

const filas = computed(() => exportados.items.map((e) => ({ e, v: boveda.items.find((x) => x.id === e.videoId && x.m) })).filter((f) => f.v))
const ESTADO = { en_cola: 'En cola', procesando: 'Creando', lista: 'Lista', error: 'Error' }
const COLOR = { en_cola: 'secondary', procesando: 'info', lista: 'success', error: 'danger' }

async function borrar(e) {
  try {
    await exportados.borrar(e)
    toast.ok('Exportación borrada')
  } catch (err) {
    toast.error(err)
  }
}
// Vuelve a prestar la clave: sigue desde el último fragmento que quedó hecho (o empieza, si no hay nada).
const reanudando = ref(null)
async function reanudar(v, e) {
  reanudando.value = e.id
  try {
    await exportados.pedir(v, { alto: e.alto, filtro: e.filtro, mbps: e.mbps })
    toast.ok(e.progreso ? `Sigue desde el ${e.progreso}%` : 'Otra vez en cola')
  } catch (err) {
    toast.error(err)
  } finally {
    reanudando.value = null
  }
}
async function compartirE(v, e) {
  compartiendo.value = e.id
  try {
    await compartir(v, null, e)
  } finally {
    compartiendo.value = null
  }
}

onMounted(async () => {
  try {
    await Promise.all([boveda.cargar(), exportados.cargar(), zips.cargar()])
  } catch (e) {
    toast.error(e)
  }
})
</script>

<template>
  <PageHeader title="Exportaciones" :subtitle="`${filas.length + zips.items.length} · ${tamano(exportados.ocupado + zips.ocupado)} en disco · se borran solas a los 7 días`" />
  <div v-if="!exportados.cargada" class="text-center py-5"><CSpinner /></div>

  <template v-if="zips.items.length">
    <div class="grupo-mes">ZIP con contraseña</div>
    <CListGroup class="mb-4">
      <CListGroupItem v-for="z in zips.items" :key="z.id" class="zip-fila">
        <div class="d-flex align-items-center gap-3">
          <CIcon icon="cil-compress" size="xl" class="text-body-secondary flex-shrink-0" />
          <div class="flex-grow-1 min-w-0">
            <div class="fw-semibold text-truncate">{{ z.info.nombre }}</div>
            <div class="small">{{ z.total }} elementos · {{ opcionesZip(z) }}</div>
            <div class="small text-body-secondary d-flex flex-wrap gap-2 align-items-center">
              <CBadge :color="COLOR[z.status] ?? 'secondary'">{{ ESTADO[z.status] ?? 'En cola' }}{{ z.status === 'procesando' ? ` ${z.hechos} de ${z.total}` : '' }}</CBadge>
              <span v-if="z.size">{{ tamano(z.size) }}</span>
              <span v-if="z.status === 'lista'">{{ venceEn(z.expiresAt) }}</span>
              <span v-else-if="z.status === 'error'" class="text-danger text-truncate">{{ z.error }}</span>
            </div>
          </div>
          <div class="d-flex flex-wrap gap-1 justify-content-end">
            <template v-if="z.status === 'lista'">
              <a class="btn btn-sm btn-primary" :href="`/api/zips/${z.id}/archivo`" download title="Descargar el ZIP"><CIcon icon="cil-cloud-download" /></a>
              <CButton color="secondary" variant="outline" size="sm" :title="viendoClave[z.id] ? 'Ocultar la contraseña' : 'Ver la contraseña'" @click="mostrarClave(z)"><CIcon icon="cil-lock-locked" /></CButton>
            </template>
            <CButton v-if="z.status === 'error'" color="primary" variant="outline" size="sm" @click="reanudarZip(z)"><CIcon icon="cil-media-play" class="me-1" />Reanudar</CButton>
            <CButton v-if="z.status !== 'procesando'" color="danger" variant="ghost" size="sm" title="Borrar el ZIP" @click="borrarZip(z)"><CIcon icon="cil-trash" /></CButton>
          </div>
        </div>
        <div v-if="viendoClave[z.id]" class="d-flex align-items-center gap-2 mt-2">
          <code class="zip-clave flex-grow-1">{{ viendoClave[z.id] }}</code>
          <CButton color="secondary" variant="outline" size="sm" title="Copiar la contraseña" @click="copiarClave(z)"><CIcon icon="cil-copy" /></CButton>
        </div>
      </CListGroupItem>
    </CListGroup>
    <div v-if="filas.length" class="grupo-mes">Videos</div>
  </template>

  <CCard v-else-if="exportados.cargada && !filas.length" class="text-center py-5">
    <CCardBody>
      <CIcon icon="cil-share-all" size="3xl" class="text-secondary mb-3" />
      <p class="mb-0">No hay exportaciones. Se crean desde un video («Exportar → Nueva…») o eligiendo varios en la galería («Seleccionar» → ZIP).</p>
    </CCardBody>
  </CCard>
  <CListGroup v-if="exportados.cargada && filas.length" class="mb-4">
    <CListGroupItem v-for="{ e, v } in filas" :key="e.id" class="d-flex align-items-center gap-3">
      <div class="export-mini flex-shrink-0" role="button" @click="router.push(`/ver/${v.id}`)"><Miniatura :item="v" /></div>
      <div class="flex-grow-1 min-w-0">
        <div class="fw-semibold text-truncate">{{ fechaCorta(boveda.fechaDe(v)) }}</div>
        <div class="small">{{ etiquetaExport(e) }}</div>
        <div class="small text-body-secondary d-flex flex-wrap gap-2 align-items-center">
          <CBadge :color="COLOR[e.status]">{{ ESTADO[e.status] }}{{ e.status === 'procesando' ? ` ${e.progreso}%` : '' }}</CBadge>
          <span v-if="e.status === 'procesando' && e.estimado" class="small text-body-secondary">pesará ~{{ tamano(e.estimado) }}</span>
          <template v-if="e.status === 'lista'">
            <span>{{ tamano(e.size) }}</span><span>{{ venceEn(e.expiresAt) }}</span>
          </template>
          <span v-else-if="e.status === 'error'" class="text-danger text-truncate">{{ e.progreso ? `Quedó en ${e.progreso}% · ` : '' }}{{ e.error }}</span>
        </div>
      </div>
      <div class="d-flex flex-wrap gap-1 justify-content-end">
        <template v-if="e.status === 'lista'">
          <CButton color="secondary" variant="ghost" size="sm" title="Ver" @click="router.push({ path: `/ver/${v.id}`, query: { exp: e.id } })"><CIcon icon="cil-media-play" /></CButton>
          <CButton color="secondary" variant="ghost" size="sm" title="Compartir" :disabled="compartiendo !== null" @click="compartirE(v, e)">
            <CIcon icon="cil-share-boxed" /><span v-if="compartiendo === e.id && progreso !== null" class="small ms-1">{{ progreso }}%</span>
          </CButton>
        </template>
        <CButton v-if="e.status === 'error'" color="primary" variant="outline" size="sm" :disabled="reanudando !== null" @click="reanudar(v, e)">
          <CIcon icon="cil-media-play" class="me-1" />{{ e.progreso ? 'Reanudar' : 'Reintentar' }}
        </CButton>
        <CButton v-if="e.status !== 'procesando'" color="danger" variant="ghost" size="sm" title="Borrar" @click="borrar(e)"><CIcon icon="cil-trash" /></CButton>
      </div>
    </CListGroupItem>
  </CListGroup>
</template>
