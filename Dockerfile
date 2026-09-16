# syntax=docker/dockerfile:1

# -----------------------------------------------------------------------------
# Stage 1: build React (CRA + craco) frontend
# -----------------------------------------------------------------------------
FROM node:20-bookworm-slim AS frontend-build
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps || npm install --legacy-peer-deps

COPY frontend/ ./

# Empty = same-origin (/api) when FastAPI serves the SPA
ARG REACT_APP_BACKEND_URL=
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL
ENV CI=true
ENV GENERATE_SOURCEMAP=false

RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Python FastAPI + static frontend
# -----------------------------------------------------------------------------
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System deps sometimes needed by cryptography / bcrypt wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /tmp/requirements.txt
# Skip emergentintegrations if still present (not on public PyPI)
RUN grep -viE '^[[:space:]]*emergentintegrations' /tmp/requirements.txt > /tmp/req.txt \
    && pip install --upgrade pip \
    && pip install -r /tmp/req.txt

COPY backend/ /app/backend/
COPY --from=frontend-build /app/frontend/build /app/frontend_build

# Runtime upload dirs (ephemeral on Render unless a disk is attached)
RUN mkdir -p /app/backend/uploads/crests /app/backend/uploads/comprovantes

WORKDIR /app/backend
ENV PYTHONPATH=/app/backend

EXPOSE 8000

# Render sets $PORT; default locally to 8000
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}"]
