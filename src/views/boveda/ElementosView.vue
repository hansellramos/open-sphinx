<script setup>
// Galería (fotos y videos), archivos, favoritos o una etiqueta. Filtros por texto, fecha, ubicación y zona
// del mapa; todo se hace aquí sobre los metadatos ya descifrados. Los archivos se ven en lista.
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBovedaStore } from '@/stores/boveda'
import { useToastStore } from '@/stores/toast'
import { api } from '@/services/api'
import PageHeader from '@/components/common/PageHeader.vue'
import Miniatura from '@/components/elementos/Miniatura.vue'
import EtiquetasEditor from '@/components/elementos/EtiquetasEditor.vue'
import { ESTADOS, fecha, iconoArchivo, mesAnio, tamano } from '@/lib/formato'

const route = useRoute()
const router = useRouter()
const boveda = useBovedaStore()
const toast = useToastStore()
const q = ref('')
const desde = ref('')
const hasta = ref('')
const conUbicacion = ref(false)
const orden = ref('tomado-desc')
const verFiltros = ref(false)
const clase = ref('todo') // en la galería: todo | imagen | video
const editar = ref(null)
const etiquetar = ref(null) // { v, nombres }
const borrar = ref(null)

const modo = computed(() => route.name) // Galeria | Archivos | Favoritos | Etiqueta
const enLista = computed(() => modo.value === 'Archivos')
const conPendientes = computed(() => modo.value === 'Galeria' || modo.value === 'Archivos')
const etq = computed(() => (modo.value === 'Etiqueta' ? boveda.etiqueta(route.params.id) : null))
const zona = computed(() => {
  const z = String(route.query.zona ?? '').split(',').map(Number)
  return z.length === 4 && z.every(Number.isFinite) ? { s: z[0], w: z[1], n: z[2], e: z[3] } : null
})
const titulo = computed(() => ({ Galeria: 'Fotos y videos', Archivos: 'Archivos', Favoritos: 'Favoritos' })[modo.value] ?? etq.value?.name ?? '')

const base = computed(() => {
  if (modo.value === 'Favoritos') return boveda.favoritos
  if (modo.value === 'Etiqueta') return boveda.listos.filter((v) => v.m.tags?.includes(route.params.id))
  if (modo.value === 'Archivos') return boveda.archivos
  return boveda.galeria
})

const filtrados = computed(() => {
  const t = q.value.trim().toLowerCase()
  const d = desde.value ? new Date(`${desde.value}T00:00:00`) : null
  const h = hasta.value ? new Date(`${hasta.value}T23:59:59`) : null
  const lista = base.value.filter((v) => {
    const f = new Date(boveda.fechaDe(v))
    const loc = v.m.location
    return (
      (modo.value !== 'Galeria' || clase.value === 'todo' || boveda.tipo(v) === clase.value) &&
      (!t || [v.m.title, v.m.originalName, v.m.device, ...boveda.nombresDe(v)].some((x) => x?.toLowerCase().includes(t))) &&
      (!d || f >= d) &&
      (!h || f <= h) &&
      (!conUbicacion.value || loc) &&
      (!zona.value || (loc && loc.lat >= zona.value.s && loc.lat <= zona.value.n && loc.lon >= zona.value.w && loc.lon <= zona.value.e))
    )
  })
  const clave = orden.value.startsWith('subido') ? (v) => v.createdAt : (v) => boveda.fechaDe(v)
  const signo = orden.value.endsWith('desc') ? -1 : 1
  return [...lista].sort((a, b) => signo * (new Date(clave(a)) - new Date(clave(b))))
})

// Agrupado por mes de la fecha en que se tomó/grabó.
// Al abrir uno, el visor pasa al anterior/siguiente en este mismo orden y con estos filtros.
function abrir(v) {
  boveda.secuencia = filtrados.value.filter((x) => x.m).map((x) => x.id)
  router.push(`/ver/${v.id}`)
}

const grupos = computed(() => {
  const out = []
  for (const v of filtrados.value) {
    const k = mesAnio(orden.value.startsWith('subido') ? v.createdAt : boveda.fechaDe(v))
    if (out.at(-1)?.k !== k) out.push({ k, items: [] })
    out.at(-1).items.push(v)
  }
  return out
})
const hayFiltros = computed(() => !!(q.value || desde.value || hasta.value || conUbicacion.value || zona.value))
const plural = (n) => `${n} ${n === 1 ? 'elemento' : 'elementos'}`
function limpiarFiltros() {
  q.value = desde.value = hasta.value = ''
  conUbicacion.value = false
  if (zona.value) router.replace({ query: {} })
}

const accion = (fn) => async (...a) => {
  try {
    await fn(...a)
  } catch (e) {
    toast.error(e)
  }
}
const favorito = accion((v) => boveda.favorito(v))
const guardarTitulo = accion(async () => {
  await boveda.renombrar(editar.value.v, editar.value.title)
  editar.value = null
})
const guardarEtiquetas = accion(async () => {
  await boveda.asignarEtiquetas(etiquetar.value.v, etiquetar.value.nombres)
  etiquetar.value = null
})
const confirmarBorrar = accion(async () => {
  await boveda.borrar(borrar.value)
  toast.ok('Borrado')
  borrar.value = null
})
const reintentar = accion(async (v) => {
  await api.post(`/videos/${v.id}/reintentar`)
  boveda.cargar(true)
})

onMounted(() => boveda.cargar(true).catch((e) => toast.error(e)))
watch(() => route.fullPath, () => (q.value = ''))
</script>

<template>
  <RouterLink v-if="modo === 'Etiqueta'" to="/etiquetas" class="small text-decoration-none d-inline-block mb-2"><CIcon icon="cil-arrow-left" class="me-1" />Etiquetas</RouterLink>
  <PageHeader :title="titulo" :subtitle="filtrados.length === base.length ? plural(base.length) : `${filtrados.length} de ${plural(base.length)}`">
    <CFormInput v-model="q" placeholder="Buscar…" style="max-width: 14rem" />
    <CButton :color="hayFiltros ? 'primary' : 'secondary'" variant="outline" @click="verFiltros = !verFiltros"><CIcon icon="cil-calendar" class="me-1" />Filtros</CButton>
    <CButton color="primary" @click="router.push('/subir')"><CIcon icon="cil-cloud-upload" class="me-1" />Subir</CButton>
  </PageHeader>

  <CCard v-if="verFiltros || hayFiltros" class="mb-3">
    <CCardBody class="d-flex flex-wrap align-items-end gap-3 py-2">
      <div><CFormLabel class="small mb-1">Fecha desde</CFormLabel><CFormInput v-model="desde" type="date" size="sm" /></div>
      <div><CFormLabel class="small mb-1">hasta</CFormLabel><CFormInput v-model="hasta" type="date" size="sm" /></div>
      <div>
        <CFormLabel class="small mb-1">Orden</CFormLabel>
        <CFormSelect v-model="orden" size="sm">
          <option value="tomado-desc">Fecha: recientes primero</option>
          <option value="tomado-asc">Fecha: antiguos primero</option>
          <option value="subido-desc">Subido: recientes primero</option>
        </CFormSelect>
      </div>
      <CFormCheck id="conubic" v-model="conUbicacion" label="Solo con ubicación" class="mb-1" />
      <CBadge v-if="zona" color="info" class="d-inline-flex align-items-center gap-2 py-2 px-2 mb-1">
        Zona del mapa <CCloseButton white style="width: .5rem; height: .5rem" @click="router.replace({ query: {} })" />
      </CBadge>
      <CButton v-if="hayFiltros" color="link" size="sm" class="mb-1" @click="limpiarFiltros">Quitar filtros</CButton>
      <CButton color="link" size="sm" class="mb-1 ms-auto" @click="router.push(zona ? `/mapa?zona=${route.query.zona}` : '/mapa')"><CIcon icon="cil-map" class="me-1" />Elegir zona en el mapa</CButton>
    </CCardBody>
  </CCard>

  <CNav v-if="modo === 'Galeria'" variant="pills" class="mb-3 gap-1">
    <CNavItem v-for="[k, txt] in [['todo', 'Todo'], ['imagen', 'Fotos'], ['video', 'Videos']]" :key="k">
      <CNavLink as="button" :active="clase === k" @click="clase = k">{{ txt }}</CNavLink>
    </CNavItem>
  </CNav>

  <!-- Subidas en proceso o con error (aún sin metadatos ni tipo) -->
  <div v-if="conPendientes && boveda.pendientes.length" class="video-grid mb-3">
    <CCard v-for="v in boveda.pendientes" :key="v.id">
      <Miniatura :item="v" />
      <CCardBody class="p-2 px-3 small">
        <CBadge :color="ESTADOS[v.status]?.color">{{ ESTADOS[v.status]?.texto }}</CBadge>
        <span class="ms-2 text-body-secondary">{{ tamano(v.size) }}</span>
        <div v-if="v.error" class="text-danger mt-1 text-truncate" :title="v.error">{{ v.error }}</div>
        <div v-if="v.status === 'error'" class="mt-1">
          <CButton color="link" size="sm" class="p-0 me-3" @click="reintentar(v)">Reintentar</CButton>
          <CButton color="link" size="sm" class="p-0 text-danger" @click="borrar = v">Borrar</CButton>
        </div>
      </CCardBody>
    </CCard>
  </div>

  <div v-if="!boveda.cargado" class="text-center py-5"><CSpinner /></div>
  <CCard v-else-if="!base.length" class="text-center py-5">
    <CCardBody>
      <CIcon :icon="{ Favoritos: 'cil-star', Archivos: 'cil-folder', Etiqueta: 'cil-tags' }[modo] ?? 'cil-image'" size="3xl" class="text-secondary mb-3" />
      <p class="mb-3">{{ { Favoritos: 'Aún no marcas favoritos: toca la estrella de cualquier elemento.', Etiqueta: 'Nada tiene esta etiqueta.', Archivos: 'Todavía no hay archivos.' }[modo] ?? 'Todavía no hay fotos ni videos.' }}</p>
      <CButton v-if="conPendientes" color="primary" @click="router.push('/subir')">Subir el primero</CButton>
    </CCardBody>
  </CCard>
  <p v-else-if="!filtrados.length" class="text-body-secondary">Nada coincide con los filtros.</p>

  <template v-if="enLista">
    <template v-for="g in grupos" :key="g.k">
      <div class="grupo-mes">{{ g.k }}</div>
      <CListGroup>
        <CListGroupItem v-for="v in g.items" :key="v.id" class="d-flex align-items-center gap-3 archivo-fila" @click="abrir(v)">
          <CIcon :icon="iconoArchivo(v.m.originalName, v.m.mime ?? '')" size="xl" class="text-body-secondary flex-shrink-0" />
          <div class="flex-grow-1 min-w-0">
            <div class="text-truncate fw-semibold" :title="v.m.title">{{ v.m.title }}</div>
            <div class="small text-body-secondary d-flex flex-wrap gap-2 align-items-center">
              <span>{{ fecha(boveda.fechaDe(v)) }}</span><span>{{ tamano(v.size) }}</span>
              <template v-for="id in v.m.tags" :key="id">
                <CBadge v-if="boveda.etiqueta(id)" :color="boveda.etiqueta(id).color" class="fw-normal">{{ boveda.etiqueta(id).name }}</CBadge>
              </template>
            </div>
          </div>
          <CButton color="link" class="p-1" :class="v.m.favorite ? 'text-warning' : 'text-body-secondary'" :title="v.m.favorite ? 'Quitar de favoritos' : 'Favorito'" @click.stop="favorito(v)"><CIcon icon="cil-star" /></CButton>
          <CDropdown placement="bottom-end" @click.stop>
            <CDropdownToggle color="link" size="sm" class="p-0 text-body-secondary" :caret="false" aria-label="Opciones">⋯</CDropdownToggle>
            <CDropdownMenu>
              <CDropdownItem as="button" @click="etiquetar = { v, nombres: boveda.nombresDe(v) }"><CIcon icon="cil-tags" class="me-2" />Etiquetas</CDropdownItem>
              <CDropdownItem as="button" @click="editar = { v, title: v.m.title }"><CIcon icon="cil-pencil" class="me-2" />Renombrar</CDropdownItem>
              <CDropdownItem as="button" class="text-danger" @click="borrar = v"><CIcon icon="cil-trash" class="me-2" />Borrar</CDropdownItem>
            </CDropdownMenu>
          </CDropdown>
        </CListGroupItem>
      </CListGroup>
    </template>
  </template>
  <template v-for="g in grupos" v-else :key="g.k">
    <div class="grupo-mes">{{ g.k }}</div>
    <div class="video-grid">
      <CCard v-for="v in g.items" :key="v.id" class="video-card" @click="abrir(v)">
        <Miniatura :item="v">
          <button type="button" class="fav" :class="{ on: v.m.favorite }" :title="v.m.favorite ? 'Quitar de favoritos' : 'Favorito'" @click.stop="favorito(v)">
            <CIcon icon="cil-star" :class="{ 'opacity-50': !v.m.favorite }" />
          </button>
        </Miniatura>
        <CCardBody class="p-2 px-3">
          <div class="d-flex align-items-start gap-2">
            <div class="flex-grow-1 text-truncate fw-semibold" :title="v.m.title">{{ v.m.title }}</div>
            <CDropdown placement="bottom-end" @click.stop>
              <CDropdownToggle color="link" size="sm" class="p-0 text-body-secondary" :caret="false" aria-label="Opciones">⋯</CDropdownToggle>
              <CDropdownMenu>
                <CDropdownItem as="button" @click="etiquetar = { v, nombres: boveda.nombresDe(v) }"><CIcon icon="cil-tags" class="me-2" />Etiquetas</CDropdownItem>
                <CDropdownItem as="button" @click="editar = { v, title: v.m.title }"><CIcon icon="cil-pencil" class="me-2" />Renombrar</CDropdownItem>
                <CDropdownItem as="button" class="text-danger" @click="borrar = v"><CIcon icon="cil-trash" class="me-2" />Borrar</CDropdownItem>
              </CDropdownMenu>
            </CDropdown>
          </div>
          <div class="d-flex align-items-center gap-2 small text-body-secondary mt-1">
            <span>{{ fecha(boveda.fechaDe(v)) }}</span>
            <CIcon v-if="v.m.location" icon="cil-location-pin" size="sm" title="Tiene ubicación" />
            <span class="ms-auto">{{ tamano(v.size) }}</span>
          </div>
          <div v-if="v.m.tags?.length" class="d-flex flex-wrap gap-1 mt-2">
            <template v-for="id in v.m.tags" :key="id">
              <CBadge v-if="boveda.etiqueta(id)" :color="boveda.etiqueta(id).color" class="fw-normal">{{ boveda.etiqueta(id).name }}</CBadge>
            </template>
          </div>
        </CCardBody>
      </CCard>
    </div>
  </template>
  <div class="mb-4"></div>

  <CModal :visible="!!editar" @close="editar = null" alignment="center">
    <CModalHeader><CModalTitle>Renombrar</CModalTitle></CModalHeader>
    <CModalBody v-if="editar"><CFormInput v-model="editar.title" maxlength="200" @keyup.enter="guardarTitulo" /></CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="ghost" @click="editar = null">Cancelar</CButton>
      <CButton color="primary" @click="guardarTitulo">Guardar</CButton>
    </CModalFooter>
  </CModal>

  <CModal :visible="!!etiquetar" @close="etiquetar = null" alignment="center">
    <CModalHeader><CModalTitle class="text-truncate">Etiquetas · {{ etiquetar?.v.m.title }}</CModalTitle></CModalHeader>
    <CModalBody v-if="etiquetar"><EtiquetasEditor v-model="etiquetar.nombres" :sugerencias="boveda.etiquetas" /></CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="ghost" @click="etiquetar = null">Cancelar</CButton>
      <CButton color="primary" @click="guardarEtiquetas">Guardar</CButton>
    </CModalFooter>
  </CModal>

  <CModal :visible="!!borrar" @close="borrar = null" alignment="center">
    <CModalHeader><CModalTitle>¿Borrar?</CModalTitle></CModalHeader>
    <CModalBody v-if="borrar">Se borra <strong>{{ borrar.m?.title ?? 'esto' }}</strong> de la NAS. No se puede deshacer.</CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="ghost" @click="borrar = null">Cancelar</CButton>
      <CButton color="danger" @click="confirmarBorrar">Borrar</CButton>
    </CModalFooter>
  </CModal>
</template>
