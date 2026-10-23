// Las etiquetas viven cifradas en el catálogo de la bóveda (ver boveda.ts). Aquí solo queda limpiar
// la tabla del MVP (sin cifrar) una vez que el navegador las migró.
import { Router } from 'express'
import { prisma } from '../db.ts'

const r = Router()

r.delete('/legado', async (req, res) => {
  const { count } = await prisma.tag.deleteMany({})
  res.json({ borradas: count })
})

export default r
