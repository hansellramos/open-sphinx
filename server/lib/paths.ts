// Carpetas de datos. En disco solo hay material cifrado: videos/ (fotos y archivos también, por historia) y
// subidas/ (lo que llega por tus, cifrado al vuelo con una llave temporal). Todo lo que está SIN cifrar, y
// esas llaves temporales y las prestadas para exportar, vive en ram/: en la NAS es /dev/shm (memoria), así
// que un reinicio lo borra. En desarrollo es una carpeta más.
import { mkdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(process.env.DATA_DIR ?? './data')
const ram = path.resolve(process.env.RAM_DIR ?? path.join(root, 'ram'))
export const paths = {
  root,
  db: path.join(root, 'db'),
  subidas: path.join(root, 'subidas'),
  videos: path.join(root, 'videos'),
  ram,
  tmp: path.join(ram, 'trabajo'), // sin cifrar mientras se procesa
  llavesSubida: path.join(ram, 'subidas'), // llave temporal y datos (nombre) de cada subida
  claves: path.join(ram, 'claves'), // claves prestadas por el navegador para exportar
}
mkdirSync(ram, { recursive: true, mode: 0o700 })
for (const p of Object.values(paths)) mkdirSync(p, { recursive: true, mode: 0o700 })

// Archivos que puede pedir el navegador de un elemento ya procesado (video, foto o archivo).
export const ARCHIVO_VALIDO = /^(index\.m3u8|init\.mp4|seg_\d{5}\.m4s|thumb\.jpg|vista\.jpg|orig_\d{5})$/
export const bovedaJson = () => path.join(root, 'boveda.json')
export const videoDir = (id: string) => path.join(paths.videos, id)

// Borra la subida (cifrada), su llave temporal y sus datos de tus.
export async function borrarSubida(uploadId: string) {
  await rm(path.join(paths.subidas, uploadId), { force: true })
  await rm(path.join(paths.subidas, `${uploadId}.json`), { force: true }) // de antes, cuando iba en disco
  await rm(path.join(paths.llavesSubida, uploadId), { force: true })
  await rm(path.join(paths.llavesSubida, `${uploadId}.json`), { force: true })
  await rm(path.join(paths.llavesSubida, `${uploadId}.key`), { force: true })
}
