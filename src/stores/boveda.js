// Contenido de la bóveda descifrado en memoria: metadatos de cada elemento —video, foto o archivo— (tipo,
// título, fecha, ubicación, equipo, etiquetas, favorito) y el catálogo de etiquetas. El servidor solo guarda esto cifrado,
// así que se carga todo de una vez y se filtra aquí. Al bloquear se borra.
import { ref, computed, watch, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { aadParte, decryptBlob, decryptJSON, encryptJSON, newFileKey, nombreParte, sealFileKey } from '@shared/crypto.js'

const COLORES = ['primary', 'success', 'danger', 'warning', 'info', 'secondary', 'dark']
const uuid = () => globalThis.crypto.randomUUID()
const normalizar = (n) => String(n ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)

export const useBovedaStore = defineStore('boveda', () => {
  const auth = useAuthStore()
  const items = ref([]) // { id, size, status, error, createdAt, keyWrap, meta, m }
  const catalogo = ref({ v: 1, tags: [] })
  const cargado = ref(false)
  const metaKey = shallowRef(null)
  const thumbs = new Map() // id → blob URL
  let publicKey = null
  let cargando = null
  let timer = null

  const tipo = (v) => v.m?.kind ?? 'video' // lo anterior a fotos/archivos eran solo videos
  const listos = computed(() => items.value.filter((v) => v.m))
  const galeria = computed(() => listos.value.filter((v) => tipo(v) !== 'archivo'))
  const archivos = computed(() => listos.value.filter((v) => tipo(v) === 'archivo'))
  const pendientes = computed(() => items.value.filter((v) => v.status === 'en_cola' || v.status === 'procesando' || v.status === 'error'))
  const favoritos = computed(() => listos.value.filter((v) => v.m.favorite))
  const etiquetas = computed(() =>
    catalogo.value.tags
      .map((t) => ({ ...t, total: listos.value.filter((v) => v.m.tags?.includes(t.id)).length }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es')),
  )
  const etiqueta = (id) => catalogo.value.tags.find((t) => t.id === id)
  const fechaDe = (v) => v.m?.takenAt ?? v.createdAt

  // ---------- carga ----------

  async function asegurarMetaKey(vault) {
    if (vault.metaKeyWrap) return auth.abrirSellado(vault.metaKeyWrap)
    const fk = await newFileKey()
    try {
      await api.put('/boveda/meta-key', { metaKeyWrap: await sealFileKey(vault.publicKey, fk.raw) })
      return fk.key
    } catch (e) {
      if (e.status !== 409) throw e
      return auth.abrirSellado((await api.get('/boveda')).metaKeyWrap)
    }
  }

  async function descifrar(v, previo) {
    if (previo?.meta === v.meta && previo?.m) return { ...v, m: previo.m }
    if (!v.keyWrap || !v.meta) return { ...v, m: null }
    try {
      return { ...v, m: await decryptJSON(await auth.claveDe(v), v.meta) }
    } catch {
      return { ...v, m: null, error: 'No se pudieron descifrar los metadatos' }
    }
  }

  async function cargar(forzar = false) {
    if (cargado.value && !forzar) return
    cargando ??= (async () => {
      const [vault, lista] = await Promise.all([api.get('/boveda'), api.get('/videos')])
      publicKey = vault.publicKey
      metaKey.value ??= await asegurarMetaKey(vault)
      if (vault.catalog) catalogo.value = await decryptJSON(metaKey.value, vault.catalog)
      const prev = new Map(items.value.map((v) => [v.id, v]))
      items.value = await Promise.all(lista.map((v) => descifrar(v, prev.get(v.id))))
      await migrarLegado(lista)
      cargado.value = true
      programarSondeo()
    })().finally(() => (cargando = null))
    return cargando
  }

  // Mientras haya elementos procesándose, se vuelve a consultar cada 4 s.
  function programarSondeo() {
    clearTimeout(timer)
    if (items.value.some((v) => v.status === 'en_cola' || v.status === 'procesando')) timer = setTimeout(() => cargar(true).catch(() => {}), 4000)
  }

  // Videos del MVP (título/etiquetas sin cifrar): se cifran aquí y el servidor borra lo plano.
  async function migrarLegado(lista) {
    const legado = lista.filter((v) => v.legado && v.keyWrap)
    if (!legado.length) return
    let catalogoCambio = false
    for (const v of legado) {
      const ids = []
      for (const t of v.legado.tags) {
        let tag = catalogo.value.tags.find((x) => x.name.toLowerCase() === t.name.toLowerCase())
        if (!tag) {
          tag = { id: uuid(), name: t.name, color: t.color || 'primary' }
          catalogo.value.tags.push(tag)
          catalogoCambio = true
        }
        ids.push(tag.id)
      }
      const actual = items.value.find((x) => x.id === v.id)
      const base = actual?.m ?? { v: 1, kind: 'video', title: v.legado.title ?? 'video', originalName: v.legado.originalName, takenAt: null, location: null, device: null, duration: v.legado.duration, width: v.legado.width, height: v.legado.height, videoCodec: v.legado.videoCodec, favorite: false, tags: [] }
      await guardarMeta(actual ?? v, { ...base, tags: [...new Set([...(base.tags ?? []), ...ids])] }, true)
    }
    if (catalogoCambio) await guardarCatalogo()
    await api.del('/etiquetas/legado')
  }

  // ---------- escritura (todo se cifra aquí antes de enviarse) ----------

  async function guardarMeta(v, cambios, reemplazar = false) {
    const m = reemplazar ? cambios : { ...v.m, ...cambios }
    const meta = await encryptJSON(await auth.claveDe(v), m)
    const r = await api.put(`/videos/${v.id}/meta`, { meta })
    const i = items.value.findIndex((x) => x.id === v.id)
    if (i >= 0) items.value[i] = { ...items.value[i], ...r, legado: undefined, meta, m }
    return items.value[i]
  }

  async function guardarCatalogo() {
    await api.put('/boveda/catalogo', { catalog: await encryptJSON(metaKey.value, catalogo.value) })
  }

  function idsDe(nombres) {
    const nuevos = []
    const ids = nombres.map(normalizar).filter(Boolean).map((n) => {
      let t = catalogo.value.tags.find((x) => x.name.toLowerCase() === n.toLowerCase())
      if (!t) {
        t = { id: uuid(), name: n, color: COLORES[catalogo.value.tags.length % COLORES.length] }
        catalogo.value.tags.push(t)
        nuevos.push(t)
      }
      return t.id
    })
    return { ids: [...new Set(ids)], nuevos }
  }

  async function asignarEtiquetas(v, nombres) {
    const { ids, nuevos } = idsDe(nombres)
    if (nuevos.length) await guardarCatalogo()
    return guardarMeta(v, { tags: ids })
  }

  const nombresDe = (v) => (v.m?.tags ?? []).map((id) => etiqueta(id)?.name).filter(Boolean)

  async function editarEtiqueta(id, cambios) {
    const t = etiqueta(id)
    if (cambios.name !== undefined) {
      const n = normalizar(cambios.name)
      if (!n) throw new Error('El nombre no puede estar vacío')
      if (catalogo.value.tags.some((x) => x.id !== id && x.name.toLowerCase() === n.toLowerCase())) throw new Error('Ya existe una etiqueta con ese nombre')
      t.name = n
    }
    if (cambios.color && COLORES.includes(cambios.color)) t.color = cambios.color
    await guardarCatalogo()
  }

  async function borrarEtiqueta(id) {
    for (const v of listos.value.filter((v) => v.m.tags?.includes(id))) await guardarMeta(v, { tags: v.m.tags.filter((x) => x !== id) })
    catalogo.value.tags = catalogo.value.tags.filter((t) => t.id !== id)
    await guardarCatalogo()
  }

  const favorito = (v) => guardarMeta(v, { favorite: !v.m.favorite })
  const renombrar = (v, title) => guardarMeta(v, { title: String(title).trim().slice(0, 200) || v.m.title })

  async function borrar(v) {
    await api.del(`/videos/${v.id}`)
    items.value = items.value.filter((x) => x.id !== v.id)
  }

  // ---------- miniaturas (cifradas; se descifran al aparecer en pantalla) ----------

  async function thumbUrl(v) {
    if (tipo(v) === 'archivo') return null
    if (thumbs.has(v.id)) return thumbs.get(v.id)
    const res = await fetch(`/api/videos/${v.id}/archivo/thumb.jpg`, { credentials: 'include' })
    if (!res.ok) return null
    const url = URL.createObjectURL(new Blob([await decryptBlob(await auth.claveDe(v), await res.arrayBuffer())], { type: 'image/jpeg' }))
    thumbs.set(v.id, url)
    return url
  }

  // ---------- originales (fotos y archivos, en partes) ----------

  async function bajar(v, nombre) {
    const res = await fetch(`/api/videos/${v.id}/archivo/${nombre}`, { credentials: 'include' })
    if (!res.ok) throw new Error(res.status === 401 ? 'Sesión expirada' : 'No se pudo bajar el archivo')
    return res.arrayBuffer()
  }

  // Baja y descifra el original parte por parte. Queda entero en memoria: para archivos muy grandes en
  // el iPhone puede quedarse sin RAM.
  async function original(v, progreso) {
    const key = await auth.claveDe(v)
    const n = v.m.parts ?? 1
    const partes = []
    for (let i = 0; i < n; i++) {
      partes.push(await decryptBlob(key, await bajar(v, nombreParte(i)), aadParte(i, n)))
      progreso?.((i + 1) / n)
    }
    return new Blob(partes, { type: v.m.mime || 'application/octet-stream' })
  }

  // Lo que se muestra de una foto: la copia JPEG (HEIC) o el original.
  async function imagen(v) {
    if (!v.m.vista) return original(v)
    return new Blob([await decryptBlob(await auth.claveDe(v), await bajar(v, 'vista.jpg'))], { type: 'image/jpeg' })
  }

  async function descargar(v, progreso) {
    const url = URL.createObjectURL(await original(v, progreso))
    const a = Object.assign(document.createElement('a'), { href: url, download: v.m.originalName || v.m.title })
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  function limpiar() {
    clearTimeout(timer)
    items.value = []
    catalogo.value = { v: 1, tags: [] }
    metaKey.value = null
    cargado.value = false
    for (const u of thumbs.values()) URL.revokeObjectURL(u)
    thumbs.clear()
  }
  watch(
    () => auth.desbloqueada,
    (d) => !d && limpiar(),
  )

  return {
    items, listos, galeria, archivos, pendientes, favoritos, etiquetas, cargado, COLORES,
    tipo, etiqueta, fechaDe, nombresDe, original, imagen, descargar, cargar, guardarMeta, asignarEtiquetas, editarEtiqueta, borrarEtiqueta,
    favorito, renombrar, borrar, thumbUrl, publicKey: () => publicKey,
  }
})
