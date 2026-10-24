// Cifrado temporal de las subidas: lo que llega por tus se cifra al vuelo (AES-256-CTR) con una llave al azar
// por subida que vive solo en RAM (paths.llavesSubida). En disco nunca queda el archivo en claro. CTR permite
// escribir y leer desde cualquier posición (tus reanuda en cualquier byte; ffmpeg salta por el archivo) y el
// cifrado mide lo mismo que el original. Si la NAS se reinicia, la llave se pierde: esa subida ya no sirve y se
// descarta (el navegador la vuelve a empezar).
// Esto no reemplaza el cifrado de la bóveda: es solo para el rato entre que llega y el worker la procesa.
import { createCipheriv, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { FileStore, FileConfigstore } from '@tus/file-store'
import { ERRORS } from '@tus/server'
import { paths } from './paths.ts'

type Llave = { key: Buffer; iv: Buffer }
const archivoLlave = (id: string) => path.join(paths.llavesSubida, `${id}.key`)

export async function crearLlave(id: string) {
  await writeFile(archivoLlave(id), randomBytes(48), { mode: 0o600 })
}

export async function leerLlave(id: string): Promise<Llave | null> {
  const b = await readFile(archivoLlave(id)).catch(() => null)
  return b?.length === 48 ? { key: b.subarray(0, 32), iv: b.subarray(32) } : null
}

// Contador de CTR para empezar en el byte `pos` (bloques de 16).
function ivEn(iv: Buffer, pos: number) {
  const out = Buffer.from(iv)
  let suma = BigInt(Math.floor(pos / 16))
  for (let i = 15; i >= 0 && suma > 0n; i--) {
    const v = BigInt(out[i]) + (suma & 0xffn)
    out[i] = Number(v & 0xffn)
    suma = (suma >> 8n) + (v >> 8n)
  }
  return out
}

// Cifra o descifra (en CTR es lo mismo) un flujo que empieza en el byte `pos`.
export function ctr(ll: Llave, pos: number) {
  const c = createCipheriv('aes-256-ctr', ll.key, ivEn(ll.iv, pos))
  if (pos % 16) c.update(Buffer.alloc(pos % 16))
  return c
}

export function cifrarBloque(ll: Llave, pos: number, datos: Uint8Array) {
  return ctr(ll, pos).update(datos)
}

// ---------------- tus ----------------

// FileStore que guarda las subidas cifradas en disco y sus datos (con el nombre del archivo) en RAM.
export class SubidasCifradas extends FileStore {
  constructor() {
    super({ directory: paths.subidas, configstore: new FileConfigstore(paths.llavesSubida) })
  }

  async create(file) {
    await crearLlave(file.id)
    return super.create(file)
  }

  async write(readable, id: string, offset: number) {
    const ll = await leerLlave(id)
    if (!ll) throw ERRORS.FILE_NOT_FOUND
    const c = ctr(ll, offset)
    readable.on('error', (e) => c.destroy(e))
    return super.write(readable.pipe(c), id, offset)
  }

  async getUpload(id: string) {
    if (!(await leerLlave(id))) {
      // Se reinició la NAS: sin la llave, lo que hay en disco no sirve.
      await rm(path.join(paths.subidas, id), { force: true })
      await rm(path.join(paths.llavesSubida, `${id}.json`), { force: true })
      throw ERRORS.FILE_NOT_FOUND
    }
    return super.getUpload(id)
  }

  async remove(id: string) {
    await super.remove(id)
    await rm(archivoLlave(id), { force: true })
  }
}

// ---------------- lectura (worker) ----------------

export type Lector = {
  size: number
  leer: (pos: number, len: number) => Promise<Buffer> // descifrado
  flujo: (start?: number, end?: number) => Readable // descifrado; end incluido
}

export async function abrirSubida(id: string): Promise<Lector> {
  const ll = await leerLlave(id)
  if (!ll) throw new Error('La subida se perdió (se reinició la NAS antes de procesarla): súbela otra vez')
  const file = path.join(paths.subidas, id)
  const { size } = await stat(file)
  return {
    size,
    async leer(pos, len) {
      const fh = await open(file, 'r')
      try {
        const buf = Buffer.alloc(Math.max(0, Math.min(len, size - pos)))
        const { bytesRead } = await fh.read(buf, 0, buf.length, pos)
        return cifrarBloque(ll, pos, buf.subarray(0, bytesRead))
      } finally {
        await fh.close()
      }
    },
    flujo(start = 0, end = size - 1) {
      const c = ctr(ll, start)
      const r = createReadStream(file, { start, end })
      r.on('error', (e) => c.destroy(e))
      return r.pipe(c)
    },
  }
}

// Sirve subidas descifradas solo en 127.0.0.1 para que ffmpeg/ffprobe las lean (con saltos, por eso HTTP con
// Range y no un pipe: un .MOV con el índice al final no se puede leer en orden). Cada subida tiene una ruta
// al azar que deja de existir al terminar.
const servidas = new Map<string, Lector>()
let servidor: Promise<number> | null = null

function arrancar() {
  servidor ??= new Promise((ok, ko) => {
    const s = http.createServer((req, res) => {
      const l = servidas.get((req.url ?? '').slice(1))
      if (!l) return res.writeHead(404).end()
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
      let start = 0, end = l.size - 1
      if (m) {
        if (m[1]) start = Number(m[1])
        else if (m[2]) start = Math.max(0, l.size - Number(m[2]))
        if (m[1] && m[2]) end = Math.min(Number(m[2]), l.size - 1)
        if (start >= l.size) return res.writeHead(416, { 'Content-Range': `bytes */${l.size}` }).end()
      }
      const cab = { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 }
      if (m) res.writeHead(206, { ...cab, 'Content-Range': `bytes ${start}-${end}/${l.size}` })
      else res.writeHead(200, cab)
      if (req.method === 'HEAD' || l.size === 0) return res.end()
      const f = l.flujo(start, end)
      f.on('error', () => res.destroy())
      res.on('close', () => f.destroy())
      f.pipe(res)
    })
    s.on('error', ko)
    s.listen(0, '127.0.0.1', () => {
      s.unref()
      ok((s.address() as { port: number }).port)
    })
  })
  return servidor
}

// Devuelve una URL local para el lector y una función para quitarla.
export async function servir(l: Lector) {
  const port = await arrancar()
  const token = randomBytes(16).toString('hex')
  servidas.set(token, l)
  return { url: `http://127.0.0.1:${port}/${token}`, cerrar: () => servidas.delete(token) }
}
