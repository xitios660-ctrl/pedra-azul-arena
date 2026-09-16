"""Dual upload storage: MongoDB GridFS (primary, survives Free restarts) + optional disk cache."""
from __future__ import annotations

import io
import logging
import os
import uuid
from pathlib import Path
from typing import Any, Optional, Tuple

from bson import ObjectId
from gridfs.errors import NoFile
from motor.motor_asyncio import AsyncIOMotorDatabase, AsyncIOMotorGridFSBucket

logger = logging.getLogger("arena.uploads")

BUCKET_NAME = "uploads"
ALLOWED_SUBDIRS = frozenset({"crests", "comprovantes", "gallery"})
ALLOWED_EXT = frozenset({"png", "jpg", "jpeg", "webp", "gif"})
MAX_BYTES = int(os.environ.get("UPLOAD_MAX_BYTES", str(5 * 1024 * 1024)))

_CT_BY_EXT = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "gif": "image/gif",
}


def sniff_image_ext(content: bytes) -> Optional[str]:
    """Return normalized extension from magic bytes, or None if not a safe raster image."""
    if len(content) < 12:
        return None
    if content[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if content[:3] == b"\xff\xd8\xff":
        return "jpg"
    if content[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "webp"
    return None


def content_type_for_ext(ext: str) -> str:
    return _CT_BY_EXT.get(ext.lower(), "application/octet-stream")


def safe_filename(name: str) -> bool:
    if not name or "/" in name or "\\" in name or ".." in name:
        return False
    if name.startswith("."):
        return False
    return True


def gridfs_bucket(db: AsyncIOMotorDatabase) -> AsyncIOMotorGridFSBucket:
    return AsyncIOMotorGridFSBucket(db, bucket_name=BUCKET_NAME)


def _disk_writable(upload_dir: Path, subdir: str) -> bool:
    try:
        target = upload_dir / subdir
        target.mkdir(parents=True, exist_ok=True)
        probe = target / f".write_probe_{uuid.uuid4().hex}"
        probe.write_bytes(b"ok")
        probe.unlink(missing_ok=True)
        return True
    except Exception as e:
        logger.warning("event=upload_disk_unwritable path=%s err=%s", upload_dir / subdir, e)
        return False


async def save_bytes(
    db: AsyncIOMotorDatabase,
    content: bytes,
    subdir: str,
    *,
    upload_dir: Path,
    filename: Optional[str] = None,
    require_magic: bool = True,
) -> Tuple[str, str, str]:
    """Persist image to GridFS (required) and optionally disk cache.

    Returns (public_url, gridfs_id_str, filename).
    """
    if subdir not in ALLOWED_SUBDIRS:
        raise ValueError("Destino de upload inválido")
    if not content:
        raise ValueError("Imagem vazia")
    if len(content) > MAX_BYTES:
        raise ValueError("Imagem muito grande (máx 5MB)")

    sniffed = sniff_image_ext(content)
    if sniffed:
        ext = sniffed
    elif require_magic:
        raise ValueError("Arquivo não é uma imagem válida (PNG/JPG/WEBP/GIF)")
    else:
        # WhatsApp media edge cases — opaque bytes as jpg
        name = filename or "comprovante.jpg"
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else "jpg"
        if ext not in ALLOWED_EXT:
            ext = "jpg"
        ext = "jpg"

    fname = f"{uuid.uuid4().hex}.{ext}"
    grid_name = f"{subdir}/{fname}"
    ct = content_type_for_ext(ext)
    fs = gridfs_bucket(db)
    file_id = await fs.upload_from_stream(
        grid_name,
        io.BytesIO(content),
        metadata={"subdir": subdir, "filename": fname, "content_type": ct},
    )
    grid_id = str(file_id)

    # Optional disk cache (durable on Starter+ disk; ephemeral on Free)
    if _disk_writable(upload_dir, subdir):
        try:
            out_path = upload_dir / subdir / fname
            out_path.write_bytes(content)
            logger.info(
                "event=upload_saved storage=gridfs+disk subdir=%s bytes=%s ext=%s gridfs_id=%s",
                subdir,
                len(content),
                ext,
                grid_id[:8],
            )
        except Exception as e:
            logger.warning("event=upload_disk_write_failed err=%s (GridFS ok)", e)
    else:
        logger.info(
            "event=upload_saved storage=gridfs subdir=%s bytes=%s ext=%s gridfs_id=%s",
            subdir,
            len(content),
            ext,
            grid_id[:8],
        )

    url = f"/api/uploads/{subdir}/{fname}"
    return url, grid_id, fname


async def open_stream(
    db: AsyncIOMotorDatabase,
    subdir: str,
    filename: str,
    *,
    upload_dir: Path,
) -> Tuple[Any, str, Optional[Path]]:
    """Resolve upload: disk first, then GridFS by name.

    Returns (stream_or_path_marker, content_type, disk_path_or_None).
    If disk_path is set, caller should FileResponse it; else stream is Motor GridOut.
    """
    if subdir not in ALLOWED_SUBDIRS or not safe_filename(filename):
        raise FileNotFoundError("not found")
    disk = upload_dir / subdir / filename
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    ct = content_type_for_ext(ext) if ext in ALLOWED_EXT else "application/octet-stream"
    if disk.is_file():
        return None, ct, disk

    fs = gridfs_bucket(db)
    try:
        grid_out = await fs.open_download_stream_by_name(f"{subdir}/{filename}")
    except NoFile as e:
        raise FileNotFoundError("not found") from e
    meta = getattr(grid_out, "metadata", None) or {}
    ct = meta.get("content_type") or ct
    return grid_out, ct, None


async def open_stream_by_id(
    db: AsyncIOMotorDatabase,
    file_id: str,
) -> Tuple[Any, str]:
    """Open GridFS by ObjectId string."""
    fs = gridfs_bucket(db)
    try:
        oid = ObjectId(file_id)
    except Exception as e:
        raise FileNotFoundError("not found") from e
    try:
        grid_out = await fs.open_download_stream(oid)
    except NoFile as e:
        raise FileNotFoundError("not found") from e
    meta = getattr(grid_out, "metadata", None) or {}
    name = getattr(grid_out, "filename", "") or ""
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    ct = meta.get("content_type") or content_type_for_ext(ext)
    return grid_out, ct


async def delete_by_id(
    db: AsyncIOMotorDatabase,
    file_id: str,
) -> bool:
    """Best-effort GridFS delete by ObjectId string. Returns True if deleted."""
    if not file_id:
        return False
    fs = gridfs_bucket(db)
    try:
        oid = ObjectId(file_id)
    except Exception:
        return False
    try:
        await fs.delete(oid)
        return True
    except NoFile:
        return False
    except Exception as e:
        logger.warning("event=gridfs_delete_failed id=%s err=%s", str(file_id)[:8], e)
        return False

