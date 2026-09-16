"""Court photo gallery — Cycle 34.

Metadata in `gallery_images`; binary in GridFS subdir `gallery` (same bucket as comprovantes).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from pymongo import ReturnDocument

logger = logging.getLogger("arena.gallery")

COL = "gallery_images"
SUBDIR = "gallery"
MAX_IMAGES = 12
CAPTION_MAX = 200


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _public(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return None
    return {k: v for k, v in doc.items() if k != "_id"}


async def ensure_indexes(db) -> None:
    try:
        await db[COL].create_index("id", unique=True, name="gallery_id")
        await db[COL].create_index(
            [("sort_order", 1), ("created_at", 1)],
            name="gallery_sort",
        )
    except Exception as e:
        logger.warning("gallery indexes: %s", e)


async def count_images(db) -> int:
    return int(await db[COL].count_documents({}))


async def list_images(db) -> list[dict[str, Any]]:
    cursor = db[COL].find({}, {"_id": 0}).sort([("sort_order", 1), ("created_at", 1)])
    return await cursor.to_list(MAX_IMAGES + 5)


async def get_image(db, image_id: str) -> Optional[dict[str, Any]]:
    return await db[COL].find_one({"id": image_id}, {"_id": 0})


async def create_image(
    db,
    *,
    url: str,
    gridfs_id: str,
    caption: str = "",
    sort_order: Optional[int] = None,
) -> dict[str, Any]:
    n = await count_images(db)
    if n >= MAX_IMAGES:
        raise ValueError(f"Limite de {MAX_IMAGES} fotos na galeria")
    cap = (caption or "").strip()[:CAPTION_MAX]
    if sort_order is None:
        last = await db[COL].find({}, {"sort_order": 1}).sort("sort_order", -1).limit(1).to_list(1)
        sort_order = int(last[0]["sort_order"]) + 1 if last else n
    doc = {
        "id": str(uuid.uuid4()),
        "gridfs_id": gridfs_id,
        "url": url,
        "caption": cap,
        "sort_order": int(sort_order),
        "created_at": _now_iso(),
    }
    await db[COL].insert_one(doc)
    return _public(doc)  # type: ignore[return-value]


async def update_image(
    db,
    image_id: str,
    *,
    caption: Optional[str] = None,
    sort_order: Optional[int] = None,
) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    if caption is not None:
        fields["caption"] = (caption or "").strip()[:CAPTION_MAX]
    if sort_order is not None:
        fields["sort_order"] = int(sort_order)
    if not fields:
        doc = await get_image(db, image_id)
        if not doc:
            raise ValueError("Foto não encontrada")
        return doc
    result = await db[COL].find_one_and_update(
        {"id": image_id},
        {"$set": fields},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if not result:
        raise ValueError("Foto não encontrada")
    return result


async def reorder_images(db, ordered_ids: list[str]) -> list[dict[str, Any]]:
    """Set sort_order 0..n-1 by given id list. Unknown ids ignored; missing keep order after."""
    ids = [str(x).strip() for x in (ordered_ids or []) if str(x).strip()]
    if not ids:
        raise ValueError("Lista de fotos vazia")
    existing = await list_images(db)
    by_id = {d["id"]: d for d in existing}
    seen: set[str] = set()
    order = 0
    for iid in ids:
        if iid not in by_id or iid in seen:
            continue
        await db[COL].update_one({"id": iid}, {"$set": {"sort_order": order}})
        seen.add(iid)
        order += 1
    for d in existing:
        if d["id"] not in seen:
            await db[COL].update_one({"id": d["id"]}, {"$set": {"sort_order": order}})
            order += 1
    return await list_images(db)


async def delete_image(db, image_id: str) -> dict[str, Any]:
    doc = await db[COL].find_one({"id": image_id})
    if not doc:
        raise ValueError("Foto não encontrada")
    await db[COL].delete_one({"id": image_id})
    return _public(doc)  # type: ignore[return-value]
