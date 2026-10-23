import 'dotenv/config'
import { mkdirSync } from 'node:fs'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from './generated/prisma/client.ts'
import { paths } from './lib/paths.ts'

mkdirSync(paths.db, { recursive: true })
// La API y el worker abren la misma base: WAL + espera ante bloqueos.
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? `file:${paths.db}/boveda.db`, timeout: 10_000 })
export const prisma = new PrismaClient({ adapter })
await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL')
