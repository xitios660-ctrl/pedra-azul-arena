#!/usr/bin/env bash
# Pedra Azul — production smoke (Cycle 8)
# Usage:
#   ./scripts/prod_smoke.sh
#   BASE_URL=https://pedra-azul.onrender.com ./scripts/prod_smoke.sh
set -euo pipefail

BASE_URL="${BASE_URL:-https://pedra-azul.onrender.com}"
API="${BASE_URL%/}/api"
PASS=0
FAIL=0
TMPDIR="${TMPDIR:-/tmp}"
HFILE="$TMPDIR/pa_prod_health_$$.json"

ok() { echo "PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL  $1 — $2"; FAIL=$((FAIL+1)); }

cleanup() { rm -f "$HFILE" 2>/dev/null || true; }
trap cleanup EXIT

echo "== Pedra Azul prod smoke @ $BASE_URL =="

fetch_health() {
  curl -fsS --max-time 30 "$API/health" >"$HFILE" 2>/dev/null
}

# 1) Health (retry once — free Render cold start)
if fetch_health; then
  :
else
  sleep 3
  fetch_health || true
fi

if [ -s "$HFILE" ] && grep -q '"ok"' "$HFILE"; then
  if grep -Eiq 'password|jwt_secret|mongo_url|private_key' "$HFILE"; then
    bad "health" "possible secret leak"
  else
    ok "GET /api/health"
  fi
else
  bad "health" "unreachable or invalid: $(head -c 200 "$HFILE" 2>/dev/null || true)"
fi

# 2) Courts (single court)
C=$(curl -fsS --max-time 25 "$API/courts" || true)
if echo "$C" | grep -q 'court-1'; then
  ok "GET /api/courts (court-1)"
else
  bad "courts" "$C"
fi

# 3) Site settings
SS=$(curl -fsS --max-time 25 "$API/site-settings" || true)
if echo "$SS" | grep -q 'price_per_hour'; then
  ok "GET /api/site-settings"
else
  bad "site-settings" "$SS"
fi

# 4) WhatsApp — CONECTANDO (restore), AGUARDANDO_QR, or CONECTADO (retry for cold start)
WA=""
for _try in 1 2 3 4 5; do
  fetch_health || true
  if [ -s "$HFILE" ]; then
    WA=$(python3 -c "import json; print(json.load(open('$HFILE')).get('whatsapp') or '')" 2>/dev/null || true)
  fi
  case "$WA" in
    AGUARDANDO_QR|CONECTADO|CONECTANDO) break ;;
  esac
  sleep 2
done

case "$WA" in
  AGUARDANDO_QR|CONECTADO|CONECTANDO)
    ok "whatsapp status=$WA (expected CONECTANDO|AGUARDANDO_QR|CONECTADO)"
    ;;
  *)
    bad "whatsapp" "got '${WA:-empty}' — expected CONECTANDO, AGUARDANDO_QR or CONECTADO after cold start"
    ;;
esac

# 5) SEO sitemap + robots
SM=$(curl -s --max-time 25 -o /tmp/pa_prod_sitemap.xml -w "%{http_code}" "$BASE_URL/sitemap.xml" || echo "000")
if [ "$SM" = "200" ] && grep -q 'urlset' /tmp/pa_prod_sitemap.xml && grep -q '/faq' /tmp/pa_prod_sitemap.xml; then
  ok "GET /sitemap.xml"
else
  bad "sitemap.xml" "code=$SM"
fi
RB=$(curl -s --max-time 25 -o /tmp/pa_prod_robots.txt -w "%{http_code}" "$BASE_URL/robots.txt" || echo "000")
if [ "$RB" = "200" ] && grep -q 'Disallow: /admin' /tmp/pa_prod_robots.txt; then
  ok "GET /robots.txt"
else
  bad "robots.txt" "code=$RB"
fi


echo
echo "Result: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
