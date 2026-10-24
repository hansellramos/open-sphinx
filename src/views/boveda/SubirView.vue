<script setup>
// Subir: elegir, arrastrar o pegar. Pegar tiene dos caminos: el botón (navigator.clipboard.read: Safari solo
// entrega imágenes y texto) y el recuadro donde se mantiene presionado → Pegar (evento paste: ahí Safari
// también entrega archivos copiados desde la app Archivos). En el Mac, Cmd+V en cualquier parte de la página.
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useSubidasStore } from '@/stores/subidas'
import { useToastStore } from '@/stores/toast'
import { useBovedaStore } from '@/stores/boveda'
import EtiquetasEditor from '@/components/elementos/EtiquetasEditor.vue'
import PageHeader from '@/components/common/PageHeader.vue'
import { tamano } from '@/lib/formato'

const router = useRouter()
const subidas = useSubidasStore()
const toast = useToastStore()
const boveda = useBovedaStore()
const input = ref(null)
const encima = ref(false)
const nota = ref(null) // { nombre, texto } cuando lo pegado es solo texto
const editandoEtq = ref(new Set()) // ids de la lista con el editor de etiquetas abierto
const alternarEtq = (it) => (editandoEtq.value.has(it.id) ? editandoEtq.value.delete(it.id) : editandoEtq.value.add(it.id))

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

onMounted(() => document.addEventListener('paste', alPegar))
onBeforeUnmount(() => document.removeEventListener('paste', alPegar))

const COLOR = { revisando: 'info', esperando: 'secondary', subiendo: 'primary', listo: 'success', error: 'danger', duplicado: 'warning' }
</script>

<template>
  <PageHeader title="Subir" subtitle="Se suben por la VPN; la NAS los cifra y borra lo que llegó sin cifrar.">
    <CButton v-if="subidas.items.some((i) => i.estado === 'listo' || i.estado === 'duplicado')" color="secondary" variant="outline" @click="subidas.limpiarListos()">Limpiar terminados</CButton>
    <CButton color="primary" variant="outline" @click="router.push('/galeria')">Ir a la galería</CButton>
  </PageHeader>

  <div class="mb-3">
    <div class="small text-body-secondary mb-1">Etiquetas para lo que subas (opcional)</div>
    <EtiquetasEditor v-model="subidas.etiquetas" :sugerencias="boveda.etiquetas" />
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
        <div class="flex-grow-1 text-truncate fw-semibold" :title="it.nombre">{{ it.nombre }}</div>
        <span class="small text-body-secondary text-nowrap">{{ tamano(it.tam) }}</span>
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
        <template v-else>{{ { revisando: `Revisando si ya está… ${it.progreso}%`, subiendo: `${it.progreso}%`, listo: 'Subido · en cola para cifrar', error: it.error }[it.estado] ?? 'Esperando' }}</template>
      </div>
      <!-- Fecha y etiquetas de este archivo: se pueden cambiar sin esperar a que termine -->
      <div v-if="it.estado !== 'duplicado'" class="d-flex flex-wrap align-items-center gap-2 mt-2 small">
        <CIcon icon="cil-calendar" class="text-body-secondary" />
        <input type="datetime-local" class="form-control form-control-sm subir-fecha" :value="it.fecha ?? ''" aria-label="Fecha" @change="subidas.cambiar(it, { fecha: $event.target.value })" />
        <span v-if="it.fecha && !it.manual" class="text-body-secondary">del nombre</span>
        <span v-else-if="!it.fecha" class="text-body-secondary">la de la foto, o la de hoy</span>
        <button type="button" class="btn btn-link btn-sm p-0 ms-sm-auto d-inline-flex align-items-center gap-1 text-decoration-none" title="Etiquetas de este archivo" @click="alternarEtq(it)">
          <CIcon icon="cil-tags" />
          <template v-if="!it.tags.length">Etiquetas</template>
          <CBadge v-for="t in it.tags" :key="t" color="secondary" class="fw-normal">{{ t }}</CBadge>
        </button>
      </div>
      <EtiquetasEditor v-if="editandoEtq.has(it.id)" class="mt-2" :model-value="it.tags" :sugerencias="boveda.etiquetas" @update:model-value="(t) => subidas.cambiar(it, { tags: t })" />
    </CCardBody>
  </CCard>
</template>
