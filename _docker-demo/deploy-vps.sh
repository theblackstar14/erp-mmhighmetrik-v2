#!/usr/bin/env bash
# Redeploy de la demo en el VPS. Correr DENTRO de _docker-demo en el VPS:
#     ./deploy-vps.sh
#
# OJO: borra el volumen de Postgres (down -v). Es a propósito: la data de la demo
# viene del dump db-init/01-restore.sql, que Postgres solo corre en el PRIMER
# arranque — sin -v el VPS se queda con el esquema viejo y la app revienta en la
# primera columna nueva. Todo lo que se haya tipeado en el VPS se pierde.
set -euo pipefail

export PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-http://144.126.150.128:3001}"
export COOKIE_SECURE="${COOKIE_SECURE:-0}"   # servido por IP → el navegador descarta la cookie secure

cd "$(dirname "$0")"
[ -f .env ] || { echo "falta _docker-demo/.env (copiar de .env.example y llenar)"; exit 1; }

git -C .. pull --ff-only
docker compose down -v
docker compose up -d --build

echo
echo "esperando que la app responda…"
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://localhost:${APP_PORT:-3001}/api/health" 2>/dev/null; then
    echo "✅ arriba → $PUBLIC_ORIGIN"
    exit 0
  fi
  sleep 3
done
echo "✗ no respondió en 3 min. Ver: docker compose logs app --tail 60"
exit 1
