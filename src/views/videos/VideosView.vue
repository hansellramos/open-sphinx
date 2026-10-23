<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/services/api'
import { useToastStore } from '@/stores/toast'
import PageHeader from '@/components/common/PageHeader.vue'
import VideoThumb from '@/components/videos/VideoThumb.vue'
import { ESTADOS, fecha, tamano } from '@/lib/formato'

const router = useRouter()
const toast = useToastStore()
const videos = ref([])
const cargando = ref(true)
const q = ref('')
const editar = ref(null)
const borrar = ref(null)
let timer = null

const filtrados = computed(() => {
  const t = q.value.trim().toLowerCase()
  return t ? videos.value.filter((v) => v.title.toLowerCase().includes(t)) : videos.value
})
const pendientes = computed(() => videos.value.some((v) => v.status === 'en_cola' || v.status === 'procesando'))

async function cargar() {
  try {
    const nuevos = await api.get('/videos')
    // Conserva los objetos ya cargados (y sus miniaturas) si no cambiaron.
    const prev = new Map(videos.value.map((v) => [v.id, v]))
    videos.value = nuevos.map((n) => (prev.get(n.id)?.status === n.status && prev.get(n.id)?.title === n.title ? prev.get(n.id) : n))
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

onMounted(cargar)
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <PageHeader title="Videos" :subtitle="`${videos.length} en la bóveda`">
    <CFormInput v-model="q" placeholder="Buscar por título…" style="max-width: 16rem" />
    <CButton color="primary" @click="router.push('/subir')"><CIcon icon="cil-cloud-upload" class="me-1" />Subir</CButton>
  </PageHeader>

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
            <CDropdownToggle color="link" size="sm" class="p-0 text-body-secondary" :caret="false">⋯</CDropdownToggle>
            <CDropdownMenu>
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

  <CModal :visible="!!borrar" @close="borrar = null" alignment="center">
    <CModalHeader><CModalTitle>¿Borrar el video?</CModalTitle></CModalHeader>
    <CModalBody v-if="borrar">Se borra <strong>{{ borrar.title }}</strong> de la NAS. No se puede deshacer.</CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="ghost" @click="borrar = null">Cancelar</CButton>
      <CButton color="danger" @click="confirmarBorrar">Borrar</CButton>
    </CModalFooter>
  </CModal>
</template>
