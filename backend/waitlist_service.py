"""Waitlist for full slots — Cycle 25.

FIFO notify first waiting entry once when a slot frees (cancel/expire).
Best-effort WhatsApp; no hold locks — customer books normally on site/WA.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import site_settings as sset
import whatsapp_bridge
from booking_service import ACTIVE_STATUSES, COURT_ID, build_availability, slot_key
from cpf_utils import normalize_whatsapp, only_digits, phone_variants

logger = logging.getLogger("arena.waitlist")

WAITING = "waiting"
NOTIFIED = "notified"
FULFILLED = "fulfilled"
CANCELLED = "cancelled"
ACTIVE_WAIT = (WAITING, NOTIFIED)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_name(name: str) -> str:
    n = (name or "").strip()
    if len(n) < 2:
        raise ValueError("Informe seu nome (mín. 2 caracteres)")
    if len(n) > 80:
        n = n[:80]
    return n


def _validate_phone(phone: str) -> str:
    raw = only_digits(phone)
    if len(raw) < 10 or len(raw) > 15:
        raise ValueError("WhatsApp inválido (use DDD + número)")
    return normalize_whatsapp(phone)


def _parse_ymd(date: str) -> None:
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError as e:
        raise ValueError("Data inválida (use YYYY-MM-DD)") from e


def _parse_time(start_time: str) -> str:
    t = (start_time or "").strip()
    if not re.match(r"^\d{1,2}:\d{2}$", t):
        raise ValueError("Horário inválido (use HH:MM)")
    hh, mm = t.split(":")
    h, m = int(hh), int(mm)
    if h < 0 or h > 23 or m < 0 or m > 59:
        raise ValueError("Horário inválido")
    return f"{h:02d}:{m:02d}"


def covered_times_from_booking(booking: dict[str, Any]) -> list[str]:
    """Start times freed when this booking is cancelled/expired."""
    keys = booking.get("slot_keys") or []
    times: list[str] = []
    for sk in keys:
        parts = str(sk).split("|")
        if len(parts) >= 3:
            times.append(parts[-1])
    if not times and booking.get("start_time"):
        times = [str(booking["start_time"])]
    # de-dupe preserve order
    seen: set[str] = set()
    out: list[str] = []
    for t in times:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out


async def ensure_indexes(db) -> None:
    try:
        await db.waitlist.create_index([("slot_key", 1), ("status", 1), ("created_at", 1)], name="waitlist_fifo")
        await db.waitlist.create_index([("date", 1), ("status", 1)], name="waitlist_date")
        await db.waitlist.create_index("id", unique=True, name="waitlist_id")
        await db.waitlist.create_index(
            [("slot_key", 1), ("phone", 1)],
            unique=True,
            partialFilterExpression={"status": {"$in": [WAITING, NOTIFIED]}},
            name="uniq_waitlist_phone_slot_active",
        )
    except Exception as e:
        logger.warning("waitlist indexes: %s", e)


async def slot_is_full(db, court_id: str, date: str, start_time: str) -> bool:
    """True when slot is reserved or blocked (not free / not simply closed)."""
    avail = await build_availability(db, court_id, date)
    for s in avail.get("slots") or []:
        if s.get("time") == start_time:
            st = s.get("status")
            return st in ("reserved", "blocked", "occupied")
    return False


async def join_waitlist(
    db,
    *,
    court_id: str,
    date: str,
    start_time: str,
    name: str,
    phone: str,
) -> dict[str, Any]:
    settings = await sset.get_settings(db)
    if not bool(settings.get("waitlist_enabled", True)):
        raise ValueError("Lista de espera desativada no momento")

    court_id = court_id or COURT_ID
    if court_id != COURT_ID:
        raise ValueError("Quadra não encontrada")
    _parse_ymd(date)
    start_time = _parse_time(start_time)
    name_clean = _validate_name(name)
    phone_norm = _validate_phone(phone)
    sk = slot_key(court_id, date, start_time)

    if not await slot_is_full(db, court_id, date, start_time):
        raise ValueError("Horário está livre — reserve normalmente no site")

    variants = phone_variants(phone_norm) or [phone_norm]
    existing = await db.waitlist.find_one(
        {
            "slot_key": sk,
            "status": {"$in": list(ACTIVE_WAIT)},
            "phone": {"$in": variants},
        },
        {"_id": 0},
    )
    if existing:
        raise ValueError("Você já está na lista deste horário")

    # Position = count of waiting ahead + 1
    ahead = await db.waitlist.count_documents({"slot_key": sk, "status": WAITING})

    doc = {
        "id": str(uuid.uuid4()),
        "court_id": court_id,
        "date": date,
        "start_time": start_time,
        "slot_key": sk,
        "name": name_clean,
        "phone": phone_norm,
        "created_at": _now_iso(),
        "status": WAITING,
        "notified_at": None,
    }
    try:
        await db.waitlist.insert_one(doc)
    except Exception as e:
        # Unique index race → duplicate
        msg = str(e).lower()
        if "duplicate" in msg or "e11000" in msg:
            raise ValueError("Você já está na lista deste horário") from e
        raise
    doc.pop("_id", None)
    doc["position"] = ahead + 1
    logger.info(
        "event=waitlist_join id=%s slot=%s phone=%s pos=%s",
        doc["id"][:8],
        sk,
        phone_norm[-4:],
        doc["position"],
    )
    return doc


async def list_for_date(db, date: str, *, status: Optional[str] = None) -> list[dict[str, Any]]:
    _parse_ymd(date)
    q: dict[str, Any] = {"date": date}
    if status:
        q["status"] = status
    rows = await db.waitlist.find(q, {"_id": 0}).sort([("start_time", 1), ("created_at", 1)]).to_list(500)
    return rows


async def remove_entry(db, entry_id: str) -> bool:
    res = await db.waitlist.update_one(
        {"id": entry_id, "status": {"$in": [WAITING, NOTIFIED]}},
        {"$set": {"status": CANCELLED, "cancelled_at": _now_iso()}},
    )
    return res.modified_count == 1


async def notify_first_waiting(db, court_id: str, date: str, start_time: str) -> Optional[dict[str, Any]]:
    """Notify first FIFO waiting entry once; mark notified. Best-effort WA."""
    settings = await sset.get_settings(db)
    if not bool(settings.get("waitlist_enabled", True)):
        return None

    court_id = court_id or COURT_ID
    sk = slot_key(court_id, date, start_time)
    entry = await db.waitlist.find_one(
        {"slot_key": sk, "status": WAITING},
        sort=[("created_at", 1)],
    )
    if not entry:
        return None

    now = _now_iso()
    res = await db.waitlist.update_one(
        {"id": entry["id"], "status": WAITING},
        {"$set": {"status": NOTIFIED, "notified_at": now}},
    )
    if res.modified_count != 1:
        return None  # raced — another notifier won

    court_name = settings.get("court_name") or "Pedra Azul"
    msg = (
        f"Pedra Azul: vaga liberada! {date} às {start_time} na {court_name}. "
        f"Você era o próximo na lista — reserve agora no site (horário livre por ordem de chegada)."
    )
    wa_ok = False
    try:
        sent = await whatsapp_bridge.send_text(entry.get("phone") or "", msg)
        wa_ok = bool(sent)
    except Exception as e:
        logger.warning("waitlist WA notify failed: %s", e)

    logger.info(
        "event=waitlist_notify id=%s slot=%s wa=%s",
        entry["id"][:8],
        sk,
        wa_ok,
    )
    entry.pop("_id", None)
    entry["status"] = NOTIFIED
    entry["notified_at"] = now
    entry["whatsapp_sent"] = wa_ok
    return entry


async def notify_after_booking_freed(db, booking: dict[str, Any]) -> list[dict[str, Any]]:
    """Call after cancel/expire frees slot_locks — notify first waiter per freed hour."""
    if not booking:
        return []
    court_id = booking.get("court_id") or COURT_ID
    date = booking.get("date")
    if not date:
        return []
    results: list[dict[str, Any]] = []
    for t in covered_times_from_booking(booking):
        try:
            r = await notify_first_waiting(db, court_id, date, t)
            if r:
                results.append(r)
        except Exception as e:
            logger.warning("waitlist notify slot %s %s: %s", date, t, e)
    return results


async def mark_fulfilled_on_book(db, *, court_id: str, date: str, start_time: str, phone: str) -> int:
    """When someone books, mark their waitlist rows for that slot as fulfilled."""
    phone_norm = normalize_whatsapp(phone) if phone else ""
    if not phone_norm:
        return 0
    variants = phone_variants(phone_norm) or [phone_norm]
    sk = slot_key(court_id or COURT_ID, date, start_time)
    res = await db.waitlist.update_many(
        {"slot_key": sk, "phone": {"$in": variants}, "status": {"$in": list(ACTIVE_WAIT)}},
        {"$set": {"status": FULFILLED, "fulfilled_at": _now_iso()}},
    )
    return int(res.modified_count or 0)
