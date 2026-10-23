<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { errorPasskey, soportaPasskeys } from '@/lib/webauthn'
import CodigoRecuperacion from '@/components/common/CodigoRecuperacion.vue'

const auth = useAuthStore()
const router = useRouter()
const paso = ref(1) // 1 passkey · 2 crear bóveda · 3 código
const nombre = ref(/iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Mac/.test(navigator.userAgent) ? 'Mac' : 'Passkey')
const ocupado = ref(false)
const error = ref('')
const prf = ref(null)
const sinPrf = ref(false)
const codigo = ref('')

onMounted(() => {
  // Ya hay passkey y sesión pero falta la bóveda (configuración interrumpida).
  if (auth.estado?.passkeys && auth.estado?.sesion) paso.value = 2
})

async function crearPasskey() {
  error.value = ''
  ocupado.value = true
  try {
    const r = await auth.registrarPasskey(nombre.value)
    prf.value = r.prf
    sinPrf.value = !r.prf
    paso.value = 2
    if (r.prf) await crearBoveda()
  } catch (e) {
    error.value = errorPasskey(e)
  } finally {
    ocupado.value = false
  }
}

async function crearBoveda() {
  error.value = ''
  ocupado.value = true
  try {
    codigo.value = await auth.crearBoveda({ prf: prf.value })
    paso.value = 3
  } catch (e) {
    error.value = e.message
  } finally {
    ocupado.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <CCard class="auth-card shadow-lg">
      <CCardBody class="p-4">
        <div class="text-center mb-4">
          <img src="/favicon.svg" width="56" height="56" alt="" />
          <h1 class="h3 mt-3 mb-1">Configurar la Bóveda</h1>
          <div class="text-body-secondary small">Paso {{ paso }} de 3</div>
        </div>

        <CAlert v-if="!soportaPasskeys()" color="danger">Este navegador no soporta passkeys.</CAlert>
        <CAlert v-if="error" color="danger" class="small">{{ error }}</CAlert>

        <template v-if="paso === 1">
          <p class="small text-body-secondary">
            Vas a entrar con una <strong>passkey</strong> (Face ID / Touch ID). La misma passkey abre la clave que descifra todo;
            el servidor nunca la ve.
          </p>
          <CFormLabel for="nombre">Nombre de esta passkey</CFormLabel>
          <CFormInput id="nombre" v-model="nombre" class="mb-3" maxlength="60" />
          <CButton color="primary" class="w-100" :disabled="ocupado || !nombre.trim()" @click="crearPasskey">
            <CSpinner v-if="ocupado" size="sm" class="me-2" /><CIcon v-else icon="cil-fingerprint" class="me-2" />Crear passkey
          </CButton>
        </template>

        <template v-else-if="paso === 2">
          <CAlert v-if="sinPrf" color="warning" class="small">
            Este navegador no permite abrir la bóveda con la passkey (le falta la extensión PRF). Igual puedes crearla:
            para entrar aquí usarás el <strong>código de recuperación</strong>. En Safari (iPhone/Mac) o Chrome recientes sí funciona la passkey.
          </CAlert>
          <p class="small text-body-secondary">Ahora se crea la clave de la bóveda en este dispositivo. Al servidor solo llega la parte pública, que sirve para cifrar.</p>
          <CButton color="primary" class="w-100" :disabled="ocupado" @click="crearBoveda">
            <CSpinner v-if="ocupado" size="sm" class="me-2" />Crear la bóveda
          </CButton>
        </template>

        <CodigoRecuperacion v-else :codigo="codigo" @listo="router.push('/galeria')" />
      </CCardBody>
    </CCard>
  </div>
</template>
