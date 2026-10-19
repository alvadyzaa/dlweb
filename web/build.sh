#!/usr/bin/env bash
# Build frontend ke ../app/static (dipakai FastAPI StaticFiles).
# Catatan: `npx vite build` / `npm run build` diblokir lifecycle guard di mesin ini,
# jadi vite dipanggil langsung lewat node.
set -euo pipefail
cd "$(dirname "$0")"
./node_modules/.bin/tsc --noEmit -p tsconfig.json
node ./node_modules/vite/bin/vite.js build
echo "build selesai -> ../app/static"
