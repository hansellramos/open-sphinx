// Por qué pesa un video: la tasa (megabits por segundo = peso ÷ duración) comparada con lo habitual para su
// tamaño y cuadros por segundo, y lo que la explica. Lo «habitual» es una tasa de referencia por píxel y cuadro
// (H.264 a calidad media; HEVC ocupa ~40 % menos a igual calidad). Sirve para Ver (detalles) y Optimizar.

const BITS_POR_PIXEL = { h264: 0.08, hevc: 0.05, av1: 0.04, vp9: 0.05 }
export const MBPS_720 = 3 // tope de las exportaciones a 720p (igual que server/lib/exportar.ts)

// Lado corto pedido → medidas de salida (nunca agranda; pares), igual que tamanoSalida() en exportar.ts.
export function salida(m, alto) {
  const corto = Math.min(m.width, m.height)
  const k = alto && alto < corto ? alto / corto : 1
  return { W: 2 * Math.round((m.width * k) / 2), H: 2 * Math.round((m.height * k) / 2) }
}
// Tasa máxima sugerida para exportar (igual que mbpsSugerida() en exportar.ts).
export function mbpsSugerida(m, alto) {
  if (!m?.width || !m?.height) return MBPS_720
  const { W, H } = salida(m, alto)
  return Math.max(0.8, (MBPS_720 * W * H) / (1280 * 720))
}

export const mbps = (v) => (v?.m?.duration > 0 && v.size > 0 ? (v.size * 8) / v.m.duration / 1e6 : null)

// Mbps habituales para este video (a 30 cps si no se sabe).
export function habitual(m) {
  if (!m?.width || !m?.height) return null
  const bpp = BITS_POR_PIXEL[m.videoCodec] ?? BITS_POR_PIXEL.h264
  return (m.width * m.height * (m.fps || 30) * bpp) / 1e6
}

const num = (x, d = 1) => x.toLocaleString('es', { maximumFractionDigits: d })
const nombreTamano = (corto) => (corto >= 2000 ? '5K o más' : corto >= 1440 ? '4K' : corto >= 1080 ? '1080p' : corto >= 720 ? '720p' : `${corto}p`)

// { mbps, habitual, veces, nivel: 'normal'|'alta'|'muy alta', razones: [texto] } o null si faltan datos.
export function porQuePesa(v) {
  const m = v?.m
  const t = mbps(v)
  if (!t || !m?.width || !m?.height) return null
  const h = habitual(m)
  const veces = t / h
  const nivel = veces > 3 ? 'muy alta' : veces > 1.6 ? 'alta' : 'normal'
  const corto = Math.min(m.width, m.height)
  const razones = []
  if (nivel !== 'normal') {
    razones.push(`Tasa ${nivel}: ${num(t)} Mbps, ${num(veces)} veces lo habitual para ${nombreTamano(corto)}${m.fps ? ` a ${Math.round(m.fps)} cps` : ''} (~${num(h)}). Así lo guardó la cámara o la app que lo exportó; Esfinge lo guarda tal cual.`)
  }
  if (corto >= 1440) razones.push(`${nombreTamano(corto)}: cada cuadro tiene ${num((m.width * m.height) / (1280 * 720), 0)} veces los píxeles de uno de 720p.`)
  else if (corto >= 1080) razones.push('1080p: cada cuadro tiene 2,25 veces los píxeles de uno de 720p.')
  if (m.fps >= 48) razones.push(`${Math.round(m.fps)} cuadros por segundo: el doble de imágenes que a 30 (suele pesar ~30–50 % más).`)
  if (m.videoCodec === 'h264' && nivel !== 'normal') razones.push('Formato H.264: a igual calidad ocupa más que HEVC (H.265).')
  if (m.duration > 10 * 60) razones.push(`Largo: ${Math.round(m.duration / 60)} minutos.`)
  if (!razones.length) razones.push('Peso normal para su tamaño y duración.')
  return { mbps: t, habitual: h, veces, nivel, razones }
}

// Lo que se puede hacer: reducir a 720p (si es más grande) o recomprimir al mismo tamaño (si la tasa es alta).
// { alto: 720 | null, accion } o null si no vale la pena.
export function aligerar(v) {
  const m = v?.m
  if (!m?.width || !m?.height) return null
  if (Math.min(m.width, m.height) > 720) return { alto: 720, accion: 'Reducir a 720p' }
  const p = porQuePesa(v)
  if (p && p.nivel !== 'normal' && p.mbps > MBPS_720 * 1.2) return { alto: null, accion: 'Recomprimir' }
  return null
}
