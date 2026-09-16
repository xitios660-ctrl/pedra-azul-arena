"""Shared booking helpers — used by public API, WhatsApp internal, and admin calendar."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Optional
from zoneinfo import ZoneInfo

from pymongo.errors import DuplicateKeyError

import site_settings as sset

TZ = ZoneInfo("America/Sao_Paulo")
COURT_ID = "court-1"
# Static fallbacks (used only until settings load; prefer get_court / get_time_slots)
COURT = {
    "id": COURT_ID,
    "name": sset.DEFAULTS["court_name"],
    "type": "Futsal · Society",
    "price_per_hour": sset.DEFAULTS["price_per_hour"],
    "color": "#2563EB",
}
TIME_SLOTS = [f"{h:02d}:00" for h in range(8, 24)]
DEPOSIT_RATE = 0.30
PIX_TTL_MINUTES = 45  # pending PIX expires; never auto-confirm from text alone
ACTIVE_STATUSES = ["pending", "awaiting_admin", "confirmed"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def now_local() -> datetime:
    return datetime.now(TZ)


def slot_key(court_id: str, date: str, start_time: str) -> str:
    return f"{court_id}|{date}|{start_time}"


def is_past_slot(date: str, start_time: str, now: Optional[datetime] = None) -> bool:
    n = now or now_local()
    today = n.strftime("%Y-%m-%d")
    if date < today:
        return True
    if date == today:
        try:
            parts = start_time.split(":")
            hour = int(parts[0])
            minute = int(parts[1]) if len(parts) > 1 else 0
            if hour < n.hour or (hour == n.hour and minute <= n.minute):
                return True
        except Exception:
            return False
    return False


async def get_runtime(db) -> dict[str, Any]:
    settings = await sset.get_settings(db)
    court = {
        "id": COURT_ID,
        "name": settings.get("court_name") or COURT["name"],
        "type": "Futsal · Society",
        "price_per_hour": float(settings["price_per_hour"]),
        "color": "#2563EB",
    }
    slots = sset.time_slots_from(settings)
    return {"settings": settings, "court": court, "time_slots": slots}


async def get_blocked_times(db, court_id: str, date: str) -> set[str]:
    rows = await db.blocked_slots.find(
        {"court_id": court_id, "date": date},
        {"_id": 0, "start_time": 1},
    ).to_list(100)
    return {r["start_time"] for r in rows}


async def build_availability(
    db,
    court_id: str,
    date: str,
    after_hour: Optional[int] = None,
) -> dict[str, Any]:
    if court_id != COURT_ID:
        raise ValueError("court_not_found")
    runtime = await get_runtime(db)
    court = runtime["court"]
    time_slots = runtime["time_slots"]
    price = court["price_per_hour"]
    bookings = await db.bookings.find(
        {
            "court_id": court_id,
            "date": date,
            "status": {"$in": ACTIVE_STATUSES},
        },
        {"_id": 0},
    ).to_list(500)
    taken = {b["start_time"]: b for b in bookings}
    blocked = await get_blocked_times(db, court_id, date)
    slots = []
    n = now_local()
    for t in time_slots:
        hour = int(t.split(":")[0])
        if after_hour is not None and hour < after_hour:
            continue
        b = taken.get(t)
        if b:
            status = "reserved"
        elif t in blocked:
            status = "blocked"
        elif is_past_slot(date, t, n):
            status = "unavailable"
        else:
            status = "available"
        legacy = (
            "occupied"
            if status == "reserved"
            else ("blocked" if status == "blocked" else ("free" if status == "available" else "unavailable"))
        )
        slots.append(
            {
                "time": t,
                "status": status,
                "legacy_status": legacy,
                "booking_status": b["status"] if b else None,
                "booking_id": b["id"] if b else None,
                "customer_name": b.get("customer_name") if b else None,
                "price": price,
            }
        )
    return {"court": court, "date": date, "slots": slots, "settings": {
        "open_hour": runtime["settings"]["open_hour"],
        "close_hour": runtime["settings"]["close_hour"],
        "slot_duration_minutes": runtime["settings"]["slot_duration_minutes"],
        "price_per_hour": price,
    }}


def _pix_payload(settings: dict[str, Any], deposit: float) -> dict[str, Any]:
    copy_text = (settings.get("pix_copy_text") or "").strip()
    if not copy_text:
        key = settings.get("pix_key") or "contato@pedraazulfs.com.br"
        # EMV merchant name max 13 chars
        copy_text = (
            f"00020126360014BR.GOV.BCB.PIX0114{key[:14]:<14}"
            f"5204000053039865802BR5913PEDRA AZUL FS6009SAO PAULO62070503***6304"
            f"{uuid.uuid4().hex[:8].upper()}"
        )
    # Keep unique suffix so mocks don't collide visually across bookings
    if "PIX-MOCK" not in copy_text and len(copy_text) < 40:
        copy_text = f"{copy_text}|{uuid.uuid4().hex[:8].upper()}"
    return {
        "method": "pix",
        "qr_code": f"PIX-KEY-{(settings.get('pix_key') or 'arena')[:24]}",
        "pix_copy_paste": copy_text,
        "pix_key": settings.get("pix_key"),
        "amount": deposit,
    }


async def create_booking_atomic(
    db,
    *,
    court_id: str,
    date: str,
    start_time: str,
    customer_name: str,
    whatsapp: str,
    cpf: str,
    cpf_masked: str,
    your_team_name: str = "Time A",
    opponent_team_name: str = "Time B",
    your_team_crest: Optional[str] = None,
    opponent_team_crest: Optional[str] = None,
    duration_minutes: Optional[int] = None,
    source: str = "web",
    status: str = "pending",
    payment_status: Optional[str] = None,
) -> dict[str, Any]:
    """Insert booking with unique slot_key. Raises DuplicateKeyError or ValueError."""
    if court_id != COURT_ID:
        raise ValueError("Quadra não encontrada")
    runtime = await get_runtime(db)
    settings = runtime["settings"]
    court = runtime["court"]
    time_slots = runtime["time_slots"]
    dur = int(duration_minutes or settings.get("slot_duration_minutes") or 60)
    if start_time not in time_slots:
        raise ValueError("Horário inválido")
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError as e:
        raise ValueError("Data inválida") from e
    if is_past_slot(date, start_time):
        raise ValueError("Horário indisponível")

    blocked = await get_blocked_times(db, court_id, date)
    if start_time in blocked:
        raise ValueError("Horário bloqueado")

    total = float(court["price_per_hour"]) * (dur / 60)
    deposit = round(total * DEPOSIT_RATE, 2)
    pay_status = payment_status or ("paid" if status == "confirmed" and source == "whatsapp" else "pending")

    pix_bits = _pix_payload(settings, deposit) if source == "web" else {
        "method": "whatsapp",
        "qr_code": None,
        "pix_copy_paste": None,
        "pix_key": settings.get("pix_key"),
        "amount": deposit,
    }

    booking = {
        "id": str(uuid.uuid4()),
        "cpf": cpf,
        "cpf_masked": cpf_masked,
        "customer_name": customer_name.strip(),
        "whatsapp": whatsapp,
        "court_id": court_id,
        "court_name": court["name"],
        "date": date,
        "start_time": start_time,
        "duration_minutes": dur,
        "your_team_name": your_team_name,
        "opponent_team_name": opponent_team_name,
        "your_team_crest": your_team_crest,
        "opponent_team_crest": opponent_team_crest,
        "total": total,
        "deposit": deposit,
        "status": status,
        "source": source,
        "payment": {
            **pix_bits,
            "status": pay_status,
            "created_at": now_iso(),
            "expires_at": (
                (datetime.now(timezone.utc) + timedelta(minutes=PIX_TTL_MINUTES)).isoformat()
                if pay_status == "pending" and status == "pending"
                else None
            ),
            "confirmed_at": now_iso() if status == "confirmed" else None,
            "comprovante_url": None,
            "comprovante_uploaded_at": None,
            "comprovante_gridfs_id": None,
        },
        "whatsapp_sent": False,
        "whatsapp_sent_at": None,
        "reminder_sent": False,
        "reminder_sent_at": None,
        "created_at": now_iso(),
        "slot_key": slot_key(court_id, date, start_time),
    }
    try:
        await db.bookings.insert_one(booking)
    except DuplicateKeyError:
        raise
    booking.pop("_id", None)
    return booking


async def expire_stale_pending(db) -> int:
    """Mark overdue pending PIX bookings as expired (frees slot). Admin confirm is the only paid path for web."""
    now = datetime.now(timezone.utc)
    cursor = db.bookings.find(
        {"status": "pending", "payment.status": "pending"},
        {"id": 1, "payment.expires_at": 1, "created_at": 1},
    )
    expired_ids = []
    async for b in cursor:
        exp = (b.get("payment") or {}).get("expires_at")
        created = b.get("created_at")
        deadline = None
        if exp:
            try:
                deadline = datetime.fromisoformat(exp.replace("Z", "+00:00"))
            except Exception:
                deadline = None
        if deadline is None and created:
            try:
                created_dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                deadline = created_dt + timedelta(minutes=PIX_TTL_MINUTES)
            except Exception:
                deadline = None
        if deadline and now >= deadline:
            expired_ids.append(b["id"])
    if not expired_ids:
        return 0
    result = await db.bookings.update_many(
        {"id": {"$in": expired_ids}, "status": "pending"},
        {"$set": {"status": "expired", "payment.status": "expired"}},
    )
    return result.modified_count


async def calendar_range(db, start_date: str, days: int = 7) -> dict[str, Any]:
    """Day / week / month view for the single court (max 42 days for month grid)."""
    from datetime import timedelta

    start = datetime.strptime(start_date, "%Y-%m-%d")
    days_out = []
    court = None
    n_days = max(1, min(int(days), 42))
    for i in range(n_days):
        d = (start + timedelta(days=i)).strftime("%Y-%m-%d")
        avail = await build_availability(db, COURT_ID, d)
        # Density summary for month heatmap (occupied / blocked / free)
        counts = {"reserved": 0, "blocked": 0, "available": 0, "unavailable": 0}
        for s in avail.get("slots") or []:
            st = s.get("status") or "unavailable"
            counts[st] = counts.get(st, 0) + 1
        avail["density"] = {
            "occupied": counts["reserved"],
            "blocked": counts["blocked"],
            "free": counts["available"],
            "unavailable": counts["unavailable"],
            "total_bookable": counts["reserved"] + counts["blocked"] + counts["available"],
        }
        court = avail["court"]
        days_out.append(avail)
    return {"court": court or COURT, "start_date": start_date, "days": days_out}
