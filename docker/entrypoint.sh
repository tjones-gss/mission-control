#!/usr/bin/env bash
# Launch the cockpit's two processes inside the container:
#   - Express API on :3001 (bound to 127.0.0.1 inside the container)
#   - Vite dev server on :5173, exposed on 0.0.0.0 so the host browser can reach
#     it via the published port. Vite proxies /api -> 127.0.0.1:3001.
#
# We start them directly (rather than `npm run up`) for one reason: the stock
# `dev:client` script runs `vite` with no --host, which only listens on
# localhost *inside* the container and is unreachable through the published
# port. Everything else matches the normal dev flow.
set -euo pipefail

cd /app

# Forward termination to both children so `docker stop` / Ctrl-C is clean.
pids=()
term() {
  echo "[entrypoint] shutting down..."
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait || true
  exit 0
}
trap term SIGTERM SIGINT

echo "[entrypoint] starting Express API on :${PORT:-3001} ..."
node apps/cockpit/server/index.js &
pids+=($!)

echo "[entrypoint] starting Vite UI on :5173 (host 0.0.0.0) ..."
( cd apps/cockpit/client && npx vite --host 0.0.0.0 --port 5173 ) &
pids+=($!)

# If either process exits, bring the whole container down so the failure is
# visible instead of a half-dead cockpit.
wait -n
echo "[entrypoint] a process exited; stopping container."
term
