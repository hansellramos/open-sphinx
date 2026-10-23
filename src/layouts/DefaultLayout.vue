<script setup>
import { CContainer } from '@coreui/vue'
import AppFooter from '@/components/AppFooter.vue'
import AppHeader from '@/components/AppHeader.vue'
import AppSidebar from '@/components/AppSidebar.vue'
import { useBovedaStore } from '@/stores/boveda'
import { useToastStore } from '@/stores/toast'

// Al entrar se descifra todo el contenido de una vez (lo usan el menú, la lista y el mapa).
const toast = useToastStore()
useBovedaStore().cargar().catch((e) => toast.error(e))
</script>

<template>
  <div>
    <AppSidebar />
    <div class="wrapper d-flex flex-column min-vh-100">
      <AppHeader />
      <div class="body flex-grow-1">
        <CContainer class="px-3 px-md-4" fluid>
          <router-view :key="$route.name === 'Ver' ? $route.fullPath : $route.name" />
        </CContainer>
      </div>
      <AppFooter />
    </div>
  </div>
</template>
