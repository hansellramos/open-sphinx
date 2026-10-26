<script setup>
import { RouterLink } from 'vue-router'
import icon from '@/assets/brand/icon.svg'
import AppSidebarNav from '@/components/AppSidebarNav.vue'
import { useSidebarStore } from '@/stores/sidebar.js'
import { useBovedaStore } from '@/stores/boveda'

const sidebar = useSidebarStore()
const boveda = useBovedaStore()
</script>

<template>
  <CSidebar
    class="border-end"
    colorScheme="dark"
    position="fixed"
    :unfoldable="sidebar.unfoldable"
    :visible="sidebar.visible"
    @visible-change="(value) => sidebar.toggleVisible(value)"
  >
    <CSidebarHeader class="border-bottom">
      <RouterLink custom to="/" v-slot="{ href, navigate }">
        <CSidebarBrand as="a" :href="href" @click="navigate" class="d-flex align-items-center gap-2 text-decoration-none text-white">
          <!-- En modo Horus, la esfinge mira hacia el otro lado (la única señal). -->
          <img :src="icon" height="32" alt="" class="logo-esfinge" :class="{ 'logo-horus': boveda.horus }" />
          <span class="sidebar-brand-text">Esfinge</span>
        </CSidebarBrand>
      </RouterLink>
      <CCloseButton class="d-lg-none" dark @click="sidebar.toggleVisible()" />
    </CSidebarHeader>
    <AppSidebarNav />
    <CSidebarFooter class="border-top d-none d-lg-flex">
      <CSidebarToggler @click="sidebar.toggleUnfoldable()" />
    </CSidebarFooter>
  </CSidebar>
</template>

<style scoped>
.logo-horus {
  transform: scaleX(-1);
}
</style>
