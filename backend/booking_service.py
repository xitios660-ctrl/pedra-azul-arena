"""Shared booking helpers — used by public API, WhatsApp internal, and admin calendar."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from pymongo.errors import DuplicateKeyError

TZ = ZoneInfo("America/Sao_Paulo")
COURT_ID = "court-1"
COURT = {
    "id": COURT_ID,
    "name": "Quadra Pedra Azul — Núncio",
    "type": "Futsal · Society",
    "price_per_hour": 130,
    "color": "#2563EB",
}
TIME_SLOTS = [f"{h:02d}:00" for h in range(8, 24)]
DEPOSIT_RATE = 0.30
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
            hour = int(start_time.split(":")[0])
            if hour < n.hour or (hour == n.hour and n.minute > 0):
                return True
        except Exception:
            return False
    return False


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
    for t in TIME_SLOTS:
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
                "price": COURT["price_per_hour"],
            }
        )
    return {"court": COURT, "date": date, "slots": slots}


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
    duration_minutes: int = 60,
    source: str = "web",
    status: str = "pending",
    payment_status: Optional[str] = None,
) -> dict[str, Any]:
    """Insert booking with unique slot_key. Raises DuplicateKeyError or ValueError."""
    if court_id != COURT_ID:
        raise ValueError("Quadra não encontrada")
    if start_time not in TIME_SLOTS:
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

    total = COURT["price_per_hour"] * (duration_minutes / 60)
    deposit = round(total * DEPOSIT_RATE, 2)
    pay_status = payment_status or ("paid" if status == "confirmed" and source == "whatsapp" else "pending")

    booking = {
        "id": str(uuid.uuid4()),
        "cpf": cpf,
        "cpf_masked": cpf_masked,
        "customer_name": customer_name.strip(),
        "whatsapp": whatsapp,
        "court_id": court_id,
        "court_name": COURT["name"],
        "date": date,
        "start_time": start_time,
        "duration_minutes": duration_minutes,
        "your_team_name": your_team_name,
        "opponent_team_name": opponent_team_name,
        "your_team_crest": your_team_crest,
        "opponent_team_crest": opponent_team_crest,
        "total": total,
        "deposit": deposit,
        "status": status,
        "source": source,
        "payment": {
            "method": "pix" if source == "web" else "whatsapp",
            "status": pay_status,
            "qr_code": f"PIX-MOCK-{uuid.uuid4().hex[:16].upper()}",
            "pix_copy_paste": (
                f"00020126360014BR.GOV.BCB.PIX0114arena@premium5204000053039865802BR"
                f"5913ARENA PREMIUM6009SAO PAULO62070503***6304{uuid.uuid4().hex[:8].upper()}"
            ),
            "amount": deposit,
            "created_at": now_iso(),
            "confirmed_at": now_iso() if status == "confirmed" else None,
            "comprovante_url": None,
            "comprovante_uploaded_at": None,
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


async def calendar_range(db, start_date: str, days: int = 7) -> dict[str, Any]:
    """Day or week view for the single court."""
    from datetime import timedelta

    start = datetime.strptime(start_date, "%Y-%m-%d")
    days_out = []
    for i in range(max(1, min(days, 14))):
        d = (start + timedelta(days=i)).strftime("%Y-%m-%d")
        avail = await build_availability(db, COURT_ID, d)
        days_out.append(avail)
    return {"court": COURT, "start_date": start_date, "days": days_out}
