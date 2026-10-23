<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { errorPasskey } from '@/lib/webauthn'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const ocupado = ref(false)
const error = ref('')
const codigo = ref('')
const pedirCodigo = ref(false)
const conSesion = computed(() => !!auth.estado?.sesion)

function continuar() {
  if (!auth.estado?.configurada) return router.push({ name: 'Configurar' })
  router.push(route.query.r || '/videos')
}

async function entrar() {
  error.value = ''
  ocupado.value = true
  try {
    const r = await auth.entrar()
    if (!auth.estado.configurada) return continuar()
    if (r.desbloqueada) return continuar()
    pedirCodigo.value = true
    if (!r.conPrf) error.value = 'Este navegador no puede abrir la bóveda con la passkey. Usa el código de recuperación.'
  } catch (e) {
    error.value = errorPasskey(e)
  } finally {
    ocupado.value = false
  }
}

async function usarCodigo() {
  error.value = ''
  ocupado.value = true
  try {
    await auth.conRecuperacion(codigo.value)
    codigo.value = ''
    continuar()
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
          <h1 class="h3 mt-3 mb-1">Bóveda</h1>
          <div class="text-body-secondary small">{{ conSesion ? 'La bóveda está bloqueada' : 'Tus videos, cifrados' }}</div>
        </div>
        <CAlert v-if="error" color="danger" class="small">{{ error }}</CAlert>

        <CButton color="primary" size="lg" class="w-100 mb-3" :disabled="ocupado" @click="entrar">
          <CSpinner v-if="ocupado && !pedirCodigo" size="sm" class="me-2" /><CIcon v-else icon="cil-fingerprint" class="me-2" />
          {{ conSesion ? 'Desbloquear con passkey' : 'Entrar con passkey' }}
        </CButton>

        <template v-if="conSesion">
          <div v-if="!pedirCodigo" class="text-center">
            <CButton color="link" size="sm" @click="pedirCodigo = true">Usar el código de recuperación</CButton>
          </div>
          <form v-else @submit.prevent="usarCodigo">
            <CFormLabel for="codigo" class="small">Código de recuperación</CFormLabel>
            <CFormTextarea id="codigo" v-model="codigo" rows="3" class="recovery-code mb-2" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-…" />
            <CButton type="submit" color="secondary" class="w-100" :disabled="ocupado || codigo.replace(/[\s-]/g, '').length < 52">
              <CSpinner v-if="ocupado" size="sm" class="me-2" />Abrir con el código
            </CButton>
          </form>
        </template>
      </CCardBody>
    </CCard>
  </div>
</template>
