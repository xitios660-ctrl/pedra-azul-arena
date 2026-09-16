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
| `CORS_ORIGINS` | não | Origens permitidas, **separadas por vírgula**. Local: default `*`. Em produção (`RENDER`/`ENV=production`), se `*` ou vazio → `https://pedra-azul.onrender.com` + localhost. Ex.: `https://pedra-azul.onrender.com` |
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
| `AUTH_RATE_LIMIT` | não | Max POSTs `/api/auth/login` por IP/janela (default 10) |
| `AUTH_RATE_WINDOW_SEC` | não | Janela do rate limit de login em segundos (default 60) |
| `WA_SELF_PING_MINUTES` | não | Default `5`. Ping localhost do sidecar WA (mín. 3). `0` desliga. **Não** impede sleep do Render Free. |
| `UPLOAD_DIR` | não | Pasta cache de uploads (crests/comprovantes). Local: `backend/uploads`. Render: `/var/data/uploads` (Starter+). **Comprovantes PIX: GridFS no Mongo (Free-safe)**; disk opcional. |

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
Uploads: **Free uses MongoDB GridFS for PIX comprovantes** (survive restarts); disk (`UPLOAD_DIR` / `pedra-uploads`) is optional cache on paid Starter+.

## Admin — login (seed)

1. Abra `/login`
2. Credenciais **seed** (override com env):
   - Email: `ADMIN_EMAIL` (default `Gugu123@`)
   - Senha: `ADMIN_PASSWORD` (default `Gugu123@`)
3. Troque a senha em produção (`ADMIN_EMAIL` / `ADMIN_PASSWORD` no Render) — o seed reaplica o hash se a env mudar.

## Admin — conectar WhatsApp (QR)

1. Login em `/login` (admin seed acima)
2. Aba **WhatsApp** no dashboard
3. No boot / após cold start: status `CONECTANDO` / **Restaurando sessão…** se já houver auth no Mongo (sem QR prematuro)
4. Só sem sessão (ou após logout): **Conectar / Gerar QR** → `AGUARDANDO_QR`
5. Celular: WhatsApp → Aparelhos conectados → escanear QR grande
6. Status vira `CONECTADO` + número; confirmações de reserva enviam mensagem automática
7. Se `loggedOut` / sessão inválida: **Desconectar** e gerar QR novo (`whatsapp_auth` no Mongo)

**Render Free:** o serviço dorme sem tráfego — o sidecar WA cai. O restore no Mongo ajuda no wake, mas **24/7 WhatsApp exige plano pago** (sem sleep). Self-ping (`WA_SELF_PING_MINUTES`) só faz nudge localhost enquanto o dyno já está acordado.

SSE: `GET /api/admin/whatsapp/events` (JWT/cookie admin).

## Admin — Configurações

Aba **Configurações** edita o singleton `site_settings` (WhatsApp E.164, PIX, endereço/Maps, preço/hora, abertura/fechamento, **dias abertos** `open_days`, duração do slot, **multi-hora** `allow_multi_hour` / `max_hours_per_booking`, **lista de espera** `waitlist_enabled`, **recorrente** `recurring_enabled` / `recurring_max_weeks`, estacionamento, nome da quadra).

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

Admin → aba **Calendário**: visão dia/semana/mês, bloquear horário ou **dia/período** (manutenção/feriado), desbloquear, criar/cancelar com confirmação.


## PWA / SEO (Cycle 3)

- Installable: `manifest.json` + ícones em `/icons/` + `theme-color` `#00E5FF`
- Service worker (`/sw.js`): **network-first** para HTML/navegação (não prende deploy velho); **nunca cacheia** `/api/*`; cache-first só para `/static/*` hashed
- SEO local: meta/OG + JSON-LD `SportsActivityLocation`/`LocalBusiness` (Núncio · Alto Tietê — **sem** inventar rua/telefone placeholder)
- PIX: estados **aguardando → informado → confirmado** (admin) · **cancelado** · **expirado** (~45 min). Nunca auto-confirma por texto


## Bot + Observability (Cycle 4)

Intents extras (pt-BR): estacionamento, duração (1h), PIX how-to, endereço/Maps (busca), “depois das 20”, sábado à noite, remarcar, mudança de ideia no meio do fluxo.

Cancel/remarcar só se o WhatsApp bater com a reserva (variantes 55 / 9º dígito). Estado de conversa expira por idle (~30 min) + sweep periódico.

### Remarcação (Cycle 19)

- Cliente: `POST /api/bookings/{id}/reschedule` (CPF + `date` + `start_time`) — janela = `cancel_min_hours` antes do horário **original**
- Admin: `POST /api/admin/bookings/{id}/reschedule` — sem janela
- Atômico: atualiza `date`/`start_time`/`slot_key` no mesmo doc (índice único parcial); conflito → **409**; pagamento/status preservados
- UI: **Reagendar** em Minhas Reservas e Admin → Reservas
- WhatsApp: intent `remarcar` / `mudar horário` → confirma → escolhe novo slot via `POST /api/internal/whatsapp/bookings/reschedule` (não cancela antes)

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
- Segurança: `INTERNAL_API_TOKEN` (ou legacy `WHATSAPP_INTERNAL_TOKEN`) obrigatório quando definido; CORS: em produção prefira origens explícitas (vírgula); `*` sem credentials (local).

## Cycle 8 notes
- Token unify: `start.sh` + `whatsapp_bridge` preferem `INTERNAL_API_TOKEN` (evita mismatch com sidecar).
- Booking: data local (não UTC via `toISOString`); preço das settings no UI; aviso **confirmação manual / WhatsApp pendente** se WA ≠ `CONECTADO`.
- Admin calendário mês: semana começa na **segunda** (pt-BR); Configurações refrescam o provider público ao salvar.
- `scripts/prod_smoke.sh` contra Render.

## Cycle 15 notes
- Admin: `POST /api/admin/calendar/block-day`, `block-range` (máx. 31 dias), `unblock-day`.
- Bloqueio preenche `blocked_slots` para cada horário livre (`open_hour`..`close_hour`); **não cancela** reservas ativas (conta `skipped_reserved`).
- Campo opcional `reason` (manutenção / feriado) nos docs de bloqueio.
- UI calendário (pt-BR, neon): Bloquear/Desbloquear dia + formulário de período na toolbar.
- Disponibilidade pública e bot WA já respeitam `get_blocked_times` / status `blocked`.

## Cycle 16 notes
- `site_settings.open_days`: lista de weekdays **Python** `datetime.weekday()` — **0=Seg … 6=Dom** (ISO Monday-first, zero-based). Default `[0,1,2,3,4,5,6]`.
- Seed/`ensure_seeded`: se faltar a chave, preenche com os 7 dias.
- `build_availability` / create booking / WA availability: weekday fora de `open_days` → slots `unavailable` (sem free); booking → 400 "Quadra fechada neste dia da semana".
- Admin Configurações: checkboxes Seg–Dom; booking mostra aviso se o dia escolhido estiver fechado.

## Cycle 17 notes
- `site_settings` amenities / FAQ: `has_parking`, `parking_note`, `game_duration_note` (default from `slot_duration_minutes`), `accepts_pix` (default true), `structure_blurb`, `amenities` (lista curta).
- Admin **Configurações**: checkboxes + textos; landing faixa **Estrutura / Conheça a quadra** (chips + blurb + vídeo).
- Bot WA: intents estacionamento / endereço / duração / PIX leem settings ao vivo (pt-BR curto).
- Sem inventar número de rua — `address_label` / `maps_url` inalterados na semântica.

## Cycle 18 notes
- WhatsApp cold-start: sempre tenta **restaurar sessão do Mongo** antes de gerar QR; QR só se credenciais ausentes ou `loggedOut`.
- Status: `CONECTANDO` (restaurando / backoff) ≠ `AGUARDANDO_QR` ≠ `DESCONECTADO`; logs `restore_ok` / `restore_fail` / `need_qr`.
- Admin UI: “Restaurando sessão…” durante restore (sem QR grande prematuro).
- Self-ping leve Python → sidecar `/health` a cada `WA_SELF_PING_MINUTES` (default 5, localhost). **Não** evita sleep Free; plano pago para WA 24/7.
- Persistência Mongo (`whatsapp_auth`) inalterada em força; sem spam de QR; uma quadra.

## Cycle 24 notes
- Multi-hora: `allow_multi_hour` (default true) + `max_hours_per_booking` (1–3, default 2).
- Disponibilidade: slots livres incluem `max_consecutive`; UI oferece “1 hora” / “2 horas”.
- Uma reserva com `duration_minutes` / `slot_keys` + collection `slot_locks` (unique `slot_key`) bloqueia todas as horas cobertas (409 em conflito).
- Preço = horas × preço horário (fim de semana inclusive). Cancel/expire/reschedule liberam todos os locks.
- Admin calendário mostra continuação (`↳`) e duração; criar reserva admin aceita `duration_hours`.

## Cycle 25 notes
- Lista de espera quando o horário está **reservado/bloqueado**: collection `waitlist` (FIFO).
- Público `POST /api/waitlist` (rate-limited); UI Booking: “Entrar na lista” em slots ocupados.
- Cancel/expire/reject liberam o slot e notificam o **primeiro** `waiting` via WhatsApp (best-effort), status → `notified` (uma vez).
- Admin: aba **Lista de espera** (por data) + remoção; Configurações: `waitlist_enabled` (default true).
- Sem hold lock — o cliente reserva normalmente no site/WA após o aviso.

## Cycle 27 notes
- Reservas recorrentes semanais: `POST /api/bookings/recurring` (+ preview) e admin `POST /api/admin/calendar/bookings/recurring`.
- Mesmo weekday + `start_time` por N semanas (2–8); cada ocorrência é booking próprio com `series_id` e `slot_locks`.
- Conflito numa semana → pula e reporta; sucesso parcial OK. Settings: `recurring_enabled` (default true), `recurring_max_weeks` (default 8).
- UI Booking: “Repetir por X semanas” + prévia livre/ocupado; cancelar uma não cancela a série; “Cancelar série futura” (cliente/admin).


## Cycle 28 notes
- Admin **audit log**: collection `audit_log` (`id`, `at`, `actor_email`/`actor_id`, `action`, `entity_type`, `entity_id`, `summary`, `meta` — sem segredos).
- Helper `audit_log.audit` best-effort nas mutações admin (PIX confirm/reject, cancel, create, block/unblock, settings, WhatsApp disconnect, no-show, check-in, waitlist remove, reschedule).
- `GET /api/admin/audit?limit=&action=` (admin JWT, mais recentes primeiro); aba **Atividade** com filtros.
- Índice `at` descendente; sem auto-delete.

## Cycle 29 notes
- Cupons de desconto (`promo_codes`): percentual ou valor fixo; `active`, `max_uses`, `used_count`, `expires_at`.
- Admin: listar / criar / desativar em **Configurações → Cupons**; audit `promo_create` / `promo_deactivate`.
- Público: `POST /api/promo/validate` (preview, sem consumir uso). Reserva aceita `promo_code`; claim atômico; `discount` + `promo_code` na booking; total/PIX após desconto (nunca negativo).
- UI Booking: campo Cupom + Aplicar; mostra preço antigo/novo.
