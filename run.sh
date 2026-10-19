#!/usr/bin/env bash
# Start the downloader.
#   ./run.sh                    -> 127.0.0.1:8000 (local only, safe default)
#   ./run.sh 9000               -> 127.0.0.1:9000
#   ./run.sh 8000 0.0.0.0       -> reachable from LAN / Tailscale / internet
#   DEV=1 ./run.sh              -> auto-reload (development only)
#
# Catatan keamanan: aplikasi ini TIDAK punya login. Bind ke 0.0.0.0 hanya kalau
# kamu memang menginginkan orang lain memakainya, dan taruh di belakang reverse
# proxy (Caddy/Nginx) yang menangani TLS + pembatasan akses.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-8000}"
HOST="${2:-127.0.0.1}"

ARGS=(app.main:app --host "$HOST" --port "$PORT")
if [[ "${DEV:-0}" == "1" ]]; then
  ARGS+=(--reload)
else
  ARGS+=(--proxy-headers --forwarded-allow-ips '*')
fi

# SENGAJA satu worker. Job store dan rate limiter disimpan di memori proses:
# dengan >1 worker, resolve bisa mendarat di worker A dan polling job-nya di
# worker B, sehingga unduhan yang sudah selesai terlihat "410 kedaluwarsa".
# Kalau butuh multi-worker, ganti store ke Redis dulu.
WORKERS_NOTE="(1 worker: job store in-memory)"

echo "→ http://${HOST}:${PORT}  ${WORKERS_NOTE}"
exec .venv/bin/python -m uvicorn "${ARGS[@]}"
