<script setup>
// Lista de etiquetas (descifradas): en cuadrícula o en lista. Al abrir una se ve lo que tiene.
import { ref, computed, watch, onMounted } from 'vue'
import { useBovedaStore } from '@/stores/boveda'
import { useToastStore } from '@/stores/toast'
import PageHeader from '@/components/common/PageHeader.vue'

const boveda = useBovedaStore()
const toast = useToastStore()
const leer = () => {
  try {
    return localStorage.getItem('boveda-etiquetas-vista') || 'iconos'
  } catch {
    return 'iconos'
  }
}
const vista = ref(leer())
const buscar = ref('')
watch(vista, (v) => {
  try {
    localStorage.setItem('boveda-etiquetas-vista', v)
  } catch {}
})

const lista = computed(() => {
  const q = buscar.value.trim().toLowerCase()
  return q ? boveda.etiquetas.filter((t) => t.name.toLowerCase().includes(q)) : boveda.etiquetas
})
// Al final: lo que no tiene etiqueta (no en modo Horus, donde las ocultas harían parecer «sin etiqueta» lo que sí tiene).
const sin = computed(() => (boveda.horus || buscar.value.trim() || !boveda.sinEtiqueta.length ? null : boveda.sinEtiqueta.length))

onMounted(() => boveda.cargar().catch((e) => toast.error(e)))
</script>

<template>
  <PageHeader title="Etiquetas" :subtitle="`${boveda.etiquetas.length} etiquetas`">
    <CFormInput v-model="buscar" placeholder="Buscar etiqueta…" style="max-width: 14rem" />
    <CButtonGroup>
      <CButton color="secondary" :variant="vista === 'iconos' ? undefined : 'outline'" title="Iconos" @click="vista = 'iconos'"><CIcon icon="cil-grid" /></CButton>
      <CButton color="secondary" :variant="vista === 'lista' ? undefined : 'outline'" title="Lista" @click="vista = 'lista'"><CIcon icon="cil-list" /></CButton>
    </CButtonGroup>
  </PageHeader>

  <div v-if="!boveda.etiquetas.length && !sin" class="text-body-secondary">Todavía no hay etiquetas. Agrégalas desde cualquier elemento.</div>

  <div v-else-if="vista === 'iconos'" class="etiquetas-grid mb-4">
    <RouterLink v-for="t in lista" :key="t.id" :to="`/etiquetas/${t.id}`" class="etiqueta-tile">
      <span :class="`etiqueta-icono bg-${t.color}`"><CIcon icon="cil-tag" size="xl" /></span>
      <span class="fw-semibold text-truncate mw-100">{{ t.name }}</span>
      <span class="small text-body-secondary">{{ t.total }} {{ t.total === 1 ? 'elemento' : 'elementos' }}</span>
    </RouterLink>
    <RouterLink v-if="sin" to="/etiquetas/sin" class="etiqueta-tile etiqueta-sin">
      <span class="etiqueta-icono bg-secondary"><CIcon icon="cil-tag" size="xl" /></span>
      <span class="fw-semibold text-truncate mw-100">Sin etiqueta</span>
      <span class="small text-body-secondary">{{ sin }} {{ sin === 1 ? 'elemento' : 'elementos' }}</span>
    </RouterLink>
  </div>

  <CListGroup v-else class="mb-4">
    <CListGroupItem v-for="t in lista" :key="t.id" as="RouterLink" :to="`/etiquetas/${t.id}`" class="d-flex align-items-center gap-3">
      <span :class="`etiqueta-punto bg-${t.color}`"></span>
      <span class="text-truncate">{{ t.name }}</span>
      <span class="ms-auto small text-body-secondary">{{ t.total }}</span>
      <CIcon icon="cil-chevron-right" class="text-body-secondary" />
    </CListGroupItem>
    <CListGroupItem v-if="sin" as="RouterLink" to="/etiquetas/sin" class="d-flex align-items-center gap-3 etiqueta-sin">
      <span class="etiqueta-punto bg-secondary"></span>
      <span class="text-truncate fst-italic">Sin etiqueta</span>
      <span class="ms-auto small text-body-secondary">{{ sin }}</span>
      <CIcon icon="cil-chevron-right" class="text-body-secondary" />
    </CListGroupItem>
  </CListGroup>
</template>
