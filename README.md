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
| `WHATSAPP_INTERNAL_TOKEN` | não | Legacy token FastAPI ↔ sidecar (ainda aceito) |
| `INTERNAL_API_TOKEN` | prod | Preferido: header `X-Internal-Token` nas rotas `/api/internal/*`. Gere com `openssl rand -hex 32`. Em `render.yaml` está `sync: false` — defina no dashboard. |
| `WHATSAPP_SESSION_ID` | não | Default `default` (chave Mongo auth) |
| `WHATSAPP_AUTO_START` | não | Default `true` — tenta restaurar sessão no boot |
| `WHATSAPP_ADMIN_JID` | não | JID admin p/ notificar reservas WA (ex.: `5511999999999@s.whatsapp.net`) |
| `API_INTERNAL_URL` | não | Default `http://127.0.0.1:$PORT` — sidecar → FastAPI |
| `PORT` | não | Porta HTTP pública (Render define) |
| `BOOKING_RATE_LIMIT` | não | Max POSTs `/api/bookings` por IP/janela (default 8) |
| `BOOKING_RATE_WINDOW_SEC` | não | Janela do rate limit em segundos (default 60) |
| `UPLOAD_DIR` | não | Pasta de uploads (crests/comprovantes). Local: `backend/uploads`. Render: `/var/data/uploads` com disk `pedra-uploads` (Starter+; Free perde arquivos no restart) |

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
Uploads: disk `pedra-uploads` → `/var/data/uploads` (`UPLOAD_DIR`); Free tier is ephemeral until Starter+ disk is attached.

## Admin — login (seed)

1. Abra `/login`
2. Credenciais **seed** (override com env):
   - Email: `ADMIN_EMAIL` (default `Gugu123@`)
   - Senha: `ADMIN_PASSWORD` (default `Gugu123@`)
3. Troque a senha em produção (`ADMIN_EMAIL` / `ADMIN_PASSWORD` no Render) — o seed reaplica o hash se a env mudar.

## Admin — conectar WhatsApp (QR)

1. Login em `/login` (admin seed acima)
2. Aba **WhatsApp** no dashboard
3. **Conectar / Gerar QR** → status `AGUARDANDO_QR`
4. Celular: WhatsApp → Aparelhos conectados → escanear QR grande
5. Status vira `CONECTADO` + número; confirmações de reserva enviam mensagem automática
6. Se cair para `DESCONECTADO` / `ERRO`: Gerar QR de novo (auth state fica em Mongo `whatsapp_auth`)

SSE: `GET /api/admin/whatsapp/events` (JWT/cookie admin).

## Admin — Configurações

Aba **Configurações** edita o singleton `site_settings` (WhatsApp E.164, PIX, endereço/Maps, preço/hora, abertura/fechamento, duração do slot, estacionamento, nome da quadra).

- Público: `GET /api/site-settings`
- Admin JWT: `GET|PUT /api/admin/site-settings`
- Booking web + bot WhatsApp leem esses valores (cache ~60s no sidecar).

## INTERNAL_API_TOKEN (FastAPI ↔ WhatsApp)

Defina **um** segredo compartilhado no Render (`openssl rand -hex 32`):

| Variável | Papel |
|----------|--------|
| `INTERNAL_API_TOKEN` | Preferido — header `X-Internal-Token` |
| `WHATSAPP_INTERNAL_TOKEN` | Legacy / `generateValue` no blueprint |

`start.sh` **unifica** os dois no boot (prefere `INTERNAL_API_TOKEN`) para o bridge Python, as rotas `/api/internal/*` e o sidecar Node usarem o mesmo valor. Sem token, rotas internas ficam abertas (só localhost/dev).

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
- SEO local: meta/OG + JSON-LD `SportsActivityLocation`/`LocalBusiness` (Núncio · Alto Tietê — **sem** inventar rua/telefone placeholder)
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

# Produção (health + courts + site-settings + WA AGUARDANDO_QR|CONECTADO)
./scripts/prod_smoke.sh
# BASE_URL=https://pedra-azul.onrender.com ./scripts/prod_smoke.sh
```

Cobertura smoke: health (sem leak), courts, create booking + **409** conflict, admin auth reject (dashboard + metrics).
Prod smoke: `GET /api/health`, `/api/courts`, `/api/site-settings`, WhatsApp `AGUARDANDO_QR` ou `CONECTADO`.

## Cycle 5 notes
- WhatsApp **image comprovante** → booking `awaiting_admin` (informado); **never** auto-confirms.
- Persisted funnel metrics in Mongo (`daily_metrics`); `GET /api/admin/metrics` includes `last_7_days`.
- Admin **Fila PIX** for informados + one-click confirm / reject.

## Cycle 6 notes
- Admin **Configurações** (`site_settings` singleton): WhatsApp, PIX, endereço/Maps, preço/hora, abertura/fechamento, duração do slot.
- Booking público e bot WA leem preço/horários/contato dessas settings (fallback nos defaults).
- Hero video: `preload=metadata`, poster `baleys-poster.jpg`, cópia leve `baleys-lite.mp4` (ffmpeg).
- Segurança: `INTERNAL_API_TOKEN` (ou legacy `WHATSAPP_INTERNAL_TOKEN`) obrigatório quando definido; CORS `*` sem credentials.

## Cycle 8 notes
- Token unify: `start.sh` + `whatsapp_bridge` preferem `INTERNAL_API_TOKEN` (evita mismatch com sidecar).
- Booking: data local (não UTC via `toISOString`); preço das settings no UI; aviso **confirmação manual / WhatsApp pendente** se WA ≠ `CONECTADO`.
- Admin calendário mês: semana começa na **segunda** (pt-BR); Configurações refrescam o provider público ao salvar.
- `scripts/prod_smoke.sh` contra Render.
