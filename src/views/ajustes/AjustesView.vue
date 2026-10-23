<script setup>
import { ref, onMounted } from 'vue'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { errorPasskey } from '@/lib/webauthn'
import PageHeader from '@/components/common/PageHeader.vue'
import CodigoRecuperacion from '@/components/common/CodigoRecuperacion.vue'
import { fecha } from '@/lib/formato'

const auth = useAuthStore()
const toast = useToastStore()
const passkeys = ref([])
const nombre = ref('')
const ocupado = ref(false)
const codigo = ref('')
const confirmarCodigo = ref(false)
const borrar = ref(null)

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
onMounted(cargar)
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

  <CModal :visible="!!borrar" @close="borrar = null" alignment="center">
    <CModalHeader><CModalTitle>¿Quitar la passkey?</CModalTitle></CModalHeader>
    <CModalBody v-if="borrar">Se quita <strong>{{ borrar.name }}</strong>. Ya no podrá entrar ni abrir la bóveda.</CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="ghost" @click="borrar = null">Cancelar</CButton>
      <CButton color="danger" @click="confirmarBorrar">Quitar</CButton>
    </CModalFooter>
  </CModal>
</template>
