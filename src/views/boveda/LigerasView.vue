<script setup>
// Versiones ligeras (720p) de videos: de un solo uso, se borran solas a los 7 días. Aquí se ven, se comparten
// y se borran a mano para no llenar el disco.
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useBovedaStore } from '@/stores/boveda'
import { useLigerasStore } from '@/stores/ligeras'
import { useToastStore } from '@/stores/toast'
import { useCompartir } from '@/lib/compartir'
import PageHeader from '@/components/common/PageHeader.vue'
import Miniatura from '@/components/elementos/Miniatura.vue'
import { fechaCorta, tamano, venceEn } from '@/lib/formato'

const router = useRouter()
const boveda = useBovedaStore()
const ligeras = useLigerasStore()
const toast = useToastStore()
const { progreso, compartir } = useCompartir()

const filas = computed(() => ligeras.items.map((l) => ({ l, v: boveda.items.find((x) => x.id === l.videoId && x.m) })).filter((f) => f.v))
const ESTADO = { en_cola: 'En cola', procesando: 'Creando', lista: 'Lista', error: 'Error' }
const COLOR = { en_cola: 'secondary', procesando: 'info', lista: 'success', error: 'danger' }

async function borrar(l) {
  try {
    await ligeras.borrar(l)
    toast.ok('Versión ligera borrada')
  } catch (e) {
    toast.error(e)
  }
}

onMounted(async () => {
  try {
    await Promise.all([boveda.cargar(), ligeras.cargar()])
  } catch (e) {
    toast.error(e)
  }
})
</script>

<template>
  <PageHeader title="Versiones ligeras" :subtitle="`${filas.length} · ${tamano(ligeras.ocupado)} en disco · se borran solas a los 7 días`" />
  <div v-if="!ligeras.cargada" class="text-center py-5"><CSpinner /></div>
  <CCard v-else-if="!filas.length" class="text-center py-5">
    <CCardBody>
      <CIcon icon="cil-speedometer" size="3xl" class="text-secondary mb-3" />
      <p class="mb-0">No hay versiones ligeras. Se crean desde un video: «Versión ligera (720p) → Crear».</p>
    </CCardBody>
  </CCard>
  <CListGroup v-else class="mb-4">
    <CListGroupItem v-for="{ l, v } in filas" :key="l.id" class="d-flex align-items-center gap-3">
      <div class="ligera-mini flex-shrink-0" role="button" @click="router.push(`/ver/${v.id}`)"><Miniatura :item="v" /></div>
      <div class="flex-grow-1 min-w-0">
        <div class="fw-semibold text-truncate">{{ fechaCorta(boveda.fechaDe(v)) }}</div>
        <div class="small text-body-secondary d-flex flex-wrap gap-2 align-items-center">
          <CBadge :color="COLOR[l.status]">{{ ESTADO[l.status] }}{{ l.status === 'procesando' ? ` ${l.progreso}%` : '' }}</CBadge>
          <template v-if="l.status === 'lista'">
            <span>{{ tamano(l.size) }}</span><span>{{ venceEn(l.expiresAt) }}</span>
          </template>
          <span v-else-if="l.status === 'error'" class="text-danger text-truncate">{{ l.error }}</span>
        </div>
      </div>
      <div class="d-flex flex-wrap gap-1 justify-content-end">
        <template v-if="l.status === 'lista'">
          <CButton color="secondary" variant="ghost" size="sm" title="Ver" @click="router.push({ path: `/ver/${v.id}`, query: { ligera: '1' } })"><CIcon icon="cil-media-play" /></CButton>
          <CButton color="secondary" variant="ghost" size="sm" title="Compartir" :disabled="progreso !== null" @click="compartir(v, null, true)">
            <CIcon icon="cil-share-boxed" /><span v-if="progreso !== null" class="small ms-1">{{ progreso }}%</span>
          </CButton>
        </template>
        <CButton v-if="l.status !== 'procesando'" color="danger" variant="ghost" size="sm" title="Borrar" @click="borrar(l)"><CIcon icon="cil-trash" /></CButton>
      </div>
    </CListGroupItem>
  </CListGroup>
</template>
