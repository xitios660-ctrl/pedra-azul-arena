# syntax=docker/dockerfile:1

# -----------------------------------------------------------------------------
# Stage 1: build React (CRA + craco) frontend
# -----------------------------------------------------------------------------
FROM node:20-bookworm-slim AS frontend-build
WORKDIR /app/frontend

# Avoid Corepack/yarn surprises; this repo uses npm + package-lock.json.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack disable 2>/dev/null || true

COPY frontend/package.json frontend/package-lock.json ./
# --legacy-peer-deps: React 19 + CRA/craco peer ranges.
# Direct ajv@8.17.1 + overrides in package.json prevent ajv-keywords@5
# resolving against hoisted ajv@6 (MODULE_NOT_FOUND for dist/compile/codegen).
RUN npm ci --legacy-peer-deps

COPY frontend/ ./

# Fail fast if cycle-6 video assets missing from build context / git
RUN test -f public/assets/video/baleys-lite.mp4 \
 && test -f public/assets/video/baleys-poster.jpg \
 && test -f public/assets/video/baleys.mp4 \
 && ls -la public/assets/video/

# Empty = same-origin (/api) when FastAPI serves the SPA
ARG REACT_APP_BACKEND_URL=
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL
ENV CI=true
ENV GENERATE_SOURCEMAP=false
# Free-tier Docker builders often OOM on CRA; cap heap explicitly.
ENV NODE_OPTIONS=--max_old_space_size=1536

RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: WhatsApp (Baileys) deps
# -----------------------------------------------------------------------------
FROM node:20-bookworm-slim AS whatsapp-deps
WORKDIR /app/whatsapp
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack disable 2>/dev/null || true
COPY whatsapp/package.json whatsapp/package-lock.json ./
RUN npm ci --omit=dev

# -----------------------------------------------------------------------------
# Stage 3: Python FastAPI + static frontend + Node WhatsApp sidecar
# -----------------------------------------------------------------------------
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System certs only — Node runtime copied from official image (no nodesource).
# nodesource setup_20.x has been a common intermittent Render build failure.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Node 20 binary + npm/npx from the same major as build stages
COPY --from=node:20-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:20-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && node -v && npm -v

COPY backend/requirements.txt /tmp/requirements.txt
# Skip emergentintegrations if still present (not on public PyPI)
RUN grep -viE '^[[:space:]]*emergentintegrations' /tmp/requirements.txt > /tmp/req.txt \
    && pip install --upgrade pip \
    && pip install -r /tmp/req.txt

COPY backend/ /app/backend/
COPY whatsapp/ /app/whatsapp/
# Drop accidental nested junk if present (never needed at runtime)
RUN rm -rf /app/whatsapp/frontend /app/whatsapp/node_modules
COPY --from=whatsapp-deps /app/whatsapp/node_modules /app/whatsapp/node_modules
COPY --from=frontend-build /app/frontend/build /app/frontend_build
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Runtime upload dirs (ephemeral on Free; persist via disk mount + UPLOAD_DIR=/var/data/uploads)
RUN mkdir -p /app/backend/uploads/crests /app/backend/uploads/comprovantes \
    /var/data/uploads/crests /var/data/uploads/comprovantes

WORKDIR /app/backend
ENV PYTHONPATH=/app/backend \
    WHATSAPP_HOST=127.0.0.1 \
    WHATSAPP_PORT=3001 \
    WHATSAPP_SERVICE_URL=http://127.0.0.1:3001 \
    WHATSAPP_AUTO_START=true
# INTERNAL_API_TOKEN / WHATSAPP_INTERNAL_TOKEN come from the host/Render at runtime.
# start.sh unifies them (prefer INTERNAL_API_TOKEN) so FastAPI + Node share one secret.
# Also inherits: MONGO_URL, DB_NAME, JWT_SECRET, CORS_ORIGINS, WHATSAPP_ADMIN_JID, PORT, UPLOAD_DIR.

EXPOSE 8000

# Render sets $PORT; start.sh runs node whatsapp + uvicorn
CMD ["/app/start.sh"]
