<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/services/api'
import { useToastStore } from '@/stores/toast'
import PageHeader from '@/components/common/PageHeader.vue'
import VideoThumb from '@/components/videos/VideoThumb.vue'
import EtiquetasEditor from '@/components/videos/EtiquetasEditor.vue'
import { ESTADOS, fecha, tamano } from '@/lib/formato'

const router = useRouter()
const toast = useToastStore()
const videos = ref([])
const cargando = ref(true)
const q = ref('')
const editar = ref(null)
const etiquetar = ref(null) // { id, title, nombres }
const etiquetas = ref([])
const filtro = ref([]) // ids de etiquetas seleccionadas (deben estar todas)
const borrar = ref(null)
let timer = null

const filtrados = computed(() => {
  const t = q.value.trim().toLowerCase()
  return videos.value.filter(
    (v) =>
      (!t || v.title.toLowerCase().includes(t) || v.tags.some((g) => g.name.toLowerCase().includes(t))) &&
      filtro.value.every((id) => v.tags.some((g) => g.id === id)),
  )
})
const toggleFiltro = (id) => (filtro.value = filtro.value.includes(id) ? filtro.value.filter((x) => x !== id) : [...filtro.value, id])
const cargarEtiquetas = async () => {
  etiquetas.value = await api.get('/etiquetas')
  filtro.value = filtro.value.filter((id) => etiquetas.value.some((e) => e.id === id))
}
const pendientes = computed(() => videos.value.some((v) => v.status === 'en_cola' || v.status === 'procesando'))

async function cargar() {
  try {
    const nuevos = await api.get('/videos')
    // Conserva los objetos ya cargados (y sus miniaturas) si no cambiaron.
    const prev = new Map(videos.value.map((v) => [v.id, v]))
    // (las etiquetas se copian siempre: no afectan a la miniatura)
    videos.value = nuevos.map((n) => {
      const p = prev.get(n.id)
      return p?.status === n.status && p?.title === n.title ? Object.assign(p, { tags: n.tags }) : n
    })
  } catch (e) {
    toast.error(e)
  } finally {
    cargando.value = false
  }
  clearTimeout(timer)
  if (pendientes.value) timer = setTimeout(cargar, 4000)
}

function abrir(v) {
  if (v.status === 'listo') router.push(`/videos/${v.id}`)
}
async function guardarTitulo() {
  try {
    await api.put(`/videos/${editar.value.id}`, { title: editar.value.title })
    editar.value = null
    cargar()
  } catch (e) {
    toast.error(e)
  }
}
async function guardarEtiquetas() {
  try {
    await api.put(`/videos/${etiquetar.value.id}/etiquetas`, { nombres: etiquetar.value.nombres })
    etiquetar.value = null
    await Promise.all([cargar(), cargarEtiquetas()])
  } catch (e) {
    toast.error(e)
  }
}
async function confirmarBorrar() {
  try {
    await api.del(`/videos/${borrar.value.id}`)
    toast.ok('Video borrado')
    borrar.value = null
    cargar()
  } catch (e) {
    toast.error(e)
  }
}
async function reintentar(v) {
  await api.post(`/videos/${v.id}/reintentar`).catch((e) => toast.error(e))
  cargar()
}

onMounted(() => Promise.all([cargar(), cargarEtiquetas()]))
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <PageHeader title="Videos" :subtitle="`${videos.length} en la bóveda`">
    <CFormInput v-model="q" placeholder="Buscar por título…" style="max-width: 16rem" />
    <CButton color="primary" @click="router.push('/subir')"><CIcon icon="cil-cloud-upload" class="me-1" />Subir</CButton>
  </PageHeader>

  <div v-if="etiquetas.length" class="d-flex flex-wrap gap-1 mb-3">
    <CButton
      v-for="e in etiquetas"
      :key="e.id"
      size="sm"
      :color="e.color"
      :variant="filtro.includes(e.id) ? undefined : 'outline'"
      class="py-0 px-2 rounded-pill"
      @click="toggleFiltro(e.id)"
    >{{ e.name }} <span class="opacity-75">{{ e.videos }}</span></CButton>
    <CButton v-if="filtro.length" size="sm" color="link" class="py-0" @click="filtro = []">Quitar filtro</CButton>
  </div>

  <div v-if="cargando" class="text-center py-5"><CSpinner /></div>
  <CCard v-else-if="!videos.length" class="text-center py-5">
    <CCardBody>
      <CIcon icon="cil-video" size="3xl" class="text-secondary mb-3" />
      <p class="mb-3">Todavía no hay videos.</p>
      <CButton color="primary" @click="router.push('/subir')">Subir el primero</CButton>
    </CCardBody>
  </CCard>

  <div v-else class="video-grid mb-4">
    <CCard v-for="v in filtrados" :key="v.id" class="video-card" @click="abrir(v)">
      <VideoThumb :video="v" />
      <CCardBody class="p-2 px-3">
        <div class="d-flex align-items-start gap-2">
          <div class="flex-grow-1 text-truncate fw-semibold" :title="v.title">{{ v.title }}</div>
          <CDropdown placement="bottom-end" @click.stop>
            <CDropdownToggle color="link" size="sm" class="p-0 text-body-secondary" :caret="false" aria-label="Opciones">⋯</CDropdownToggle>
            <CDropdownMenu>
              <CDropdownItem as="button" @click="etiquetar = { id: v.id, title: v.title, nombres: v.tags.map((g) => g.name) }"><CIcon icon="cil-tags" class="me-2" />Etiquetas</CDropdownItem>
              <CDropdownItem as="button" @click="editar = { id: v.id, title: v.title }"><CIcon icon="cil-pencil" class="me-2" />Renombrar</CDropdownItem>
              <CDropdownItem v-if="v.status === 'error'" as="button" @click="reintentar(v)"><CIcon icon="cil-reload" class="me-2" />Reintentar</CDropdownItem>
              <CDropdownItem as="button" class="text-danger" @click="borrar = v"><CIcon icon="cil-trash" class="me-2" />Borrar</CDropdownItem>
            </CDropdownMenu>
          </CDropdown>
        </div>
        <div class="d-flex align-items-center gap-2 small text-body-secondary mt-1">
          <CBadge v-if="v.status !== 'listo'" :color="ESTADOS[v.status]?.color">{{ ESTADOS[v.status]?.texto }}</CBadge>
          <span>{{ tamano(v.size) }}</span>
          <span v-if="v.height">· {{ v.height }}p</span>
          <span class="ms-auto">{{ fecha(v.createdAt) }}</span>
        </div>
        <div v-if="v.tags.length" class="d-flex flex-wrap gap-1 mt-2">
          <CBadge v-for="g in v.tags" :key="g.id" :color="g.color" class="fw-normal">{{ g.name }}</CBadge>
        </div>
        <div v-if="v.error" class="small text-danger mt-1 text-truncate" :title="v.error">{{ v.error }}</div>
      </CCardBody>
    </CCard>
  </div>

  <CModal :visible="!!editar" @close="editar = null" alignment="center">
    <CModalHeader><CModalTitle>Renombrar</CModalTitle></CModalHeader>
    <CModalBody v-if="editar">
      <CFormInput v-model="editar.title" maxlength="200" @keyup.enter="guardarTitulo" />
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="ghost" @click="editar = null">Cancelar</CButton>
      <CButton color="primary" @click="guardarTitulo">Guardar</CButton>
    </CModalFooter>
  </CModal>

  <CModal :visible="!!etiquetar" @close="etiquetar = null" alignment="center">
    <CModalHeader><CModalTitle class="text-truncate">Etiquetas · {{ etiquetar?.title }}</CModalTitle></CModalHeader>
    <CModalBody v-if="etiquetar">
      <EtiquetasEditor v-model="etiquetar.nombres" :sugerencias="etiquetas" />
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="ghost" @click="etiquetar = null">Cancelar</CButton>
      <CButton color="primary" @click="guardarEtiquetas">Guardar</CButton>
    </CModalFooter>
  </CModal>

  <CModal :visible="!!borrar" @close="borrar = null" alignment="center">
    <CModalHeader><CModalTitle>¿Borrar el video?</CModalTitle></CModalHeader>
    <CModalBody v-if="borrar">Se borra <strong>{{ borrar.title }}</strong> de la NAS. No se puede deshacer.</CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="ghost" @click="borrar = null">Cancelar</CButton>
      <CButton color="danger" @click="confirmarBorrar">Borrar</CButton>
    </CModalFooter>
  </CModal>
</template>
