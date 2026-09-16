"""In-memory ops metrics for admin — no secrets, process-local counters."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Sao_Paulo")

_bookings_created = 0
_bookings_cancelled = 0
_bookings_today = 0
_bookings_today_ymd: Optional[str] = None
_last_error_code: Optional[str] = None
_last_event_at: Optional[str] = None
_wa_status_cache: Optional[str] = None


def _today_ymd() -> str:
    return datetime.now(TZ).strftime("%Y-%m-%d")


def _roll_day() -> None:
    global _bookings_today, _bookings_today_ymd
    ymd = _today_ymd()
    if _bookings_today_ymd != ymd:
        _bookings_today_ymd = ymd
        _bookings_today = 0


def note_booking_create(source: str = "web") -> None:
    global _bookings_created, _bookings_today, _last_event_at
    _roll_day()
    _bookings_created += 1
    _bookings_today += 1
    _last_event_at = datetime.now(TZ).isoformat()
    _ = source  # kept for future breakdown; not exposed as secret


def note_booking_cancel(source: str = "web") -> None:
    global _bookings_cancelled, _last_event_at
    _bookings_cancelled += 1
    _last_event_at = datetime.now(TZ).isoformat()
    _ = source


def note_error(code: str) -> None:
    global _last_error_code, _last_event_at
    if not code:
        return
    # Never store tokens/secrets — truncate free text
    _last_error_code = str(code)[:120]
    _last_event_at = datetime.now(TZ).isoformat()


def set_wa_status(status: Optional[str]) -> None:
    global _wa_status_cache
    if status:
        _wa_status_cache = str(status)[:40]


def snapshot(wa_status: Optional[str] = None) -> dict[str, Any]:
    _roll_day()
    wa = wa_status or _wa_status_cache or "DESCONECTADO"
    return {
        "bookings_today": _bookings_today,
        "bookings_created_total": _bookings_created,
        "bookings_cancelled_total": _bookings_cancelled,
        "wa_status": wa,
        "last_error_code": _last_error_code,
        "last_event_at": _last_event_at,
        "day": _bookings_today_ymd or _today_ymd(),
    }
