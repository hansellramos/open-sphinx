<script setup>
// Optimizar almacenamiento: los videos, de los que más se ahorraría al pasarlos a 720p a los que menos, con su peso
// y una estimación (la misma del diálogo de exportar, que aprende de lo ya exportado). Desde aquí se abren o se pide
// la exportación de 720p (que luego se puede usar como original). Avisa lo que puede salir mal en la NAS.
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useBovedaStore } from '@/stores/boveda'
import { useExportadosStore } from '@/stores/exportados'
import { useToastStore } from '@/stores/toast'
import PageHeader from '@/components/common/PageHeader.vue'
import Miniatura from '@/components/elementos/Miniatura.vue'
import { duracion, fechaCorta, tamano } from '@/lib/formato'

const ALTO = 720
const router = useRouter()
const boveda = useBovedaStore()
const exportados = useExportadosStore()
const toast = useToastStore()
const soloReducibles = ref(true)
const confirmar = ref(null) // video 4K/largo a confirmar antes de exportar
const pidiendo = ref(null)

const corto = (v) => Math.min(v.m.width ?? 0, v.m.height ?? 0)
// Lo que puede salir mal al hacerlo en la NAS (4 GB de RAM compartidos con Immich y Jellyfin).
function avisos(v) {
  const out = []
  if (corto(v) >= 1440) out.push('4K: decodificarlo puede saturar la NAS (ya pasó con uno). Mejor de noche, sin subidas en curso.')
  if ((v.m.duration ?? 0) > 20 * 60) out.push(`Largo (${duracion(v.m.duration)}): en la NAS puede tardar horas.`)
  return out
}
const filas = computed(() =>
  boveda.galeria
    .filter((v) => boveda.tipo(v) === 'video')
    .map((v) => {
      const reducible = corto(v) > ALTO
      const est = reducible ? exportados.estimar(v, { alto: ALTO }) : null
      const despues = est ? (est.min + est.max) / 2 : v.size
      const exp = exportados.de(v.id).find((e) => e.alto === ALTO && !e.filtro)
      return { v, reducible, est, ahorro: Math.max(0, v.size - despues), exp, avisos: avisos(v) }
    })
    .filter((f) => !soloReducibles.value || f.reducible)
    .sort((a, b) => b.ahorro - a.ahorro || b.v.size - a.v.size),
)
const totales = computed(() => {
  const t = { n: filas.value.length, antes: 0, despues: 0 }
  for (const f of filas.value) {
    t.antes += f.v.size
    t.despues += f.v.size - f.ahorro
  }
  return t
})
const rango = (e) => (e ? `~${tamano(e.min)} – ${tamano(e.max)}` : '')

async function exportar(f, confirmado = false) {
  if (f.avisos.length && !confirmado) return (confirmar.value = f)
  confirmar.value = null
  pidiendo.value = f.v.id
  try {
    await exportados.pedir(f.v, { alto: ALTO })
    toast.ok('En cola: cuando esté lista, ábrelo y «Usar como original»')
  } catch (e) {
    toast.error(e)
  } finally {
    pidiendo.value = null
  }
}

onMounted(async () => {
  try {
    await Promise.all([boveda.cargar(), exportados.cargar()])
  } catch (e) {
    toast.error(e)
  }
})
</script>

<template>
  <PageHeader title="Optimizar" :subtitle="`${totales.n} videos · ${tamano(totales.antes)}${soloReducibles ? ` → ~${tamano(totales.despues)} a ${ALTO}p` : ''}`">
    <CFormCheck id="solo-reducibles" v-model="soloReducibles" label="Solo los que se pueden reducir" />
  </PageHeader>
  <p class="small text-body-secondary">
    Lo estimado sale de lo que pesaron tus exportaciones anteriores (más exacto mientras más hayas hecho). Exportar no borra nada: cuando esté lista,
    ábrelo y elige «Usar como original» para liberar el espacio.
  </p>

  <div v-if="!boveda.cargado" class="text-center py-5"><CSpinner /></div>
  <p v-else-if="!filas.length" class="text-body-secondary">No hay videos para reducir.</p>
  <CListGroup v-else class="mb-4">
    <CListGroupItem v-for="f in filas" :key="f.v.id" class="optimizar-fila">
      <div class="d-flex gap-3 align-items-start">
        <div class="optimizar-mini flex-shrink-0" role="button" title="Abrir" @click="router.push(`/ver/${f.v.id}`)"><Miniatura :item="f.v" /></div>
        <div class="flex-grow-1 min-w-0">
          <div class="fw-semibold text-truncate">{{ fechaCorta(boveda.fechaDe(f.v)) }}</div>
          <div class="small text-body-secondary">
            {{ f.v.m.width && f.v.m.height ? `${f.v.m.width}×${f.v.m.height}` : '' }}<template v-if="f.v.m.duration"> · {{ duracion(f.v.m.duration) }}</template>
          </div>
          <div class="small mt-1">
            <strong>{{ tamano(f.v.size) }}</strong>
            <template v-if="f.reducible"> → {{ rango(f.est) }} a {{ ALTO }}p <span class="text-success">(−{{ tamano(f.ahorro) }})</span></template>
            <span v-else class="text-body-secondary"> · ya es de {{ ALTO }}p o menos</span>
          </div>
          <div v-if="f.v.m.tags?.length || boveda.albumesDe(f.v).length" class="d-flex flex-wrap gap-1 mt-1">
            <span v-for="n in boveda.nombresDe(f.v)" :key="n" class="etq-chip">{{ n }}</span>
            <span v-for="a in boveda.albumesDe(f.v)" :key="a.id" class="etq-chip"><CIcon icon="cil-library" size="sm" />{{ a.name }}</span>
          </div>
          <div v-for="a in f.avisos" :key="a" class="small text-warning mt-1"><CIcon icon="cil-warning" size="sm" class="me-1" />{{ a }}</div>
        </div>
        <div class="d-flex flex-column gap-1 align-items-end flex-shrink-0">
          <CButton color="secondary" variant="outline" size="sm" @click="router.push(`/ver/${f.v.id}`)">Abrir</CButton>
          <template v-if="f.reducible">
            <CButton v-if="f.exp?.status === 'lista'" color="success" variant="outline" size="sm" @click="router.push({ path: `/ver/${f.v.id}`, query: { exp: f.exp.id } })">Lista: usar…</CButton>
            <CBadge v-else-if="f.exp && f.exp.status !== 'error'" color="info">{{ f.exp.status === 'procesando' ? `Creando ${f.exp.progreso}%` : 'En cola' }}</CBadge>
            <CButton v-else color="primary" variant="outline" size="sm" :disabled="pidiendo === f.v.id" @click="exportar(f)">{{ f.exp?.status === 'error' ? 'Reanudar 720p' : 'Exportar 720p' }}</CButton>
          </template>
        </div>
      </div>
    </CListGroupItem>
  </CListGroup>

  <CModal :visible="!!confirmar" alignment="center" @close="confirmar = null">
    <CModalHeader><CModalTitle>¿Exportar en la NAS?</CModalTitle></CModalHeader>
    <CModalBody v-if="confirmar">
      <p v-for="a in confirmar.avisos" :key="a" class="mb-2"><CIcon icon="cil-warning" class="text-warning me-1" />{{ a }}</p>
      <p class="small text-body-secondary mb-0">Si la NAS se pone lenta, la exportación se puede detener y reanudar después desde donde iba.</p>
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="ghost" @click="confirmar = null">Cancelar</CButton>
      <CButton color="warning" @click="exportar(confirmar, true)">Exportar igual</CButton>
    </CModalFooter>
  </CModal>
</template>
