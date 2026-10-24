<script setup>
// Exportaciones de videos (más pequeños y/o con filtro): de un solo uso, se borran solas a los 7 días. Aquí se
// ven, se comparten y se borran a mano para no llenar el disco.
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useBovedaStore } from '@/stores/boveda'
import { useExportadosStore } from '@/stores/exportados'
import { useToastStore } from '@/stores/toast'
import { useCompartir } from '@/lib/compartir'
import PageHeader from '@/components/common/PageHeader.vue'
import Miniatura from '@/components/elementos/Miniatura.vue'
import { etiquetaExport, fechaCorta, tamano, venceEn } from '@/lib/formato'

const router = useRouter()
const boveda = useBovedaStore()
const exportados = useExportadosStore()
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
    await Promise.all([boveda.cargar(), exportados.cargar()])
  } catch (e) {
    toast.error(e)
  }
})
</script>

<template>
  <PageHeader title="Exportaciones" :subtitle="`${filas.length} · ${tamano(exportados.ocupado)} en disco · se borran solas a los 7 días`" />
  <div v-if="!exportados.cargada" class="text-center py-5"><CSpinner /></div>
  <CCard v-else-if="!filas.length" class="text-center py-5">
    <CCardBody>
      <CIcon icon="cil-share-all" size="3xl" class="text-secondary mb-3" />
      <p class="mb-0">No hay exportaciones. Se crean desde un video: «Exportar → Nueva…».</p>
    </CCardBody>
  </CCard>
  <CListGroup v-else class="mb-4">
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
          <span v-else-if="e.status === 'error'" class="text-danger text-truncate">{{ e.error }}</span>
        </div>
      </div>
      <div class="d-flex flex-wrap gap-1 justify-content-end">
        <template v-if="e.status === 'lista'">
          <CButton color="secondary" variant="ghost" size="sm" title="Ver" @click="router.push({ path: `/ver/${v.id}`, query: { exp: e.id } })"><CIcon icon="cil-media-play" /></CButton>
          <CButton color="secondary" variant="ghost" size="sm" title="Compartir" :disabled="compartiendo !== null" @click="compartirE(v, e)">
            <CIcon icon="cil-share-boxed" /><span v-if="compartiendo === e.id && progreso !== null" class="small ms-1">{{ progreso }}%</span>
          </CButton>
        </template>
        <CButton v-if="e.status !== 'procesando'" color="danger" variant="ghost" size="sm" title="Borrar" @click="borrar(e)"><CIcon icon="cil-trash" /></CButton>
      </div>
    </CListGroupItem>
  </CListGroup>
</template>
