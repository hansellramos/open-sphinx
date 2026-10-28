#!/usr/bin/env bash
# Construye la imagen en la Mac (ARM64), la envía a la NAS y recrea los contenedores.
# Nunca toca .env ni los datos de la NAS.
set -euo pipefail
cd "$(dirname "$0")/.."
# A dónde: NAS=usuario@host (y opcionales SSH_KEY y NAS_DIR), en el entorno o en deploy/.env.deploy (no va a git).
[ -f deploy/.env.deploy ] && . deploy/.env.deploy
: "${NAS:?Falta NAS=usuario@host (en el entorno o en deploy/.env.deploy)}"
NAS_DIR=${NAS_DIR:-/volume2/docker/boveda}
SSH="ssh ${SSH_KEY:+-i $SSH_KEY} $NAS"

docker build -t boveda:latest .
docker save boveda:latest | gzip -1 | $SSH 'gunzip | docker load'
$SSH "cat > $NAS_DIR/docker-compose.yml" < docker-compose.yml
# El worker se detiene antes de recrear la app: las migraciones necesitan la base para ellas solas. Lo que estaba
# haciendo sigue solo al volver (trabajos a la cola; exportaciones desde el último fragmento, la clave sigue en
# la RAM que mantiene boveda_ram).
$SSH "cd $NAS_DIR" '&& docker compose stop worker && docker compose up -d && docker image prune -f --filter "dangling=true" >/dev/null && sleep 10 && docker compose ps --format "{{.Name}}: {{.Status}}"'
