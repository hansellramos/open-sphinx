<script setup>
import { onBeforeMount } from 'vue'
import { useColorModes } from '@coreui/vue'
import { watch } from 'vue'
import { useRouter } from 'vue-router'
import AppToaster from '@/components/common/AppToaster.vue'
import { usePrivacidadStore } from '@/stores/privacidad'
import { useAuthStore } from '@/stores/auth'

const priv = usePrivacidadStore()
const auth = useAuthStore()
const router = useRouter()
// Si se bloqueó (botón o bloqueo automático), a la pantalla de entrada.
watch(
  () => auth.desbloqueada,
  (d) => !d && !router.currentRoute.value.meta.public && router.push({ name: 'Entrar', query: { r: router.currentRoute.value.fullPath } }),
)

const { isColorModeSet, setColorMode } = useColorModes('boveda-theme')
onBeforeMount(() => {
  if (!isColorModeSet()) setColorMode('dark')
})
</script>

<template>
  <router-view />
  <AppToaster />
  <div v-if="priv.cortina" class="cortina"><img src="/favicon.svg" width="72" height="72" alt="" /></div>
</template>

<style lang="scss">
@use 'styles/style';
</style>
