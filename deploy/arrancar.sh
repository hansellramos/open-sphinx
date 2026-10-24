#!/bin/sh
# Arranque de la app: migraciones y servidor. El motor de migraciones de Prisma necesita la base de SQLite
# para él solo ("database is locked" mientras el worker la tenga abierta, aunque no escriba). Por eso primero se
# mira si hay algo pendiente (eso sí funciona con el worker andando) y solo entonces se migra; deploy.sh detiene
# el worker antes de recrear la app. Si la app se reinicia sola con el worker andando, arranca sin migrar.
if npx prisma migrate status 2>&1 | grep -q "Database schema is up to date"; then
  echo "[arranque] base al día"
  exec node server/index.ts
fi
for i in 1 2 3 4 5 6 7 8 9 10; do
  if out=$(npx prisma migrate deploy 2>&1); then
    echo "$out" | tail -1
    exec node server/index.ts
  fi
  echo "$out" | grep -q "database is locked" || { echo "$out"; exit 1; }
  echo "[arranque] hay migraciones pendientes y la base está en uso (¿worker andando?); reintento ($i)"
  sleep 3
done
exit 1
