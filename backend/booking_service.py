"""Shared booking helpers — used by public API, WhatsApp internal, and admin calendar."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Optional
from zoneinfo import ZoneInfo

from pymongo.errors import BulkWriteError, DuplicateKeyError

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


def end_time_for(start_time: str, duration_minutes: int = 60) -> str:
    """HH:MM end exclusive of display (start + duration)."""
    parts = (start_time or "00:00").split(":")
    h = int(parts[0])
    m = int(parts[1]) if len(parts) > 1 else 0
    total = h * 60 + m + int(duration_minutes or 60)
    eh, em = divmod(total, 60)
    eh = eh % 24
    return f"{eh:02d}:{em:02d}"


def add_minutes_to_time(start_time: str, minutes: int) -> str:
    parts = (start_time or "00:00").split(":")
    h = int(parts[0])
    m = int(parts[1]) if len(parts) > 1 else 0
    total = h * 60 + m + int(minutes)
    eh, em = divmod(total, 60)
    return f"{eh:02d}:{em:02d}"


def covered_start_times(
    start_time: str,
    duration_minutes: int,
    time_slots: list[str],
    *,
    slot_step: int = 60,
) -> list[str]:
    """Consecutive bookable start times covered by a booking of duration_minutes."""
    step = int(slot_step or 60)
    if step <= 0:
        step = 60
    hours = max(1, int(duration_minutes or step) // step)
    if start_time not in time_slots:
        raise ValueError("Horário inválido")
    idx = time_slots.index(start_time)
    out: list[str] = []
    for i in range(hours):
        if idx + i >= len(time_slots):
            raise ValueError("Duração ultrapassa o horário de funcionamento")
        t = time_slots[idx + i]
        # Ensure adjacency for non-hourly grids
        if i > 0:
            expected = add_minutes_to_time(out[-1], step)
            if t != expected:
                raise ValueError("Horários consecutivos indisponíveis para esta duração")
        out.append(t)
    return out


def booking_covered_times(booking: dict[str, Any], time_slots: Optional[list[str]] = None, slot_step: int = 60) -> list[str]:
    """Times covered by an existing booking (slot_keys or duration expansion)."""
    keys = booking.get("slot_keys")
    if isinstance(keys, list) and keys:
        # slot_keys are full keys court|date|HH:MM — extract times if needed
        times = []
        for k in keys:
            if isinstance(k, str) and "|" in k:
                times.append(k.split("|")[-1])
            elif isinstance(k, str):
                times.append(k)
        if times:
            return times
    start = booking.get("start_time")
    if not start:
        return []
    dur = int(booking.get("duration_minutes") or slot_step or 60)
    if time_slots:
        try:
            return covered_start_times(start, dur, time_slots, slot_step=slot_step)
        except ValueError:
            pass
    # Fallback: expand by step without validating open hours
    step = int(slot_step or 60)
    hours = max(1, dur // step)
    return [add_minutes_to_time(start, step * i) for i in range(hours)]


def resolve_booking_duration(
    settings: dict[str, Any],
    *,
    duration_minutes: Optional[int] = None,
    duration_hours: Optional[int] = None,
) -> int:
    """Return duration in minutes (multiples of slot step). Caps via max_hours_per_booking."""
    step = int(settings.get("slot_duration_minutes") or 60)
    if step <= 0 or step % 30 != 0:
        step = 60
    allow = bool(settings.get("allow_multi_hour", True))
    max_h = int(settings.get("max_hours_per_booking") if settings.get("max_hours_per_booking") is not None else 2)
    max_h = max(1, min(3, max_h))

    if duration_hours is not None:
        try:
            hours = int(duration_hours)
        except (TypeError, ValueError) as e:
            raise ValueError("Duração inválida") from e
        dur = hours * step
    elif duration_minutes is not None:
        try:
            dur = int(duration_minutes)
        except (TypeError, ValueError) as e:
            raise ValueError("Duração inválida") from e
    else:
        dur = step

    if dur < step or dur % step != 0:
        raise ValueError("Duração inválida")
    hours = dur // step
    if hours > 1 and not allow:
        raise ValueError("Reserva de múltiplas horas está desativada")
    if hours > max_h:
        raise ValueError(f"Máximo de {max_h} hora(s) por reserva")
    return dur


def max_hours_cap(settings: dict[str, Any]) -> int:
    if not bool(settings.get("allow_multi_hour", True)):
        return 1
    max_h = int(settings.get("max_hours_per_booking") if settings.get("max_hours_per_booking") is not None else 2)
    return max(1, min(3, max_h))


async def release_slot_locks(db, booking_id: str) -> int:
    """Delete all slot_locks for a booking (cancel / expire / reschedule)."""
    if not booking_id:
        return 0
    res = await db.slot_locks.delete_many({"booking_id": booking_id})
    return int(res.deleted_count)


async def acquire_slot_locks(
    db,
    *,
    booking_id: str,
    court_id: str,
    date: str,
    times: list[str],
) -> list[str]:
    """Insert unique slot_locks for each start time. Raises DuplicateKeyError on conflict."""
    docs = []
    keys = []
    for t in times:
        sk = slot_key(court_id, date, t)
        keys.append(sk)
        docs.append(
            {
                "slot_key": sk,
                "booking_id": booking_id,
                "court_id": court_id,
                "date": date,
                "start_time": t,
                "created_at": now_iso(),
            }
        )
    try:
        if docs:
            await db.slot_locks.insert_many(docs, ordered=True)
    except DuplicateKeyError:
        await release_slot_locks(db, booking_id)
        raise
    except BulkWriteError as e:
        await release_slot_locks(db, booking_id)
        # insert_many surfaces unique conflicts as BulkWriteError (code 11000)
        errs = (e.details or {}).get("writeErrors") or []
        if any(int(x.get("code") or 0) == 11000 for x in errs):
            raise DuplicateKeyError(str(e)) from e
        raise
    except Exception:
        await release_slot_locks(db, booking_id)
        raise
    return keys


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


async def get_runtime(db, date: Optional[str] = None) -> dict[str, Any]:
    """Court + settings + time slots. Pass date (YYYY-MM-DD) for weekend-aware hours."""
    settings = await sset.get_settings(db)
    price = sset.price_for_date(settings, date) if date else float(settings["price_per_hour"])
    court = {
        "id": COURT_ID,
        "name": settings.get("court_name") or COURT["name"],
        "type": "Futsal · Society",
        "price_per_hour": float(price),
        "color": "#2563EB",
    }
    slots = sset.time_slots_from(settings, date)
    open_h, close_h = sset.hours_for_date(settings, date)
    return {
        "settings": settings,
        "court": court,
        "time_slots": slots,
        "effective_open_hour": open_h,
        "effective_close_hour": close_h,
    }


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
    runtime = await get_runtime(db, date)
    court = runtime["court"]
    time_slots = runtime["time_slots"]
    price = court["price_per_hour"]
    day_open = sset.is_open_weekday(date, runtime["settings"])
    bookings = await db.bookings.find(
        {
            "court_id": court_id,
            "date": date,
            "status": {"$in": ACTIVE_STATUSES},
        },
        {"_id": 0},
    ).to_list(500)
    step = int(runtime["settings"].get("slot_duration_minutes") or 60)
    taken: dict[str, Any] = {}
    for b in bookings:
        for t in booking_covered_times(b, time_slots, slot_step=step):
            # Prefer the booking whose start matches (primary) when overlapping legacy data
            if t not in taken or taken[t].get("start_time") != t:
                if t not in taken or b.get("start_time") == t:
                    taken[t] = b
                elif taken[t].get("start_time") != t:
                    taken[t] = b
    # slot_locks as secondary source (covers races / multi-hour secondary hours)
    try:
        lock_rows = await db.slot_locks.find(
            {"court_id": court_id, "date": date},
            {"_id": 0, "start_time": 1, "booking_id": 1},
        ).to_list(200)
    except Exception:
        lock_rows = []
    booking_by_id = {b["id"]: b for b in bookings if b.get("id")}
    for lr in lock_rows:
        t = lr.get("start_time")
        if not t or t in taken:
            continue
        bid = lr.get("booking_id")
        b = booking_by_id.get(bid)
        if b:
            taken[t] = b
    blocked = await get_blocked_times(db, court_id, date)
    slots = []
    n = now_local()
    for t in time_slots:
        hour = int(t.split(":")[0])
        if after_hour is not None and hour < after_hour:
            continue
        b = taken.get(t)
        if not day_open:
            # Closed weekday — still surface reserved/blocked for admin calendar honesty
            if b:
                status = "reserved"
            elif t in blocked:
                status = "blocked"
            else:
                status = "unavailable"
        elif b:
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
        is_continuation = bool(b and b.get("start_time") and b.get("start_time") != t)
        slots.append(
            {
                "time": t,
                "status": status,
                "legacy_status": legacy,
                "booking_status": b["status"] if b else None,
                "booking_id": b["id"] if b else None,
                "customer_name": b.get("customer_name") if b else None,
                "checked_in_at": b.get("checked_in_at") if b else None,
                "checked_in": bool(b.get("checked_in_at")) if b else False,
                "duration_minutes": int(b.get("duration_minutes") or step) if b else None,
                "is_continuation": is_continuation,
                "series_id": b.get("series_id") if b else None,
                "price": price,
            }
        )
    # max_consecutive for free slots (UI 1h/2h chips)
    cap = max_hours_cap(runtime["settings"])
    for i, slot in enumerate(slots):
        if slot["status"] != "available":
            slot["max_consecutive"] = 0
            continue
        n_free = 0
        for j in range(i, len(slots)):
            if slots[j]["status"] != "available":
                break
            if j > i:
                expected = add_minutes_to_time(slots[j - 1]["time"], step)
                if slots[j]["time"] != expected:
                    break
            n_free += 1
            if n_free >= cap:
                break
        slot["max_consecutive"] = n_free
    return {"court": court, "date": date, "slots": slots, "day_open": day_open, "settings": {
        "open_hour": runtime["settings"]["open_hour"],
        "close_hour": runtime["settings"]["close_hour"],
        "weekend_open_hour": runtime["settings"].get("weekend_open_hour"),
        "weekend_close_hour": runtime["settings"].get("weekend_close_hour"),
        "effective_open_hour": runtime["effective_open_hour"],
        "effective_close_hour": runtime["effective_close_hour"],
        "open_days": runtime["settings"].get("open_days", [0, 1, 2, 3, 4, 5, 6]),
        "slot_duration_minutes": runtime["settings"]["slot_duration_minutes"],
        "price_per_hour": float(runtime["settings"]["price_per_hour"]),
        "price_weekend": runtime["settings"].get("price_weekend"),
        "effective_price_per_hour": price,
        "allow_multi_hour": bool(runtime["settings"].get("allow_multi_hour", True)),
        "max_hours_per_booking": max_hours_cap(runtime["settings"]),
        "waitlist_enabled": bool(runtime["settings"].get("waitlist_enabled", True)),
        "recurring_enabled": bool(runtime["settings"].get("recurring_enabled", True)),
        "recurring_max_weeks": max(2, min(8, int(
            runtime["settings"].get("recurring_max_weeks")
            if runtime["settings"].get("recurring_max_weeks") is not None
            else 8
        ))),
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
    duration_hours: Optional[int] = None,
    source: str = "web",
    status: str = "pending",
    payment_status: Optional[str] = None,
    series_id: Optional[str] = None,
    promo_code: Optional[str] = None,
) -> dict[str, Any]:
    """Insert one booking spanning N consecutive slots + unique slot_locks.

    Primary bookings.slot_key = start hour (partial unique index).
    All covered hours also locked in slot_locks (unique slot_key) so 2h
    blocks the second hour. Raises DuplicateKeyError or ValueError.
    """
    if court_id != COURT_ID:
        raise ValueError("Quadra não encontrada")
    runtime = await get_runtime(db, date)
    settings = runtime["settings"]
    court = runtime["court"]
    time_slots = runtime["time_slots"]
    step = int(settings.get("slot_duration_minutes") or 60)
    dur = resolve_booking_duration(
        settings,
        duration_minutes=duration_minutes,
        duration_hours=duration_hours,
    )
    if start_time not in time_slots:
        raise ValueError("Horário inválido")
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError as e:
        raise ValueError("Data inválida") from e
    if is_past_slot(date, start_time):
        raise ValueError("Horário indisponível")

    if not sset.is_open_weekday(date, settings):
        raise ValueError("Quadra fechada neste dia da semana")

    covered = covered_start_times(start_time, dur, time_slots, slot_step=step)
    blocked = await get_blocked_times(db, court_id, date)
    for t in covered:
        if t in blocked:
            raise ValueError("Horário bloqueado")
        if is_past_slot(date, t):
            raise ValueError("Horário indisponível")

    # Conflict with active bookings (incl. multi-hour expansion / legacy without locks)
    reserved = await _reserved_times(db, court_id, date)
    for t in covered:
        if t in reserved:
            raise DuplicateKeyError("slot taken")

    # Price = hours × applicable hourly (weekend-aware via get_runtime / wall-clock)
    bill_hours = dur / 60.0
    original_total = round(float(court["price_per_hour"]) * bill_hours, 2)
    total = original_total
    discount = 0.0
    applied_promo = None
    claimed_promo_code = None

    # Optional promo: claim atomically after locks so we can roll back cleanly
    booking_id = str(uuid.uuid4())
    primary_sk = slot_key(court_id, date, start_time)
    end_t = end_time_for(start_time, dur)

    # Lock all covered slots first (unique) — then claim promo + insert booking
    slot_keys = await acquire_slot_locks(
        db,
        booking_id=booking_id,
        court_id=court_id,
        date=date,
        times=covered,
    )

    if promo_code and str(promo_code).strip():
        import promo_codes as promo_svc
        try:
            claimed = await promo_svc.claim_promo(db, promo_code)
            claimed_promo_code = claimed.get("code")
            priced = promo_svc.compute_discount(original_total, claimed)
            total = float(priced["total"])
            discount = float(priced["discount"])
            applied_promo = claimed_promo_code
        except ValueError:
            await release_slot_locks(db, booking_id)
            raise
        except Exception:
            await release_slot_locks(db, booking_id)
            raise

    deposit = round(total * DEPOSIT_RATE, 2)
    pay_status = payment_status or ("paid" if status == "confirmed" and source == "whatsapp" else "pending")

    pix_bits = _pix_payload(settings, deposit) if source == "web" else {
        "method": "whatsapp" if source == "whatsapp" else ("admin" if source == "admin" else "other"),
        "qr_code": None,
        "pix_copy_paste": None,
        "pix_key": settings.get("pix_key"),
        "amount": deposit,
    }

    booking = {
        "id": booking_id,
        "cpf": cpf,
        "cpf_masked": cpf_masked,
        "customer_name": customer_name.strip(),
        "whatsapp": whatsapp,
        "court_id": court_id,
        "court_name": court["name"],
        "date": date,
        "start_time": start_time,
        "end_time": end_t,
        "duration_minutes": dur,
        "duration_hours": int(round(bill_hours)) if abs(bill_hours - round(bill_hours)) < 1e-9 else bill_hours,
        "your_team_name": your_team_name,
        "opponent_team_name": opponent_team_name,
        "your_team_crest": your_team_crest,
        "opponent_team_crest": opponent_team_crest,
        "total": total,
        "original_total": original_total,
        "discount": discount,
        "promo_code": applied_promo,
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
        "admin_notes": "",
        "checked_in_at": None,
        "created_at": now_iso(),
        "slot_key": primary_sk,
        "slot_keys": slot_keys,
        "series_id": series_id,
    }
    try:
        await db.bookings.insert_one(booking)
    except DuplicateKeyError:
        await release_slot_locks(db, booking_id)
        if claimed_promo_code:
            import promo_codes as promo_svc
            await promo_svc.release_claim(db, claimed_promo_code)
        raise
    except Exception:
        await release_slot_locks(db, booking_id)
        if claimed_promo_code:
            import promo_codes as promo_svc
            await promo_svc.release_claim(db, claimed_promo_code)
        raise
    booking.pop("_id", None)
    return booking


async def expire_stale_pending(db) -> int:
    """Mark overdue pending PIX bookings as expired (frees slot). Admin confirm is the only paid path for web."""
    now = datetime.now(timezone.utc)
    cursor = db.bookings.find(
        {"status": "pending", "payment.status": "pending"},
        {"id": 1, "payment.expires_at": 1, "created_at": 1, "court_id": 1, "date": 1,
         "start_time": 1, "slot_keys": 1, "slot_key": 1},
    )
    expired_ids = []
    expired_docs = []
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
            expired_docs.append(b)
    if not expired_ids:
        return 0
    result = await db.bookings.update_many(
        {"id": {"$in": expired_ids}, "status": "pending"},
        {"$set": {"status": "expired", "payment.status": "expired"}},
    )
    for bid in expired_ids:
        try:
            await release_slot_locks(db, bid)
        except Exception:
            pass
    # Cycle 25: best-effort waitlist notify for freed slots
    try:
        import waitlist_service as wls
        for doc in expired_docs:
            try:
                await wls.notify_after_booking_freed(db, doc)
            except Exception:
                pass
    except Exception:
        pass
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


MAX_BLOCK_RANGE_DAYS = 31


def _parse_ymd(date: str) -> datetime:
    try:
        return datetime.strptime(date, "%Y-%m-%d")
    except ValueError as e:
        raise ValueError("Data inválida") from e


async def _reserved_times(db, court_id: str, date: str) -> set[str]:
    rows = await db.bookings.find(
        {
            "court_id": court_id,
            "date": date,
            "status": {"$in": ACTIVE_STATUSES},
        },
        {"_id": 0, "start_time": 1, "duration_minutes": 1, "slot_keys": 1},
    ).to_list(500)
    out: set[str] = set()
    for r in rows:
        for t in booking_covered_times(r, slot_step=60):
            out.add(t)
    return out


async def block_day(
    db,
    *,
    date: str,
    reason: Optional[str] = None,
    created_by: Optional[str] = None,
    court_id: str = COURT_ID,
) -> dict[str, Any]:
    """Block every bookable slot on a date. Skips slots with active reservations."""
    _parse_ymd(date)
    runtime = await get_runtime(db, date)
    time_slots = runtime["time_slots"]
    reserved = await _reserved_times(db, court_id, date)
    reason_clean = (reason or "").strip()[:200] or None
    blocked = 0
    skipped_reserved = 0
    already = 0
    for t in time_slots:
        if t in reserved:
            skipped_reserved += 1
            continue
        sk = slot_key(court_id, date, t)
        existing = await db.blocked_slots.find_one({"slot_key": sk}, {"_id": 1})
        if existing:
            already += 1
            if reason_clean:
                await db.blocked_slots.update_one(
                    {"slot_key": sk},
                    {"$set": {"reason": reason_clean}},
                )
            continue
        doc = {
            "id": str(uuid.uuid4()),
            "court_id": court_id,
            "date": date,
            "start_time": t,
            "slot_key": sk,
            "created_at": now_iso(),
            "created_by": created_by,
        }
        if reason_clean:
            doc["reason"] = reason_clean
        try:
            await db.blocked_slots.update_one({"slot_key": sk}, {"$set": doc}, upsert=True)
            blocked += 1
        except DuplicateKeyError:
            already += 1
    return {
        "ok": True,
        "date": date,
        "blocked": blocked,
        "skipped_reserved": skipped_reserved,
        "already_blocked": already,
        "total_slots": len(time_slots),
        "reason": reason_clean,
    }


async def block_date_range(
    db,
    *,
    date_from: str,
    date_to: str,
    reason: Optional[str] = None,
    created_by: Optional[str] = None,
    court_id: str = COURT_ID,
) -> dict[str, Any]:
    """Inclusive date range; max MAX_BLOCK_RANGE_DAYS days."""
    start = _parse_ymd(date_from)
    end = _parse_ymd(date_to)
    if end < start:
        raise ValueError("date_to deve ser >= date_from")
    n_days = (end - start).days + 1
    if n_days > MAX_BLOCK_RANGE_DAYS:
        raise ValueError(f"Intervalo máximo de {MAX_BLOCK_RANGE_DAYS} dias")
    days_out: list[dict[str, Any]] = []
    totals = {"blocked": 0, "skipped_reserved": 0, "already_blocked": 0}
    cur = start
    while cur <= end:
        d = cur.strftime("%Y-%m-%d")
        day_res = await block_day(
            db, date=d, reason=reason, created_by=created_by, court_id=court_id
        )
        days_out.append(day_res)
        totals["blocked"] += day_res["blocked"]
        totals["skipped_reserved"] += day_res["skipped_reserved"]
        totals["already_blocked"] += day_res["already_blocked"]
        cur += timedelta(days=1)
    return {
        "ok": True,
        "date_from": date_from,
        "date_to": date_to,
        "days": n_days,
        "blocked": totals["blocked"],
        "skipped_reserved": totals["skipped_reserved"],
        "already_blocked": totals["already_blocked"],
        "per_day": days_out,
        "reason": (reason or "").strip()[:200] or None,
    }


async def unblock_day(
    db,
    *,
    date: str,
    court_id: str = COURT_ID,
) -> dict[str, Any]:
    """Remove all blocked_slots for a date (does not touch bookings)."""
    _parse_ymd(date)
    res = await db.blocked_slots.delete_many({"court_id": court_id, "date": date})
    return {"ok": True, "date": date, "removed": int(res.deleted_count)}


async def reschedule_booking_atomic(
    db,
    *,
    booking_id: str,
    new_date: str,
    new_start_time: str,
    match_extra: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Move an active booking to a new slot in-place (same id).

    Preserves status and payment.* (pending stays pending; paid stays paid).
    Relies on partial unique index uniq_active_slot_key — DuplicateKeyError → conflict.
    Raises DuplicateKeyError or ValueError.
    """
    from pymongo import ReturnDocument

    try:
        datetime.strptime(new_date, "%Y-%m-%d")
    except ValueError as e:
        raise ValueError("Data inválida") from e

    runtime = await get_runtime(db, new_date)
    settings = runtime["settings"]
    time_slots = runtime["time_slots"]
    if new_start_time not in time_slots:
        raise ValueError("Horário inválido")
    if is_past_slot(new_date, new_start_time):
        raise ValueError("Horário indisponível")
    if not sset.is_open_weekday(new_date, settings):
        raise ValueError("Quadra fechada neste dia da semana")

    q: dict[str, Any] = {"id": booking_id, "status": {"$in": list(ACTIVE_STATUSES)}}
    if match_extra:
        q.update(match_extra)

    existing = await db.bookings.find_one(q)
    if not existing:
        raise ValueError("Reserva não encontrada ou inativa")

    court_id = existing.get("court_id") or COURT_ID
    if court_id != COURT_ID:
        raise ValueError("Quadra não encontrada")

    old_date = existing.get("date")
    old_time = existing.get("start_time")
    if old_date == new_date and old_time == new_start_time:
        raise ValueError("Já está neste horário")

    step = int(settings.get("slot_duration_minutes") or 60)
    dur = int(existing.get("duration_minutes") or step or 60)
    # Clamp duration to current multi-hour policy (keep same wall duration when allowed)
    try:
        dur = resolve_booking_duration(settings, duration_minutes=dur)
    except ValueError:
        # If policy tightened, fall back to single slot
        dur = step

    covered = covered_start_times(new_start_time, dur, time_slots, slot_step=step)
    blocked = await get_blocked_times(db, court_id, new_date)
    for t in covered:
        if t in blocked:
            raise ValueError("Horário bloqueado")
        if is_past_slot(new_date, t):
            raise ValueError("Horário indisponível")

    booking_id = existing["id"]
    new_sk = slot_key(court_id, new_date, new_start_time)
    new_keys = [slot_key(court_id, new_date, t) for t in covered]
    new_price = float(sset.price_for_date(settings, new_date))
    new_total = new_price * (dur / 60.0)
    new_deposit = round(new_total * DEPOSIT_RATE, 2)
    end_t = end_time_for(new_start_time, dur)

    # Free old locks first, then acquire new — if acquire fails, re-lock old (best effort)
    try:
        old_runtime = await get_runtime(db, old_date) if old_date else runtime
        old_times = booking_covered_times(existing, old_runtime["time_slots"], slot_step=step)
    except Exception:
        old_times = booking_covered_times(existing, slot_step=step)

    await release_slot_locks(db, booking_id)
    try:
        await acquire_slot_locks(
            db,
            booking_id=booking_id,
            court_id=court_id,
            date=new_date,
            times=covered,
        )
    except DuplicateKeyError:
        # Restore previous locks so cancel/availability stay consistent
        try:
            await acquire_slot_locks(
                db,
                booking_id=booking_id,
                court_id=court_id,
                date=old_date,
                times=old_times,
            )
        except Exception:
            pass
        raise

    update_fields = {
        "date": new_date,
        "start_time": new_start_time,
        "end_time": end_t,
        "duration_minutes": dur,
        "slot_key": new_sk,
        "slot_keys": new_keys,
        "total": new_total,
        "deposit": new_deposit,
        "rescheduled_at": now_iso(),
        "previous_date": old_date,
        "previous_start_time": old_time,
        # New slot needs a fresh reminder window
        "reminder_sent": False,
        "reminder_sent_at": None,
    }
    # Keep PIX amount in sync when still pending (never auto-confirm)
    pay = existing.get("payment") or {}
    if pay.get("status") == "pending":
        update_fields["payment.amount"] = new_deposit
    try:
        updated = await db.bookings.find_one_and_update(
            q,
            {"$set": update_fields},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0},
        )
    except DuplicateKeyError:
        await release_slot_locks(db, booking_id)
        try:
            await acquire_slot_locks(
                db,
                booking_id=booking_id,
                court_id=court_id,
                date=old_date,
                times=old_times,
            )
        except Exception:
            pass
        raise
    if not updated:
        await release_slot_locks(db, booking_id)
        try:
            await acquire_slot_locks(
                db,
                booking_id=booking_id,
                court_id=court_id,
                date=old_date,
                times=old_times,
            )
        except Exception:
            pass
        raise ValueError("Reserva não encontrada ou inativa")
    return updated


# -----------------------------------------------------------------------------
# Cycle 27 — recurring weekly bookings
# -----------------------------------------------------------------------------

def weekly_occurrence_dates(start_date: str, weeks: int) -> list[str]:
    """N consecutive weekly dates starting at start_date (inclusive)."""
    try:
        base = datetime.strptime(start_date, "%Y-%m-%d")
    except ValueError as e:
        raise ValueError("Data inválida") from e
    n = int(weeks)
    if n < 1:
        raise ValueError("weeks deve ser >= 1")
    return [(base + timedelta(weeks=i)).strftime("%Y-%m-%d") for i in range(n)]


def clamp_recurring_weeks(weeks: int, settings: dict[str, Any]) -> int:
    """Validate weeks against settings recurring_max_weeks (2..max, max capped 2–8)."""
    enabled = settings.get("recurring_enabled")
    if enabled is False:
        raise ValueError("Reservas recorrentes desativadas")
    raw_max = settings.get("recurring_max_weeks")
    try:
        max_w = int(raw_max if raw_max is not None else 8)
    except (TypeError, ValueError):
        max_w = 8
    max_w = max(2, min(8, max_w))
    try:
        n = int(weeks)
    except (TypeError, ValueError) as e:
        raise ValueError("Número de semanas inválido") from e
    if n < 2 or n > max_w:
        raise ValueError(f"Repetir por 2 a {max_w} semanas")
    return n


async def preview_recurring(
    db,
    *,
    court_id: str,
    date: str,
    start_time: str,
    weeks: int,
    duration_minutes: Optional[int] = None,
    duration_hours: Optional[int] = None,
) -> dict[str, Any]:
    """Check free/busy for each weekly occurrence (no locks created)."""
    if court_id != COURT_ID:
        raise ValueError("Quadra não encontrada")
    settings = await sset.get_settings(db)
    weeks_n = clamp_recurring_weeks(weeks, settings)
    dates = weekly_occurrence_dates(date, weeks_n)
    step = int(settings.get("slot_duration_minutes") or 60)
    # Duration resolved once from settings (same hours each week)
    try:
        dur = resolve_booking_duration(
            settings,
            duration_minutes=duration_minutes,
            duration_hours=duration_hours,
        )
    except ValueError:
        dur = step

    items: list[dict[str, Any]] = []
    for d in dates:
        entry: dict[str, Any] = {
            "date": d,
            "start_time": start_time,
            "available": False,
            "reason": None,
            "weekday": datetime.strptime(d, "%Y-%m-%d").weekday(),
            "price_per_hour": None,
        }
        try:
            runtime = await get_runtime(db, d)
            entry["price_per_hour"] = float(runtime["court"]["price_per_hour"])
            time_slots = runtime["time_slots"]
            if start_time not in time_slots:
                entry["reason"] = "Horário inválido neste dia"
                items.append(entry)
                continue
            if not sset.is_open_weekday(d, runtime["settings"]):
                entry["reason"] = "Quadra fechada neste dia da semana"
                items.append(entry)
                continue
            if is_past_slot(d, start_time):
                entry["reason"] = "Horário indisponível"
                items.append(entry)
                continue
            covered = covered_start_times(start_time, dur, time_slots, slot_step=step)
            blocked = await get_blocked_times(db, court_id, d)
            reserved = await _reserved_times(db, court_id, d)
            busy = False
            reason = None
            for t in covered:
                if t in blocked:
                    busy = True
                    reason = "Horário bloqueado"
                    break
                if t in reserved:
                    busy = True
                    reason = "Horário já reservado"
                    break
                if is_past_slot(d, t):
                    busy = True
                    reason = "Horário indisponível"
                    break
            if busy:
                entry["reason"] = reason
            else:
                entry["available"] = True
                bill_hours = dur / 60.0
                entry["estimated_total"] = round(entry["price_per_hour"] * bill_hours, 2)
                entry["estimated_deposit"] = round(entry["estimated_total"] * DEPOSIT_RATE, 2)
        except ValueError as e:
            entry["reason"] = str(e)
        items.append(entry)

    free_n = sum(1 for x in items if x["available"])
    return {
        "court_id": court_id,
        "start_time": start_time,
        "weeks": weeks_n,
        "duration_minutes": dur,
        "occurrences": items,
        "available_count": free_n,
        "busy_count": len(items) - free_n,
    }


async def create_recurring_bookings(
    db,
    *,
    court_id: str,
    date: str,
    start_time: str,
    weeks: int,
    customer_name: str,
    whatsapp: str,
    cpf: str,
    cpf_masked: str,
    your_team_name: str = "Time A",
    opponent_team_name: str = "Time B",
    your_team_crest: Optional[str] = None,
    opponent_team_crest: Optional[str] = None,
    duration_minutes: Optional[int] = None,
    duration_hours: Optional[int] = None,
    source: str = "web",
    status: str = "pending",
    payment_status: Optional[str] = None,
    promo_code: Optional[str] = None,
) -> dict[str, Any]:
    """Create up to N weekly bookings; skip conflicts; partial success OK.

    Each week is its own atomic booking + slot_locks. Shared series_id links them.
    """
    settings = await sset.get_settings(db)
    weeks_n = clamp_recurring_weeks(weeks, settings)
    dates = weekly_occurrence_dates(date, weeks_n)
    series_id = str(uuid.uuid4())
    created: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    promo_applied = False
    for d in dates:
        try:
            # Apply promo once on first successful occurrence (one use)
            use_promo = promo_code if (promo_code and not promo_applied) else None
            booking = await create_booking_atomic(
                db,
                court_id=court_id,
                date=d,
                start_time=start_time,
                customer_name=customer_name,
                whatsapp=whatsapp,
                cpf=cpf,
                cpf_masked=cpf_masked,
                your_team_name=your_team_name,
                opponent_team_name=opponent_team_name,
                your_team_crest=your_team_crest,
                opponent_team_crest=opponent_team_crest,
                duration_minutes=duration_minutes,
                duration_hours=duration_hours,
                source=source,
                status=status,
                payment_status=payment_status,
                series_id=series_id,
                promo_code=use_promo,
            )
            if use_promo and booking.get("promo_code"):
                promo_applied = True
            created.append(booking)
        except DuplicateKeyError:
            skipped.append({"date": d, "start_time": start_time, "reason": "Horário já reservado"})
        except ValueError as e:
            skipped.append({"date": d, "start_time": start_time, "reason": str(e)})

    summary = _recurring_summary_pt(created, skipped, weeks_n)
    return {
        "series_id": series_id,
        "weeks": weeks_n,
        "start_time": start_time,
        "created": created,
        "skipped": skipped,
        "created_count": len(created),
        "skipped_count": len(skipped),
        "summary": summary,
    }


def _recurring_summary_pt(
    created: list[dict[str, Any]],
    skipped: list[dict[str, Any]],
    weeks_n: int,
) -> str:
    n_ok = len(created)
    n_skip = len(skipped)
    if n_ok == weeks_n and n_skip == 0:
        return f"{n_ok} reservas criadas nas {weeks_n} semanas."
    parts = [f"{n_ok} de {weeks_n} semanas criadas."]
    if n_skip:
        fails = ", ".join(
            f"{s['date']} ({s.get('reason') or 'indisponível'})" for s in skipped
        )
        parts.append(f"Não criadas: {fails}.")
    return " ".join(parts)


async def cancel_series_future(
    db,
    series_id: str,
    *,
    cancelled_by: str = "customer",
    cpf: Optional[str] = None,
    from_date: Optional[str] = None,
) -> dict[str, Any]:
    """Cancel active bookings in a series from from_date (inclusive) onward.

    Does not cancel past occurrences. Returns count + ids.
    """
    sid = (series_id or "").strip()
    if not sid:
        raise ValueError("series_id inválido")
    today = now_local().strftime("%Y-%m-%d")
    cutoff = from_date or today
    try:
        datetime.strptime(cutoff, "%Y-%m-%d")
    except ValueError as e:
        raise ValueError("Data inválida") from e

    query: dict[str, Any] = {
        "series_id": sid,
        "status": {"$in": list(ACTIVE_STATUSES)},
        "date": {"$gte": cutoff},
    }
    if cpf:
        query["cpf"] = cpf

    cursor = db.bookings.find(query, {"_id": 0, "id": 1, "date": 1, "start_time": 1, "cpf": 1})
    docs = await cursor.to_list(200)
    cancelled_ids: list[str] = []
    for b in docs:
        bid = b["id"]
        filt: dict[str, Any] = {"id": bid, "status": {"$in": list(ACTIVE_STATUSES)}}
        if cpf:
            filt["cpf"] = cpf
        res = await db.bookings.update_one(
            filt,
            {"$set": {
                "status": "cancelled",
                "payment.status": "cancelled",
                "cancelled_at": now_iso(),
                "cancelled_by": cancelled_by,
                "cancelled_series": True,
            }},
        )
        if res.modified_count == 1:
            await release_slot_locks(db, bid)
            cancelled_ids.append(bid)

    return {
        "ok": True,
        "series_id": sid,
        "cancelled_count": len(cancelled_ids),
        "cancelled_ids": cancelled_ids,
        "from_date": cutoff,
    }
