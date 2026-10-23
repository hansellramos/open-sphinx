// Carpetas de datos. subidas/ y tmp/ tienen material SIN cifrar de forma temporal; videos/ solo cifrado.
import { mkdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(process.env.DATA_DIR ?? './data')
export const paths = {
  root,
  db: path.join(root, 'db'),
  subidas: path.join(root, 'subidas'),
  tmp: path.join(root, 'tmp'),
  videos: path.join(root, 'videos'),
}
for (const p of Object.values(paths)) mkdirSync(p, { recursive: true })

// Archivos que puede pedir el navegador de un video ya procesado.
export const ARCHIVO_VALIDO = /^(index\.m3u8|init\.mp4|seg_\d{5}\.m4s|thumb\.jpg)$/
export const bovedaJson = () => path.join(root, 'boveda.json')
export const videoDir = (id: string) => path.join(paths.videos, id)

// Borra el archivo subido sin cifrar (y su metadata de tus).
export async function borrarSubida(uploadId: string) {
  await rm(path.join(paths.subidas, uploadId), { force: true })
  await rm(path.join(paths.subidas, `${uploadId}.json`), { force: true })
}
