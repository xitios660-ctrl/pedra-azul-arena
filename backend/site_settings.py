"""Mongo singleton `site_settings` — ops-editable court/contact config."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator, model_validator

SINGLETON_ID = "singleton"

# Seeded from former hardcoded frontend/backend values (one court).
DEFAULTS: dict[str, Any] = {
    "id": SINGLETON_ID,
    "whatsapp_e164": "551140028922",
    "whatsapp_display": "+55 (11) 4002-8922",
    "pix_key": "arena@premium",
    "pix_copy_text": (
        "00020126360014BR.GOV.BCB.PIX0114arena@premium5204000053039865802BR"
        "5913ARENA PREMIUM6009SAO PAULO62070503***6304ABCD"
    ),
    "address_label": "Núncio · Alto Tietê · SP",
    "maps_url": (
        "https://www.google.com/maps/search/?api=1&query=Pedra%20Azul%20Nuncio%20Alto%20Tiete%20SP"
    ),
    "price_per_hour": 130,
    "open_hour": 8,
    "close_hour": 23,  # inclusive last slot start hour
    "slot_duration_minutes": 60,
    "parking_note": "Estacionamento no entorno da quadra — chegue ~10 min antes.",
    "court_name": "Quadra Pedra Azul — Núncio",
}


class SiteSettingsUpdate(BaseModel):
    whatsapp_e164: str = Field(min_length=10, max_length=20)
    whatsapp_display: str = Field(min_length=5, max_length=40)
    pix_key: str = Field(min_length=3, max_length=120)
    pix_copy_text: str = Field(min_length=8, max_length=600)
    address_label: str = Field(min_length=3, max_length=160)
    maps_url: str = Field(min_length=8, max_length=500)
    price_per_hour: float = Field(gt=0, le=10000)
    open_hour: int = Field(ge=0, le=23)
    close_hour: int = Field(ge=0, le=23)
    slot_duration_minutes: int = Field(ge=30, le=180)
    parking_note: str = Field(min_length=0, max_length=240)
    court_name: Optional[str] = Field(default=None, max_length=120)

    @field_validator("whatsapp_e164")
    @classmethod
    def digits_wa(cls, v: str) -> str:
        d = re.sub(r"\D", "", v or "")
        if len(d) < 10 or len(d) > 15:
            raise ValueError("WhatsApp E.164 inválido (use só dígitos com DDI)")
        return d

    @field_validator("maps_url")
    @classmethod
    def http_url(cls, v: str) -> str:
        u = (v or "").strip()
        parsed = urlparse(u)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("maps_url deve ser http(s)")
        return u

    @field_validator("slot_duration_minutes")
    @classmethod
    def slot_step(cls, v: int) -> int:
        if v % 30 != 0:
            raise ValueError("slot_duration_minutes deve ser múltiplo de 30")
        return v

    @model_validator(mode="after")
    def hours_order(self):
        if self.close_hour < self.open_hour:
            raise ValueError("close_hour deve ser >= open_hour")
        return self


def public_view(doc: dict[str, Any]) -> dict[str, Any]:
    """Fields safe for public booking + WA bot."""
    d = {**DEFAULTS, **(doc or {})}
    return {
        "whatsapp_e164": d["whatsapp_e164"],
        "whatsapp_display": d["whatsapp_display"],
        "pix_key": d["pix_key"],
        "pix_copy_text": d["pix_copy_text"],
        "address_label": d["address_label"],
        "maps_url": d["maps_url"],
        "price_per_hour": float(d["price_per_hour"]),
        "open_hour": int(d["open_hour"]),
        "close_hour": int(d["close_hour"]),
        "slot_duration_minutes": int(d["slot_duration_minutes"]),
        "parking_note": d.get("parking_note") or DEFAULTS["parking_note"],
        "court_name": d.get("court_name") or DEFAULTS["court_name"],
    }


def time_slots_from(settings: dict[str, Any]) -> list[str]:
    open_h = int(settings.get("open_hour", DEFAULTS["open_hour"]))
    close_h = int(settings.get("close_hour", DEFAULTS["close_hour"]))
    step = int(settings.get("slot_duration_minutes", 60))
    if step <= 0 or step % 30 != 0:
        step = 60
    slots: list[str] = []
    # Generate from open to close inclusive at hour granularity when step==60;
    # for 30-min steps, walk minutes within [open, close+1).
    start_min = open_h * 60
    end_min = (close_h + 1) * 60  # exclusive end: close_hour is last start hour for 60m
    if step == 60:
        for h in range(open_h, close_h + 1):
            slots.append(f"{h:02d}:00")
        return slots
    m = start_min
    while m + step <= end_min:
        hh, mm = divmod(m, 60)
        if hh > 23:
            break
        slots.append(f"{hh:02d}:{mm:02d}")
        m += step
    return slots or [f"{open_h:02d}:00"]


async def ensure_seeded(db) -> dict[str, Any]:
    existing = await db.site_settings.find_one({"id": SINGLETON_ID}, {"_id": 0})
    if existing:
        # fill any missing keys from defaults without overwriting admin edits
        patch = {k: v for k, v in DEFAULTS.items() if k not in existing or existing.get(k) in (None, "")}
        if patch:
            patch.pop("id", None)
            if patch:
                await db.site_settings.update_one(
                    {"id": SINGLETON_ID},
                    {"$set": {**patch, "updated_at": datetime.now(timezone.utc).isoformat()}},
                )
                existing = await db.site_settings.find_one({"id": SINGLETON_ID}, {"_id": 0})
        return public_view(existing)
    doc = {
        **DEFAULTS,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.site_settings.insert_one(doc)
    doc.pop("_id", None)
    return public_view(doc)


async def get_settings(db) -> dict[str, Any]:
    doc = await db.site_settings.find_one({"id": SINGLETON_ID}, {"_id": 0})
    if not doc:
        return await ensure_seeded(db)
    return public_view(doc)


async def update_settings(db, payload: SiteSettingsUpdate) -> dict[str, Any]:
    data = payload.model_dump()
    if not data.get("court_name"):
        data["court_name"] = DEFAULTS["court_name"]
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.site_settings.update_one(
        {"id": SINGLETON_ID},
        {"$set": data, "$setOnInsert": {"id": SINGLETON_ID, "created_at": data["updated_at"]}},
        upsert=True,
    )
    return await get_settings(db)
