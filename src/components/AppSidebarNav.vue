<script setup>
// Menú lateral. Las etiquetas no se listan aquí: se abren desde «Etiquetas».
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import simplebar from 'simplebar-vue'
import 'simplebar-vue/dist/simplebar.min.css'
import { useBovedaStore } from '@/stores/boveda'

const route = useRoute()
const boveda = useBovedaStore()
const fijos = computed(() => [
  { to: '/galeria', name: 'Fotos y videos', icon: 'cil-image', n: boveda.galeria.length },
  { to: '/archivos', name: 'Archivos', icon: 'cil-folder', n: boveda.archivos.length },
  { to: '/favoritos', name: 'Favoritos', icon: 'cil-star', n: boveda.favoritos.length },
  { to: '/albumes', name: 'Álbumes', icon: 'cil-library', n: boveda.albumes.length },
  { to: '/etiquetas', name: 'Etiquetas', icon: 'cil-tags', n: boveda.etiquetas.length },
  { to: '/mapa', name: 'Mapa', icon: 'cil-map' },
  { to: '/subir', name: 'Subir', icon: 'cil-cloud-upload' },
  { to: '/cola', name: 'Cola', icon: 'cil-av-timer', n: boveda.pendientes.length },
  { to: '/exportados', name: 'Exportaciones', icon: 'cil-share-all' },
])
const activo = (to) => route.path === to || (['/etiquetas', '/albumes'].includes(to) && route.path.startsWith(`${to}/`))
</script>

<template>
  <CSidebarNav :as="simplebar">
    <CNavItem v-for="i in fijos" :key="i.to">
      <RouterLink :to="i.to" class="nav-link" :class="{ active: activo(i.to) }">
        <CIcon :icon="i.icon" custom-class-name="nav-icon" />{{ i.name }}
        <span v-if="i.n" class="ms-auto small opacity-50">{{ i.n }}</span>
      </RouterLink>
    </CNavItem>
    <CNavTitle>Bóveda</CNavTitle>
    <CNavItem>
      <RouterLink to="/ajustes" class="nav-link" :class="{ active: activo('/ajustes') }"><CIcon icon="cil-settings" custom-class-name="nav-icon" />Ajustes</RouterLink>
    </CNavItem>
  </CSidebarNav>
</template>
