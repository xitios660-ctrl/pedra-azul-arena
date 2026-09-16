#!/bin/sh
# Pedra Azul — start WhatsApp sidecar + FastAPI (uvicorn)
set -eu

PORT="${PORT:-8000}"
WHATSAPP_PORT="${WHATSAPP_PORT:-3001}"
WHATSAPP_HOST="${WHATSAPP_HOST:-127.0.0.1}"
export PORT WHATSAPP_PORT WHATSAPP_HOST
export WHATSAPP_SERVICE_URL="${WHATSAPP_SERVICE_URL:-http://127.0.0.1:${WHATSAPP_PORT}}"
# Sidecar → FastAPI (same container)
export API_INTERNAL_URL="${API_INTERNAL_URL:-http://127.0.0.1:${PORT}}"

# Shared secret for FastAPI ↔ WhatsApp (X-Internal-Token).
# Prefer INTERNAL_API_TOKEN; WHATSAPP_INTERNAL_TOKEN remains legacy alias.
# Re-export so the Node sidecar child always inherits them from the container env.
if [ -n "${INTERNAL_API_TOKEN:-}" ]; then
  export INTERNAL_API_TOKEN
fi
if [ -n "${WHATSAPP_INTERNAL_TOKEN:-}" ]; then
  export WHATSAPP_INTERNAL_TOKEN
fi
# If only one is set, mirror so both Node and Python see a consistent pair.
if [ -n "${INTERNAL_API_TOKEN:-}" ] && [ -z "${WHATSAPP_INTERNAL_TOKEN:-}" ]; then
  export WHATSAPP_INTERNAL_TOKEN="$INTERNAL_API_TOKEN"
fi
if [ -z "${INTERNAL_API_TOKEN:-}" ] && [ -n "${WHATSAPP_INTERNAL_TOKEN:-}" ]; then
  export INTERNAL_API_TOKEN="$WHATSAPP_INTERNAL_TOKEN"
fi

_tok_state="unset"
if [ -n "${INTERNAL_API_TOKEN:-}${WHATSAPP_INTERNAL_TOKEN:-}" ]; then
  _tok_state="set"
fi
echo "[start] WhatsApp sidecar on ${WHATSAPP_HOST}:${WHATSAPP_PORT} (API ${API_INTERNAL_URL}, internal_token=${_tok_state})"
cd /app/whatsapp
node server.js &
WA_PID=$!

cleanup() {
  echo "[start] shutting down..."
  kill "$WA_PID" 2>/dev/null || true
  wait "$WA_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Brief wait so sidecar binds before health checks hammer it
sleep 1

echo "[start] uvicorn on 0.0.0.0:${PORT}"
cd /app/backend
exec uvicorn server:app --host 0.0.0.0 --port "${PORT}"
