# syntax=docker/dockerfile:1

# -----------------------------------------------------------------------------
# Stage 1: build React (CRA + craco) frontend
# -----------------------------------------------------------------------------
FROM node:20-bookworm-slim AS frontend-build
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
# --legacy-peer-deps: React 19 + CRA/craco peer ranges.
# Direct ajv@8.17.1 + overrides in package.json prevent ajv-keywords@5
# resolving against hoisted ajv@6 (MODULE_NOT_FOUND for dist/compile/codegen).
RUN npm ci --legacy-peer-deps

COPY frontend/ ./

# Empty = same-origin (/api) when FastAPI serves the SPA
ARG REACT_APP_BACKEND_URL=
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL
ENV CI=true
ENV GENERATE_SOURCEMAP=false

RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: WhatsApp (Baileys) deps
# -----------------------------------------------------------------------------
FROM node:20-bookworm-slim AS whatsapp-deps
WORKDIR /app/whatsapp
COPY whatsapp/package.json ./
RUN npm install --omit=dev

# -----------------------------------------------------------------------------
# Stage 3: Python FastAPI + static frontend + Node WhatsApp sidecar
# -----------------------------------------------------------------------------
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System deps + Node.js 20 for Baileys sidecar
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /tmp/requirements.txt
# Skip emergentintegrations if still present (not on public PyPI)
RUN grep -viE '^[[:space:]]*emergentintegrations' /tmp/requirements.txt > /tmp/req.txt \
    && pip install --upgrade pip \
    && pip install -r /tmp/req.txt

COPY backend/ /app/backend/
COPY whatsapp/ /app/whatsapp/
COPY --from=whatsapp-deps /app/whatsapp/node_modules /app/whatsapp/node_modules
COPY --from=frontend-build /app/frontend/build /app/frontend_build
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Runtime upload dirs (ephemeral on Render unless a disk is attached)
RUN mkdir -p /app/backend/uploads/crests /app/backend/uploads/comprovantes

WORKDIR /app/backend
ENV PYTHONPATH=/app/backend \
    WHATSAPP_HOST=127.0.0.1 \
    WHATSAPP_PORT=3001 \
    WHATSAPP_SERVICE_URL=http://127.0.0.1:3001 \
    WHATSAPP_AUTO_START=true

EXPOSE 8000

# Render sets $PORT; start.sh runs node whatsapp + uvicorn
CMD ["/app/start.sh"]
