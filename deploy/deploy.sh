#!/usr/bin/env bash
# Construye la imagen en la Mac (ARM64), la envía a la NAS y recrea los contenedores.
# Nunca toca .env ni los datos de la NAS (/volume2/boveda).
set -euo pipefail
NAS=${NAS:-hansellramos@192.168.1.200}
SSH="ssh -i $HOME/.ssh/id_ed25519 $NAS"
cd "$(dirname "$0")/.."

docker build -t boveda:latest .
docker save boveda:latest | gzip -1 | $SSH 'gunzip | docker load'
$SSH 'cat > /volume2/docker/boveda/docker-compose.yml' < docker-compose.yml
$SSH 'cd /volume2/docker/boveda && docker compose up -d && docker image prune -f --filter "dangling=true" >/dev/null && sleep 10 && docker compose ps --format "{{.Name}}: {{.Status}}"'
