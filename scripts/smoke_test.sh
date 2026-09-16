#!/usr/bin/env bash
# Pedra Azul — local/API smoke tests (Cycle 6)
# Usage:
#   BASE_URL=http://127.0.0.1:8000 ./scripts/smoke_test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
API="${BASE_URL%/}/api"
PASS=0
FAIL=0

ok() { echo "PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL  $1 — $2"; FAIL=$((FAIL+1)); }

echo "== Pedra Azul smoke @ $API =="

# 1) Health (safe public)
H=$(curl -fsS "$API/health" || true)
if echo "$H" | grep -q '"ok"'; then
  if echo "$H" | grep -Eiq 'password|jwt|secret|mongo_url|private'; then
    bad "health" "possible secret leak"
  else
    ok "GET /api/health"
  fi
else
  bad "health" "unreachable or invalid JSON: $H"
fi

# 2) Courts
C=$(curl -fsS "$API/courts" || true)
if echo "$C" | grep -q 'court-1\|Pedra Azul\|price'; then
  ok "GET /api/courts"
else
  if echo "$C" | grep -q '\['; then
    ok "GET /api/courts (array)"
  else
    bad "courts" "$C"
  fi
fi


# 2b) Public site-settings
SS=$(curl -fsS "$API/site-settings" || true)
if echo "$SS" | grep -q 'price_per_hour'; then
  ok "GET /api/site-settings"
else
  bad "site-settings" "$SS"
fi

# 2c) Internal without token (only assert 401 when token configured)
if [ -n "${INTERNAL_API_TOKEN:-}${WHATSAPP_INTERNAL_TOKEN:-}" ]; then
  IC=$(curl -s -o /tmp/pa_int.json -w "%{http_code}" "$API/internal/whatsapp/availability?date=2099-01-01" || echo "000")
  if [ "$IC" = "401" ]; then
    ok "GET /api/internal/... without token → 401"
  else
    bad "internal token" "expected 401 got $IC"
  fi
fi

# 3) Admin auth reject
CODE=$(curl -s -o /tmp/pa_admin.json -w "%{http_code}" "$API/admin/dashboard" || echo "000")
if [ "$CODE" = "401" ] || [ "$CODE" = "403" ]; then
  ok "GET /api/admin/dashboard → $CODE (auth reject)"
else
  bad "admin auth reject" "expected 401/403 got $CODE"
fi

CODE2=$(curl -s -o /tmp/pa_metrics.json -w "%{http_code}" "$API/admin/metrics" || echo "000")
if [ "$CODE2" = "401" ] || [ "$CODE2" = "403" ]; then
  ok "GET /api/admin/metrics → $CODE2 (auth reject)"
else
  bad "admin metrics auth" "expected 401/403 got $CODE2"
fi

CODE3=$(curl -s -o /tmp/pa_await.json -w "%{http_code}" "$API/admin/bookings/awaiting" || echo "000")
if [ "$CODE3" = "401" ] || [ "$CODE3" = "403" ]; then
  ok "GET /api/admin/bookings/awaiting → $CODE3 (auth reject)"
else
  bad "awaiting auth" "expected 401/403 got $CODE3"
fi

# 4) Create booking conflict 409
DATE=$(python3 - <<'PY'
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
tz = ZoneInfo("America/Sao_Paulo")
d = datetime.now(tz) + timedelta(days=14)
print(d.strftime("%Y-%m-%d"))
PY
)
SLOT="22:00"
PAYLOAD=$(cat <<JSON
{
  "court_id": "court-1",
  "date": "$DATE",
  "start_time": "$SLOT",
  "duration_minutes": 60,
  "cpf": "52998224725",
  "customer_name": "Smoke Test",
  "whatsapp": "11999990001",
  "your_team_name": "Smoke A",
  "opponent_team_name": "Smoke B"
}
JSON
)

R1=$(curl -s -o /tmp/pa_b1.json -w "%{http_code}" -X POST "$API/bookings" \
  -H "Content-Type: application/json" -d "$PAYLOAD" || echo "000")
R2=$(curl -s -o /tmp/pa_b2.json -w "%{http_code}" -X POST "$API/bookings" \
  -H "Content-Type: application/json" -d "$PAYLOAD" || echo "000")

if [ "$R1" = "200" ] || [ "$R1" = "201" ]; then
  ok "POST /api/bookings create ($R1) slot $DATE $SLOT"
  if [ "$R2" = "409" ]; then
    ok "POST /api/bookings conflict → 409"
  else
    bad "booking 409" "second create got $R2"
  fi
  BID=$(python3 -c "import json;print(json.load(open('/tmp/pa_b1.json')).get('id',''))" 2>/dev/null || true)
  if [ -n "$BID" ]; then
    # 5) Comprovante → informado (not confirmed)
    printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82' > /tmp/pa_comp.png
    RC=$(curl -s -o /tmp/pa_comp.json -w "%{http_code}" -X POST "$API/bookings/$BID/comprovante" \
      -F "file=@/tmp/pa_comp.png;type=image/png" || echo "000")
    if [ "$RC" = "200" ] && grep -q 'awaiting_admin' /tmp/pa_comp.json && ! grep -q '"status":"confirmed"' /tmp/pa_comp.json; then
      ok "POST comprovante → awaiting_admin (no auto-confirm)"
    else
      bad "comprovante" "code=$RC body=$(head -c 180 /tmp/pa_comp.json)"
    fi
    curl -fsS -X POST "$API/bookings/$BID/cancel?cpf=52998224725" >/dev/null 2>&1 || true
  fi
elif [ "$R1" = "409" ]; then
  ok "POST /api/bookings already conflict on first try (slot busy) — treat as 409 path OK"
else
  bad "booking create" "got $R1 body=$(head -c 200 /tmp/pa_b1.json 2>/dev/null || true)"
fi

echo
echo "Result: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
