# Pedra Azul Arena — Quadra Futsal (booking)

Reserva de **uma** quadra (Pedra Azul — Núncio), fluxo CPF + PIX + confirmação WhatsApp (Baileys).

## Stack

- **Frontend:** React (CRA/craco) — landing cinemática, booking mobile-first, admin
- **Backend:** FastAPI + MongoDB (Motor)
- **WhatsApp:** sidecar Node `@whiskeysockets/baileys` (`whatsapp/`), auth state no MongoDB

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `MONGO_URL` | sim | Connection string MongoDB Atlas |
| `DB_NAME` | sim | Nome do DB (ex.: `arena_futsal`) |
| `JWT_SECRET` | sim | Segredo JWT admin |
| `CORS_ORIGINS` | não | Default `*`. Em produção, liste origens explícitas (vírgula) |
| `WHATSAPP_SERVICE_URL` | não | Default `http://127.0.0.1:3001` |
| `WHATSAPP_PORT` | não | Default `3001` |
| `WHATSAPP_HOST` | não | Default `127.0.0.1` (só localhost) |
| `WHATSAPP_INTERNAL_TOKEN` | não | Token compartilhado FastAPI ↔ sidecar |
| `WHATSAPP_SESSION_ID` | não | Default `default` (chave Mongo auth) |
| `WHATSAPP_AUTO_START` | não | Default `true` — tenta restaurar sessão no boot |
| `WHATSAPP_ADMIN_JID` | não | JID admin p/ notificar reservas WA (ex.: `5511999999999@s.whatsapp.net`) |
| `API_INTERNAL_URL` | não | Default `http://127.0.0.1:$PORT` — sidecar → FastAPI |
| `PORT` | não | Porta HTTP pública (Render define) |
| `BOOKING_RATE_LIMIT` | não | Max POSTs `/api/bookings` por IP/janela (default 8) |
| `BOOKING_RATE_WINDOW_SEC` | não | Janela do rate limit em segundos (default 60) |

**Nunca** commitir credenciais Baileys / `.env` / QR. Sessão fica na collection `whatsapp_auth`.

## Docker / Render

```bash
docker build -t pedra-azul .
docker run --rm -p 8000:8000 \
  -e MONGO_URL=... -e DB_NAME=arena_futsal -e JWT_SECRET=... \
  pedra-azul
```

Health: `GET /api/health` → `{ ok, db, whatsapp }`.

Blueprint: `render.yaml` (Docker). Configure `MONGO_URL` no dashboard.

## Admin — conectar WhatsApp (QR)

1. Login em `/login` (admin)
2. Aba **WhatsApp** no dashboard
3. **Conectar / Gerar QR** → status `AGUARDANDO_QR`
4. Celular: WhatsApp → Aparelhos conectados → escanear QR grande
5. Status vira `CONECTADO` + número; confirmações de reserva enviam mensagem automática

SSE: `GET /api/admin/whatsapp/events` (JWT/cookie admin).

## Dev local

```bash
# API
cd backend && pip install -r requirements.txt && uvicorn server:app --reload --port 8000

# WhatsApp sidecar
cd whatsapp && npm install && MONGO_URL=... DB_NAME=arena_futsal npm start

# Frontend
cd frontend && npm install --legacy-peer-deps && npm start
```

## Booking

Fluxo: **data → horário → dados → revisão → confirmar**.  
Estados de slot: `available` | `reserved` | `unavailable`.  
Double-booking bloqueado atomicamente (índice único parcial + 409).


## Bot WhatsApp (Cycle 2)

Mensagens inbound em pt-BR (sem menu numérico, salvo fallback):

- cumprimentos, preço, endereço/local (Núncio)
- disponibilidade (hoje / amanhã / sábado / depois das 20)
- reservar: horário → nome → confirmação (*sim*/*não*)
- cancelar se o telefone bater com a reserva

Estado da conversa por JID em Mongo (`whatsapp_conversations`).
Reservas usam o mesmo caminho atômico do site (`slot_key` + índice único).
Lembrete ~3h antes (`reminder_sent` — sem duplicar após restart).

Admin → aba **Calendário**: visão dia/semana, bloquear/desbloquear, criar/cancelar com confirmação.


## PWA / SEO (Cycle 3)

- Installable: `manifest.json` + ícones em `/icons/` + `theme-color` `#00E5FF`
- Service worker (`/sw.js`): **network-first** para HTML/navegação (não prende deploy velho); **nunca cacheia** `/api/*`; cache-first só para `/static/*` hashed
- SEO local: meta/OG + JSON-LD `SportsActivityLocation`/`LocalBusiness` (Núncio · Alto Tietê — **sem** inventar rua)
- PIX: estados **aguardando → informado → confirmado** (admin) · **cancelado** · **expirado** (~45 min). Nunca auto-confirma por texto


## Bot + Observability (Cycle 4)

Intents extras (pt-BR): estacionamento, duração (1h), PIX how-to, endereço/Maps (busca), “depois das 20”, sábado à noite, remarcar, mudança de ideia no meio do fluxo.

Cancel/remarcar só se o WhatsApp bater com a reserva (variantes 55 / 9º dígito). Estado de conversa expira por idle (~30 min) + sweep periódico.

### Observability

- Logs estruturados: `event=booking_create|booking_cancel`, `wa_connect|wa_disconnect|wa_reconnect`, `reminder_send` (sem secrets)
- Admin: `GET /api/admin/metrics` → `{ bookings_today, wa_status, last_error_code, ... }` (JWT admin only)
- Health público permanece seguro: `{ ok, db, whatsapp, whatsapp_bot, court }`

### Smoke / regression

```bash
# API precisa estar no ar
BASE_URL=http://127.0.0.1:8000 ./scripts/smoke_test.sh

# ou pytest
BASE_URL=http://127.0.0.1:8000 python -m pytest backend/tests/test_smoke.py -q

# NL parser (sem API)
cd whatsapp && node tests/nl_smoke.mjs
```

Cobertura smoke: health (sem leak), courts, create booking + **409** conflict, admin auth reject (dashboard + metrics).
