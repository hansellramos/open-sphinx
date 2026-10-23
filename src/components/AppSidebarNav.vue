<script setup>
// Menú lateral: secciones fijas + las etiquetas (descifradas) con su conteo.
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import simplebar from 'simplebar-vue'
import 'simplebar-vue/dist/simplebar.min.css'
import { useBovedaStore } from '@/stores/boveda'

const route = useRoute()
const boveda = useBovedaStore()
const fijos = computed(() => [
  { to: '/videos', name: 'Todos los videos', icon: 'cil-video', n: boveda.listos.length },
  { to: '/favoritos', name: 'Favoritos', icon: 'cil-star', n: boveda.favoritos.length },
  { to: '/mapa', name: 'Mapa', icon: 'cil-map' },
  { to: '/subir', name: 'Subir', icon: 'cil-cloud-upload' },
])
const activo = (to) => route.path === to
</script>

<template>
  <CSidebarNav :as="simplebar">
    <CNavItem v-for="i in fijos" :key="i.to">
      <RouterLink :to="i.to" class="nav-link" :class="{ active: activo(i.to) }">
        <CIcon :icon="i.icon" custom-class-name="nav-icon" />{{ i.name }}
        <span v-if="i.n" class="ms-auto small opacity-50">{{ i.n }}</span>
      </RouterLink>
    </CNavItem>
    <CNavTitle>Etiquetas</CNavTitle>
    <CNavItem v-for="t in boveda.etiquetas" :key="t.id">
      <RouterLink :to="`/etiquetas/${t.id}`" class="nav-link" :class="{ active: activo(`/etiquetas/${t.id}`) }">
        <span class="nav-icon d-flex justify-content-center"><span :class="`etiqueta-punto bg-${t.color}`"></span></span>
        <span class="text-truncate">{{ t.name }}</span>
        <span class="ms-auto small opacity-50">{{ t.videos }}</span>
      </RouterLink>
    </CNavItem>
    <li v-if="!boveda.etiquetas.length" class="px-3 small opacity-50">Etiqueta un video para verla aquí</li>
    <CNavTitle>Bóveda</CNavTitle>
    <CNavItem>
      <RouterLink to="/ajustes" class="nav-link" :class="{ active: activo('/ajustes') }"><CIcon icon="cil-settings" custom-class-name="nav-icon" />Ajustes</RouterLink>
    </CNavItem>
  </CSidebarNav>
</template>
