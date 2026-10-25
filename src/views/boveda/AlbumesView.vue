<script setup>
// Álbumes: portada (difuminada como las demás miniaturas), nombre, cuántos tiene, fechas y lugares.
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useBovedaStore } from '@/stores/boveda'
import { useToastStore } from '@/stores/toast'
import PageHeader from '@/components/common/PageHeader.vue'
import Miniatura from '@/components/elementos/Miniatura.vue'
import AlbumModal from '@/components/elementos/AlbumModal.vue'
import { rangoFechas } from '@/lib/formato'

const router = useRouter()
const boveda = useBovedaStore()
const toast = useToastStore()
const buscar = ref('')
const creando = ref(false)

const lista = computed(() => {
  const q = buscar.value.trim().toLowerCase()
  return q ? boveda.albumes.filter((a) => [a.name, a.descripcion, ...a.ubicaciones.map((u) => u.nombre)].some((x) => x?.toLowerCase().includes(q))) : boveda.albumes
})
const lugares = (a) => a.ubicaciones.map((u) => u.nombre).filter(Boolean).join(', ') || (a.ubicaciones.length ? `${a.ubicaciones.length} ${a.ubicaciones.length === 1 ? 'lugar' : 'lugares'}` : '')

async function crear(datos) {
  try {
    const a = await boveda.crearAlbum(datos)
    creando.value = false
    router.push(`/albumes/${a.id}`)
  } catch (e) {
    toast.error(e)
  }
}

onMounted(() => boveda.cargar().catch((e) => toast.error(e)))
</script>

<template>
  <PageHeader title="Álbumes" :subtitle="`${boveda.albumes.length} ${boveda.albumes.length === 1 ? 'álbum' : 'álbumes'}`">
    <CFormInput v-if="boveda.albumes.length" v-model="buscar" placeholder="Buscar álbum…" style="max-width: 14rem" />
    <CButton color="primary" @click="creando = true"><CIcon icon="cil-plus" class="me-1" />Nuevo álbum</CButton>
  </PageHeader>

  <div v-if="!boveda.cargado" class="text-center py-5"><CSpinner /></div>
  <CCard v-else-if="!boveda.albumes.length" class="text-center py-5">
    <CCardBody>
      <CIcon icon="cil-library" size="3xl" class="text-secondary mb-3" />
      <p class="mb-3">Todavía no hay álbumes. Crea uno aquí, o elige fotos en la galería («Seleccionar») y agrégalas a un álbum nuevo.</p>
      <CButton color="primary" @click="creando = true">Crear el primero</CButton>
    </CCardBody>
  </CCard>
  <div v-else class="albumes-grid mb-4">
    <RouterLink v-for="a in lista" :key="a.id" :to="`/albumes/${a.id}`" class="album-tile">
      <Miniatura v-if="a.portadaItem" :item="a.portadaItem" />
      <div v-else class="thumb"><CIcon icon="cil-library" size="xl" class="text-secondary" /></div>
      <div class="fw-semibold text-truncate mt-2">{{ a.name }}</div>
      <div class="small text-body-secondary text-truncate">{{ a.total }} {{ a.total === 1 ? 'elemento' : 'elementos' }}<template v-if="a.rango"> · {{ rangoFechas(a.rango) }}</template></div>
      <div v-if="lugares(a)" class="small text-body-secondary text-truncate"><CIcon icon="cil-location-pin" size="sm" class="me-1" />{{ lugares(a) }}</div>
    </RouterLink>
  </div>

  <AlbumModal :visible="creando" @close="creando = false" @save="crear" />
</template>
