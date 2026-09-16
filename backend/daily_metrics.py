"""Persisted daily funnel / occupancy aggregates in Mongo.

Collection: daily_metrics
  { day: "YYYY-MM-DD", bookings_created, bookings_confirmed, bookings_cancelled,
    bookings_no_show, occupancy_hours, updated_at }

Views intentionally skipped. Never auto-confirms payment.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Sao_Paulo")
COL = "daily_metrics"


def today_ymd() -> str:
    return datetime.now(TZ).strftime("%Y-%m-%d")


def _now_iso() -> str:
    return datetime.now(TZ).isoformat()


async def ensure_indexes(db) -> None:
    await db[COL].create_index("day", unique=True)


async def _bump(db, day: str, incs: dict[str, float]) -> None:
    if not day or not incs:
        return
    # $inc alone creates missing fields; avoid $setOnInsert on same paths (conflict).
    await db[COL].update_one(
        {"day": day},
        {"$inc": incs, "$set": {"updated_at": _now_iso()}},
        upsert=True,
    )


async def note_created(db, day: Optional[str] = None) -> None:
    await _bump(db, day or today_ymd(), {"bookings_created": 1})


async def note_confirmed(db, duration_minutes: int = 60, day: Optional[str] = None) -> None:
    hours = max(0.0, float(duration_minutes or 60) / 60.0)
    await _bump(
        db,
        day or today_ymd(),
        {"bookings_confirmed": 1, "occupancy_hours": hours},
    )


async def note_cancelled(db, day: Optional[str] = None) -> None:
    await _bump(db, day or today_ymd(), {"bookings_cancelled": 1})


async def note_no_show(db, day: Optional[str] = None) -> None:
    await _bump(db, day or today_ymd(), {"bookings_no_show": 1})


async def last_n_days(db, n: int = 7) -> list[dict[str, Any]]:
    """Return last n calendar days (Sao Paulo), filling zeros for missing docs."""
    n = max(1, min(int(n), 31))
    today = datetime.now(TZ).date()
    days = [(today - timedelta(days=i)).isoformat() for i in range(n - 1, -1, -1)]
    cursor = db[COL].find({"day": {"$in": days}}, {"_id": 0})
    by_day = {doc["day"]: doc async for doc in cursor}
    out = []
    for d in days:
        doc = by_day.get(d) or {}
        out.append(
            {
                "day": d,
                "bookings_created": int(doc.get("bookings_created") or 0),
                "bookings_confirmed": int(doc.get("bookings_confirmed") or 0),
                "bookings_cancelled": int(doc.get("bookings_cancelled") or 0),
                "bookings_no_show": int(doc.get("bookings_no_show") or 0),
                "occupancy_hours": float(doc.get("occupancy_hours") or 0),
            }
        )
    return out


async def summary_last_n(db, n: int = 7) -> dict[str, Any]:
    series = await last_n_days(db, n)
    return {
        "days": n,
        "series": series,
        "totals": {
            "bookings_created": sum(x["bookings_created"] for x in series),
            "bookings_confirmed": sum(x["bookings_confirmed"] for x in series),
            "bookings_cancelled": sum(x["bookings_cancelled"] for x in series),
            "bookings_no_show": sum(x.get("bookings_no_show", 0) for x in series),
            "occupancy_hours": round(sum(x["occupancy_hours"] for x in series), 2),
        },
    }
