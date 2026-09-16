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
| `CORS_ORIGINS` | não | Default `*` |
| `WHATSAPP_SERVICE_URL` | não | Default `http://127.0.0.1:3001` |
| `WHATSAPP_PORT` | não | Default `3001` |
| `WHATSAPP_HOST` | não | Default `127.0.0.1` (só localhost) |
| `WHATSAPP_INTERNAL_TOKEN` | não | Token compartilhado FastAPI ↔ sidecar |
| `WHATSAPP_SESSION_ID` | não | Default `default` (chave Mongo auth) |
| `WHATSAPP_AUTO_START` | não | Default `true` — tenta restaurar sessão no boot |
| `PORT` | não | Porta HTTP pública (Render define) |

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
