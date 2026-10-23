import { createRouter, createWebHashHistory } from 'vue-router'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import { useAuthStore } from '@/stores/auth'

const routes = [
  { path: '/configurar', name: 'Configurar', component: () => import('@/views/pages/ConfigurarView.vue'), meta: { public: true } },
  { path: '/entrar', name: 'Entrar', component: () => import('@/views/pages/EntrarView.vue'), meta: { public: true } },
  {
    path: '/',
    component: DefaultLayout,
    redirect: '/videos',
    children: [
      { path: 'videos', name: 'Videos', component: () => import('@/views/videos/VideosView.vue') },
      { path: 'videos/:id', name: 'Ver', component: () => import('@/views/videos/VerView.vue') },
      { path: 'subir', name: 'Subir', component: () => import('@/views/videos/SubirView.vue') },
      { path: 'ajustes', name: 'Ajustes', component: () => import('@/views/ajustes/AjustesView.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/videos' },
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
  if (!e.sesion || !auth.desbloqueada) return { name: 'Entrar', query: to.fullPath !== '/videos' ? { r: to.fullPath } : {} }
  return true
})

export default router
