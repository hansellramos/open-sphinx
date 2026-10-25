// La cola, vista desde cualquier dispositivo: lo que se está recibiendo (subidas tus en curso, desde donde sea), lo
// que espera cifrarse, lo que se está cifrando (con avance) y lo que falló. Los nombres son los del archivo subido:
// el servidor los tiene en claro solo hasta que el worker los mete en los metadatos cifrados.
import { Router } from 'express'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '../db.ts'
import { paths } from '../lib/paths.ts'

const r = Router()

r.get('/', async (req, res) => {
  const enUso = new Set((await prisma.video.findMany({ where: { uploadId: { not: null } }, select: { uploadId: true } })).map((v) => v.uploadId))
  const recibiendo = []
  for (const id of (await readdir(paths.subidas).catch(() => [])).filter((f) => !f.endsWith('.json'))) {
    if (enUso.has(id)) continue // ya llegó entera: está en la cola de abajo
    const info = JSON.parse(await readFile(path.join(paths.llavesSubida, `${id}.json`), 'utf8').catch(() => 'null'))
    const s = await stat(path.join(paths.subidas, id)).catch(() => null)
    if (!info || !s) continue // sin llave: huérfana (se borra sola)
    recibiendo.push({ id, nombre: String(info.metadata?.filename ?? 'archivo').slice(0, 200), recibido: s.size, total: Number(info.size) || null, actualizado: s.mtime })
  }
  const vs = await prisma.video.findMany({
    where: { status: { in: ['en_cola', 'procesando', 'error'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, originalName: true, status: true, progreso: true, error: true, size: true, createdAt: true },
  })
  const [exportaciones, zips] = await Promise.all([
    prisma.exportacion.count({ where: { status: { in: ['en_cola', 'procesando'] } } }),
    prisma.zip.count({ where: { status: { in: ['en_cola', 'procesando'] } } }),
  ])
  res.json({
    recibiendo: recibiendo.sort((a, b) => +a.actualizado - +b.actualizado),
    elementos: vs.map((v) => ({ ...v, nombre: v.originalName ?? 'archivo', originalName: undefined })),
    exportaciones,
    zips,
  })
})

export default r
