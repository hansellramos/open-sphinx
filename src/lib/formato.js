export function duracion(s) {
  if (!s && s !== 0) return ''
  s = Math.round(s)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(x).padStart(2, '0')}`
}

export function tamano(b) {
  if (!b) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)))
  return `${(b / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${u[i]}`
}

export const fecha = (d) => new Date(d).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })

export const ESTADOS = {
  en_cola: { color: 'secondary', texto: 'En cola' },
  procesando: { color: 'info', texto: 'Procesando' },
  listo: { color: 'success', texto: 'Listo' },
  error: { color: 'danger', texto: 'Error' },
}

const mayus = (s) => s.charAt(0).toUpperCase() + s.slice(1)
export const dia = (d) => mayus(new Date(d).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
export const fechaCorta = (d) => new Date(d).toLocaleString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export const mesAnio = (d) => {
  const s = new Date(d).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export const fechaHora = (d) => new Date(d).toLocaleString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export const extension = (nombre) => (String(nombre ?? '').match(/\.([^.]{1,8})$/)?.[1] ?? '').toUpperCase()

// Ícono según el tipo del archivo.
export function iconoArchivo(nombre, mime = '') {
  const e = extension(nombre).toLowerCase()
  if (mime.startsWith('image/')) return 'cil-image'
  if (mime.startsWith('video/')) return 'cil-video'
  if (mime.startsWith('audio/') || ['mp3', 'm4a', 'wav', 'flac', 'aac', 'ogg'].includes(e)) return 'cil-music-note'
  if (mime === 'application/pdf' || ['pdf', 'doc', 'docx', 'odt', 'rtf', 'pages'].includes(e)) return 'cil-description'
  if (['xls', 'xlsx', 'csv', 'ods', 'numbers'].includes(e)) return 'cil-spreadsheet'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) return 'cil-compress'
  if (mime.startsWith('text/') || ['txt', 'md', 'json'].includes(e)) return 'cil-notes'
  return 'cil-file'
}

// Qué se puede ver dentro de la app (lo demás solo se descarga).
export function vistaPrevia(mime = '', nombre = '') {
  const e = extension(nombre).toLowerCase()
  if (mime === 'application/pdf' || e === 'pdf') return 'pdf'
  if (mime.startsWith('image/')) return 'imagen'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('text/') || ['txt', 'md', 'json', 'csv', 'log'].includes(e)) return 'texto'
  return null
}

// <input type="datetime-local"> trabaja en hora local sin zona: 'AAAA-MM-DDTHH:mm'.
const dos = (n) => String(n).padStart(2, '0')
export const aLocal = (d) => {
  if (!d) return ''
  const x = new Date(d)
  return `${x.getFullYear()}-${dos(x.getMonth() + 1)}-${dos(x.getDate())}T${dos(x.getHours())}:${dos(x.getMinutes())}`
}
export const deLocal = (s) => (s ? new Date(s).toISOString() : null)

// Fecha escrita en el nombre del archivo, como la ponen WhatsApp (IMG-20231015-WA0012.jpg, "WhatsApp Image
// 2023-10-15 at 10.20.30"), Android/Pixel (IMG_20231015_102030.jpg, PXL_…) o capturas. Sin hora → mediodía.
// Devuelve hora local para datetime-local, o null. Lo pegado se nombra con la hora de pegar: no cuenta.
export function fechaDelNombre(nombre) {
  if (/^(pegado|nota)-/.test(nombre)) return null
  const m = /(?:^|\D)((?:19|20)\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?:[ _T.-]*(?:at |a las )?(\d{2})[.:h_-]?(\d{2})(?:[.:m_-]?(\d{2}))?)?/i.exec(nombre)
  if (!m) return null
  const [a, me, d, h = '12', mi = '00'] = m.slice(1)
  if (+me < 1 || +me > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59 || +a > new Date().getFullYear()) return null
  return `${a}-${me}-${d}T${dos(h)}:${mi}`
}

// Opciones de una exportación de video, para mostrar y para el nombre del archivo.
export const etiquetaExport = (e) =>
  [e.alto ? `${e.alto}p` : 'Tamaño original', e.filtro && `filtro ${e.filtro.toUpperCase()}`, e.reemplazar && 'reemplazará al original'].filter(Boolean).join(' · ')
export const sufijoExport = (e) => `${e.alto ? `-${e.alto}p` : ''}${e.filtro ? `-filtro-${e.filtro}` : ''}`

// Cuánto le queda a algo que vence (exportaciones).
export function venceEn(d) {
  const h = (new Date(d) - Date.now()) / 3600e3
  if (h < 1) return 'vence en menos de una hora'
  if (h < 24) return `vence en ${Math.round(h)} h`
  const dias = Math.round(h / 24)
  return `vence en ${dias} ${dias === 1 ? 'día' : 'días'}`
}

// Rango de fechas de un álbum: { desde, hasta } (ISO o YYYY-MM-DD, que es día local, no UTC).
const aFecha = (d) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00` : d)
export function rangoFechas(r) {
  if (!r) return ''
  const a = aFecha(r.desde), b = aFecha(r.hasta)
  if (a.toDateString() === b.toDateString()) return fecha(a)
  const mismoAnio = a.getFullYear() === b.getFullYear()
  const ini = a.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', ...(!mismoAnio && { year: 'numeric' }) })
  return `${ini} – ${fecha(b)}`
}
// YYYY-MM-DD local de una fecha (para los <input type="date">).
export const diaLocal = (d) => aFecha(d).toLocaleDateString('sv')
