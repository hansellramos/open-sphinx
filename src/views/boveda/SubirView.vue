<script setup>
// Subir: elegir, arrastrar o pegar. Pegar tiene dos caminos: el botón (navigator.clipboard.read: Safari solo
// entrega imágenes y texto) y el recuadro donde se mantiene presionado → Pegar (evento paste: ahí Safari
// también entrega archivos copiados desde la app Archivos). En el Mac, Cmd+V en cualquier parte de la página.
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useSubidasStore } from '@/stores/subidas'
import { useToastStore } from '@/stores/toast'
import { useBovedaStore } from '@/stores/boveda'
import { usePrivacidadStore } from '@/stores/privacidad'
import EtiquetasEditor from '@/components/elementos/EtiquetasEditor.vue'
import AlbumElegirModal from '@/components/elementos/AlbumElegirModal.vue'
import AlbumModal from '@/components/elementos/AlbumModal.vue'
import PageHeader from '@/components/common/PageHeader.vue'
import { duracion, fecha, tamano } from '@/lib/formato'
import { useOcultable } from '@/lib/ocultable'

const router = useRouter()
const subidas = useSubidasStore()
const toast = useToastStore()
const boveda = useBovedaStore()
const priv = usePrivacidadStore()
const input = ref(null)
const encima = ref(false)
const nota = ref(null) // { nombre, texto } cuando lo pegado es solo texto
// Etiquetas y notas a la vista solo mientras se editan: se abren con su ícono y se cierran solas a los 30 s sin
// tocarlas (que nadie las lea de un vistazo). Afuera solo se ve cuántas hay. Ids: 'global', `e<id>`, `n<id>`.
const panel = useOcultable()
const abierto = (id) => panel.abiertos.value.has(id)
// Si la nota se cierra sola mientras se escribía (sin salir del campo), se guarda igual.
watch(
  () => [...panel.abiertos.value],
  (ahora, antes) => {
    for (const id of antes ?? []) {
      if (!id.startsWith('n') || ahora.includes(id)) continue
      const it = subidas.items.find((i) => `n${i.id}` === id)
      if (it) subidas.cambiar(it, { nota: it.nota })
    }
  },
)

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' }
const marca = () => new Date().toLocaleString('sv').replace(' ', '_').replace(/:/g, '-')
// Lo pegado sin nombre real (image.png, etc.) se nombra con la fecha.
const nombrar = (f, i) =>
  /^(image|imagen)\.\w+$/i.test(f.name) || !f.name
    ? new File([f], `pegado-${marca()}${i ? `-${i}` : ''}.${EXT[f.type] ?? f.name.split('.').pop() ?? 'bin'}`, { type: f.type })
    : f

function elegir(files) {
  if (files.length) subidas.agregar([...files])
}
function soltar(e) {
  encima.value = false
  elegir(e.dataTransfer.files)
}
function recibir(files, texto) {
  if (files.length) {
    subidas.agregar(files.map(nombrar))
    toast.ok(files.length === 1 ? 'Pegado: subiendo' : `${files.length} pegados: subiendo`)
  } else if (texto?.trim()) nota.value = { nombre: `nota-${marca()}`, texto }
  else toast.info('El portapapeles no tiene nada que se pueda subir')
}

async function pegarBoton() {
  if (!navigator.clipboard?.read) return toast.info('Este navegador no deja leer el portapapeles con el botón: mantén presionado el recuadro y toca Pegar')
  try {
    const files = []
    let texto = null
    for (const it of await navigator.clipboard.read()) {
      const tipo = it.types.find((t) => !t.startsWith('text/') && !t.startsWith('web '))
      if (tipo) files.push(new File([await it.getType(tipo)], '', { type: tipo }))
      else if (it.types.includes('text/plain')) texto = await (await it.getType('text/plain')).text()
    }
    recibir(files, texto)
  } catch (e) {
    toast.error(e.name === 'NotAllowedError' ? 'No se dio permiso para leer el portapapeles' : e)
  }
}

function alPegar(e) {
  // Pegar dentro de un campo de texto (p. ej. la nota) es pegar texto, no subir.
  if (e.target.closest?.('input, textarea')) return
  const files = [...(e.clipboardData?.files ?? [])]
  const texto = e.clipboardData?.getData('text/plain')
  if (!files.length && !texto) return
  e.preventDefault()
  recibir(files, texto)
}

function guardarNota() {
  const nombre = (nota.value.nombre.trim() || `nota-${marca()}`).replace(/\.txt$/i, '')
  subidas.agregar([new File([nota.value.texto], `${nombre}.txt`, { type: 'text/plain' })])
  nota.value = null
}

// Mientras haya algo subido que todavía no aparece listo, se consulta la NAS (la galería solo lo hace mientras ve
// pendientes, y una recarga en curso al terminar la subida podía dejar la lista sin enterarse).
let sondeo = null
onMounted(() => {
  document.addEventListener('paste', alPegar)
  boveda.cargar().catch(() => {}) // álbumes y etiquetas para elegir
  sondeo = setInterval(() => {
    if (subidas.items.some((i) => i.estado === 'listo' && !listoEn(i))) boveda.cargar(true).catch(() => {})
  }, 5000)
})
onBeforeUnmount(() => clearInterval(sondeo))
onBeforeUnmount(() => document.removeEventListener('paste', alPegar))

// Álbumes: para lo que se agregue (it = null) o para un archivo de la lista.
const eligiendoAlbum = ref(undefined) // undefined = cerrado; null = los de todo lo que se suba; item
const creandoAlbum = ref(false)
const nombreAlbum = (id) => boveda.album(id)?.name
const albumesActuales = computed(() => (eligiendoAlbum.value ? eligiendoAlbum.value.albumes : subidas.albumes))
function ponerAlbumes(ids) {
  if (eligiendoAlbum.value) subidas.cambiar(eligiendoAlbum.value, { albumes: ids })
  else subidas.albumes = ids
}
function albumesElegidos(ids) {
  ponerAlbumes(ids)
  eligiendoAlbum.value = undefined
}
let paraNuevo = null
function nuevoAlbum() {
  paraNuevo = eligiendoAlbum.value
  eligiendoAlbum.value = undefined
  creandoAlbum.value = true
}
async function crearAlbum(datos) {
  try {
    const a = await boveda.crearAlbum(datos)
    creandoAlbum.value = false
    const ids = [...(paraNuevo ? paraNuevo.albumes : subidas.albumes), a.id]
    if (paraNuevo) subidas.cambiar(paraNuevo, { albumes: ids })
    else subidas.albumes = ids
    toast.ok(`Álbum «${a.name}» creado`)
  } catch (e) {
    toast.error(e)
  }
}

// Ya subido: cómo va en la NAS (la cola de cifrado). Siempre empieza con «Subido · ». Se sigue por el id que
// devuelve la NAS al terminar la subida (o, si no lo hay, por la subida o la huella).
const idSubida = (it) => it.upload?.url?.split('/').pop()
const elemento = (it) =>
  (it.elementoId && boveda.items.find((x) => x.id === it.elementoId)) ||
  boveda.items.find((x) => x.uploadId && x.uploadId === idSubida(it)) ||
  (it.sha && boveda.huellas.get(it.sha)) ||
  null
const listoEn = (it) => {
  const v = it.estado === 'listo' && elemento(it)
  return v && v.status === 'listo' && v.m ? v.id : null
}
function enNas(it) {
  if (listoEn(it)) return 'Subido · ✓ listo en la bóveda'
  const v = elemento(it)
  if (v?.status === 'procesando') return `Subido · cifrando en la NAS ${v.progreso ?? 0}%`
  if (v?.status === 'error') return `Subido · error al cifrar: ${v.error}`
  const fila = boveda.items.filter((x) => x.status === 'en_cola').sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
  const pos = v ? fila.indexOf(v) + 1 : 0
  return `Subido · en cola para cifrar${pos ? ` (${pos}º)` : ''}`
}

const REDUCIR = [[null, 'Dejar el original'], [720, 'Reducir a 720p y reemplazar el original'], [540, 'Reducir a 540p y reemplazar el original']]
const REDUCIR_CORTO = [[null, 'Original'], [720, 'Reducir a 720p'], [540, 'Reducir a 540p']]
const COLOR = { revisando: 'info', esperando: 'secondary', subiendo: 'primary', listo: 'success', error: 'danger', duplicado: 'warning' }
</script>

<template>
  <PageHeader title="Subir" subtitle="Se suben por la VPN; la NAS los cifra y borra lo que llegó sin cifrar.">
    <CButton v-if="subidas.items.some((i) => i.estado === 'listo' || i.estado === 'duplicado')" color="secondary" variant="outline" @click="subidas.limpiarListos()">Limpiar terminados</CButton>
    <CButton color="primary" variant="outline" @click="router.push('/galeria')">Ir a la galería</CButton>
  </PageHeader>

  <CCard v-if="subidas.resumen.n" class="mb-3">
    <CCardBody class="py-2">
      <div class="d-flex flex-wrap align-items-center gap-2 small mb-1">
        <strong v-if="subidas.activa">Subiendo {{ subidas.resumen.actual }} de {{ subidas.resumen.n }}</strong>
        <strong v-else>Subidos {{ subidas.resumen.listos }} de {{ subidas.resumen.n }}</strong>
        <span class="text-body-secondary">· {{ subidas.resumen.pct }}%</span>
        <span v-if="subidas.resumen.errores" class="text-danger">· {{ subidas.resumen.errores }} con error</span>
        <RouterLink to="/cola" class="ms-auto text-decoration-none">Ver la cola de cifrado →</RouterLink>
      </div>
      <CProgress :value="subidas.resumen.pct" height="6" />
    </CCardBody>
  </CCard>

  <div class="mb-3">
    <div class="small text-body-secondary mb-1">Para todo lo que subas (opcional)</div>
    <div class="d-flex flex-wrap gap-3 align-items-center">
      <button type="button" class="btn btn-link btn-sm p-0 d-inline-flex align-items-center gap-1 text-decoration-none" title="Etiquetas para lo que subas" :aria-expanded="abierto('global')" @click="panel.alternar('global')">
        <CIcon icon="cil-tags" />Etiquetas<span v-if="subidas.etiquetas.length" class="badge rounded-pill text-bg-secondary">{{ subidas.etiquetas.length }}</span>
      </button>
      <button type="button" class="btn btn-link btn-sm p-0 d-inline-flex align-items-center gap-1 text-decoration-none" title="Álbumes para lo que subas" @click="eligiendoAlbum = null">
        <CIcon icon="cil-library" />Álbumes<span v-if="subidas.albumes.filter(nombreAlbum).length" class="badge rounded-pill text-bg-secondary">{{ subidas.albumes.filter(nombreAlbum).length }}</span>
      </button>
    </div>
    <EtiquetasEditor v-if="abierto('global')" v-model="subidas.etiquetas" class="mt-2" :sugerencias="boveda.etiquetas" @pointerdown="panel.tocar('global')" @keydown="panel.tocar('global')" />
  </div>

  <div class="mb-3">
    <label class="small text-body-secondary mb-1 d-block" for="subir-reducir">Videos</label>
    <select id="subir-reducir" v-model="subidas.reducir" class="form-select form-select-sm subir-reducir">
      <option v-for="[v, txt] in REDUCIR" :key="String(v)" :value="v">{{ txt }}</option>
    </select>
    <div v-if="subidas.reducir" class="small text-body-secondary mt-1">
      Se sube completo y, ya en la bóveda, la NAS crea la versión de {{ subidas.reducir }}p y con ella reemplaza al original (el original se borra). Si no
      pesa menos, se queda el original. Lo ves en Exportaciones mientras se crea.
    </div>
  </div>

  <div
    class="dropzone mb-4"
    :class="{ over: encima }"
    @click="input.click()"
    @dragover.prevent="encima = true"
    @dragleave="encima = false"
    @drop.prevent="soltar"
  >
    <CIcon icon="cil-cloud-upload" size="3xl" class="text-primary mb-2" />
    <div class="fw-semibold">Toca para elegir fotos, videos o archivos, o arrástralos aquí</div>
    <div class="small text-body-secondary">Se suben de a uno; si se corta la conexión, siguen donde iban</div>
    <input ref="input" type="file" multiple hidden @change="elegir($event.target.files); $event.target.value = ''" />
  </div>

  <div class="d-flex flex-wrap align-items-stretch gap-2 mb-4">
    <CButton color="primary" variant="outline" @click="pegarBoton"><CIcon icon="cil-clipboard" class="me-1" />Pegar</CButton>
    <div class="zona-pegar flex-grow-1" contenteditable="true" inputmode="none" spellcheck="false" aria-label="Zona para pegar" data-texto="Mantén presionado aquí y toca Pegar (sirve también para archivos)" @input="$event.target.textContent = ''"></div>
  </div>

  <CCard v-if="nota" class="mb-4">
    <CCardBody>
      <div class="fw-semibold mb-2">El portapapeles tiene texto. ¿Guardarlo como nota?</div>
      <CFormInput v-model="nota.nombre" class="mb-2" aria-label="Nombre de la nota" />
      <CFormTextarea v-model="nota.texto" rows="5" class="mb-2" aria-label="Texto" />
      <div class="d-flex gap-2 justify-content-end">
        <CButton color="secondary" variant="ghost" @click="nota = null">Descartar</CButton>
        <CButton color="primary" @click="guardarNota">Guardar como nota</CButton>
      </div>
    </CCardBody>
  </CCard>

  <CCard v-for="it in subidas.items" :key="it.id" class="mb-2">
    <CCardBody class="py-2">
      <div class="d-flex align-items-center gap-2 mb-1">
        <div class="subir-mini" aria-hidden="true">
          <img v-if="it.mini" :src="it.mini" alt="" :class="{ difuminada: priv.difuminar }" />
          <CIcon v-else :icon="it.video ? 'cil-video' : 'cil-file'" class="text-secondary" />
        </div>
        <div class="flex-grow-1 text-truncate fw-semibold" :title="it.nombre">{{ it.nombre }}</div>
        <span class="small text-body-secondary text-nowrap">{{ tamano(it.tam) }}</span>
        <RouterLink v-if="listoEn(it)" :to="`/ver/${listoEn(it)}`" class="btn btn-sm btn-outline-primary py-0" title="Abrirlo en la bóveda"><CIcon icon="cil-media-play" size="sm" class="me-1" />Ver</RouterLink>
        <CButton v-if="it.estado === 'error'" color="link" size="sm" @click="subidas.reintentar(it)">Reintentar</CButton>
        <CButton v-if="it.estado === 'duplicado'" color="link" size="sm" @click="subidas.subirIgual(it)">Subir igual</CButton>
        <CButton v-if="it.estado !== 'listo'" color="link" size="sm" class="text-danger" @click="subidas.cancelar(it)">{{ it.estado === 'duplicado' ? 'Quitar' : 'Cancelar' }}</CButton>
      </div>
      <CProgress :value="it.progreso" :color="COLOR[it.estado]" height="6" />
      <div class="small mt-1 d-flex flex-wrap gap-1 align-items-center" :class="it.estado === 'error' ? 'text-danger' : 'text-body-secondary'">
        <template v-if="it.estado === 'duplicado'">
          Ya está en la bóveda:
          <RouterLink v-if="it.igual?.id" :to="`/ver/${it.igual.id}`">{{ it.igual.title }}</RouterLink>
          <span v-else>{{ it.igual?.title }} (en esta misma subida)</span>
        </template>
        <template v-else>{{ { revisando: `Revisando si ya está… ${it.progreso}%`, subiendo: `${it.progreso}%${it.velocidad ? ` · ${tamano(it.velocidad)}/s${it.restante != null ? ` · faltan ${duracion(it.restante)}` : ''}` : ''}`, listo: enNas(it), error: it.error }[it.estado] ?? 'Esperando' }}</template>
      </div>
      <!-- Fecha y etiquetas de este archivo: se pueden cambiar sin esperar a que termine -->
      <div v-if="it.estado !== 'duplicado'" class="d-flex flex-wrap align-items-center gap-2 mt-2 small">
        <CIcon icon="cil-calendar" class="text-body-secondary" />
        <input type="datetime-local" class="form-control form-control-sm subir-fecha" :value="it.fecha ?? ''" aria-label="Fecha" @change="subidas.cambiar(it, { fecha: $event.target.value })" />
        <span v-if="it.fecha && !it.manual" class="text-body-secondary">del nombre</span>
        <span v-else-if="!it.fecha && it.archivo" class="text-body-secondary">la de la foto, o la del archivo: {{ fecha(it.archivo) }}</span>
        <span v-else-if="!it.fecha" class="text-body-secondary">la de la foto, o la de hoy</span>
        <select v-if="it.video" class="form-select form-select-sm subir-reducir-item" :value="it.reducir ?? ''" aria-label="Reducir este video" @change="subidas.cambiar(it, { reducir: Number($event.target.value) || null })">
          <option v-for="[v, txt] in REDUCIR_CORTO" :key="String(v)" :value="v ?? ''">{{ txt }}</option>
        </select>
        <button type="button" class="btn btn-link btn-sm p-0 ms-sm-auto d-inline-flex align-items-center gap-1 text-decoration-none" title="Álbumes de este archivo" @click="eligiendoAlbum = it">
          <CIcon icon="cil-library" />Álbum<span v-if="it.albumes.filter(nombreAlbum).length" class="badge rounded-pill text-bg-secondary">{{ it.albumes.filter(nombreAlbum).length }}</span>
        </button>
        <button type="button" class="btn btn-link btn-sm p-0 d-inline-flex align-items-center gap-1 text-decoration-none" title="Nota de este archivo" :aria-expanded="abierto(`n${it.id}`)" @click="panel.alternar(`n${it.id}`)">
          <CIcon icon="cil-notes" />Nota<span v-if="it.nota.trim()" class="badge rounded-pill text-bg-secondary">✓</span>
        </button>
        <button type="button" class="btn btn-link btn-sm p-0 d-inline-flex align-items-center gap-1 text-decoration-none" title="Etiquetas de este archivo" :aria-expanded="abierto(`e${it.id}`)" @click="panel.alternar(`e${it.id}`)">
          <CIcon icon="cil-tags" />Etiquetas<span v-if="it.tags.length" class="badge rounded-pill text-bg-secondary">{{ it.tags.length }}</span>
        </button>
      </div>
      <!-- @change: se guarda al salir del campo (no en cada letra) -->
      <CFormTextarea v-if="abierto(`n${it.id}`)" class="mt-2" rows="2" maxlength="2000" placeholder="Nota (va cifrada con la foto)" aria-label="Nota de este archivo" :model-value="it.nota" @input="it.nota = $event.target.value.slice(0, 2000); panel.tocar(`n${it.id}`)" @change="subidas.cambiar(it, { nota: $event.target.value })" />
      <EtiquetasEditor v-if="abierto(`e${it.id}`)" class="mt-2" :model-value="it.tags" :sugerencias="boveda.etiquetas" @pointerdown="panel.tocar(`e${it.id}`)" @keydown="panel.tocar(`e${it.id}`)" @update:model-value="(t) => subidas.cambiar(it, { tags: t })" />
    </CCardBody>
  </CCard>

  <AlbumElegirModal :visible="eligiendoAlbum !== undefined" :elegir="albumesActuales" @close="eligiendoAlbum = undefined" @elegidos="albumesElegidos" @nuevo="nuevoAlbum" />
  <AlbumModal :visible="creandoAlbum" @close="creandoAlbum = false" @save="crearAlbum" />
</template>
