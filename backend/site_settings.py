"""Mongo singleton `site_settings` — ops-editable court/contact config.

open_days: list of Python datetime.weekday() ints — 0=Monday .. 6=Sunday
(ISO Monday-first, zero-based). Default [0,1,2,3,4,5,6] = all week.

Weekend hours (Cycle 21): optional weekend_open_hour / weekend_close_hour
(null or -1 = use weekday open_hour/close_hour). Weekend = Sat/Sun (5,6).

Weekend price (Cycle 23): optional price_weekend (null/0 = use price_per_hour on Sat/Sun).
Multi-hour (Cycle 24): allow_multi_hour + max_hours_per_booking (1–3, default 2).
maps_url may be empty — Landing/Footer hide "Como chegar" when unset.

Amenities / FAQ (Cycle 17): has_parking, parking_note, game_duration_note,
accepts_pix, structure_blurb, amenities — used on landing + WA FAQ.
Do not invent street numbers; keep address_label / maps_url as-is.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator, model_validator

SINGLETON_ID = "singleton"

# Seeded from former hardcoded frontend/backend values (one court).
# Placeholder PIX — admin must set the real key in Configurações (no fake street address).
DEFAULTS: dict[str, Any] = {
    "id": SINGLETON_ID,
    "whatsapp_e164": "551140028922",
    "whatsapp_display": "+55 (11) 4002-8922",
    "pix_key": "contato@pedraazulfs.com.br",
    "pix_copy_text": (
        "00020126360014BR.GOV.BCB.PIX0125contato@pedraazulfs.com.br"
        "5204000053039865802BR5913PEDRA AZUL FS6009SAO PAULO62070503***6304ABCD"
    ),
    "address_label": "Núncio · Alto Tietê · SP",
    "maps_url": (
        "https://www.google.com/maps/search/?api=1&query=Pedra%20Azul%20Nuncio%20Alto%20Tiete%20SP"
    ),
    "price_per_hour": 130,
    "price_weekend": None,  # null/0 = use price_per_hour on Sat/Sun
    "open_hour": 8,
    "close_hour": 23,  # inclusive last slot start hour (weekday / default)
    # Optional Sat/Sun hours (Python weekday 5,6). None / -1 = use open_hour/close_hour.
    "weekend_open_hour": None,
    "weekend_close_hour": None,
    # Weekdays court is open: Python datetime.weekday() — 0=Mon .. 6=Sun (ISO Mon-first, zero-based).
    "open_days": [0, 1, 2, 3, 4, 5, 6],
    "slot_duration_minutes": 60,
    # Cycle 24: multi-hour bookings (1–2 consecutive slots by default)
    "allow_multi_hour": True,
    "max_hours_per_booking": 2,  # capped 1–3
    "parking_note": "Estacionamento no entorno da quadra — chegue ~10 min antes.",
    "has_parking": True,
    "game_duration_note": "1 hora (60 min)",  # default aligned with slot_duration_minutes=60
    "accepts_pix": True,
    "structure_blurb": (
        "Quadra oficial no Alto Tietê — iluminação noturna, espaço para peladas e treinos. "
        "Chegue ~10 min antes."
    ),
    "amenities": ["Iluminação noturna", "Pelada & treino", "Copa Alto Tietê"],
    "court_name": "Quadra Pedra Azul — Núncio",
    "cancel_min_hours": 2,  # customer cancel cutoff before slot start; admin always can
    "reminder_hours_before": 3,  # WA reminder lead time (hours before start); window ±30min
    # Admin WA alerts — empty until owner sets a real number (never invent phones)
    "admin_whatsapp_e164": "",
    "admin_alerts_enabled": True,
}

# Legacy Arena Premium placeholders → migrate once if still at old seed values.
_LEGACY_PIX = {
    "pix_key": "arena@premium",
    "pix_copy_text": (
        "00020126360014BR.GOV.BCB.PIX0114arena@premium5204000053039865802BR"
        "5913ARENA PREMIUM6009SAO PAULO62070503***6304ABCD"
    ),
}


class SiteSettingsUpdate(BaseModel):
    whatsapp_e164: str = Field(min_length=10, max_length=20)
    whatsapp_display: str = Field(min_length=5, max_length=40)
    pix_key: str = Field(min_length=3, max_length=120)
    pix_copy_text: str = Field(min_length=8, max_length=600)
    address_label: str = Field(min_length=3, max_length=160)
    maps_url: str = Field(default="", max_length=500)
    price_per_hour: float = Field(gt=0, le=10000)
    price_weekend: Optional[float] = Field(default=None)
    open_hour: int = Field(ge=0, le=23)
    close_hour: int = Field(ge=0, le=23)
    weekend_open_hour: Optional[int] = Field(default=None)
    weekend_close_hour: Optional[int] = Field(default=None)
    open_days: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4, 5, 6])
    slot_duration_minutes: int = Field(ge=30, le=180)
    allow_multi_hour: bool = Field(default=True)
    max_hours_per_booking: int = Field(default=2, ge=1, le=3)
    parking_note: str = Field(min_length=0, max_length=240)
    has_parking: bool = Field(default=True)
    game_duration_note: str = Field(default="", max_length=120)
    accepts_pix: bool = Field(default=True)
    structure_blurb: str = Field(default="", max_length=400)
    amenities: list[str] = Field(default_factory=list)
    court_name: Optional[str] = Field(default=None, max_length=120)
    cancel_min_hours: int = Field(default=2, ge=0, le=168)
    reminder_hours_before: int = Field(default=3, ge=1, le=48)
    admin_whatsapp_e164: Optional[str] = Field(default="", max_length=20)
    admin_alerts_enabled: bool = Field(default=True)

    @field_validator("whatsapp_e164")
    @classmethod
    def digits_wa(cls, v: str) -> str:
        d = re.sub(r"\D", "", v or "")
        if len(d) < 10 or len(d) > 15:
            raise ValueError("WhatsApp E.164 inválido (use só dígitos com DDI)")
        return d

    @field_validator("admin_whatsapp_e164")
    @classmethod
    def digits_admin_wa(cls, v: Optional[str]) -> str:
        raw = (v or "").strip()
        if not raw:
            return ""
        d = re.sub(r"\D", "", raw)
        if len(d) < 10 or len(d) > 15:
            raise ValueError("WhatsApp admin E.164 inválido (vazio ou só dígitos com DDI)")
        return d

    @field_validator("maps_url")
    @classmethod
    def http_url(cls, v: str) -> str:
        u = (v or "").strip()
        if not u:
            return ""
        parsed = urlparse(u)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("maps_url deve ser http(s) ou vazio")
        return u

    @field_validator("slot_duration_minutes")
    @classmethod
    def slot_step(cls, v: int) -> int:
        if v % 30 != 0:
            raise ValueError("slot_duration_minutes deve ser múltiplo de 30")
        return v

    @field_validator("max_hours_per_booking")
    @classmethod
    def cap_max_hours(cls, v: int) -> int:
        n = int(v)
        if n < 1 or n > 3:
            raise ValueError("max_hours_per_booking deve ser 1–3")
        return n

    @field_validator("open_days")
    @classmethod
    def normalize_open_days(cls, v: list[int]) -> list[int]:
        if v is None:
            return [0, 1, 2, 3, 4, 5, 6]
        if not isinstance(v, list):
            raise ValueError("open_days deve ser lista de inteiros 0–6")
        out: list[int] = []
        for x in v:
            try:
                n = int(x)
            except (TypeError, ValueError) as e:
                raise ValueError("open_days: cada item deve ser int 0–6") from e
            if n < 0 or n > 6:
                raise ValueError("open_days: use 0=Seg … 6=Dom (Python weekday)")
            if n not in out:
                out.append(n)
        out.sort()
        return out

    @field_validator("amenities")
    @classmethod
    def normalize_amenities(cls, v: list[str]) -> list[str]:
        if v is None:
            return []
        if not isinstance(v, list):
            raise ValueError("amenities deve ser lista de strings curtas")
        out: list[str] = []
        for x in v:
            s = str(x or "").strip()
            if not s:
                continue
            if len(s) > 48:
                s = s[:48]
            if s not in out:
                out.append(s)
            if len(out) >= 12:
                break
        return out

    @field_validator("game_duration_note", "structure_blurb", "parking_note")
    @classmethod
    def strip_text(cls, v: str) -> str:
        return (v or "").strip()

    @field_validator("weekend_open_hour", "weekend_close_hour", mode="before")
    @classmethod
    def optional_weekend_hour(cls, v):
        """None / "" / -1 → unset (use weekday open/close)."""
        if v is None or v == "":
            return None
        try:
            n = int(v)
        except (TypeError, ValueError) as e:
            raise ValueError("hora de fim de semana inválida") from e
        if n == -1:
            return None
        if n < 0 or n > 23:
            raise ValueError("hora de fim de semana deve ser 0–23 ou -1/null")
        return n

    @field_validator("price_weekend", mode="before")
    @classmethod
    def optional_weekend_price(cls, v):
        """None / "" / 0 → unset (use price_per_hour on weekend)."""
        if v is None or v == "":
            return None
        try:
            n = float(v)
        except (TypeError, ValueError) as e:
            raise ValueError("preço de fim de semana inválido") from e
        if n <= 0:
            return None
        if n > 10000:
            raise ValueError("price_weekend deve ser <= 10000")
        return n

    @model_validator(mode="after")
    def hours_order(self):
        if self.close_hour < self.open_hour:
            raise ValueError("close_hour deve ser >= open_hour")
        wo, wc = self.weekend_open_hour, self.weekend_close_hour
        if (wo is None) != (wc is None):
            raise ValueError("Defina ambos weekend_open_hour e weekend_close_hour, ou nenhum")
        if wo is not None and wc is not None and wc < wo:
            raise ValueError("weekend_close_hour deve ser >= weekend_open_hour")
        return self



def _normalize_open_days(raw: Any) -> list[int]:
    """Python weekday ints 0=Mon..6=Sun.

    Missing/invalid → default all seven. Explicit [] stays empty (closed all week).
    """
    if raw is None:
        return list(DEFAULTS["open_days"])
    if not isinstance(raw, (list, tuple)):
        return list(DEFAULTS["open_days"])
    if len(raw) == 0:
        return []
    out: list[int] = []
    for x in raw:
        try:
            n = int(x)
        except (TypeError, ValueError):
            continue
        if 0 <= n <= 6 and n not in out:
            out.append(n)
    out.sort()
    return out if out else list(DEFAULTS["open_days"])


def is_open_weekday(date_ymd: str, settings: dict[str, Any] | None = None) -> bool:
    """True if YYYY-MM-DD falls on an open_days weekday (Python weekday)."""
    from datetime import datetime as _dt
    try:
        wd = _dt.strptime(date_ymd, "%Y-%m-%d").weekday()  # 0=Mon..6=Sun
    except ValueError:
        return False
    days = _normalize_open_days((settings or {}).get("open_days") if settings else None)
    return wd in days



def default_game_duration_note(mins: int | None = None) -> str:
    """Human label for slot length — default from slot_duration_minutes."""
    try:
        m = int(mins if mins is not None else DEFAULTS["slot_duration_minutes"])
    except (TypeError, ValueError):
        m = 60
    if m <= 0:
        m = 60
    if m == 60:
        return "1 hora (60 min)"
    if m % 60 == 0:
        h = m // 60
        return f"{h} hora{'s' if h != 1 else ''} ({m} min)"
    return f"{m} minutos"


def _normalize_amenities(raw: Any) -> list[str]:
    if raw is None:
        return list(DEFAULTS["amenities"])
    if not isinstance(raw, (list, tuple)):
        return list(DEFAULTS["amenities"])
    out: list[str] = []
    for x in raw:
        s = str(x or "").strip()
        if not s:
            continue
        if len(s) > 48:
            s = s[:48]
        if s not in out:
            out.append(s)
        if len(out) >= 12:
            break
    return out


def public_view(doc: dict[str, Any]) -> dict[str, Any]:
    """Fields safe for public booking + WA bot."""
    d = {**DEFAULTS, **(doc or {})}
    return {
        "whatsapp_e164": d["whatsapp_e164"],
        "whatsapp_display": d["whatsapp_display"],
        "pix_key": d["pix_key"],
        "pix_copy_text": d["pix_copy_text"],
        "address_label": d["address_label"],
        "maps_url": (d.get("maps_url") or "").strip(),
        "price_per_hour": float(d["price_per_hour"]),
        "price_weekend": _normalize_optional_price(d.get("price_weekend")),
        "open_hour": int(d["open_hour"]),
        "close_hour": int(d["close_hour"]),
        "weekend_open_hour": _normalize_optional_hour(d.get("weekend_open_hour")),
        "weekend_close_hour": _normalize_optional_hour(d.get("weekend_close_hour")),
        "open_days": _normalize_open_days(d.get("open_days")),
        "slot_duration_minutes": int(d["slot_duration_minutes"]),
        "allow_multi_hour": bool(d["allow_multi_hour"]) if d.get("allow_multi_hour") is not None else bool(DEFAULTS["allow_multi_hour"]),
        "max_hours_per_booking": max(1, min(3, int(
            d.get("max_hours_per_booking") if d.get("max_hours_per_booking") is not None else DEFAULTS["max_hours_per_booking"]
        ))),
        "parking_note": d.get("parking_note") if d.get("parking_note") is not None else DEFAULTS["parking_note"],
        "has_parking": bool(d["has_parking"]) if d.get("has_parking") is not None else bool(DEFAULTS["has_parking"]),
        "game_duration_note": (
            (d.get("game_duration_note") or "").strip()
            or default_game_duration_note(d.get("slot_duration_minutes"))
        ),
        "accepts_pix": bool(d["accepts_pix"]) if d.get("accepts_pix") is not None else bool(DEFAULTS["accepts_pix"]),
        "structure_blurb": (d.get("structure_blurb") if d.get("structure_blurb") is not None else DEFAULTS["structure_blurb"]) or "",
        "amenities": _normalize_amenities(d.get("amenities")),
        "court_name": d.get("court_name") or DEFAULTS["court_name"],
        "cancel_min_hours": int(d.get("cancel_min_hours") if d.get("cancel_min_hours") is not None else DEFAULTS["cancel_min_hours"]),
        "reminder_hours_before": int(
            d.get("reminder_hours_before") if d.get("reminder_hours_before") is not None else DEFAULTS["reminder_hours_before"]
        ),
        # admin_whatsapp_e164 stays admin-only (not in public_view)
        "admin_alerts_enabled": bool(
            d.get("admin_alerts_enabled") if d.get("admin_alerts_enabled") is not None else DEFAULTS["admin_alerts_enabled"]
        ),
    }



def _normalize_optional_price(raw: Any) -> float | None:
    """None / "" / 0 / negative → unset. Positive float kept."""
    if raw is None or raw == "":
        return None
    try:
        n = float(raw)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    return n


def has_weekend_price(settings: dict[str, Any] | None = None) -> bool:
    return _normalize_optional_price((settings or {}).get("price_weekend")) is not None


def price_for_date(
    settings: dict[str, Any],
    date_ymd: str | None = None,
    *,
    weekday: int | None = None,
) -> float:
    """Effective hourly price for a date. Sat/Sun use price_weekend when set."""
    base = float(settings.get("price_per_hour", DEFAULTS["price_per_hour"]))
    weekend = _normalize_optional_price(settings.get("price_weekend"))
    wd = weekday
    if wd is None and date_ymd:
        try:
            wd = datetime.strptime(date_ymd, "%Y-%m-%d").weekday()
        except ValueError:
            wd = None
    if wd is not None and wd in (5, 6) and weekend is not None:
        return float(weekend)
    return base


def _normalize_optional_hour(raw: Any) -> int | None:
    """None / -1 / "" → unset. Valid 0–23 kept."""
    if raw is None or raw == "":
        return None
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return None
    if n == -1:
        return None
    if 0 <= n <= 23:
        return n
    return None


def has_weekend_hours(settings: dict[str, Any] | None = None) -> bool:
    s = settings or {}
    wo = _normalize_optional_hour(s.get("weekend_open_hour"))
    wc = _normalize_optional_hour(s.get("weekend_close_hour"))
    return wo is not None and wc is not None


def hours_for_date(
    settings: dict[str, Any],
    date_ymd: str | None = None,
    *,
    weekday: int | None = None,
) -> tuple[int, int]:
    """Effective (open_hour, close_hour) for a date or weekday.

    Weekend = Python weekday 5 (Sat) or 6 (Sun). If weekend_* unset, use default pair.
    """
    open_h = int(settings.get("open_hour", DEFAULTS["open_hour"]))
    close_h = int(settings.get("close_hour", DEFAULTS["close_hour"]))
    wd = weekday
    if wd is None and date_ymd:
        try:
            wd = datetime.strptime(date_ymd, "%Y-%m-%d").weekday()
        except ValueError:
            wd = None
    if wd is not None and wd in (5, 6) and has_weekend_hours(settings):
        return (
            int(_normalize_optional_hour(settings.get("weekend_open_hour"))),
            int(_normalize_optional_hour(settings.get("weekend_close_hour"))),
        )
    return open_h, close_h


def time_slots_from(
    settings: dict[str, Any],
    date_ymd: str | None = None,
    *,
    weekday: int | None = None,
) -> list[str]:
    """Bookable start times for settings; optional date/weekday selects weekend hours."""
    open_h, close_h = hours_for_date(settings, date_ymd, weekday=weekday)
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
        # Replace leftover Arena Premium PIX seed if admin never customized it
        if existing.get("pix_key") == _LEGACY_PIX["pix_key"]:
            patch["pix_key"] = DEFAULTS["pix_key"]
        if existing.get("pix_copy_text") == _LEGACY_PIX["pix_copy_text"]:
            patch["pix_copy_text"] = DEFAULTS["pix_copy_text"]
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


def admin_view(doc: dict[str, Any]) -> dict[str, Any]:
    """Public fields + admin alert config (for Configurações UI)."""
    d = {**DEFAULTS, **(doc or {})}
    out = public_view(d)
    out["admin_whatsapp_e164"] = str(d.get("admin_whatsapp_e164") or "").strip()
    out["admin_alerts_enabled"] = bool(
        d.get("admin_alerts_enabled") if d.get("admin_alerts_enabled") is not None else True
    )
    return out


async def get_admin_settings(db) -> dict[str, Any]:
    doc = await db.site_settings.find_one({"id": SINGLETON_ID}, {"_id": 0})
    if not doc:
        await ensure_seeded(db)
        doc = await db.site_settings.find_one({"id": SINGLETON_ID}, {"_id": 0}) or {}
    return admin_view(doc)


async def update_settings(db, payload: SiteSettingsUpdate) -> dict[str, Any]:
    data = payload.model_dump()
    if not data.get("court_name"):
        data["court_name"] = DEFAULTS["court_name"]
    if not (data.get("game_duration_note") or "").strip():
        data["game_duration_note"] = default_game_duration_note(data.get("slot_duration_minutes"))
    if data.get("amenities") is None:
        data["amenities"] = list(DEFAULTS["amenities"])
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.site_settings.update_one(
        {"id": SINGLETON_ID},
        {"$set": data, "$setOnInsert": {"id": SINGLETON_ID, "created_at": data["updated_at"]}},
        upsert=True,
    )
    return await get_admin_settings(db)
