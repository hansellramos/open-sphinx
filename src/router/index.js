import { createRouter, createWebHashHistory } from 'vue-router'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import { useAuthStore } from '@/stores/auth'

const routes = [
  { path: '/configurar', name: 'Configurar', component: () => import('@/views/pages/ConfigurarView.vue'), meta: { public: true } },
  { path: '/entrar', name: 'Entrar', component: () => import('@/views/pages/EntrarView.vue'), meta: { public: true } },
  {
    path: '/',
    component: DefaultLayout,
    redirect: '/galeria',
    children: [
      { path: 'galeria', name: 'Galeria', component: () => import('@/views/boveda/ElementosView.vue') },
      { path: 'archivos', name: 'Archivos', component: () => import('@/views/boveda/ElementosView.vue') },
      { path: 'favoritos', name: 'Favoritos', component: () => import('@/views/boveda/ElementosView.vue') },
      { path: 'etiquetas', name: 'Etiquetas', component: () => import('@/views/boveda/EtiquetasView.vue') },
      { path: 'etiquetas/:id', name: 'Etiqueta', component: () => import('@/views/boveda/ElementosView.vue') },
      { path: 'mapa', name: 'Mapa', component: () => import('@/views/boveda/MapaView.vue') },
      { path: 'ver/:id', name: 'Ver', component: () => import('@/views/boveda/VerView.vue') },
      // Enlaces de antes (cuando solo había videos)
      { path: 'videos', redirect: (to) => ({ path: '/galeria', query: to.query }) },
      { path: 'videos/:id', redirect: (to) => `/ver/${to.params.id}` },
      { path: 'exportados', name: 'Exportados', component: () => import('@/views/boveda/ExportadosView.vue') },
      { path: 'subir', name: 'Subir', component: () => import('@/views/boveda/SubirView.vue') },
      { path: 'ajustes', name: 'Ajustes', component: () => import('@/views/ajustes/AjustesView.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/galeria' },
]

const router = createRouter({ history: createWebHashHistory(), routes, scrollBehavior: () => ({ top: 0 }) })

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  const e = auth.estado ?? (await auth.cargar().catch(() => null))
  if (!e) return true
  if (!e.configurada) {
    // Hay passkey pero no bóveda (se abandonó la configuración): entrar y luego terminarla.
    if (e.passkeys && !e.sesion) return to.name === 'Entrar' ? true : { name: 'Entrar' }
    return to.name === 'Configurar' ? true : { name: 'Configurar' }
  }
  if (to.meta.public) return to.name === 'Configurar' ? { name: 'Entrar' } : true
  if (!e.sesion || !auth.desbloqueada) return { name: 'Entrar', query: to.fullPath !== '/galeria' ? { r: to.fullPath } : {} }
  return true
})

export default router
