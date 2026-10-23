<script setup>
// Lista de etiquetas (descifradas): en cuadrícula o en lista. Al abrir una se ven sus videos.
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

  <div v-if="!boveda.etiquetas.length" class="text-body-secondary">Todavía no hay etiquetas. Agrégalas desde un video.</div>

  <div v-else-if="vista === 'iconos'" class="etiquetas-grid mb-4">
    <RouterLink v-for="t in lista" :key="t.id" :to="`/etiquetas/${t.id}`" class="etiqueta-tile">
      <span :class="`etiqueta-icono bg-${t.color}`"><CIcon icon="cil-tag" size="xl" /></span>
      <span class="fw-semibold text-truncate mw-100">{{ t.name }}</span>
      <span class="small text-body-secondary">{{ t.videos }} {{ t.videos === 1 ? 'video' : 'videos' }}</span>
    </RouterLink>
  </div>

  <CListGroup v-else class="mb-4">
    <CListGroupItem v-for="t in lista" :key="t.id" as="RouterLink" :to="`/etiquetas/${t.id}`" class="d-flex align-items-center gap-3">
      <span :class="`etiqueta-punto bg-${t.color}`"></span>
      <span class="text-truncate">{{ t.name }}</span>
      <span class="ms-auto small text-body-secondary">{{ t.videos }}</span>
      <CIcon icon="cil-chevron-right" class="text-body-secondary" />
    </CListGroupItem>
  </CListGroup>
</template>
