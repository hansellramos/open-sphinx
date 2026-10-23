<script setup>
import { onBeforeMount } from 'vue'
import { useColorModes } from '@coreui/vue'
import AppToaster from '@/components/common/AppToaster.vue'

const { isColorModeSet, setColorMode } = useColorModes('boveda-theme')
onBeforeMount(() => {
  if (!isColorModeSet()) setColorMode('dark')
})
</script>

<template>
  <router-view />
  <AppToaster />
</template>

<style lang="scss">
@use 'styles/style';
</style>
