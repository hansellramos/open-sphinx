// Compartir un elemento con la hoja del sistema (WhatsApp, etc.). Safari solo deja abrirla poco después de
// tocar el botón: si armar el archivo tardó (un video), queda listo y se pide tocar Compartir otra vez.
import { ref } from 'vue'
import { useBovedaStore } from '@/stores/boveda'
import { useToastStore } from '@/stores/toast'

export function useCompartir() {
  const boveda = useBovedaStore()
  const toast = useToastStore()
  const progreso = ref(null)
  let listo = null // { id, file }

  // `ligera`: la versión 720p de un video.
  async function compartir(v, file = null, ligera = false) {
    const id = `${v.id}:${ligera}`
    try {
      if (!file && listo?.id === id) file = listo.file
      if (!file) {
        progreso.value = 0
        file = await boveda.paraCompartir(v, (p) => (progreso.value = Math.round(p * 100)), ligera)
        listo = { id, file }
      }
      progreso.value = null
      await boveda.compartir(file)
    } catch (e) {
      progreso.value = null
      if (e.name === 'NotAllowedError') toast.info('Ya está listo: toca Compartir otra vez')
      else toast.error(e)
    }
  }

  return { progreso, compartir }
}
