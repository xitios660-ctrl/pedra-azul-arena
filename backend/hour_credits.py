"""Prepaid hour credits (pacotes) — Cycle 32.

Admin sells hour packs keyed by customer phone. Booking may pay fully with
credits when duration_hours ≤ balance (atomic decrement).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from pymongo import ReturnDocument

from cpf_utils import normalize_whatsapp, only_digits, phone_variants

logger = logging.getLogger("arena.credits")

COL = "hour_credits"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_phone(phone: Optional[str]) -> str:
    """Digits with BR country code 55 when missing."""
    return normalize_whatsapp(phone or "")


def public_credit(doc: dict[str, Any]) -> dict[str, Any]:
    bal = doc.get("balance_hours")
    try:
        bal_f = float(bal if bal is not None else 0)
    except (TypeError, ValueError):
        bal_f = 0.0
    # Avoid ugly floats; keep .5 etc.
    if abs(bal_f - round(bal_f)) < 1e-9:
        bal_out: Any = int(round(bal_f))
    else:
        bal_out = round(bal_f, 2)
    return {
        "id": doc.get("id"),
        "phone_digits": doc.get("phone_digits"),
        "name": doc.get("name") or None,
        "balance_hours": bal_out,
        "notes": doc.get("notes") or None,
        "updated_at": doc.get("updated_at"),
        "created_at": doc.get("created_at"),
    }


async def ensure_indexes(db) -> None:
    try:
        await db[COL].create_index("phone_digits", unique=True, name="hour_credits_phone_unique")
        await db[COL].create_index("id", unique=True, name="hour_credits_id")
    except Exception as e:
        logger.warning("hour_credits indexes: %s", e)


async def get_by_phone(db, phone: str) -> Optional[dict[str, Any]]:
    variants = phone_variants(phone)
    if not variants:
        return None
    return await db[COL].find_one({"phone_digits": {"$in": variants}}, {"_id": 0})


async def list_credits(db, *, phone: Optional[str] = None, limit: int = 200) -> list[dict[str, Any]]:
    lim = max(1, min(int(limit or 200), 500))
    q: dict[str, Any] = {}
    if phone and str(phone).strip():
        variants = phone_variants(phone)
        if not variants:
            return []
        q["phone_digits"] = {"$in": variants}
    cursor = db[COL].find(q, {"_id": 0}).sort("updated_at", -1).limit(lim)
    items = await cursor.to_list(lim)
    return [public_credit(x) for x in items]


async def adjust_credit(
    db,
    *,
    phone: str,
    delta_hours: float,
    name: Optional[str] = None,
    notes: Optional[str] = None,
) -> dict[str, Any]:
    """Add/subtract hours for a phone. Creates row if missing. Balance never goes below 0 via this path
    unless delta is negative and sufficient — negative delta with insufficient balance raises ValueError.
    """
    phone_n = normalize_phone(phone)
    raw = only_digits(phone)
    if not phone_n or len(raw) < 10:
        raise ValueError("Telefone inválido")
    try:
        delta = float(delta_hours)
    except (TypeError, ValueError) as e:
        raise ValueError("Quantidade de horas inválida") from e
    if abs(delta) < 1e-9:
        raise ValueError("Informe um ajuste diferente de zero")
    if abs(delta) > 1000:
        raise ValueError("Ajuste de horas fora do limite")

    now = _now_iso()
    existing = await get_by_phone(db, phone_n)
    name_clean = (name or "").strip()[:80] or None
    notes_clean = (notes or "").strip()[:300] or None

    if existing:
        cur = float(existing.get("balance_hours") or 0)
        new_bal = round(cur + delta, 2)
        if new_bal < -1e-9:
            raise ValueError(
                f"Saldo insuficiente para debitar (saldo {cur}h, ajuste {delta}h)"
            )
        if new_bal < 0:
            new_bal = 0.0
        patch: dict[str, Any] = {
            "balance_hours": new_bal,
            "updated_at": now,
        }
        if name_clean:
            patch["name"] = name_clean
        if notes_clean is not None and notes is not None:
            patch["notes"] = notes_clean
        # Keep canonical phone_digits as existing or normalized
        doc = await db[COL].find_one_and_update(
            {"id": existing["id"]},
            {"$set": patch},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0},
        )
        if not doc:
            raise ValueError("Crédito não encontrado")
        return public_credit(doc)

    if delta < 0:
        raise ValueError("Não há crédito para este telefone")

    doc = {
        "id": str(uuid.uuid4()),
        "phone_digits": phone_n,
        "name": name_clean,
        "balance_hours": round(delta, 2),
        "notes": notes_clean,
        "created_at": now,
        "updated_at": now,
    }
    try:
        await db[COL].insert_one(doc)
    except Exception as e:
        # Race: another insert won unique phone — retry as update
        again = await get_by_phone(db, phone_n)
        if again:
            return await adjust_credit(
                db, phone=phone_n, delta_hours=delta, name=name, notes=notes
            )
        raise ValueError(f"Falha ao criar crédito: {e}") from e
    doc.pop("_id", None)
    return public_credit(doc)


async def lookup_balance(db, phone: str) -> dict[str, Any]:
    """Public-ish balance preview (no secrets)."""
    phone_n = normalize_phone(phone)
    if not phone_n or len(only_digits(phone)) < 10:
        raise ValueError("Telefone inválido")
    doc = await get_by_phone(db, phone_n)
    if not doc:
        return {
            "phone_digits": phone_n,
            "balance_hours": 0,
            "has_credit": False,
            "name": None,
        }
    pub = public_credit(doc)
    bal = float(pub["balance_hours"] or 0)
    return {
        "phone_digits": pub["phone_digits"],
        "balance_hours": pub["balance_hours"],
        "has_credit": bal > 0,
        "name": pub.get("name"),
    }


async def consume_hours(db, phone: str, hours: float) -> dict[str, Any]:
    """Atomically decrement balance if sufficient. Raises ValueError if not."""
    phone_n = normalize_phone(phone)
    try:
        need = float(hours)
    except (TypeError, ValueError) as e:
        raise ValueError("Duração inválida para crédito") from e
    if need <= 0:
        raise ValueError("Duração inválida para crédito")
    # Round to 2 decimals for comparison
    need = round(need, 2)
    variants = phone_variants(phone_n)
    if not variants:
        raise ValueError("Telefone inválido")

    now = _now_iso()
    updated = await db[COL].find_one_and_update(
        {
            "phone_digits": {"$in": variants},
            "balance_hours": {"$gte": need},
        },
        {
            "$inc": {"balance_hours": -need},
            "$set": {"updated_at": now},
        },
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not updated:
        again = await get_by_phone(db, phone_n)
        if not again:
            raise ValueError("Sem crédito de horas para este WhatsApp")
        bal = float(again.get("balance_hours") or 0)
        raise ValueError(
            f"Crédito insuficiente (saldo {bal}h, necessário {need}h)"
        )
    # Fix float noise
    bal = float(updated.get("balance_hours") or 0)
    if abs(bal) < 1e-9:
        bal = 0.0
    await db[COL].update_one(
        {"id": updated["id"]},
        {"$set": {"balance_hours": round(bal, 2)}},
    )
    updated["balance_hours"] = round(bal, 2)
    return public_credit(updated)


async def restore_hours(db, phone: str, hours: float) -> None:
    """Best-effort rollback after failed booking insert."""
    try:
        need = float(hours)
        if need <= 0:
            return
        phone_n = normalize_phone(phone)
        variants = phone_variants(phone_n)
        if not variants:
            return
        existing = await get_by_phone(db, phone_n)
        if not existing:
            return
        await db[COL].update_one(
            {"id": existing["id"]},
            {
                "$inc": {"balance_hours": round(need, 2)},
                "$set": {"updated_at": _now_iso()},
            },
        )
    except Exception as e:
        logger.warning("credits restore_hours failed phone=%s: %s", phone, e)


def credit_hours_from_booking(booking: dict[str, Any]) -> float:
    """Hours to restore for a credit-paid booking."""
    if not booking:
        return 0.0
    pay = booking.get("payment") or {}
    for raw in (
        pay.get("credits_hours"),
        booking.get("credits_hours"),
        booking.get("duration_hours"),
    ):
        if raw is None:
            continue
        try:
            h = float(raw)
            if h > 0:
                return round(h, 2)
        except (TypeError, ValueError):
            continue
    mins = booking.get("duration_minutes")
    if mins is not None:
        try:
            m = float(mins)
            if m > 0:
                return round(m / 60.0, 2)
        except (TypeError, ValueError):
            pass
    return 0.0


def is_credit_paid_booking(booking: dict[str, Any]) -> bool:
    if not booking:
        return False
    if booking.get("paid_with_credits"):
        return True
    pay = booking.get("payment") or {}
    method = str(pay.get("method") or "").strip().lower()
    return method == "credits"


async def refund_credits_on_cancel(db, booking: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Atomically restore hour credits when a credit-paid booking is cancelled.

    Idempotent via ``credits_refunded_at`` on the booking (set only once).
    Skips no_show and non-credit bookings. Returns refund info or None.
    """
    if not booking:
        return None
    if booking.get("status") == "no_show":
        return None
    if not is_credit_paid_booking(booking):
        return None
    if booking.get("credits_refunded_at"):
        return None

    bid = booking.get("id")
    if not bid:
        return None
    hours = credit_hours_from_booking(booking)
    if hours <= 0:
        return None
    phone = booking.get("whatsapp") or ""
    if not phone or len(only_digits(phone)) < 10:
        logger.warning("credits refund skipped — bad phone booking=%s", str(bid)[:8])
        return None

    now = _now_iso()
    # Claim refund right once (race-safe)
    claimed = await db.bookings.find_one_and_update(
        {
            "id": bid,
            "$and": [
                {
                    "$or": [
                        {"credits_refunded_at": {"$exists": False}},
                        {"credits_refunded_at": None},
                    ]
                },
                {
                    "$or": [
                        {"payment.method": "credits"},
                        {"paid_with_credits": True},
                    ]
                },
            ],
        },
        {
            "$set": {
                "credits_refunded_at": now,
                "credits_refunded_hours": hours,
            }
        },
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not claimed:
        return None

    try:
        doc = await adjust_credit(
            db,
            phone=phone,
            delta_hours=hours,
            notes=f"Estorno cancelamento {str(bid)[:8]}",
        )
    except Exception as e:
        logger.exception(
            "credits refund adjust failed booking=%s hours=%s: %s",
            str(bid)[:8],
            hours,
            e,
        )
        # Best-effort: still leave flag set to avoid double credit on retry storms;
        # ops can manual-adjust. Log clearly.
        return {
            "hours": hours,
            "phone_digits": normalize_phone(phone),
            "balance_hours": None,
            "credits_refunded_at": now,
            "error": str(e),
        }

    logger.info(
        "event=credits_refund booking_id=%s hours=%s phone=%s balance=%s",
        str(bid)[:8],
        hours,
        doc.get("phone_digits"),
        doc.get("balance_hours"),
    )
    return {
        "hours": hours,
        "phone_digits": doc.get("phone_digits"),
        "balance_hours": doc.get("balance_hours"),
        "credits_refunded_at": now,
    }
