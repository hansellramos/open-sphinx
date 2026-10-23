<script setup>
import { ref, onMounted } from 'vue'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { errorPasskey } from '@/lib/webauthn'
import PageHeader from '@/components/common/PageHeader.vue'
import CodigoRecuperacion from '@/components/common/CodigoRecuperacion.vue'
import { fecha } from '@/lib/formato'
import { useBovedaStore } from '@/stores/boveda'
import { usePrivacidadStore } from '@/stores/privacidad'

const auth = useAuthStore()
const toast = useToastStore()
const passkeys = ref([])
const nombre = ref('')
const ocupado = ref(false)
const codigo = ref('')
const confirmarCodigo = ref(false)
const borrar = ref(null)
const boveda = useBovedaStore()
const priv = usePrivacidadStore()
const borrarEtq = ref(null)

async function guardarEtiqueta(e, cambios) {
  try {
    await boveda.editarEtiqueta(e.id, cambios)
  } catch (err) {
    toast.error(err)
  }
}
async function confirmarBorrarEtq() {
  try {
    await boveda.borrarEtiqueta(borrarEtq.value.id)
  } catch (e) {
    toast.error(e)
  }
  borrarEtq.value = null
}

const cargar = async () => (passkeys.value = await api.get('/auth/credenciales'))

async function agregar() {
  ocupado.value = true
  try {
    const r = await auth.agregarPasskey(nombre.value.trim() || 'Passkey')
    toast.ok(r.conPrf ? 'Passkey agregada; también abre la bóveda' : 'Passkey agregada, pero este navegador no da PRF: solo sirve para entrar')
    nombre.value = ''
    cargar()
  } catch (e) {
    toast.error(errorPasskey(e))
  } finally {
    ocupado.value = false
  }
}
async function renombrar(p) {
  await api.put(`/auth/credenciales/${encodeURIComponent(p.id)}`, { name: p.name }).catch((e) => toast.error(e))
}
async function confirmarBorrar() {
  try {
    await api.del(`/auth/credenciales/${encodeURIComponent(borrar.value.id)}`)
    borrar.value = null
    cargar()
  } catch (e) {
    toast.error(e)
  }
}
async function generarCodigo() {
  confirmarCodigo.value = false
  try {
    codigo.value = await auth.nuevoCodigo()
  } catch (e) {
    toast.error(e)
  }
}
onMounted(() => Promise.all([cargar(), boveda.cargar()]).catch((e) => toast.error(e)))
</script>

<template>
  <PageHeader title="Ajustes" />

  <CCard class="mb-4">
    <CCardHeader class="fw-semibold">Passkeys</CCardHeader>
    <CCardBody>
      <p class="small text-body-secondary">
        Ten al menos dos: por ejemplo la de iCloud (iPhone/Mac) y otra en un gestor de contraseñas o una llave física.
        Las que dicen <CBadge color="success">abre la bóveda</CBadge> sirven para descifrar sin el código de recuperación.
      </p>
      <CTable responsive class="align-middle">
        <CTableBody>
          <CTableRow v-for="p in passkeys" :key="p.id">
            <CTableDataCell style="min-width: 10rem">
              <CFormInput v-model="p.name" size="sm" @change="renombrar(p)" />
            </CTableDataCell>
            <CTableDataCell>
              <CBadge v-if="p.prf" color="success">abre la bóveda</CBadge>
              <CBadge v-else color="secondary">solo entrar</CBadge>
              <CBadge v-if="p.actual" color="info" class="ms-1">esta sesión</CBadge>
            </CTableDataCell>
            <CTableDataCell class="small text-body-secondary text-nowrap">{{ p.lastUsedAt ? `usada ${fecha(p.lastUsedAt)}` : `creada ${fecha(p.createdAt)}` }}</CTableDataCell>
            <CTableDataCell class="text-end">
              <CButton v-if="!p.actual && passkeys.length > 1" color="link" size="sm" class="text-danger" @click="borrar = p"><CIcon icon="cil-trash" /></CButton>
            </CTableDataCell>
          </CTableRow>
        </CTableBody>
      </CTable>
      <div class="d-flex gap-2" style="max-width: 28rem">
        <CFormInput v-model="nombre" placeholder="Nombre (ej. 1Password)" maxlength="60" />
        <CButton color="primary" class="text-nowrap" :disabled="ocupado" @click="agregar">
          <CSpinner v-if="ocupado" size="sm" class="me-1" /><CIcon v-else icon="cil-plus" class="me-1" />Agregar
        </CButton>
      </div>
    </CCardBody>
  </CCard>

  <CCard class="mb-4">
    <CCardHeader class="fw-semibold">Privacidad</CCardHeader>
    <CCardBody>
      <p class="small text-body-secondary">Las miniaturas se difuminan al entrar y al bloquear. Si las muestras, vuelven a difuminarse tras este tiempo sin tocar nada (0 = nunca). Se guarda en este dispositivo.</p>
      <div class="d-flex align-items-center gap-2" style="max-width: 20rem">
        <CFormInput type="number" min="0" step="5" :model-value="priv.segundos" @change="priv.setSegundos($event.target.value)" />
        <span class="small text-nowrap">segundos sin actividad</span>
      </div>
      <p class="small text-body-secondary mt-3">Al salir de la app (app switcher, otra app, pantalla apagada) se tapa todo y se pausa el video. Si vuelves después de este tiempo, se bloquea y pide la passkey (0 = siempre).</p>
      <div class="d-flex align-items-center gap-2" style="max-width: 20rem">
        <CFormInput type="number" min="0" step="15" :model-value="priv.autobloqueo" @change="priv.setAutobloqueo($event.target.value)" />
        <span class="small text-nowrap">segundos fuera de la app</span>
      </div>
    </CCardBody>
  </CCard>

  <CCard class="mb-4">
    <CCardHeader class="fw-semibold">Etiquetas</CCardHeader>
    <CCardBody>
      <p class="small text-body-secondary">Van cifradas: el servidor no ve sus nombres ni a qué videos pertenecen.</p>
      <p v-if="!boveda.etiquetas.length" class="small text-body-secondary mb-0">Aún no hay etiquetas. Se crean al etiquetar un video.</p>
      <div v-for="e in boveda.etiquetas" :key="e.id" class="d-flex align-items-center gap-2 mb-2" style="max-width: 36rem">
        <CFormInput :model-value="e.name" size="sm" maxlength="40" @change="guardarEtiqueta(e, { name: $event.target.value })" />
        <div class="d-flex gap-1">
          <button
            v-for="c in boveda.COLORES"
            :key="c"
            type="button"
            :class="['btn', 'btn-sm', `btn-${c}`, 'p-0', 'rounded-circle', { 'border border-2 border-white': e.color === c }]"
            style="width: 1.3rem; height: 1.3rem"
            :title="c"
            @click="guardarEtiqueta(e, { color: c })"
          ></button>
        </div>
        <span class="small text-body-secondary text-nowrap">{{ e.videos }} video{{ e.videos === 1 ? '' : 's' }}</span>
        <CButton color="link" size="sm" class="text-danger" @click="borrarEtq = e"><CIcon icon="cil-trash" /></CButton>
      </div>
    </CCardBody>
  </CCard>

  <CCard class="mb-4">
    <CCardHeader class="fw-semibold">Código de recuperación</CCardHeader>
    <CCardBody>
      <template v-if="!codigo">
        <p class="small text-body-secondary">Si lo perdiste o crees que alguien lo vio, genera uno nuevo. El anterior deja de funcionar.</p>
        <CButton color="warning" variant="outline" @click="confirmarCodigo = true">Generar un código nuevo</CButton>
      </template>
      <CodigoRecuperacion v-else :codigo="codigo" @listo="codigo = ''" />
    </CCardBody>
  </CCard>

  <CModal :visible="confirmarCodigo" @close="confirmarCodigo = false" alignment="center">
    <CModalHeader><CModalTitle>¿Generar un código nuevo?</CModalTitle></CModalHeader>
    <CModalBody>El código actual dejará de servir. Asegúrate de guardar el nuevo.</CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="ghost" @click="confirmarCodigo = false">Cancelar</CButton>
      <CButton color="warning" @click="generarCodigo">Generar</CButton>
    </CModalFooter>
  </CModal>

  <CModal :visible="!!borrarEtq" @close="borrarEtq = null" alignment="center">
    <CModalHeader><CModalTitle>¿Borrar la etiqueta?</CModalTitle></CModalHeader>
    <CModalBody v-if="borrarEtq">Se quita <strong>{{ borrarEtq.name }}</strong> de {{ borrarEtq.videos }} video(s). Los videos no se borran.</CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="ghost" @click="borrarEtq = null">Cancelar</CButton>
      <CButton color="danger" @click="confirmarBorrarEtq">Borrar</CButton>
    </CModalFooter>
  </CModal>

  <CModal :visible="!!borrar" @close="borrar = null" alignment="center">
    <CModalHeader><CModalTitle>¿Quitar la passkey?</CModalTitle></CModalHeader>
    <CModalBody v-if="borrar">Se quita <strong>{{ borrar.name }}</strong>. Ya no podrá entrar ni abrir la bóveda.</CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="ghost" @click="borrar = null">Cancelar</CButton>
      <CButton color="danger" @click="confirmarBorrar">Quitar</CButton>
    </CModalFooter>
  </CModal>
</template>
