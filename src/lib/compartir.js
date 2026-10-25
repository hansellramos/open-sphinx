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

  // `exp`: una exportación del video (más pequeña o con filtro).
  async function compartir(v, file = null, exp = null) {
    const id = `${v.id}:${exp?.id ?? ''}`
    try {
      if (!file && listo?.id === id) file = listo.file
      if (!file) {
        progreso.value = 0
        file = await boveda.paraCompartir(v, (p) => (progreso.value = Math.round(p * 100)), exp)
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

  // Varios a la vez (en el orden dado): se arman uno por uno y van todos en la misma hoja. Todo queda en
  // memoria, así que hay un tope para no tumbar Safari en el iPhone.
  const TOPE = 1.5 * 1024 ** 3
  async function compartirVarios(vs) {
    const id = vs.map((v) => v.id).join(',')
    try {
      let files = listo?.id === id ? listo.file : null
      if (!files) {
        const total = vs.reduce((t, v) => t + (v.size ?? 0), 0)
        if (total > TOPE) throw new Error('Es demasiado para compartir de una vez (más de 1,5 GB): elige menos')
        files = []
        progreso.value = 0
        let hecho = 0
        for (const v of vs) {
          files.push(await boveda.paraCompartir(v, (p) => (progreso.value = Math.round(((hecho + p * (v.size ?? 0)) / (total || 1)) * 100))))
          hecho += v.size ?? 0
          progreso.value = Math.round((hecho / (total || 1)) * 100)
        }
        // Nombres repetidos (p. ej. varias «image.jpg»): la hoja de compartir puede perder alguno.
        const vistos = new Map()
        files = files.map((f) => {
          const n = vistos.get(f.name) ?? 0
          vistos.set(f.name, n + 1)
          return n ? new File([f], f.name.replace(/(\.[^.]+)?$/, `-${n + 1}$1`), { type: f.type }) : f
        })
        listo = { id, file: files }
      }
      progreso.value = null
      await boveda.compartir(files)
      return true
    } catch (e) {
      progreso.value = null
      if (e.name === 'NotAllowedError') toast.info('Ya están listos: toca Compartir otra vez')
      else toast.error(e)
      return false
    }
  }

  return { progreso, compartir, compartirVarios }
}
