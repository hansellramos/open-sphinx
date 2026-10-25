// Contenido de la bóveda descifrado en memoria: metadatos de cada elemento —video, foto o archivo— (tipo,
// título, fecha, ubicación, equipo, etiquetas, favorito) y el catálogo de etiquetas. El servidor solo guarda esto cifrado,
// así que se carga todo de una vez y se filtra aquí. Al bloquear se borra.
import { ref, computed, watch, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/services/api'
import { sufijoExport } from '@/lib/formato'
import { conRotacion, leerRotacion, sumarRotacion } from '@/lib/rotacion'
import { numerarFragmentos } from '@/lib/fragmentos'
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
  const secuencia = ref([]) // ids en el orden de la última lista vista, para pasar al anterior/siguiente
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
  // Huella (sha256 del original) → elemento, para no subir duplicados. Solo lo procesado desde que existe.
  const huellas = computed(() => new Map(listos.value.filter((v) => v.m.sha256).map((v) => [v.m.sha256, v])))
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
      await aplicarSellados()
      await aplicarAjustes()
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

  // Etiquetas elegidas al subir: llegan selladas con la pública dentro de los metadatos (el worker no
  // puede leerlas). Aquí se abren, se agregan y se quita lo sellado.
  async function aplicarSellados() {
    for (const v of listos.value.filter((x) => x.m.sellado)) {
      try {
        const extra = await decryptJSON(await auth.abrirSellado(v.m.sellado.k), v.m.sellado.d)
        const nuevas = (extra.tags ?? []).filter((id) => etiqueta(id))
        const { sellado, ...m } = v.m
        m.tags = [...new Set([...(m.tags ?? []), ...nuevas])]
        // La fecha elegida a mano manda; la sacada del nombre solo si la foto no traía una propia (EXIF).
        if (extra.takenAt && (extra.manual || !m.takenAt)) m.takenAt = extra.takenAt
        // Si no hay ninguna, la del archivo según el navegador (p. ej. lo guardado de WhatsApp en el iPhone).
        if (!m.takenAt && extra.archivo) Object.assign(m, { takenAt: extra.archivo, fechaOrigen: 'archivo' })
        if (extra.title) m.title = extra.title
        await guardarMeta(v, m, true)
      } catch (e) {
        console.warn('No se pudieron aplicar las etiquetas de la subida', e)
      }
    }
  }

  // Sella algo para que solo la bóveda lo abra (como la clave de un archivo): { k: clave sellada, d: JSON cifrado }.
  async function sellar(obj) {
    const fk = await newFileKey()
    return { k: await sealFileKey(publicKey, fk.raw), d: await encryptJSON(fk.key, obj) }
  }

  // ---------- escritura (todo se cifra aquí antes de enviarse) ----------

  // Cambios hechos desde Subir cuando el archivo ya se estaba subiendo: se aplican cuando aparece procesado
  // (se reconoce por la huella). Solo en memoria: si se recarga la app antes, se pierden.
  const ajustes = new Map() // sha256 → { tags (nombres), takenAt, manual, title? }
  async function aplicarAjuste(v, a) {
    const cambios = { tags: await etiquetasPara(a.tags ?? []) }
    if (a.takenAt && (a.manual || !v.m.takenAt)) cambios.takenAt = a.takenAt
    else if (a.archivo && !v.m.takenAt) Object.assign(cambios, { takenAt: a.archivo, fechaOrigen: 'archivo' })
    if (a.title) cambios.title = a.title
    return guardarMeta(v, cambios)
  }
  async function ajustarPorHuella(sha, a) {
    const v = huellas.value.get(sha)
    if (v && !v.m.sellado) {
      ajustes.delete(sha)
      return aplicarAjuste(v, a)
    }
    ajustes.set(sha, a)
  }
  async function aplicarAjustes() {
    for (const [sha, a] of ajustes) {
      const v = huellas.value.get(sha)
      if (!v || v.m.sellado) continue
      ajustes.delete(sha)
      await aplicarAjuste(v, a).catch((e) => console.warn('No se pudo aplicar el cambio', e))
    }
  }

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

  // Ids de etiquetas por nombre, creando (y guardando) las nuevas.
  async function etiquetasPara(nombres) {
    const { ids, nuevos } = idsDe(nombres)
    if (nuevos.length) await guardarCatalogo()
    return ids
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

  // ?r=: si el video se reemplazó por una exportación, los fragmentos se llaman igual pero son otros; con la
  // marca de readyAt el navegador no usa los viejos de su caché.
  const marca = (v) => `r=${v.readyAt ? Date.parse(v.readyAt) : 0}`
  async function bajar(v, nombre, base = null) {
    const url = base ? `${base}/${nombre}` : `/api/videos/${v.id}/archivo/${nombre}?${marca(v)}`
    const res = await fetch(url, { credentials: 'include' })
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

  // Para compartir (WhatsApp, etc.): la foto como se ve (JPEG si era HEIC), el video armado como un
  // MP4 (init + fragmentos, ya descifrados; `exp` = una exportación del video) y los archivos tal cual. Todo en memoria.
  async function paraCompartir(v, progreso, exp = null) {
    const t = tipo(v)
    const base = (v.m.originalName || v.m.title || 'archivo').replace(/\.[^.]+$/, '')
    if (t === 'imagen') {
      const blob = await imagen(v)
      return new File([blob], v.m.vista ? `${base}.jpg` : v.m.originalName || `${base}.jpg`, { type: blob.type || 'image/jpeg' })
    }
    if (t === 'archivo') return new File([await original(v, progreso)], v.m.originalName || base, { type: v.m.mime || 'application/octet-stream' })
    const key = await auth.claveDe(v)
    const ruta = exp ? `/api/exportados/${exp.id}` : undefined
    const lista = new TextDecoder().decode(await bajar(v, 'index.m3u8', ruta))
    const segs = lista.split('\n').map((l) => l.trim()).filter((l) => /^seg_\d{5}\.m4s$/.test(l))
    // Que el archivo compartido se vea como en la bóveda: giro = el del init + el elegido (meta.rotacion). Las
    // exportaciones ya salen derechas (ffmpeg aplica el del init al recodificar), así que en ellas solo cuenta el elegido.
    const init = new Uint8Array(await decryptBlob(key, await bajar(v, 'init.mp4', ruta)))
    const partes = [conRotacion(init, sumarRotacion(exp ? 0 : leerRotacion(init), v.m.rotacion))]
    let n = 1
    for (let i = 0; i < segs.length; i++) {
      const seg = await decryptBlob(key, await bajar(v, segs[i], ruta))
      n = numerarFragmentos(seg, n)
      partes.push(seg)
      progreso?.((i + 1) / segs.length)
    }
    return new File(partes, `${base}${exp ? sufijoExport(exp) : ''}.mp4`, { type: 'video/mp4' })
  }

  // Hoja de compartir del sistema; si el navegador no la tiene, se descarga.
  async function compartir(file) {
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] })
      } catch (e) {
        if (e.name !== 'AbortError') throw e
      }
      return
    }
    const url = URL.createObjectURL(file)
    const a = Object.assign(document.createElement('a'), { href: url, download: file.name })
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  function limpiar() {
    clearTimeout(timer)
    items.value = []
    secuencia.value = []
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
    huellas, secuencia, marca, ajustarPorHuella, paraCompartir, compartir, tipo, etiqueta, fechaDe, nombresDe, original, imagen, descargar, sellar, etiquetasPara, cargar, guardarMeta, asignarEtiquetas, editarEtiqueta, borrarEtiqueta,
    favorito, renombrar, borrar, thumbUrl, publicKey: () => publicKey,
  }
})
