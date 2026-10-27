// Contenido de la bóveda descifrado en memoria: metadatos de cada elemento —video, foto o archivo— (tipo,
// título, fecha, ubicación, equipo, etiquetas, favorito) y el catálogo de etiquetas y álbumes. El servidor solo guarda esto cifrado,
// así que se carga todo de una vez y se filtra aquí. Al bloquear se borra.
import { ref, computed, watch, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { api, alCambiarHorus } from '@/services/api'
import { usarPasskey } from '@/lib/webauthn'
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
  const catalogo = ref({ v: 1, tags: [], albumes: [] })
  const cargado = ref(false)
  const horus = ref(null) // modo Horus activo (en toda la bóveda): { desde, n } o null
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
  // Sin etiqueta: sin ninguna que exista en el catálogo (las de etiquetas borradas no cuentan).
  const sinEtiqueta = computed(() => {
    const ids = new Set(catalogo.value.tags.map((t) => t.id))
    return listos.value.filter((v) => !v.m.tags?.some((id) => ids.has(id)))
  })
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
      catalogo.value = vault.catalog ? await decryptJSON(metaKey.value, vault.catalog) : { v: 1, tags: [], albumes: [] }
      catalogo.value.albumes ??= []
      horus.value = vault.horus
      const prev = new Map(items.value.map((v) => [v.id, v]))
      items.value = await Promise.all(lista.map((v) => descifrar(v, prev.get(v.id))))
      if (vault.catalogoPendiente) await fusionarHorus(vault.catalogoPendiente)
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
    const aAlbumes = new Map() // álbum → ids elegidos al subir
    for (const v of listos.value.filter((x) => x.m.sellado)) {
      try {
        const extra = await decryptJSON(await auth.abrirSellado(v.m.sellado.k), v.m.sellado.d)
        const nuevas = (extra.tags ?? []).map((id) => catalogo.value.alias?.[id] ?? id).filter((id) => etiqueta(id))
        const { sellado, ...m } = v.m
        m.tags = [...new Set([...(m.tags ?? []), ...nuevas])]
        // La fecha elegida a mano manda; la sacada del nombre solo si la foto no traía una propia (EXIF).
        if (extra.takenAt && (extra.manual || !m.takenAt)) m.takenAt = extra.takenAt
        // Si no hay ninguna, la del archivo según el navegador (p. ej. lo guardado de WhatsApp en el iPhone).
        if (!m.takenAt && extra.archivo) Object.assign(m, { takenAt: extra.archivo, fechaOrigen: 'archivo' })
        if (typeof extra.nota === 'string' && extra.nota) m.nota = extra.nota.slice(0, 2000)
        for (const a of extra.albumes ?? []) aAlbumes.set(a, [...(aAlbumes.get(a) ?? []), v.id])
        if (extra.title) m.title = extra.title
        await guardarMeta(v, m, true)
      } catch (e) {
        console.warn('No se pudieron aplicar las etiquetas de la subida', e)
      }
    }
    // Álbumes elegidos al subir (los que ya no existan se ignoran); un solo guardado del catálogo.
    let cambio = false
    for (const [id, ids] of aAlbumes) {
      const a = catalogo.value.albumes.find((x) => x.id === id)
      if (!a) continue
      a.items = [...new Set([...a.items, ...ids])]
      cambio = true
    }
    if (cambio) await guardarCatalogo().catch((e) => console.warn('No se pudieron agregar a los álbumes', e))
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
    if (a.nota) cambios.nota = a.nota
    const r = await guardarMeta(v, cambios)
    const alb = (a.albumes ?? []).filter((id) => catalogo.value.albumes.some((x) => x.id === id))
    if (alb.length) await asignarAlbumes([v.id], Object.fromEntries(alb.map((id) => [id, true])))
    return r
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
    // En modo Horus las etiquetas que no se ven siguen ahí (vuelven a verse al salir).
    const ocultas = horus.value ? (v.m.tags ?? []).filter((id) => !etiqueta(id)) : []
    return guardarMeta(v, { tags: [...ids, ...ocultas] })
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

  // ---------- modo Horus (ver server/lib/horus.ts) ----------
  // Se elige qué mostrar (etiquetas y/o álbumes); el servidor guarda qué elementos se pueden ver y un catálogo
  // reducido (solo lo elegido, cifrado aquí), y lo hace cumplir en todos los dispositivos hasta salir con una passkey.
  // Durante el modo se puede subir (entra a lo elegido) y etiquetar; las etiquetas nuevas van al catálogo reducido
  // y al salir se unen al completo (por nombre: si ya existía, queda una sola).
  const foco = computed(() => (horus.value ? (catalogo.value.foco ?? { etiquetas: [], albumes: [] }) : null))

  async function activarHorus({ etiquetas: tags = [], albumes: albs = [] }) {
    const ids = new Set()
    for (const v of listos.value) if (v.m.tags?.some((t) => tags.includes(t))) ids.add(v.id)
    for (const a of catalogo.value.albumes.filter((x) => albs.includes(x.id))) for (const id of a.items) if (porId.value.has(id)) ids.add(id)
    if (!ids.size) throw new Error('Lo elegido no tiene fotos, videos ni archivos')
    const reducido = {
      v: 1,
      tags: catalogo.value.tags.filter((t) => tags.includes(t.id)),
      albumes: catalogo.value.albumes.filter((a) => albs.includes(a.id)).map((a) => ({ ...a, items: a.items.filter((id) => ids.has(id)) })),
      foco: { etiquetas: tags, albumes: albs },
    }
    await api.post('/horus', { ids: [...ids], catalogo: await encryptJSON(metaKey.value, reducido) })
    await cargar(true)
  }

  async function salirHorus() {
    const opts = await api.post('/horus/salir/opciones')
    const { json } = await usarPasskey(opts)
    await api.post('/horus/salir', { response: json })
    await cargar(true)
  }

  // Une el catálogo reducido que quedó al salir con el completo: etiquetas nuevas (si ya había una con ese nombre,
  // las fotos pasan a esa y queda un alias para lo que todavía se esté procesando) y lo agregado a los álbumes.
  async function fusionarHorus(cifrado) {
    const h = await decryptJSON(metaKey.value, cifrado)
    const c = catalogo.value
    c.alias ??= {}
    const mapa = {}
    for (const t of h.tags ?? []) {
      if (c.tags.some((x) => x.id === t.id)) continue
      const igual = c.tags.find((x) => x.name.toLowerCase() === t.name.toLowerCase())
      if (igual) mapa[t.id] = c.alias[t.id] = igual.id
      else c.tags.push(t)
    }
    for (const a of h.albumes ?? []) {
      const b = c.albumes.find((x) => x.id === a.id)
      if (b) b.items = [...new Set([...b.items, ...a.items])]
    }
    await api.put('/boveda/catalogo', { catalog: await encryptJSON(metaKey.value, c), fusion: true })
    const cambiar = listos.value.filter((v) => v.m.tags?.some((id) => mapa[id]))
    if (cambiar.length) await editarVarios(cambiar, (v) => ({ tags: [...new Set(v.m.tags.map((id) => mapa[id] ?? id))] }))
  }

  // Se activó o se salió desde otro dispositivo: recargar todo (y salir de lo que ya no existe).
  alCambiarHorus(() => {
    if (!cargado.value) return
    cargar(true)
      .then(async () => {
        const { default: router, FUERA_DE_HORUS } = await import('@/router')
        if (horus.value && FUERA_DE_HORUS.includes(router.currentRoute.value.name)) router.replace('/galeria')
        else if (horus.value && router.currentRoute.value.name === 'Ver' && !porId.value.has(router.currentRoute.value.params.id)) router.replace('/galeria')
      })
      .catch(() => {})
  })

  // ---------- álbumes (en el catálogo cifrado) ----------
  // { id, name, descripcion, items: [ids], portada: id | null, fechas: null (las de sus fotos) | { desde, hasta }
  //   (YYYY-MM-DD, elegidas a mano), ubicaciones: [{ lat, lon, nombre }], creado }
  // Lo que se borró de la bóveda se ignora (y se limpia al guardar el álbum).
  const porId = computed(() => new Map(listos.value.map((v) => [v.id, v])))
  const albumes = computed(() =>
    catalogo.value.albumes
      .map((a) => {
        const elementos = a.items.map((id) => porId.value.get(id)).filter(Boolean)
        const fechas = elementos.map((v) => fechaDe(v)).sort()
        const portada = porId.value.get(a.portada) && a.items.includes(a.portada) ? porId.value.get(a.portada) : elementos.reduce((x, v) => (!x || fechaDe(v) > fechaDe(x) ? v : x), null)
        const rango = a.fechas ?? (fechas.length ? { desde: fechas[0], hasta: fechas.at(-1) } : null)
        return { ...a, elementos, total: elementos.length, portadaItem: portada, rango }
      })
      .sort((x, y) => String(y.rango?.hasta ?? y.creado).localeCompare(String(x.rango?.hasta ?? x.creado))),
  )
  const album = (id) => albumes.value.find((a) => a.id === id)
  const albumesDe = (v) => albumes.value.filter((a) => a.items.includes(v.id))
  const crudo = (id) => {
    const a = catalogo.value.albumes.find((x) => x.id === id)
    if (!a) throw new Error('Ese álbum ya no existe')
    return a
  }
  const limpiarAlbum = (a) => {
    a.items = [...new Set(a.items)].filter((id) => porId.value.has(id))
    if (a.portada && !a.items.includes(a.portada)) a.portada = null
  }
  const datosAlbum = (d) => ({
    name: String(d.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
    descripcion: String(d.descripcion ?? '').trim().slice(0, 500),
    fechas: d.fechas?.desde && d.fechas?.hasta ? { desde: d.fechas.desde <= d.fechas.hasta ? d.fechas.desde : d.fechas.hasta, hasta: d.fechas.desde <= d.fechas.hasta ? d.fechas.hasta : d.fechas.desde } : null,
    ubicaciones: (d.ubicaciones ?? []).map((u) => ({ lat: +u.lat, lon: +u.lon, nombre: String(u.nombre ?? '').trim().slice(0, 80) })).filter((u) => Number.isFinite(u.lat) && Number.isFinite(u.lon)).slice(0, 50),
  })

  async function crearAlbum(d, ids = []) {
    const datos = datosAlbum(d)
    if (!datos.name) throw new Error('Ponle un nombre al álbum')
    const a = { id: uuid(), ...datos, items: [...new Set(ids)], portada: d.portada ?? null, creado: new Date().toISOString() }
    catalogo.value.albumes.push(a)
    await guardarCatalogo()
    return a
  }
  async function editarAlbum(id, d) {
    const datos = datosAlbum(d)
    if (!datos.name) throw new Error('Ponle un nombre al álbum')
    Object.assign(crudo(id), datos)
    await guardarCatalogo()
  }
  async function borrarAlbum(id) {
    catalogo.value.albumes = catalogo.value.albumes.filter((a) => a.id !== id)
    await guardarCatalogo()
  }
  async function agregarAAlbum(id, ids) {
    const a = crudo(id)
    a.items = [...a.items, ...ids]
    limpiarAlbum(a)
    await guardarCatalogo()
  }
  async function quitarDeAlbum(id, ids) {
    const a = crudo(id)
    a.items = a.items.filter((x) => !ids.includes(x))
    limpiarAlbum(a)
    await guardarCatalogo()
  }
  async function portadaAlbum(id, itemId) {
    const a = crudo(id)
    if (itemId && !a.items.includes(itemId)) throw new Error('La portada tiene que estar en el álbum')
    a.portada = itemId
    await guardarCatalogo()
  }
  // Varios álbumes a la vez para unos elementos: { albumId: true (agregar) | false (quitar) }.
  async function asignarAlbumes(ids, cambios) {
    for (const [id, poner] of Object.entries(cambios)) {
      const a = crudo(id)
      a.items = poner ? [...a.items, ...ids] : a.items.filter((x) => !ids.includes(x))
      limpiarAlbum(a)
    }
    await guardarCatalogo()
  }

  // Cifrar/descifrar con la clave de metadatos (la del catálogo): p. ej. el nombre y la lista de un ZIP.
  const cifrarMeta = (obj) => encryptJSON(metaKey.value, obj)
  const descifrarMeta = (s) => decryptJSON(metaKey.value, s)

  // ---------- cambios a varios a la vez ----------
  // cambiosDe(v) → cambios para sus metadatos (o null si no cambia). De a 4 en paralelo (cada uno se cifra con su clave).
  async function editarVarios(vs, cambiosDe, progreso) {
    const ids = vs.map((v) => v.id)
    let i = 0, hechos = 0
    const trabajar = async () => {
      while (i < ids.length) {
        const id = ids[i++]
        const v = items.value.find((x) => x.id === id) // la versión más reciente
        const c = v?.m && cambiosDe(v)
        if (c) await guardarMeta(v, c)
        progreso?.(++hechos, ids.length)
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, trabajar))
  }
  // takenAt: ISO, o null para quitarla (queda la de subida).
  const fechaVarios = (vs, takenAt, progreso) => editarVarios(vs, () => ({ takenAt, fechaOrigen: undefined }), progreso)
  const ubicacionVarios = (vs, location, progreso) => editarVarios(vs, () => ({ location }), progreso)
  async function etiquetasVarios(vs, agregar, quitar, progreso) {
    const nuevas = await etiquetasPara(agregar)
    await editarVarios(
      vs,
      (v) => {
        const antes = v.m.tags ?? []
        const tags = [...new Set([...antes.filter((id) => !quitar.includes(id)), ...nuevas])]
        return tags.length === antes.length && tags.every((id) => antes.includes(id)) ? null : { tags }
      },
      progreso,
    )
  }

  const favorito = (v) => guardarMeta(v, { favorite: !v.m.favorite })
  const renombrar = (v, title) => guardarMeta(v, { title: String(title).trim().slice(0, 200) || v.m.title })

  // Borrar: va a la papelera (5 días).
  async function borrar(v) {
    await api.del(`/videos/${v.id}`)
    items.value = items.value.filter((x) => x.id !== v.id)
  }

  // ---------- papelera: lo borrado y los originales reemplazados, 5 días ----------

  async function papelera() {
    const lista = await api.get('/videos/papelera')
    return Promise.all(
      lista.map(async (v) => {
        const d = await descifrar(v)
        if (v.anterior?.meta) d.anterior = { ...v.anterior, m: await decryptJSON(await auth.claveDe(v), v.anterior.meta).catch(() => null) }
        return d
      }),
    )
  }
  async function restaurar(v) {
    await api.post(`/videos/${v.id}/restaurar`)
    await cargar(true)
  }
  const borrarDefinitivo = (v) => api.del(`/videos/${v.id}?definitivo=1`)
  async function restaurarOriginal(v) {
    await api.post(`/videos/${v.id}/restaurar-original`)
    olvidarMiniatura(v.id)
    await cargar(true)
  }
  const descartarOriginal = (v) => api.del(`/videos/${v.id}/original-anterior`)

  // ---------- miniaturas (cifradas; se descifran al aparecer en pantalla) ----------

  // Tras subir una miniatura nueva: que se vuelva a bajar.
  function olvidarMiniatura(id) {
    const u = thumbs.get(id)
    if (u) URL.revokeObjectURL(u)
    thumbs.delete(id)
  }

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
  // Uno o varios archivos (todos en la misma hoja).
  async function compartir(file) {
    const files = Array.isArray(file) ? file : [file]
    if (navigator.canShare?.({ files })) {
      try {
        await navigator.share({ files })
      } catch (e) {
        if (e.name !== 'AbortError') throw e
      }
      return
    }
    for (const f of files) {
      const url = URL.createObjectURL(f)
      const a = Object.assign(document.createElement('a'), { href: url, download: f.name })
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    }
  }

  function limpiar() {
    clearTimeout(timer)
    items.value = []
    secuencia.value = []
    catalogo.value = { v: 1, tags: [], albumes: [] }
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
    items, listos, galeria, archivos, pendientes, favoritos, etiquetas, sinEtiqueta, cargado, COLORES,
    huellas, secuencia, marca, ajustarPorHuella, paraCompartir, compartir, tipo, etiqueta, fechaDe, nombresDe, original, imagen, descargar, sellar, etiquetasPara, cargar, guardarMeta, asignarEtiquetas, editarEtiqueta, borrarEtiqueta,
    horus, foco, activarHorus, salirHorus,
    favorito, renombrar, borrar, papelera, restaurar, borrarDefinitivo, restaurarOriginal, descartarOriginal, thumbUrl, olvidarMiniatura, publicKey: () => publicKey,
    cifrarMeta, descifrarMeta, editarVarios, fechaVarios, ubicacionVarios, etiquetasVarios,
    albumes, album, albumesDe, crearAlbum, editarAlbum, borrarAlbum, agregarAAlbum, quitarDeAlbum, portadaAlbum, asignarAlbumes,
  }
})
