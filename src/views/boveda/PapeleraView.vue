<script setup>
// Papelera: lo que se borró y los originales que se reemplazaron por una versión más liviana. Se guardan 5 días
// (luego la NAS los borra de verdad). Desde aquí se restauran o se borran ya para liberar el espacio.
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useBovedaStore } from '@/stores/boveda'
import { useToastStore } from '@/stores/toast'
import PageHeader from '@/components/common/PageHeader.vue'
import Miniatura from '@/components/elementos/Miniatura.vue'
import { duracion, fechaCorta, tamano, venceEn } from '@/lib/formato'

const router = useRouter()
const boveda = useBovedaStore()
const toast = useToastStore()
const lista = ref(null)
const ocupado = ref(null) // id en curso
const confirmar = ref(null) // { f, tipo: 'borrado' | 'original' }

const borrados = computed(() => (lista.value ?? []).filter((v) => v.borradoAt))
const originales = computed(() => (lista.value ?? []).filter((v) => !v.borradoAt && v.anterior))
const total = computed(() => borrados.value.reduce((s, v) => s + v.size, 0) + originales.value.reduce((s, v) => s + v.anterior.size, 0))
const titulo = (v) => v.m?.title ?? 'Sin nombre'
const medidas = (m) => [m?.width && m?.height ? `${m.width}×${m.height}` : '', m?.duration ? duracion(m.duration) : ''].filter(Boolean).join(' · ')

async function cargar() {
  lista.value = await boveda.papelera()
}
async function hacer(v, fn, msg) {
  ocupado.value = v.id
  try {
    await fn(v)
    toast.ok(msg)
    await cargar()
  } catch (e) {
    toast.error(e)
  } finally {
    ocupado.value = null
  }
}
const restaurar = (v) => hacer(v, boveda.restaurar, 'Restaurado')
const restaurarOriginal = (v) => hacer(v, boveda.restaurarOriginal, `Volvió el original (${tamano(v.anterior.size)})`)
function borrarYa() {
  const { f, tipo } = confirmar.value
  confirmar.value = null
  if (tipo === 'borrado') hacer(f, boveda.borrarDefinitivo, 'Borrado para siempre')
  else hacer(f, boveda.descartarOriginal, 'Original borrado para siempre')
}

onMounted(async () => {
  try {
    await boveda.cargar()
    await cargar()
  } catch (e) {
    toast.error(e)
  }
})
</script>

<template>
  <PageHeader title="Papelera" :subtitle="lista ? `${borrados.length + originales.length} · ${tamano(total)}` : ''" />
  <p class="small text-body-secondary">Lo que borras y los originales que reemplazas por una versión más liviana se guardan 5 días; después la NAS los borra para siempre.</p>

  <div v-if="!lista" class="text-center py-5"><CSpinner /></div>
  <p v-else-if="!borrados.length && !originales.length" class="text-body-secondary">La papelera está vacía.</p>

  <template v-else>
    <template v-if="originales.length">
      <h6 class="mt-3">Originales reemplazados</h6>
      <CListGroup class="mb-4">
        <CListGroupItem v-for="v in originales" :key="v.id" class="papelera-fila">
          <div class="d-flex gap-3 align-items-start">
            <div class="papelera-mini flex-shrink-0" role="button" title="Abrir la versión actual" @click="router.push(`/ver/${v.id}`)"><Miniatura :item="v" /></div>
            <div class="flex-grow-1 min-w-0">
              <div class="fw-semibold text-truncate">{{ titulo(v) }} · {{ fechaCorta(boveda.fechaDe(v)) }}</div>
              <div class="small">Original: <strong>{{ tamano(v.anterior.size) }}</strong> <span class="text-body-secondary">{{ medidas(v.anterior.m) }}</span></div>
              <div class="small">Ahora: {{ tamano(v.size) }} <span class="text-body-secondary">{{ medidas(v.m) }}</span></div>
              <div class="small text-body-secondary">Reemplazado el {{ fechaCorta(v.anterior.fecha) }} · {{ venceEn(v.venceAt) }}</div>
            </div>
            <div class="d-flex flex-column gap-1 align-items-end flex-shrink-0">
              <CButton color="primary" variant="outline" size="sm" :disabled="ocupado === v.id" @click="restaurarOriginal(v)">Restaurar original</CButton>
              <CButton color="danger" variant="ghost" size="sm" :disabled="ocupado === v.id" @click="confirmar = { f: v, tipo: 'original' }">Borrar ya</CButton>
            </div>
          </div>
        </CListGroupItem>
      </CListGroup>
    </template>

    <template v-if="borrados.length">
      <h6 class="mt-3">Borrados</h6>
      <CListGroup class="mb-4">
        <CListGroupItem v-for="v in borrados" :key="v.id" class="papelera-fila">
          <div class="d-flex gap-3 align-items-start">
            <div class="papelera-mini flex-shrink-0"><Miniatura :item="v" /></div>
            <div class="flex-grow-1 min-w-0">
              <div class="fw-semibold text-truncate">{{ titulo(v) }} · {{ fechaCorta(boveda.fechaDe(v)) }}</div>
              <div class="small">{{ tamano(v.size) }} <span class="text-body-secondary">{{ medidas(v.m) }}</span></div>
              <div class="small text-body-secondary">Borrado el {{ fechaCorta(v.borradoAt) }} · {{ venceEn(v.venceAt) }}</div>
            </div>
            <div class="d-flex flex-column gap-1 align-items-end flex-shrink-0">
              <CButton color="primary" variant="outline" size="sm" :disabled="ocupado === v.id" @click="restaurar(v)">Restaurar</CButton>
              <CButton color="danger" variant="ghost" size="sm" :disabled="ocupado === v.id" @click="confirmar = { f: v, tipo: 'borrado' }">Borrar ya</CButton>
            </div>
          </div>
        </CListGroupItem>
      </CListGroup>
    </template>
  </template>

  <CModal :visible="!!confirmar" alignment="center" @close="confirmar = null">
    <CModalHeader><CModalTitle>¿Borrar para siempre?</CModalTitle></CModalHeader>
    <CModalBody v-if="confirmar">
      {{ confirmar.tipo === 'borrado' ? `Se borra «${titulo(confirmar.f)}» de la NAS.` : `Se borra el original de «${titulo(confirmar.f)}» (${tamano(confirmar.f.anterior.size)}); queda la versión actual.` }}
      Esto no se puede deshacer.
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="ghost" @click="confirmar = null">Cancelar</CButton>
      <CButton color="danger" @click="borrarYa">Borrar para siempre</CButton>
    </CModalFooter>
  </CModal>
</template>

<style scoped>
.papelera-mini {
  width: 96px;
  aspect-ratio: 1;
  border-radius: 6px;
  overflow: hidden;
}
.papelera-fila .btn {
  white-space: nowrap;
}
</style>
