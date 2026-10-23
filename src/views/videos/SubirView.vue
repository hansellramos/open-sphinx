<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSubidasStore } from '@/stores/subidas'
import PageHeader from '@/components/common/PageHeader.vue'
import { tamano } from '@/lib/formato'

const router = useRouter()
const subidas = useSubidasStore()
const input = ref(null)
const encima = ref(false)

function elegir(files) {
  const videos = [...files].filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|mkv|webm|avi)$/i.test(f.name))
  if (videos.length) subidas.agregar(videos)
}
function soltar(e) {
  encima.value = false
  elegir(e.dataTransfer.files)
}
const COLOR = { esperando: 'secondary', subiendo: 'primary', listo: 'success', error: 'danger' }
</script>

<template>
  <PageHeader title="Subir videos" subtitle="Se suben sin cifrar por la VPN; la NAS los corta en fragmentos, los cifra y borra el original.">
    <CButton v-if="subidas.items.some((i) => i.estado === 'listo')" color="secondary" variant="outline" @click="subidas.limpiarListos()">Limpiar terminados</CButton>
    <CButton color="primary" variant="outline" @click="router.push('/videos')">Ver videos</CButton>
  </PageHeader>

  <div
    class="dropzone mb-4"
    :class="{ over: encima }"
    @click="input.click()"
    @dragover.prevent="encima = true"
    @dragleave="encima = false"
    @drop.prevent="soltar"
  >
    <CIcon icon="cil-cloud-upload" size="3xl" class="text-primary mb-2" />
    <div class="fw-semibold">Toca para elegir videos o arrástralos aquí</div>
    <div class="small text-body-secondary">Se suben de a uno; si se corta la conexión, siguen donde iban</div>
    <input ref="input" type="file" accept="video/*" multiple hidden @change="elegir($event.target.files); $event.target.value = ''" />
  </div>

  <CCard v-for="it in subidas.items" :key="it.id" class="mb-2">
    <CCardBody class="py-2">
      <div class="d-flex align-items-center gap-2 mb-1">
        <div class="flex-grow-1 text-truncate fw-semibold" :title="it.nombre">{{ it.nombre }}</div>
        <span class="small text-body-secondary text-nowrap">{{ tamano(it.tam) }}</span>
        <CButton v-if="it.estado === 'error'" color="link" size="sm" @click="subidas.reintentar(it)">Reintentar</CButton>
        <CButton v-if="it.estado !== 'listo'" color="link" size="sm" class="text-danger" @click="subidas.cancelar(it)">Cancelar</CButton>
      </div>
      <CProgress :value="it.progreso" :color="COLOR[it.estado]" height="6" />
      <div class="small mt-1" :class="it.estado === 'error' ? 'text-danger' : 'text-body-secondary'">
        {{ it.estado === 'subiendo' ? `${it.progreso}%` : it.estado === 'listo' ? 'Subido · en cola para cifrar' : it.estado === 'error' ? it.error : 'Esperando' }}
      </div>
    </CCardBody>
  </CCard>
</template>
