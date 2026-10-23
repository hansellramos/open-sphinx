import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useToastStore = defineStore('toast', () => {
  const items = ref([])
  let id = 0
  const push = (message, color = 'success', title = null) => items.value.push({ id: ++id, message, color, title })
  return {
    items,
    ok: (m, t) => push(m, 'success', t),
    error: (m, t) => push(typeof m === 'string' ? m : m?.message ?? 'Ocurrió un error', 'danger', t ?? 'Error'),
    info: (m, t) => push(m, 'info', t),
  }
})
