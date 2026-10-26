// Modo Horus: la Esfinge muestra solo unas etiquetas/álbumes elegidos, en todos los dispositivos (es de la bóveda,
// no de la sesión), hasta que se sale explícitamente con una passkey. Lo hace cumplir el servidor:
// - solo lista y entrega los elementos permitidos (`ids`; lo que se sube durante el modo entra solo);
// - entrega un catálogo reducido (`catalogo`, cifrado por el navegador: solo las etiquetas y álbumes elegidos más
//   las etiquetas creadas durante el modo), así no se ven los nombres de las demás. El completo queda intacto en
//   Vault.catalog; al salir, el reducido pasa a Vault.catalogoPendiente para que el navegador lo una al completo;
// - es solo mirar (más subir y etiquetar): borrar, exportar, ZIP, papelera y cambiar passkeys se rechazan.
// Lo que el servidor sabe de más: qué elementos van juntos (no por qué: los nombres siguen cifrados).
import { prisma } from '../db.ts'

export type Horus = { desde: string; ids: string[]; catalogo: string }
export type HorusActivo = Horus & { permitidos: Set<string> }

let ultimo: { raw: string | null; h: HorusActivo | null } = { raw: null, h: null }

export async function leerHorus(): Promise<HorusActivo | null> {
  const v = await prisma.vault.findUnique({ where: { id: 1 }, select: { horus: true } })
  const raw = v?.horus ?? null
  if (raw !== ultimo.raw) {
    const h = raw ? (JSON.parse(raw) as Horus) : null
    ultimo = { raw, h: h && { ...h, permitidos: new Set(h.ids) } }
  }
  return ultimo.h
}

export async function guardarHorus(h: Horus | null, extra: Record<string, unknown> = {}) {
  await prisma.vault.update({ where: { id: 1 }, data: { horus: h ? JSON.stringify(h) : null, ...extra } })
}

// Lo que se sube durante el modo se puede ver (si no, desaparecería al terminar de subirlo).
// De a una (leer y escribir la lista), para que dos subidas que terminan juntas no se pisen.
let fila: Promise<unknown> = Promise.resolve()
export function permitirNuevo(id: string) {
  const paso = fila.then(async () => {
    const h = await leerHorus()
    if (!h || h.permitidos.has(id)) return
    await guardarHorus({ desde: h.desde, catalogo: h.catalogo, ids: [...h.ids, id] })
  })
  fila = paso.catch(() => {})
  return paso
}

// El catálogo reducido cambia (etiquetas nuevas durante el modo): también de a uno con lo anterior.
export function cambiarCatalogo(catalogo: string) {
  const paso = fila.then(async () => {
    const h = await leerHorus()
    if (h) await guardarHorus({ desde: h.desde, ids: h.ids, catalogo })
    return !!h
  })
  fila = paso.catch(() => {})
  return paso
}

// Rutas que no existen en modo Horus (método + ruta bajo /api).
const BLOQUEADAS: [string, RegExp][] = [
  ['*', /^\/(exportados|zips|etiquetas)(\/|$)/],
  ['*', /^\/videos\/papelera$/],
  ['DELETE', /^\/videos\//],
  ['POST', /^\/videos\/[^/]+\/(exportar|restaurar|restaurar-original)$/],
  ['PUT', /^\/boveda\/(recuperacion|meta-key)$/],
]
const DE_UN_ELEMENTO = /^\/videos\/([0-9a-f-]{36})(\/|$)/

// Middleware de /api (después de la sesión): marca la respuesta (el navegador se entera si cambió el modo desde
// otro dispositivo), rechaza lo bloqueado y lo de elementos no permitidos.
export async function filtroHorus(req, res, next) {
  try {
    const h = await leerHorus()
    req.horus = h
    res.set('Esfinge-Horus', h ? h.desde : '0')
    if (!h) return next()
    const ruta = req.path
    if (BLOQUEADAS.some(([m, re]) => (m === '*' || m === req.method) && re.test(ruta))) return res.status(403).json({ error: 'No disponible en modo Horus' })
    const id = DE_UN_ELEMENTO.exec(ruta)?.[1]
    if (id && !h.permitidos.has(id)) return res.status(404).json({ error: 'No encontrado' })
    next()
  } catch (e) {
    next(e)
  }
}
