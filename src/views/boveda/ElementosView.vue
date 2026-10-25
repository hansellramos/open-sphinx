<script setup>
// Galería (fotos y videos), archivos, favoritos, una etiqueta o un álbum. «Seleccionar» elige varios para
// cambiarles a la vez la fecha, las etiquetas o la ubicación, y agregarlos a álbumes (o quitarlos del abierto). Filtros por texto, fecha, ubicación y zona
// del mapa; todo se hace aquí sobre los metadatos ya descifrados. Fotos y videos en miniaturas (cuadritos por día,
// para el celular) o en tarjetas por mes; se muestran por fecha y el nombre queda en los detalles. Los archivos, en lista.
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useCompartir } from '@/lib/compartir'
import { useRoute, useRouter } from 'vue-router'
import { useBovedaStore } from '@/stores/boveda'
import { useToastStore } from '@/stores/toast'
import { api } from '@/services/api'
import PageHeader from '@/components/common/PageHeader.vue'
import Miniatura from '@/components/elementos/Miniatura.vue'
import EtiquetasEditor from '@/components/elementos/EtiquetasEditor.vue'
import AlbumModal from '@/components/elementos/AlbumModal.vue'
import AlbumElegirModal from '@/components/elementos/AlbumElegirModal.vue'
import EdicionMasivaModal from '@/components/elementos/EdicionMasivaModal.vue'
import ZipModal from '@/components/elementos/ZipModal.vue'
import UbicacionModal from '@/components/elementos/UbicacionModal.vue'
import { ESTADOS, dia, fecha, fechaCorta, iconoArchivo, mesAnio, rangoFechas, tamano } from '@/lib/formato'

const route = useRoute()
const router = useRouter()
const boveda = useBovedaStore()
const toast = useToastStore()
const q = ref('')
const desde = ref('')
const hasta = ref('')
const conUbicacion = ref(false)
const etqFiltro = ref([]) // ids de etiquetas elegidas en Filtros
const etqModo = ref('todas') // todas | alguna
const alternarEtq = (id) => (etqFiltro.value = etqFiltro.value.includes(id) ? etqFiltro.value.filter((x) => x !== id) : [...etqFiltro.value, id])
const orden = ref('tomado-desc')
const verFiltros = ref(false)
const clase = ref('todo') // en la galería: todo | imagen | video
const editar = ref(null)
const etiquetar = ref(null) // { v, nombres }
const borrar = ref(null)
const CLAVE_VISTA = 'boveda-galeria-vista'
const leerVista = () => {
  try {
    return localStorage.getItem(CLAVE_VISTA) === 'tarjetas' ? 'tarjetas' : 'miniaturas'
  } catch {
    return 'miniaturas'
  }
}
const vista = ref(leerVista()) // miniaturas | tarjetas
watch(vista, (x) => {
  try {
    localStorage.setItem(CLAVE_VISTA, x)
  } catch {}
})

const modo = computed(() => route.name) // Galeria | Archivos | Favoritos | Etiqueta | Album
const enLista = computed(() => modo.value === 'Archivos')
const conPendientes = computed(() => modo.value === 'Galeria' || modo.value === 'Archivos')
const etq = computed(() => (modo.value === 'Etiqueta' ? boveda.etiqueta(route.params.id) : null))
const alb = computed(() => (modo.value === 'Album' ? boveda.album(route.params.id) : null))
// ?agregar=<álbum>: se eligen elementos para agregarlos a ese álbum.
const destino = computed(() => (route.query.agregar ? boveda.album(String(route.query.agregar)) : null))
const zona = computed(() => {
  const z = String(route.query.zona ?? '').split(',').map(Number)
  return z.length === 4 && z.every(Number.isFinite) ? { s: z[0], w: z[1], n: z[2], e: z[3] } : null
})
const titulo = computed(() => ({ Galeria: 'Fotos y videos', Archivos: 'Archivos', Favoritos: 'Favoritos' })[modo.value] ?? etq.value?.name ?? alb.value?.name ?? '')

const base = computed(() => {
  if (modo.value === 'Favoritos') return boveda.favoritos
  if (modo.value === 'Etiqueta') return boveda.listos.filter((v) => v.m.tags?.includes(route.params.id))
  if (modo.value === 'Album') return alb.value?.elementos ?? []
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
      (!t || [v.m.title, v.m.originalName, v.m.device, v.m.nota, ...boveda.nombresDe(v)].some((x) => x?.toLowerCase().includes(t))) &&
      (!d || f >= d) &&
      (!h || f <= h) &&
      (!conUbicacion.value || loc) &&
      (!etqFiltro.value.length || etqFiltro.value[etqModo.value === 'todas' ? 'every' : 'some']((id) => v.m.tags?.includes(id))) &&
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
  if (ignorarClic) return (ignorarClic = false)
  if (sel.value) return elegir(v)
  boveda.secuencia = filtrados.value.filter((x) => x.m).map((x) => x.id)
  router.push(`/ver/${v.id}`)
}

const grupos = computed(() => {
  const out = []
  for (const v of filtrados.value) {
    const f = orden.value.startsWith('subido') ? v.createdAt : boveda.fechaDe(v)
    const k = !enLista.value && vista.value === 'miniaturas' ? dia(f) : mesAnio(f)
    if (out.at(-1)?.k !== k) out.push({ k, items: [] })
    out.at(-1).items.push(v)
  }
  return out
})
const hayFiltros = computed(() => !!(q.value || desde.value || hasta.value || conUbicacion.value || zona.value || etqFiltro.value.length))
const plural = (n) => `${n} ${n === 1 ? 'elemento' : 'elementos'}`
function limpiarFiltros() {
  q.value = desde.value = hasta.value = ''
  conUbicacion.value = false
  etqFiltro.value = []
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

// ---------- selección y álbumes ----------
// Mantener presionado un elemento (como en Fotos del iPhone) empieza a seleccionar con ese ya elegido. El clic que
// llega al soltar se ignora. Si el dedo se mueve (scroll), no cuenta.
let presion = null
let ignorarClic = false
function presionar(v, e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  ignorarClic = false // el clic tras una presión larga no siempre llega (iOS): cada toque nuevo empieza limpio
  soltar()
  presion = { x: e.clientX, y: e.clientY, t: setTimeout(() => {
    presion = null
    ignorarClic = true
    if (!sel.value) sel.value = new Set()
    elegir(v)
    navigator.vibrate?.(15)
  }, 450) }
}
function mover(e) {
  if (presion && Math.hypot(e.clientX - presion.x, e.clientY - presion.y) > 10) soltar()
}
function soltar() {
  if (presion) clearTimeout(presion.t)
  presion = null
}
const presionable = (v) => ({ pointerdown: (e) => presionar(v, e), pointermove: mover, pointerup: soltar, pointercancel: soltar, pointerleave: soltar, contextmenu: (e) => e.preventDefault() })
// «Seleccionar» flotante cuando el de arriba ya no se ve.
const bajo = ref(false)
const alScroll = () => (bajo.value = window.scrollY > 250)
onMounted(() => window.addEventListener('scroll', alScroll, { passive: true }))
onBeforeUnmount(() => window.removeEventListener('scroll', alScroll))
// Compartir los elegidos en una sola hoja (en el orden de la lista).
const { progreso: progresoCompartir, compartirVarios } = useCompartir()
const compartirElegidos = () => compartirVarios(filtrados.value.filter((v) => sel.value?.has(v.id)))
const sel = ref(null) // Set de ids mientras se selecciona
const nSel = computed(() => sel.value?.size ?? 0)
const idsSel = computed(() => [...(sel.value ?? [])])
const elegir = (v) => (sel.value.has(v.id) ? sel.value.delete(v.id) : sel.value.add(v.id))
const todosElegidos = computed(() => filtrados.value.length > 0 && filtrados.value.every((v) => sel.value?.has(v.id)))
const elegirTodos = () => (sel.value = new Set(todosElegidos.value ? [] : filtrados.value.map((v) => v.id)))
function empezarSeleccion() {
  sel.value = new Set()
}
function terminarSeleccion() {
  sel.value = null
  if (route.query.agregar) router.replace({ query: {} })
}
const albumes = ref(null) // ids para el selector de álbumes
const masiva = ref(null) // fecha | etiquetas (a los elegidos)
const ubicandoVarios = ref(false)
const haciendoZip = ref(false)
const zipListo = () => {
  haciendoZip.value = false
  terminarSeleccion()
}
const borrandoVarios = ref(null) // progreso (null = preguntando)
const preguntandoBorrar = ref(false)
const borrarVarios = accion(async () => {
  const vs = elegidos.value
  borrandoVarios.value = 0
  try {
    for (const [i, v] of vs.entries()) {
      await boveda.borrar(v)
      borrandoVarios.value = Math.round(((i + 1) / vs.length) * 100)
    }
    toast.ok(`${plural(vs.length)} ${vs.length === 1 ? 'borrado' : 'borrados'}`)
  } finally {
    borrandoVarios.value = null
    preguntandoBorrar.value = false
    terminarSeleccion()
  }
})
const elegidos = computed(() => idsSel.value.map((id) => boveda.listos.find((v) => v.id === id)).filter(Boolean))
const ubicables = computed(() => elegidos.value.filter((v) => boveda.tipo(v) !== 'archivo'))
const masivaLista = () => {
  masiva.value = null
  terminarSeleccion()
}
const ubicarVarios = accion(async (punto) => {
  const vs = ubicables.value
  ubicandoVarios.value = false
  await boveda.ubicacionVarios(vs, punto)
  toast.ok(punto ? `Ubicación puesta a ${plural(vs.length)}` : `Ubicación quitada a ${plural(vs.length)}`)
  terminarSeleccion()
})
const nuevoAlbum = ref(null) // { ids } para crear uno con esos elementos
const editandoAlbum = ref(false)
const borrandoAlbum = ref(false)
const crearAlbum = accion(async (datos) => {
  const a = await boveda.crearAlbum(datos, nuevoAlbum.value.ids)
  nuevoAlbum.value = null
  toast.ok(`Álbum «${a.name}» creado`)
  if (sel.value) terminarSeleccion()
})
const guardarAlbum = accion(async (datos) => {
  await boveda.editarAlbum(alb.value.id, datos)
  editandoAlbum.value = false
})
const confirmarBorrarAlbum = accion(async () => {
  await boveda.borrarAlbum(alb.value.id)
  borrandoAlbum.value = editandoAlbum.value = false
  toast.ok('Álbum borrado (sus fotos siguen en la bóveda)')
  router.replace('/albumes')
})
const agregarADestino = accion(async () => {
  const a = destino.value
  await boveda.agregarAAlbum(a.id, idsSel.value)
  toast.ok(`${plural(nSel.value)} en «${a.name}»`)
  sel.value = null
  router.replace(`/albumes/${a.id}`)
})
const quitarDelAlbum = accion(async (ids) => {
  await boveda.quitarDeAlbum(alb.value.id, ids)
  toast.ok(ids.length === 1 ? 'Quitado del álbum' : `${ids.length} quitados del álbum`)
  if (sel.value) sel.value = new Set()
})
const usarDePortada = accion(async (id) => {
  await boveda.portadaAlbum(alb.value.id, id)
  toast.ok('Portada cambiada')
  if (sel.value) sel.value = new Set()
})
// Agregar fotos a un álbum: la galería en modo selección (filtrada por sus fechas si se eligieron a mano).
function agregarFotos() {
  router.push({ path: '/galeria', query: { agregar: alb.value.id } })
}
function prepararDestino() {
  if (!route.query.agregar) return (sel.value = null)
  sel.value = new Set()
  const f = boveda.album(String(route.query.agregar))?.fechas
  if (f) {
    desde.value = f.desde
    hasta.value = f.hasta
  }
}
const lugar = (u) => u.nombre || `${u.lat.toFixed(3)}, ${u.lon.toFixed(3)}`
const zonaDe = (u) => [u.lat - 0.01, u.lon - 0.01, u.lat + 0.01, u.lon + 0.01].map((x) => x.toFixed(5)).join(',')

onMounted(async () => {
  try {
    await boveda.cargar(true)
    prepararDestino()
  } catch (e) {
    toast.error(e)
  }
})
watch(() => route.fullPath, () => (q.value = ''))
watch(() => [route.name, route.params.id, route.query.agregar], () => boveda.cargado && prepararDestino())
</script>

<template>
  <RouterLink v-if="modo === 'Etiqueta'" to="/etiquetas" class="small text-decoration-none d-inline-block mb-2"><CIcon icon="cil-arrow-left" class="me-1" />Etiquetas</RouterLink>
  <RouterLink v-if="modo === 'Album'" to="/albumes" class="small text-decoration-none d-inline-block mb-2"><CIcon icon="cil-arrow-left" class="me-1" />Álbumes</RouterLink>
  <CAlert v-if="destino" color="primary" class="d-flex align-items-center gap-2 py-2">
    <CIcon icon="cil-image-plus" />
    <span>Elige lo que quieres agregar a <strong>{{ destino.name }}</strong><template v-if="destino.fechas"> (filtrado por sus fechas)</template>.</span>
  </CAlert>
  <PageHeader :title="titulo" :subtitle="filtrados.length === base.length ? plural(base.length) : `${filtrados.length} de ${plural(base.length)}`">
    <CFormInput v-model="q" placeholder="Buscar…" style="max-width: 14rem" />
    <CButton :color="hayFiltros ? 'primary' : 'secondary'" variant="outline" @click="verFiltros = !verFiltros"><CIcon icon="cil-calendar" class="me-1" />Filtros</CButton>
    <CButton v-if="!sel && base.length" color="secondary" variant="outline" @click="empezarSeleccion"><CIcon icon="cil-check-circle" class="me-1" />Seleccionar</CButton>
    <CButton v-if="modo === 'Album' && alb" color="primary" @click="agregarFotos"><CIcon icon="cil-image-plus" class="me-1" />Agregar fotos</CButton>
    <CButton v-else-if="modo !== 'Album'" color="primary" @click="router.push('/subir')"><CIcon icon="cil-cloud-upload" class="me-1" />Subir</CButton>
  </PageHeader>

  <p v-if="modo === 'Album' && boveda.cargado && !alb" class="text-body-secondary">Ese álbum ya no existe.</p>
  <CCard v-if="alb" class="mb-3">
    <CCardBody class="d-flex gap-3 align-items-start album-cabecera py-2">
      <Miniatura v-if="alb.portadaItem" :item="alb.portadaItem" />
      <div class="flex-grow-1 min-w-0 small">
        <div v-if="alb.descripcion" class="mb-1" style="white-space: pre-line">{{ alb.descripcion }}</div>
        <div v-if="alb.rango" class="text-body-secondary"><CIcon icon="cil-calendar" size="sm" class="me-1" />{{ rangoFechas(alb.rango) }}<span v-if="!alb.fechas"> (de sus fotos)</span></div>
        <div v-if="alb.ubicaciones.length" class="d-flex flex-wrap gap-1 mt-1">
          <RouterLink v-for="(u, i) in alb.ubicaciones" :key="i" :to="`/mapa?zona=${zonaDe(u)}`" class="badge rounded-pill text-bg-light text-decoration-none fw-normal">
            <CIcon icon="cil-location-pin" size="sm" class="me-1" />{{ lugar(u) }}
          </RouterLink>
        </div>
      </div>
      <CButton color="secondary" variant="ghost" size="sm" title="Editar el álbum" @click="editandoAlbum = true"><CIcon icon="cil-pencil" /></CButton>
    </CCardBody>
  </CCard>

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
      <div v-if="boveda.etiquetas.length" class="w-100">
        <div class="d-flex align-items-center gap-2 mb-1">
          <span class="small">Etiquetas</span>
          <CButtonGroup v-if="etqFiltro.length > 1" size="sm" role="group" aria-label="Cómo combinar las etiquetas">
            <CButton color="secondary" :variant="etqModo === 'todas' ? undefined : 'outline'" class="py-0" @click="etqModo = 'todas'">Todas</CButton>
            <CButton color="secondary" :variant="etqModo === 'alguna' ? undefined : 'outline'" class="py-0" @click="etqModo = 'alguna'">Alguna</CButton>
          </CButtonGroup>
        </div>
        <div class="d-flex flex-wrap gap-1">
          <button v-for="t in boveda.etiquetas" :key="t.id" type="button" class="btn btn-sm py-0 px-2 rounded-pill" :class="etqFiltro.includes(t.id) ? `btn-${t.color}` : `btn-outline-${t.color}`" :aria-pressed="etqFiltro.includes(t.id)" @click="alternarEtq(t.id)">
            {{ t.name }} <span class="opacity-75">{{ t.total }}</span>
          </button>
        </div>
      </div>
      <CButton color="link" size="sm" class="mb-1 ms-auto" @click="router.push(zona ? `/mapa?zona=${route.query.zona}` : '/mapa')"><CIcon icon="cil-map" class="me-1" />Elegir zona en el mapa</CButton>
    </CCardBody>
  </CCard>

  <div v-if="!enLista" class="d-flex align-items-center gap-2 mb-3">
    <CNav v-if="modo === 'Galeria'" variant="pills" class="gap-1">
      <CNavItem v-for="[k, txt] in [['todo', 'Todo'], ['imagen', 'Fotos'], ['video', 'Videos']]" :key="k">
        <CNavLink as="button" :active="clase === k" @click="clase = k">{{ txt }}</CNavLink>
      </CNavItem>
    </CNav>
    <CButtonGroup size="sm" class="ms-auto" role="group" aria-label="Vista">
      <CButton color="secondary" :variant="vista === 'miniaturas' ? undefined : 'outline'" title="Miniaturas" @click="vista = 'miniaturas'"><CIcon icon="cil-grid" /></CButton>
      <CButton color="secondary" :variant="vista === 'tarjetas' ? undefined : 'outline'" title="Tarjetas" @click="vista = 'tarjetas'"><CIcon icon="cil-list" /></CButton>
    </CButtonGroup>
  </div>

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
      <CIcon :icon="{ Favoritos: 'cil-star', Archivos: 'cil-folder', Etiqueta: 'cil-tags', Album: 'cil-library' }[modo] ?? 'cil-image'" size="3xl" class="text-secondary mb-3" />
      <p class="mb-3">{{ { Favoritos: 'Aún no marcas favoritos: toca la estrella de cualquier elemento.', Etiqueta: 'Nada tiene esta etiqueta.', Archivos: 'Todavía no hay archivos.', Album: 'Este álbum está vacío.' }[modo] ?? 'Todavía no hay fotos ni videos.' }}</p>
      <CButton v-if="conPendientes" color="primary" @click="router.push('/subir')">Subir el primero</CButton>
      <CButton v-if="alb" color="primary" @click="agregarFotos">Agregar fotos</CButton>
    </CCardBody>
  </CCard>
  <p v-else-if="!filtrados.length" class="text-body-secondary">Nada coincide con los filtros.</p>

  <template v-if="enLista">
    <template v-for="g in grupos" :key="g.k">
      <div class="grupo-mes">{{ g.k }}</div>
      <CListGroup>
        <CListGroupItem v-for="v in g.items" :key="v.id" class="d-flex align-items-center gap-3 archivo-fila presionable" :active="sel?.has(v.id)" v-on="presionable(v)" @click="abrir(v)">
          <CIcon v-if="sel" :icon="sel.has(v.id) ? 'cil-check-circle' : 'cil-circle'" class="flex-shrink-0" />
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
              <CDropdownItem as="button" @click="albumes = [v.id]"><CIcon icon="cil-library" class="me-2" />Álbumes…</CDropdownItem>
              <CDropdownItem v-if="alb && boveda.tipo(v) !== 'archivo'" as="button" @click="usarDePortada(v.id)"><CIcon icon="cil-image" class="me-2" />Usar como portada</CDropdownItem>
              <CDropdownItem v-if="alb" as="button" @click="quitarDelAlbum([v.id])"><CIcon icon="cil-minus" class="me-2" />Quitar del álbum</CDropdownItem>
              <CDropdownItem as="button" class="text-danger" @click="borrar = v"><CIcon icon="cil-trash" class="me-2" />Borrar</CDropdownItem>
            </CDropdownMenu>
          </CDropdown>
        </CListGroupItem>
      </CListGroup>
    </template>
  </template>
  <template v-else-if="vista === 'miniaturas'">
    <template v-for="g in grupos" :key="g.k">
      <div class="grupo-dia">{{ g.k }}</div>
      <div class="mini-grid">
        <button v-for="v in g.items" :key="v.id" type="button" class="mini presionable" :class="{ elegido: sel?.has(v.id) }" :title="fechaCorta(boveda.fechaDe(v))" :aria-pressed="sel ? sel.has(v.id) : undefined" v-on="presionable(v)" @click="abrir(v)">
          <Miniatura :item="v">
            <span v-if="sel" class="marca-sel"><CIcon v-if="sel.has(v.id)" icon="cil-check-alt" size="sm" /></span>
            <CIcon v-if="v.m.favorite" icon="cil-star" size="sm" class="mini-fav" />
          </Miniatura>
        </button>
      </div>
    </template>
  </template>
  <template v-for="g in grupos" v-else :key="g.k">
    <div class="grupo-mes">{{ g.k }}</div>
    <div class="video-grid">
      <CCard v-for="v in g.items" :key="v.id" class="video-card presionable" :class="{ elegido: sel?.has(v.id) }" v-on="presionable(v)" @click="abrir(v)">
        <Miniatura :item="v">
          <span v-if="sel" class="marca-sel"><CIcon v-if="sel.has(v.id)" icon="cil-check-alt" size="sm" /></span>
          <button type="button" class="fav" :class="{ on: v.m.favorite }" :title="v.m.favorite ? 'Quitar de favoritos' : 'Favorito'" @click.stop="favorito(v)">
            <CIcon icon="cil-star" :class="{ 'opacity-50': !v.m.favorite }" />
          </button>
        </Miniatura>
        <CCardBody class="p-2 px-3">
          <div class="d-flex align-items-start gap-2">
            <div class="flex-grow-1 text-truncate fw-semibold">{{ fechaCorta(boveda.fechaDe(v)) }}</div>
            <CDropdown placement="bottom-end" @click.stop>
              <CDropdownToggle color="link" size="sm" class="p-0 text-body-secondary" :caret="false" aria-label="Opciones">⋯</CDropdownToggle>
              <CDropdownMenu>
                <CDropdownItem as="button" @click="etiquetar = { v, nombres: boveda.nombresDe(v) }"><CIcon icon="cil-tags" class="me-2" />Etiquetas</CDropdownItem>
                <CDropdownItem as="button" @click="editar = { v, title: v.m.title }"><CIcon icon="cil-pencil" class="me-2" />Renombrar</CDropdownItem>
                <CDropdownItem as="button" @click="albumes = [v.id]"><CIcon icon="cil-library" class="me-2" />Álbumes…</CDropdownItem>
                <CDropdownItem v-if="alb && boveda.tipo(v) !== 'archivo'" as="button" @click="usarDePortada(v.id)"><CIcon icon="cil-image" class="me-2" />Usar como portada</CDropdownItem>
                <CDropdownItem v-if="alb" as="button" @click="quitarDelAlbum([v.id])"><CIcon icon="cil-minus" class="me-2" />Quitar del álbum</CDropdownItem>
                <CDropdownItem as="button" class="text-danger" @click="borrar = v"><CIcon icon="cil-trash" class="me-2" />Borrar</CDropdownItem>
              </CDropdownMenu>
            </CDropdown>
          </div>
          <div class="d-flex align-items-center gap-2 small text-body-secondary mt-1">
            <CIcon :icon="boveda.tipo(v) === 'video' ? 'cil-video' : boveda.tipo(v) === 'imagen' ? 'cil-image' : 'cil-file'" size="sm" />
            <CIcon v-if="v.m.location" icon="cil-location-pin" size="sm" title="Tiene ubicación" />
            <CIcon v-if="v.m.nota" icon="cil-notes" size="sm" title="Tiene nota" />
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

  <button v-if="!sel && bajo && base.length" type="button" class="btn btn-primary fab-seleccionar shadow" aria-label="Empezar a seleccionar" @click="empezarSeleccion">
    <CIcon icon="cil-check-circle" class="me-1" />Seleccionar
  </button>
  <div v-if="sel" class="barra-seleccion d-flex flex-wrap align-items-center gap-2">
    <span class="fw-semibold me-1">{{ nSel }} {{ nSel === 1 ? 'elegido' : 'elegidos' }}</span>
    <CButton color="link" size="sm" class="px-1" @click="elegirTodos">{{ todosElegidos ? 'Ninguno' : `Todos (${filtrados.length})` }}</CButton>
    <div class="d-flex flex-wrap gap-2 ms-auto">
      <CButton color="secondary" variant="ghost" @click="terminarSeleccion">Cancelar</CButton>
      <template v-if="destino">
        <CButton color="primary" :disabled="!nSel" @click="agregarADestino">Agregar a «{{ destino.name }}»</CButton>
      </template>
      <template v-else>
        <CButton v-if="alb" color="secondary" variant="outline" :disabled="nSel !== 1" @click="usarDePortada(idsSel[0])">Portada</CButton>
        <CButton v-if="alb" color="danger" variant="outline" :disabled="!nSel" @click="quitarDelAlbum(idsSel)">Quitar del álbum</CButton>
        <CDropdown placement="top-end">
          <CDropdownToggle color="secondary" variant="outline" :disabled="!nSel">Cambiar</CDropdownToggle>
          <CDropdownMenu>
            <CDropdownItem as="button" @click="masiva = 'fecha'"><CIcon icon="cil-calendar" class="me-2" />Fecha…</CDropdownItem>
            <CDropdownItem as="button" @click="masiva = 'etiquetas'"><CIcon icon="cil-tags" class="me-2" />Etiquetas…</CDropdownItem>
            <CDropdownItem v-if="ubicables.length" as="button" @click="ubicandoVarios = true"><CIcon icon="cil-location-pin" class="me-2" />Ubicación…</CDropdownItem>
          </CDropdownMenu>
        </CDropdown>
        <CButton color="secondary" variant="outline" :disabled="!nSel || progresoCompartir !== null" title="Compartir los elegidos" @click="compartirElegidos">
          <CIcon icon="cil-share-boxed" /><span v-if="progresoCompartir !== null" class="small ms-1">{{ progresoCompartir }}%</span>
        </CButton>
        <CButton color="secondary" variant="outline" :disabled="!nSel" title="ZIP con contraseña de los elegidos" @click="haciendoZip = true"><CIcon icon="cil-compress" class="me-1" />ZIP</CButton>
        <CButton color="danger" variant="outline" :disabled="!nSel" title="Borrar los elegidos" @click="preguntandoBorrar = true"><CIcon icon="cil-trash" /></CButton>
        <CButton color="primary" :disabled="!nSel" @click="albumes = idsSel"><CIcon icon="cil-library" class="me-1" />Álbumes…</CButton>
      </template>
    </div>
  </div>

  <AlbumElegirModal
    :visible="!!albumes"
    :ids="albumes ?? []"
    @close="albumes = null"
    @listo="albumes = null; sel && terminarSeleccion()"
    @nuevo="nuevoAlbum = { ids: albumes }; albumes = null"
  />
  <CModal :visible="preguntandoBorrar" alignment="center" backdrop="static" @close="borrandoVarios === null && (preguntandoBorrar = false)">
    <CModalHeader :close-button="borrandoVarios === null"><CModalTitle>¿Borrar {{ plural(nSel) }}?</CModalTitle></CModalHeader>
    <CModalBody>
      Se borran de la NAS para siempre (con sus exportaciones). No se puede deshacer.
      <CProgress v-if="borrandoVarios !== null" :value="borrandoVarios" class="mt-3" height="6" />
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="ghost" :disabled="borrandoVarios !== null" @click="preguntandoBorrar = false">Cancelar</CButton>
      <CButton color="danger" :disabled="borrandoVarios !== null" @click="borrarVarios">Borrar {{ nSel }}</CButton>
    </CModalFooter>
  </CModal>
  <ZipModal :visible="haciendoZip" :items="elegidos" :nombre="titulo" @close="haciendoZip = false" @listo="zipListo" />
  <EdicionMasivaModal :modo="masiva" :items="elegidos" @close="masiva = null" @listo="masivaLista" />
  <UbicacionModal :visible="ubicandoVarios" :items="ubicables" @close="ubicandoVarios = false" @save="ubicarVarios" />
  <AlbumModal :visible="!!nuevoAlbum" :ids="nuevoAlbum?.ids ?? []" @close="nuevoAlbum = null" @save="crearAlbum" />
  <AlbumModal :visible="editandoAlbum" :album="alb" @close="editandoAlbum = false" @save="guardarAlbum" @borrar="borrandoAlbum = true" />
  <CModal :visible="borrandoAlbum" alignment="center" @close="borrandoAlbum = false">
    <CModalHeader><CModalTitle>¿Borrar el álbum?</CModalTitle></CModalHeader>
    <CModalBody>Se borra el álbum <strong>{{ alb?.name }}</strong>. Sus fotos y videos <strong>no</strong> se borran: siguen en la bóveda.</CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="ghost" @click="borrandoAlbum = false">Cancelar</CButton>
      <CButton color="danger" @click="confirmarBorrarAlbum">Borrar álbum</CButton>
    </CModalFooter>
  </CModal>

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
