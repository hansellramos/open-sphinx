<script setup>
import { useRouter } from 'vue-router'
import { useColorModes } from '@coreui/vue'
import { useSidebarStore } from '@/stores/sidebar.js'
import { useAuthStore } from '@/stores/auth'
import { useSubidasStore } from '@/stores/subidas'
import { usePrivacidadStore } from '@/stores/privacidad'

const { colorMode, setColorMode } = useColorModes('boveda-theme')
const sidebar = useSidebarStore()
const auth = useAuthStore()
const subidas = useSubidasStore()
const router = useRouter()
const priv = usePrivacidadStore()

function bloquear() {
  auth.bloquear() // App.vue lleva a la pantalla de entrada
}
async function salir() {
  await auth.salir()
  router.push({ name: 'Entrar' })
}
</script>

<template>
  <CHeader position="sticky" class="mb-4 p-0">
    <CContainer class="border-bottom px-3 px-md-4 flex-nowrap" fluid>
      <CHeaderToggler @click="sidebar.toggleVisible()" style="margin-inline-start: -14px">
        <CIcon icon="cil-menu" size="lg" />
      </CHeaderToggler>
      <RouterLink v-if="subidas.activa" to="/subir" class="ms-2 small text-body-secondary text-decoration-none">
        <CSpinner size="sm" class="me-1" /> Subiendo…
      </RouterLink>
      <CHeaderNav class="ms-auto d-flex align-items-center gap-1">
        <div class="d-flex align-items-center gap-2 me-2" :title="priv.segundos ? `Se vuelve a difuminar tras ${priv.segundos} s sin actividad` : ''">
          <CFormSwitch id="difuminar" :model-value="priv.difuminar" class="mb-0" @update:model-value="priv.set" />
          <label for="difuminar" class="small text-body-secondary mb-0 d-none d-sm-inline">Difuminar</label>
        </div>
        <CButton color="link" class="text-body-secondary" :title="colorMode === 'dark' ? 'Modo claro' : 'Modo oscuro'" @click="setColorMode(colorMode === 'dark' ? 'light' : 'dark')">
          <CIcon :icon="colorMode === 'dark' ? 'cil-sun' : 'cil-moon'" size="lg" />
        </CButton>
        <CButton color="secondary" variant="outline" size="sm" @click="bloquear"><CIcon icon="cil-lock-locked" class="me-1" />Bloquear</CButton>
        <CButton color="link" class="text-body-secondary" title="Cerrar sesión" @click="salir"><CIcon icon="cil-account-logout" size="lg" /></CButton>
      </CHeaderNav>
    </CContainer>
  </CHeader>
</template>
