// Paneles que se cierran solos tras un rato sin tocarlos (para que lo privado, como las etiquetas, no quede a la
// vista). Cada panel tiene un id; tocar() reinicia su reloj.
import { ref, onBeforeUnmount } from 'vue'

export function useOcultable(ms = 30_000) {
  const abiertos = ref(new Set())
  const relojes = new Map()
  function cerrar(id) {
    clearTimeout(relojes.get(id))
    relojes.delete(id)
    abiertos.value.delete(id)
  }
  function tocar(id) {
    if (!abiertos.value.has(id)) return
    clearTimeout(relojes.get(id))
    relojes.set(id, setTimeout(() => cerrar(id), ms))
  }
  function abrir(id) {
    abiertos.value.add(id)
    tocar(id)
  }
  const alternar = (id) => (abiertos.value.has(id) ? cerrar(id) : abrir(id))
  onBeforeUnmount(() => relojes.forEach(clearTimeout))
  return { abiertos, abrir, cerrar, alternar, tocar }
}
