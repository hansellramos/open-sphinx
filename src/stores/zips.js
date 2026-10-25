// ZIP con contraseña (tipo Takeout) de varios elementos. Aquí se arma lo que necesita la NAS: la contraseña (al
// azar), la lista con la clave de cada elemento y su nombre dentro del ZIP, y metadatos.json. La lista va solo para
// el trabajo (la NAS la tiene en RAM); en la base quedan el nombre y los ids cifrados con la clave de metadatos y la
// contraseña sellada con la pública, como las claves de los elementos.
import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { useBovedaStore } from '@/stores/boveda'
import { sealFileKey } from '@shared/crypto.js'

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789' // sin 0/O ni 1/l/I
function contrasenaNueva(n = 24) {
  const b = crypto.getRandomValues(new Uint8Array(n * 2))
  let out = ''
  for (const x of b) if (x < 4 * ALFABETO.length && out.length < n) out += ALFABETO[x % ALFABETO.length]
  return out.length === n ? out : contrasenaNueva(n)
}
const fechaArchivo = (d) => new Date(d).toLocaleString('sv').replace(' ', '_').replace(/:/g, '-')
const extension = (n) => (String(n ?? '').match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? '').toLowerCase()
const limpio = (n) => String(n ?? 'archivo').replace(/[\/\\\0]/g, '_').replace(/^\.+/, '_').slice(0, 150) || 'archivo'

export const useZipsStore = defineStore('zips', () => {
  const auth = useAuthStore()
  const boveda = useBovedaStore()
  const items = ref([]) // de la NAS + info: { nombre, ids, fotos, videos }
  const cargada = ref(false)
  let timer = null
  const pendientes = computed(() => items.value.some((z) => ['en_cola', 'procesando', 'creando'].includes(z.status)))
  const ocupado = computed(() => items.value.reduce((s, z) => s + (z.size || 0), 0))

  async function info(z) {
    try {
      return { ...z, info: await boveda.descifrarMeta(z.meta) }
    } catch {
      return { ...z, info: { nombre: 'ZIP', ids: [] } }
    }
  }
  async function cargar() {
    await boveda.cargar()
    items.value = await Promise.all((await api.get('/zips')).map(info))
    cargada.value = true
    programar()
  }
  function programar() {
    clearTimeout(timer)
    if (pendientes.value) timer = setTimeout(() => cargar().catch(() => programar()), 3000)
  }

  // Lo que va en el ZIP y con qué nombre: fotos/ y videos/ por fecha (los nombres se ven sin contraseña en un ZIP),
  // archivos/ con su nombre. Fotos y videos más grandes que lo pedido van más pequeños.
  async function manifiesto(vs, { fotos, videos }, password) {
    const usados = new Set(['metadatos.json'])
    const unico = (n) => {
      let x = n, i = 2
      while (usados.has(x)) x = n.replace(/(\.[^./]+)?$/, `-${i++}$1`)
      usados.add(x)
      return x
    }
    const items = [], metadatos = []
    for (const v of vs) {
      const t = boveda.tipo(v), m = v.m
      const corto = Math.min(m.width ?? 0, m.height ?? 0)
      const alto = t === 'imagen' ? (fotos && corto > fotos ? fotos : null) : t === 'video' ? (videos && corto > videos ? videos : null) : null
      const ext = t === 'video' ? 'mp4' : t === 'imagen' && alto ? 'jpg' : extension(m.originalName) || (t === 'imagen' ? 'jpg' : 'bin')
      const nombre = unico(t === 'archivo' ? `archivos/${limpio(m.originalName || m.title)}` : `${t === 'video' ? 'videos' : 'fotos'}/${fechaArchivo(boveda.fechaDe(v))}.${ext}`)
      items.push({
        id: v.id, clave: await auth.claveCrudaDe(v), nombre, tipo: t, parts: m.parts ?? 1, alto,
        heic: /^(heic|heif)$/.test(extension(m.originalName)) || /hei[cf]/i.test(m.mime ?? ''), rotacion: m.rotacion ?? 0, duracion: m.duration ?? null,
      })
      metadatos.push({
        archivo: nombre, titulo: m.title, nombreOriginal: m.originalName ?? null, tipo: t, fecha: boveda.fechaDe(v), ubicacion: m.location ?? null, equipo: m.device ?? null,
        etiquetas: boveda.nombresDe(v), albumes: boveda.albumesDe(v).map((a) => a.name), nota: m.nota ?? null, favorito: !!m.favorite, ...(alto && { reducido: `${alto}p` }),
      })
    }
    return { password, items, metadatos: JSON.stringify(metadatos, null, 2) }
  }

  // opciones: { nombre, fotos: 1080|720|null, videos: 720|540|480|null }
  async function crear(vs, { nombre, fotos = null, videos = null }) {
    const password = contrasenaNueva()
    const z = await api.post('/zips', {
      meta: await boveda.cifrarMeta({ nombre: String(nombre || 'ZIP').slice(0, 120), ids: vs.map((v) => v.id), fotos, videos }),
      claveSellada: await sealFileKey(boveda.publicKey(), new TextEncoder().encode(password)),
      fotos, videos,
      manifiesto: await manifiesto(vs, { fotos, videos }, password),
    })
    items.value = [await info(z), ...items.value]
    programar()
    return z
  }

  const contrasena = async (z) => new TextDecoder().decode(await auth.abrirSelladoCrudo(JSON.parse(z.claveSellada)))

  // Tras un reinicio o un error: misma contraseña, lo que siga en la bóveda.
  async function reanudar(z) {
    const vs = z.info.ids.map((id) => boveda.listos.find((v) => v.id === id)).filter(Boolean)
    if (!vs.length) throw new Error('Ya no queda nada de lo que tenía')
    const r = await api.post(`/zips/${z.id}/reanudar`, { manifiesto: await manifiesto(vs, { fotos: z.fotos, videos: z.videos }, await contrasena(z)) })
    items.value = await Promise.all(items.value.map((x) => (x.id === z.id ? info(r) : x)))
    programar()
  }

  async function borrar(z) {
    await api.del(`/zips/${z.id}`)
    items.value = items.value.filter((x) => x.id !== z.id)
  }

  watch(
    () => auth.desbloqueada,
    (d) => {
      if (d) return
      clearTimeout(timer)
      items.value = []
      cargada.value = false
    },
  )

  return { items, cargada, ocupado, cargar, crear, contrasena, reanudar, borrar }
})
