"""HTTP bridge from FastAPI to the Baileys WhatsApp sidecar (localhost)."""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

logger = logging.getLogger("arena.whatsapp")

WHATSAPP_SERVICE_URL = os.environ.get("WHATSAPP_SERVICE_URL", "http://127.0.0.1:3001").rstrip("/")
# Prefer INTERNAL_API_TOKEN (same as FastAPI /api/internal + Node sidecar); legacy alias second.
INTERNAL_TOKEN = (
    os.environ.get("INTERNAL_API_TOKEN")
    or os.environ.get("WHATSAPP_INTERNAL_TOKEN")
    or ""
).strip()


def _headers() -> dict:
    h = {"Accept": "application/json"}
    if INTERNAL_TOKEN:
        h["X-Internal-Token"] = INTERNAL_TOKEN
    return h


async def get_status() -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{WHATSAPP_SERVICE_URL}/status", headers=_headers())
            if r.status_code == 200:
                return r.json()
            return {
                "status": "ERRO",
                "qr": None,
                "number": None,
                "last_error": f"sidecar HTTP {r.status_code}",
            }
    except Exception as e:
        logger.warning("whatsapp status unreachable: %s", e)
        return {
            "status": "DESCONECTADO",
            "qr": None,
            "number": None,
            "last_error": "sidecar indisponível",
            "sidecar_up": False,
        }


async def health_label() -> str:
    st = await get_status()
    return st.get("status") or "DESCONECTADO"


async def start_session() -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(f"{WHATSAPP_SERVICE_URL}/start", headers=_headers())
        if r.status_code >= 400:
            detail = r.json().get("detail") if r.headers.get("content-type", "").startswith("application/json") else r.text
            raise RuntimeError(detail or f"HTTP {r.status_code}")
        return r.json()


async def logout_session() -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(f"{WHATSAPP_SERVICE_URL}/logout", headers=_headers())
        if r.status_code >= 400:
            detail = r.json().get("detail") if r.headers.get("content-type", "").startswith("application/json") else r.text
            raise RuntimeError(detail or f"HTTP {r.status_code}")
        return r.json()


async def send_text(phone: str, text: str) -> Optional[dict[str, Any]]:
    """Best-effort send. Returns None if not connected / sidecar down."""
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(
                f"{WHATSAPP_SERVICE_URL}/send",
                headers={**_headers(), "Content-Type": "application/json"},
                json={"phone": phone, "text": text},
            )
            if r.status_code == 200:
                return r.json()
            logger.warning("whatsapp send failed: %s %s", r.status_code, r.text[:200])
            return None
    except Exception as e:
        logger.warning("whatsapp send error: %s", e)
        return None
