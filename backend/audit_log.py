"""Admin audit log — Cycle 28.

Best-effort writes: never raise to callers. No secrets/passwords/tokens in meta.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger("arena.audit")

COL = "audit_log"

# Keys (case-insensitive substring) never stored in meta
_SECRET_KEY_RE = re.compile(
    r"(password|passwd|secret|token|jwt|authorization|api[_-]?key|cookie|credential|private[_-]?key)",
    re.I,
)

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_meta(meta: Optional[dict[str, Any]]) -> dict[str, Any]:
    if not meta or not isinstance(meta, dict):
        return {}
    out: dict[str, Any] = {}
    for k, v in meta.items():
        key = str(k)
        if _SECRET_KEY_RE.search(key):
            continue
        if isinstance(v, (str, int, float, bool)) or v is None:
            # Truncate long strings; never store huge blobs
            if isinstance(v, str) and len(v) > 500:
                out[key] = v[:500] + "…"
            else:
                out[key] = v
        elif isinstance(v, (list, tuple)):
            # Only simple scalar lists, capped
            items = []
            for item in list(v)[:20]:
                if isinstance(item, (str, int, float, bool)) or item is None:
                    items.append(item if not isinstance(item, str) or len(item) <= 200 else item[:200])
            out[key] = items
        # skip nested dicts / objects
    return out


async def ensure_indexes(db) -> None:
    try:
        await db[COL].create_index([("at", -1)], name="audit_at_desc")
        await db[COL].create_index("id", unique=True, name="audit_id")
        await db[COL].create_index([("action", 1), ("at", -1)], name="audit_action_at")
    except Exception as e:
        logger.warning("audit_log indexes: %s", e)


async def audit(
    db,
    admin: Optional[dict],
    action: str,
    *,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    summary: str = "",
    meta: Optional[dict[str, Any]] = None,
) -> Optional[dict[str, Any]]:
    """Insert one audit entry. Never raises — returns doc or None on failure."""
    try:
        action_clean = (action or "").strip()[:80]
        if not action_clean:
            return None
        actor_email = None
        actor_id = None
        if isinstance(admin, dict):
            actor_email = (admin.get("email") or None)
            actor_id = (admin.get("id") or None)
        doc = {
            "id": str(uuid.uuid4()),
            "at": _now_iso(),
            "actor_email": actor_email,
            "actor_id": actor_id,
            "action": action_clean,
            "entity_type": (entity_type or None),
            "entity_id": (str(entity_id) if entity_id else None),
            "summary": (summary or "").strip()[:300],
            "meta": _safe_meta(meta),
        }
        await db[COL].insert_one(doc)
        # Return without Mongo _id
        public = {k: v for k, v in doc.items() if k != "_id"}
        return public
    except Exception as e:
        logger.warning("audit write failed action=%s: %s", action, e)
        return None


async def list_audit(
    db,
    *,
    limit: int = DEFAULT_LIMIT,
    action: Optional[str] = None,
) -> list[dict[str, Any]]:
    lim = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))
    q: dict[str, Any] = {}
    if action and str(action).strip():
        q["action"] = str(action).strip()
    cursor = db[COL].find(q, {"_id": 0}).sort("at", -1).limit(lim)
    return await cursor.to_list(lim)
