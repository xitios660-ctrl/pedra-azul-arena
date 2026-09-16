"""Promo / discount codes — Cycle 29.

Admin CRUD + public validate (preview) + atomic claim on booking create.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from pymongo import ReturnDocument

logger = logging.getLogger("arena.promo")

COL = "promo_codes"
CODE_RE = re.compile(r"^[A-Z0-9_-]{2,32}$")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_code(code: Optional[str]) -> str:
    return (code or "").strip().upper()


def _parse_expires(expires_at: Optional[str]) -> Optional[str]:
    if expires_at is None or expires_at == "":
        return None
    s = str(expires_at).strip()
    if not s:
        return None
    # Accept date-only as end of that day UTC, or full ISO
    try:
        if len(s) == 10 and s[4] == "-" and s[7] == "-":
            datetime.strptime(s, "%Y-%m-%d")
            return f"{s}T23:59:59+00:00"
        # Normalize Z
        raw = s.replace("Z", "+00:00")
        datetime.fromisoformat(raw)
        return raw if "+" in raw or raw.endswith("Z") else s
    except ValueError as e:
        raise ValueError("Data de validade inválida") from e


def is_expired(promo: dict[str, Any], *, now: Optional[datetime] = None) -> bool:
    exp = promo.get("expires_at")
    if not exp:
        return False
    now = now or datetime.now(timezone.utc)
    try:
        raw = str(exp).replace("Z", "+00:00")
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return now > dt
    except ValueError:
        return True


def compute_discount(total: float, promo: dict[str, Any]) -> dict[str, Any]:
    """Return discount + final amounts. Never negative."""
    total = max(0.0, float(total))
    ptype = promo.get("type")
    value = float(promo.get("value") or 0)
    if value < 0:
        value = 0.0
    if ptype == "percent":
        # Cap at 100%
        pct = min(100.0, value)
        discount = round(total * (pct / 100.0), 2)
    elif ptype == "fixed":
        discount = round(min(value, total), 2)
    else:
        raise ValueError("Tipo de cupom inválido")
    final_total = round(max(0.0, total - discount), 2)
    return {
        "original_total": round(total, 2),
        "discount": discount,
        "total": final_total,
        "promo_code": promo.get("code"),
        "promo_type": ptype,
        "promo_value": value,
    }


async def ensure_indexes(db) -> None:
    try:
        await db[COL].create_index("code", unique=True, name="promo_code_unique")
        await db[COL].create_index("id", unique=True, name="promo_id")
        await db[COL].create_index([("active", 1), ("code", 1)], name="promo_active_code")
    except Exception as e:
        logger.warning("promo_codes indexes: %s", e)


def public_promo(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": doc.get("id"),
        "code": doc.get("code"),
        "type": doc.get("type"),
        "value": doc.get("value"),
        "active": bool(doc.get("active")),
        "max_uses": doc.get("max_uses"),
        "used_count": int(doc.get("used_count") or 0),
        "expires_at": doc.get("expires_at"),
        "created_at": doc.get("created_at"),
    }


async def list_promos(db) -> list[dict[str, Any]]:
    cursor = db[COL].find({}, {"_id": 0}).sort("created_at", -1)
    items = await cursor.to_list(500)
    return [public_promo(x) for x in items]


async def create_promo(
    db,
    *,
    code: str,
    type: str,
    value: float,
    max_uses: Optional[int] = None,
    expires_at: Optional[str] = None,
    active: bool = True,
) -> dict[str, Any]:
    code_n = normalize_code(code)
    if not CODE_RE.match(code_n):
        raise ValueError("Código inválido (use 2–32 letras/números, _ ou -)")
    if type not in ("percent", "fixed"):
        raise ValueError("Tipo deve ser percent ou fixed")
    try:
        val = float(value)
    except (TypeError, ValueError) as e:
        raise ValueError("Valor inválido") from e
    if val <= 0:
        raise ValueError("Valor deve ser maior que zero")
    if type == "percent" and val > 100:
        raise ValueError("Percentual máximo é 100")
    mu = None
    if max_uses is not None and max_uses != "":
        try:
            mu = int(max_uses)
        except (TypeError, ValueError) as e:
            raise ValueError("max_uses inválido") from e
        if mu < 1:
            raise ValueError("max_uses deve ser ≥ 1 ou vazio")
    exp = _parse_expires(expires_at)

    existing = await db[COL].find_one({"code": code_n}, {"_id": 0, "id": 1})
    if existing:
        raise ValueError("Já existe um cupom com este código")

    doc = {
        "id": str(uuid.uuid4()),
        "code": code_n,
        "type": type,
        "value": val,
        "active": bool(active),
        "max_uses": mu,
        "used_count": 0,
        "expires_at": exp,
        "created_at": _now_iso(),
    }
    await db[COL].insert_one(doc)
    doc.pop("_id", None)
    return public_promo(doc)


async def deactivate_promo(db, promo_id: str) -> dict[str, Any]:
    pid = (promo_id or "").strip()
    if not pid:
        raise ValueError("ID inválido")
    doc = await db[COL].find_one_and_update(
        {"id": pid},
        {"$set": {"active": False}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not doc:
        raise ValueError("Cupom não encontrado")
    return public_promo(doc)


async def get_by_code(db, code: str) -> Optional[dict[str, Any]]:
    code_n = normalize_code(code)
    if not code_n:
        return None
    return await db[COL].find_one({"code": code_n}, {"_id": 0})


def _availability_error(promo: Optional[dict[str, Any]]) -> Optional[str]:
    if not promo:
        return "Cupom não encontrado"
    if not promo.get("active"):
        return "Cupom inativo"
    if is_expired(promo):
        return "Cupom expirado"
    mu = promo.get("max_uses")
    if mu is not None:
        try:
            if int(promo.get("used_count") or 0) >= int(mu):
                return "Cupom esgotado"
        except (TypeError, ValueError):
            pass
    return None


async def validate_preview(
    db,
    *,
    code: str,
    subtotal: float,
) -> dict[str, Any]:
    """Preview discount — does NOT claim / increment used_count."""
    promo = await get_by_code(db, code)
    err = _availability_error(promo)
    if err:
        raise ValueError(err)
    priced = compute_discount(subtotal, promo)  # type: ignore[arg-type]
    return {
        "valid": True,
        "code": promo["code"],  # type: ignore[index]
        "type": promo["type"],  # type: ignore[index]
        "value": promo["value"],  # type: ignore[index]
        **priced,
    }


async def claim_promo(db, code: str) -> dict[str, Any]:
    """Atomically claim one use. Raises ValueError if unavailable."""
    code_n = normalize_code(code)
    if not code_n:
        raise ValueError("Informe o cupom")

    promo = await get_by_code(db, code_n)
    err = _availability_error(promo)
    if err:
        raise ValueError(err)

    # Build atomic filter: still active, not past expiry, under max_uses
    filt: dict[str, Any] = {
        "code": code_n,
        "active": True,
    }
    # Expiry: null/missing OR expires_at > now
    now = _now_iso()
    filt["$and"] = [
        {
            "$or": [
                {"expires_at": None},
                {"expires_at": {"$exists": False}},
                {"expires_at": {"$gt": now}},
            ]
        },
        {
            "$or": [
                {"max_uses": None},
                {"max_uses": {"$exists": False}},
                {"$expr": {"$lt": ["$used_count", "$max_uses"]}},
            ]
        },
    ]

    updated = await db[COL].find_one_and_update(
        filt,
        {"$inc": {"used_count": 1}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not updated:
        # Re-check for better error
        again = await get_by_code(db, code_n)
        raise ValueError(_availability_error(again) or "Cupom indisponível")
    return updated


async def release_claim(db, code: str) -> None:
    """Best-effort rollback of used_count after failed booking insert."""
    code_n = normalize_code(code)
    if not code_n:
        return
    try:
        await db[COL].update_one(
            {"code": code_n, "used_count": {"$gt": 0}},
            {"$inc": {"used_count": -1}},
        )
    except Exception as e:
        logger.warning("promo release_claim failed code=%s: %s", code_n, e)


async def estimate_subtotal(db, *, date: Optional[str], hours: Optional[float]) -> float:
    """Estimate booking subtotal from settings for validate preview."""
    import site_settings as sset

    settings = await sset.get_settings(db)
    hrs = float(hours if hours is not None else 1)
    if hrs <= 0:
        hrs = 1.0
    if hrs > 3:
        hrs = 3.0
    if date:
        price = float(sset.price_for_date(settings, date))
    else:
        price = float(settings.get("price_per_hour") or 0)
    return round(price * hrs, 2)
