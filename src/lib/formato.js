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
