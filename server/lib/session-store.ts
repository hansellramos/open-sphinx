// Store de express-session sobre SQLite (Prisma). Equivalente a connect-pg-simple de AirCore.
import session from 'express-session'
import { prisma } from '../db.ts'

export class PrismaSessionStore extends session.Store {
  get(sid, cb) {
    prisma.session
      .findUnique({ where: { sid } })
      .then((s) => cb(null, s && s.expiresAt > new Date() ? JSON.parse(s.data) : null))
      .catch(cb)
  }
  set(sid, sess, cb) {
    const expiresAt = sess.cookie?.expires ? new Date(sess.cookie.expires) : new Date(Date.now() + 86_400_000)
    const data = JSON.stringify(sess)
    prisma.session
      .upsert({ where: { sid }, create: { sid, data, expiresAt }, update: { data, expiresAt } })
      .then(() => cb?.())
      .catch((e) => cb?.(e))
  }
  destroy(sid, cb) {
    prisma.session.deleteMany({ where: { sid } }).then(() => cb?.()).catch((e) => cb?.(e))
  }
  touch(sid, sess, cb) {
    this.set(sid, sess, cb)
  }
}

// Limpieza de sesiones vencidas cada hora.
setInterval(() => prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {}), 3_600_000).unref()
