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
