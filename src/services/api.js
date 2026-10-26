// Cliente HTTP: cookies de sesión, JSON y errores en español.
import router from '@/router'

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message)
    this.status = status
    this.data = data
  }
}

function qs(params) {
  if (!params) return ''
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.append(k, v)
  const str = s.toString()
  return str ? `?${str}` : ''
}

// Modo Horus: cada respuesta trae su estado; si cambia (se activó o se salió desde otro dispositivo), se avisa.
let horusVisto = null
const oyentesHorus = new Set()
export const alCambiarHorus = (fn) => oyentesHorus.add(fn)

async function request(method, url, { body, params } = {}) {
  const res = await fetch(`/api${url}${qs(params)}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401 && !url.startsWith('/auth/')) {
    router.replace({ name: 'Entrar', query: { r: router.currentRoute.value.fullPath, expirada: 1 } })
  }
  const hz = res.headers.get('Esfinge-Horus')
  if (hz !== null) {
    if (horusVisto !== null && hz !== horusVisto) for (const f of oyentesHorus) f(hz)
    horusVisto = hz
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null
  if (!res.ok) throw new ApiError(data?.error || 'Ocurrió un error', res.status, data)
  return data
}

export const api = {
  get: (url, params) => request('GET', url, { params }),
  post: (url, body) => request('POST', url, { body }),
  put: (url, body) => request('PUT', url, { body }),
  del: (url, body) => request('DELETE', url, { body }),
  async download(url, params, fallbackName = 'export.xlsx') {
    const res = await fetch(`/api${url}${qs(params)}`, { credentials: 'include' })
    if (!res.ok) throw new ApiError('No se pudo exportar', res.status)
    const blob = await res.blob()
    const name = res.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] ?? fallbackName
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  },
}
