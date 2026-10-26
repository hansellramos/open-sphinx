<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { errorPasskey } from '@/lib/webauthn'
import PageHeader from '@/components/common/PageHeader.vue'
import CodigoRecuperacion from '@/components/common/CodigoRecuperacion.vue'
import { fecha, fechaCorta } from '@/lib/formato'
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
// Modo Horus: elegir qué se ve (etiquetas y/o álbumes), activarlo y salir con la passkey.
const eligeEtq = ref([])
const eligeAlb = ref([])
const confirmarHorus = ref(false)
const horusOcupado = ref(false)
const totalHorus = computed(() => {
  const ids = new Set()
  for (const v of boveda.listos) if (v.m.tags?.some((t) => eligeEtq.value.includes(t))) ids.add(v.id)
  for (const a of boveda.albumes) if (eligeAlb.value.includes(a.id)) for (const v of a.elementos) ids.add(v.id)
  return ids.size
})
async function activarHorus() {
  confirmarHorus.value = false
  horusOcupado.value = true
  try {
    await boveda.activarHorus({ etiquetas: eligeEtq.value, albumes: eligeAlb.value })
    eligeEtq.value = []
    eligeAlb.value = []
    toast.ok('Modo Horus activo en todos tus dispositivos')
  } catch (e) {
    toast.error(e)
  } finally {
    horusOcupado.value = false
  }
}
async function salirHorus() {
  horusOcupado.value = true
  try {
    await boveda.salirHorus()
    toast.ok('Saliste del modo Horus: se ve todo otra vez')
    cargar().catch(() => {})
  } catch (e) {
    toast.error(errorPasskey(e))
  } finally {
    horusOcupado.value = false
  }
}

onMounted(async () => {
  try {
    await boveda.cargar()
    if (!boveda.horus) await cargar()
  } catch (e) {
    toast.error(e)
  }
})
</script>

<template>
  <PageHeader title="Ajustes" />

  <CCard class="mb-4 horus-card">
    <CCardHeader class="fw-semibold">Modo Horus</CCardHeader>
    <CCardBody v-if="boveda.horus">
      <p class="mb-2">Activo desde el {{ fechaCorta(boveda.horus.desde) }} en todos tus dispositivos: solo se ve lo elegido.</p>
      <p class="small text-body-secondary">Para volver a ver todo, confirma con tu passkey. Las etiquetas que se crearon durante el modo se unen a las que ya tenías.</p>
      <CButton color="primary" :disabled="horusOcupado" @click="salirHorus"><CSpinner v-if="horusOcupado" size="sm" class="me-1" />Salir del modo Horus</CButton>
    </CCardBody>
    <CCardBody v-else>
      <p class="small text-body-secondary">
        Muestra solo unas etiquetas o álbumes (por ejemplo, para enseñar fotos del trabajo). Todo lo demás se oculta en todos tus dispositivos,
        incluidos los nombres de las otras etiquetas, hasta que salgas desde aquí con tu passkey. Durante el modo solo se mira, se sube (entra a lo
        elegido) y se etiqueta.
      </p>
      <div class="row g-3">
        <div class="col-md-6">
          <div class="fw-semibold small mb-1">Etiquetas</div>
          <div v-if="!boveda.etiquetas.length" class="small text-body-secondary">No hay etiquetas.</div>
          <div v-for="e in boveda.etiquetas" :key="e.id" class="form-check">
            <input :id="`horus-e-${e.id}`" v-model="eligeEtq" class="form-check-input" type="checkbox" :value="e.id" />
            <label class="form-check-label" :for="`horus-e-${e.id}`">{{ e.name }} <span class="text-body-secondary small">({{ e.total }})</span></label>
          </div>
        </div>
        <div class="col-md-6">
          <div class="fw-semibold small mb-1">Álbumes</div>
          <div v-if="!boveda.albumes.length" class="small text-body-secondary">No hay álbumes.</div>
          <div v-for="a in boveda.albumes" :key="a.id" class="form-check">
            <input :id="`horus-a-${a.id}`" v-model="eligeAlb" class="form-check-input" type="checkbox" :value="a.id" />
            <label class="form-check-label" :for="`horus-a-${a.id}`">{{ a.name }} <span class="text-body-secondary small">({{ a.total }})</span></label>
          </div>
        </div>
      </div>
      <CButton color="primary" class="mt-3" :disabled="!totalHorus || horusOcupado" @click="confirmarHorus = true">Activar modo Horus{{ totalHorus ? ` (${totalHorus})` : '' }}</CButton>
    </CCardBody>
  </CCard>

  <template v-if="!boveda.horus">

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
      <p class="small text-body-secondary mt-3">Al salir de la app (app switcher, otra app, pantalla apagada) se tapa todo y se pausa lo que se esté reproduciendo. Si vuelves después de este tiempo, se bloquea y pide la passkey (0 = siempre).</p>
      <div class="d-flex align-items-center gap-2" style="max-width: 20rem">
        <CFormInput type="number" min="0" step="15" :model-value="priv.autobloqueo" @change="priv.setAutobloqueo($event.target.value)" />
        <span class="small text-nowrap">segundos fuera de la app</span>
      </div>
    </CCardBody>
  </CCard>

  <CCard class="mb-4">
    <CCardHeader class="fw-semibold">Etiquetas</CCardHeader>
    <CCardBody>
      <p class="small text-body-secondary">Van cifradas: el servidor no ve sus nombres ni a qué pertenecen.</p>
      <p v-if="!boveda.etiquetas.length" class="small text-body-secondary mb-0">Aún no hay etiquetas. Se crean al etiquetar algo.</p>
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
        <span class="small text-body-secondary text-nowrap">{{ e.total }} elemento{{ e.total === 1 ? '' : 's' }}</span>
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
    <CModalBody v-if="borrarEtq">Se quita <strong>{{ borrarEtq.name }}</strong> de {{ borrarEtq.total }} elemento(s). No se borra ninguno.</CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="ghost" @click="borrarEtq = null">Cancelar</CButton>
      <CButton color="danger" @click="confirmarBorrarEtq">Borrar</CButton>
    </CModalFooter>
  </CModal>

  </template>

  <CModal :visible="confirmarHorus" alignment="center" @close="confirmarHorus = false">
    <CModalHeader><CModalTitle>¿Activar el modo Horus?</CModalTitle></CModalHeader>
    <CModalBody>
      Solo se verán <strong>{{ totalHorus }}</strong> {{ totalHorus === 1 ? 'elemento' : 'elementos' }}, en este y en tus otros dispositivos. Para volver a ver todo
      tendrás que venir a Ajustes y confirmar con tu passkey.
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="ghost" @click="confirmarHorus = false">Cancelar</CButton>
      <CButton color="primary" @click="activarHorus">Activar</CButton>
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
