"""Arena Futsal Premium — FastAPI backend.
Customer flow uses CPF (no login). Admin flow keeps email/password JWT auth.
"""
from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import csv
import io
import uuid
import logging
import time
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal
from urllib.parse import quote

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Response, UploadFile, File, Form, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError
from pydantic import BaseModel, EmailStr, Field
import asyncio
import httpx
from zoneinfo import ZoneInfo

import whatsapp_bridge
import admin_alerts
import booking_service as bsvc
from booking_service import COURT, COURT_ID, TIME_SLOTS, DEPOSIT_RATE, ACTIVE_STATUSES
import upload_store

from auth_utils import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    get_current_user,
    require_admin,
    set_auth_cookies,
    clear_auth_cookies,
)
from cpf_utils import validate_cpf, mask_cpf, only_digits, normalize_whatsapp, phone_variants, phones_match
import metrics as ops_metrics
import daily_metrics as daily_metrics
from seed_data import run_all_seeds
import site_settings as sset
from site_settings import SiteSettingsUpdate

# -----------------------------------------------------------------------------
# Setup
# -----------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("arena")

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# UPLOAD_DIR: local default ./uploads; Render disk typically /var/data/uploads
_upload_env = (os.environ.get("UPLOAD_DIR") or "").strip()
UPLOAD_DIR = Path(_upload_env) if _upload_env else (ROOT_DIR / "uploads")
(UPLOAD_DIR / "crests").mkdir(parents=True, exist_ok=True)
(UPLOAD_DIR / "comprovantes").mkdir(parents=True, exist_ok=True)
logger.info("event=upload_dir path=%s", str(UPLOAD_DIR))

app = FastAPI(title="Arena Futsal Premium API")
api = APIRouter(prefix="/api")



# -----------------------------------------------------------------------------
# Light rate limit — booking create + auth login (per IP, in-memory)
# -----------------------------------------------------------------------------
_BOOKING_HITS: dict[str, list[float]] = defaultdict(list)
_BOOKING_LIMIT = int(os.environ.get("BOOKING_RATE_LIMIT", "8"))
_BOOKING_WINDOW = int(os.environ.get("BOOKING_RATE_WINDOW_SEC", "60"))

_AUTH_HITS: dict[str, list[float]] = defaultdict(list)
_AUTH_LIMIT = int(os.environ.get("AUTH_RATE_LIMIT", "10"))
_AUTH_WINDOW = int(os.environ.get("AUTH_RATE_WINDOW_SEC", "60"))


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _rate_limit(hits_map: dict, limit: int, window: float, request: Request, detail: str) -> None:
    ip = _client_ip(request)
    now = time.time()
    hits = [t for t in hits_map[ip] if now - t < window]
    if len(hits) >= limit:
        hits_map[ip] = hits
        raise HTTPException(status_code=429, detail=detail)
    hits.append(now)
    hits_map[ip] = hits


def _rate_limit_booking(request: Request) -> None:
    _rate_limit(
        _BOOKING_HITS,
        _BOOKING_LIMIT,
        _BOOKING_WINDOW,
        request,
        "Muitas reservas em pouco tempo. Aguarde um minuto e tente novamente.",
    )


def _rate_limit_auth(request: Request) -> None:
    _rate_limit(
        _AUTH_HITS,
        _AUTH_LIMIT,
        _AUTH_WINDOW,
        request,
        "Muitas tentativas de login. Aguarde um minuto e tente novamente.",
    )

_wa_self_ping_task = None  # Cycle 18 optional localhost WA nudge


@api.get("/health")
async def health():
    """Public health — no secrets. Used by Render healthCheckPath.
    WhatsApp may be DESCONECTADO after free-tier sleep; ok still tracks DB only.
    """
    db_ok = False
    try:
        await db.command("ping")
        db_ok = True
    except Exception:
        db_ok = False
    wa_status = await whatsapp_bridge.get_status()
    wa = wa_status.get("status") or "DESCONECTADO"
    ok = db_ok
    ops_metrics.set_wa_status(wa)
    return {
        "ok": ok,
        "db": "ok" if db_ok else "error",
        "whatsapp": wa,
        "whatsapp_bot": bool(wa_status.get("bot")),
        "whatsapp_restoring": bool(wa_status.get("restoring")),
        "whatsapp_has_saved_session": bool(wa_status.get("has_saved_session")),
        "court": COURT_ID,
        "upload_backend": "gridfs",
    }



def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# -----------------------------------------------------------------------------
# Models
# -----------------------------------------------------------------------------
class LoginIn(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: str
    name: str
    email: str
    role: str


class BookingCreate(BaseModel):
    court_id: str
    date: str
    start_time: str
    duration_minutes: int = 60
    cpf: str
    customer_name: str = Field(min_length=2, max_length=80)
    whatsapp: str = Field(min_length=8, max_length=20)
    your_team_name: str = Field(min_length=1, max_length=60)
    opponent_team_name: str = Field(min_length=1, max_length=60)
    your_team_crest: Optional[str] = None         # URL (uploaded) or emoji
    opponent_team_crest: Optional[str] = None


class LookupIn(BaseModel):
    cpf: str


class MatchScoreUpdate(BaseModel):
    score_a: int
    score_b: int
    status: Literal["scheduled", "live", "finished"] = "finished"


# -----------------------------------------------------------------------------
# Static catalog
# -----------------------------------------------------------------------------
COURTS = [COURT]
COURT_BY_ID = {c["id"]: c for c in COURTS}
# TIME_SLOTS / DEPOSIT_RATE imported from booking_service


# =============================================================================
# ADMIN AUTH
# =============================================================================
@api.post("/auth/login")
async def login(payload: LoginIn, response: Response, request: Request):
    _rate_limit_auth(request)
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores")
    access = create_access_token(user["id"], user["email"], user["role"])
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)
    return {
        "user": {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"]},
        "access_token": access,
    }


@api.post("/auth/logout")
async def logout(response: Response):
    clear_auth_cookies(response)
    return {"ok": True}


@api.get("/auth/me", response_model=UserOut)
async def me(user: dict = Depends(get_current_user)):
    return {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"]}


# =============================================================================
# COURTS & AVAILABILITY (public)
# =============================================================================
@api.get("/courts")
async def list_courts():
    runtime = await bsvc.get_runtime(db)
    return [runtime["court"]]


@api.get("/courts/availability")
async def court_availability(court_id: str, date: str):
    await bsvc.expire_stale_pending(db)
    if court_id not in COURT_BY_ID:
        raise HTTPException(status_code=404, detail="Quadra não encontrada")
    try:
        return await bsvc.build_availability(db, court_id, date)
    except ValueError:
        raise HTTPException(status_code=404, detail="Quadra não encontrada")


@api.get("/site-settings")
async def public_site_settings():
    """Public singleton — price/hours/contact for booking + landing + WA bot."""
    return await sset.get_settings(db)


@api.get("/admin/site-settings")
async def admin_get_site_settings(admin: dict = Depends(require_admin)):
    return await sset.get_admin_settings(db)


@api.put("/admin/site-settings")
async def admin_put_site_settings(payload: SiteSettingsUpdate, admin: dict = Depends(require_admin)):
    try:
        return await sset.update_settings(db, payload)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# UPLOADS (public — crest + comprovante; GridFS primary, disk optional cache)
# =============================================================================
_UPLOAD_ALLOWED_CT = frozenset({
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/gif",
    "application/octet-stream",  # some browsers omit type; magic bytes still checked
})


async def _save_upload(file: UploadFile, subdir: str) -> tuple[str, str]:
    """Validate + save to GridFS (and disk if writable). Returns (url, gridfs_id)."""
    if subdir not in upload_store.ALLOWED_SUBDIRS:
        raise HTTPException(status_code=400, detail="Destino de upload inválido")
    ct = (file.content_type or "").split(";")[0].strip().lower()
    if ct and ct not in _UPLOAD_ALLOWED_CT:
        raise HTTPException(status_code=400, detail="Tipo de arquivo não permitido (use PNG, JPG, WEBP ou GIF)")
    content = file.file.read(upload_store.MAX_BYTES + 1)
    try:
        url, grid_id, _fname = await upload_store.save_bytes(
            db, content, subdir, upload_dir=UPLOAD_DIR, require_magic=True,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return url, grid_id


async def _save_upload_bytes(content: bytes, subdir: str, filename: str | None = None) -> tuple[str, str]:
    """Save raw image bytes (WhatsApp comprovante path). GridFS first."""
    try:
        url, grid_id, _fname = await upload_store.save_bytes(
            db,
            content,
            subdir,
            upload_dir=UPLOAD_DIR,
            filename=filename,
            require_magic=False,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return url, grid_id


async def _attach_comprovante(booking_id: str, url: str, gridfs_id: str | None = None) -> dict:
    """Mark booking as awaiting_admin (informado). NEVER confirms payment."""
    fields = {
        "status": "awaiting_admin",
        "payment.status": "awaiting_confirmation",
        "payment.comprovante_url": url,
        "payment.comprovante_uploaded_at": _now_iso(),
    }
    if gridfs_id:
        fields["payment.comprovante_gridfs_id"] = gridfs_id
    await db.bookings.update_one({"id": booking_id}, {"$set": fields})
    updated = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    logger.info(
        "event=comprovante_attached booking_id=%s status=awaiting_admin auto_confirm=false gridfs=%s",
        booking_id[:8],
        bool(gridfs_id),
    )
    return _public_booking(updated)


def _slot_start_local(booking: dict) -> datetime:
    """Booking date+start_time as America/Sao_Paulo aware datetime."""
    tz = ZoneInfo("America/Sao_Paulo")
    raw = f"{booking.get('date')} {booking.get('start_time') or '00:00'}"
    try:
        naive = datetime.strptime(raw.strip(), "%Y-%m-%d %H:%M")
    except ValueError:
        naive = datetime.strptime(f"{booking.get('date')} 00:00", "%Y-%m-%d %H:%M")
    return naive.replace(tzinfo=tz)


def _customer_cancel_allowed(booking: dict, settings: dict, *, action: str = "Cancelamento") -> tuple[bool, str]:
    """Alter/cancel window: must be >= cancel_min_hours before *original* slot start."""
    min_h = int(settings.get("cancel_min_hours") if settings.get("cancel_min_hours") is not None else 2)
    if min_h <= 0:
        return True, ""
    slot = _slot_start_local(booking)
    now = datetime.now(ZoneInfo("America/Sao_Paulo"))
    hours_left = (slot - now).total_seconds() / 3600.0
    if hours_left < min_h:
        return False, (
            f"{action} só é permitido até {min_h}h antes do horário. "
            f"Fale com a arena pelo WhatsApp se precisar."
        )
    return True, ""


async def _notify_cancel_wa(booking: dict, *, source: str) -> bool:
    """Best-effort short natural cancel message to customer if WA connected."""
    phone = (booking.get("whatsapp") or "").strip()
    if not phone:
        return False
    date = booking.get("date") or ""
    time = booking.get("start_time") or ""
    if source == "admin":
        msg = (
            f"Pedra Azul: sua reserva de {date} às {time} foi cancelada pela arena. "
            f"O horário foi liberado."
        )
    else:
        msg = (
            f"Pedra Azul: reserva de {date} às {time} cancelada. "
            f"Horário liberado — quando quiser, é só reservar de novo."
        )
    sent = await whatsapp_bridge.send_text(phone, msg)
    return bool(sent)



async def _notify_reschedule_wa(booking: dict, *, old_date: str, old_time: str, source: str) -> bool:
    """Best-effort short natural reschedule message if WA connected."""
    phone = (booking.get("whatsapp") or "").strip()
    if not phone:
        return False
    date = booking.get("date") or ""
    time = booking.get("start_time") or ""
    if source == "admin":
        msg = (
            f"Pedra Azul: sua reserva foi remarcada pela arena — "
            f"de {old_date} às {old_time} para {date} às {time}. Nos vemos lá!"
        )
    else:
        msg = (
            f"Pedra Azul: reserva remarcada — de {old_date} às {old_time} "
            f"para {date} às {time}. Horário antigo liberado."
        )
    sent = await whatsapp_bridge.send_text(phone, msg)
    return bool(sent)

@api.get("/uploads/{subdir}/{filename}")
async def serve_upload(subdir: str, filename: str):
    """Serve crest/comprovante from disk cache or Mongo GridFS (Free-tier durable)."""
    try:
        grid_out, ct, disk = await upload_store.open_stream(
            db, subdir, filename, upload_dir=UPLOAD_DIR,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    if disk is not None:
        return FileResponse(path=str(disk), media_type=ct)
    data = await grid_out.read()
    return Response(content=data, media_type=ct, headers={"Cache-Control": "public, max-age=86400"})


@api.get("/comprovantes/{file_id}")
async def serve_comprovante_by_id(file_id: str):
    """Alternate GridFS stream by id (same public access as /uploads today)."""
    try:
        grid_out, ct = await upload_store.open_stream_by_id(db, file_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Comprovante não encontrado")
    data = await grid_out.read()
    return Response(content=data, media_type=ct, headers={"Cache-Control": "public, max-age=86400"})


@api.post("/uploads/crest")
async def upload_crest(file: UploadFile = File(...)):
    url, _gid = await _save_upload(file, "crests")
    return {"url": url}


# =============================================================================
# BOOKINGS — CUSTOMER (public, CPF-based)
# =============================================================================
@api.post("/bookings")
async def create_booking(payload: BookingCreate, request: Request):
    _rate_limit_booking(request)
    await bsvc.expire_stale_pending(db)
    if payload.court_id not in COURT_BY_ID:
        raise HTTPException(status_code=404, detail="Quadra não encontrada")
    if not validate_cpf(payload.cpf):
        raise HTTPException(status_code=400, detail="CPF inválido")
    if not only_digits(payload.whatsapp) or len(only_digits(payload.whatsapp)) < 10:
        raise HTTPException(status_code=400, detail="WhatsApp inválido")

    cpf_digits = only_digits(payload.cpf)
    cpf_masked = mask_cpf(payload.cpf)
    whatsapp_digits = normalize_whatsapp(payload.whatsapp)

    try:
        booking = await bsvc.create_booking_atomic(
            db,
            court_id=payload.court_id,
            date=payload.date,
            start_time=payload.start_time,
            customer_name=payload.customer_name,
            whatsapp=whatsapp_digits,
            cpf=cpf_digits,
            cpf_masked=cpf_masked,
            your_team_name=payload.your_team_name,
            opponent_team_name=payload.opponent_team_name,
            your_team_crest=payload.your_team_crest,
            opponent_team_crest=payload.opponent_team_crest,
            duration_minutes=payload.duration_minutes,
            source="web",
            status="pending",
        )
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Horário já reservado")
    except ValueError as e:
        msg = str(e)
        code = 404 if "não encontrada" in msg else 400
        raise HTTPException(status_code=code, detail=msg)
    ops_metrics.note_booking_create("web")
    await daily_metrics.note_created(db)
    logger.info(
        "event=booking_create source=web booking_id=%s date=%s time=%s",
        booking["id"][:8],
        booking["date"],
        booking["start_time"],
    )
    # Best-effort admin WA alert — never fail the booking
    await admin_alerts.notify_admin_new_booking(db, booking)
    return _public_booking(booking)


@api.post("/bookings/{booking_id}/comprovante")
async def upload_comprovante(booking_id: str, file: UploadFile = File(...)):
    """Customer uploads PIX payment proof. Marks booking as awaiting_admin (informado).
    Never auto-confirms — only admin confirm path sets payment paid."""
    await bsvc.expire_stale_pending(db)
    b = await db.bookings.find_one({"id": booking_id})
    if not b:
        raise HTTPException(status_code=404, detail="Reserva não encontrada")
    if b["status"] in ("cancelled", "expired"):
        raise HTTPException(status_code=400, detail="Reserva cancelada ou expirada")
    if b["status"] not in ("pending", "awaiting_admin"):
        raise HTTPException(status_code=400, detail="Reserva não aceita comprovante neste estado")
    url, grid_id = await _save_upload(file, "comprovantes")
    return await _attach_comprovante(booking_id, url, grid_id)


@api.get("/bookings/{booking_id}")
async def get_booking(booking_id: str):
    await bsvc.expire_stale_pending(db)
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Reserva não encontrada")
    return _public_booking(b)


@api.post("/bookings/lookup")
async def lookup_by_cpf(payload: LookupIn):
    """Public: look up a customer's bookings by CPF (no login)."""
    await bsvc.expire_stale_pending(db)
    if not validate_cpf(payload.cpf):
        raise HTTPException(status_code=400, detail="CPF inválido")
    cpf_d = only_digits(payload.cpf)
    items = await db.bookings.find({"cpf": cpf_d}, {"_id": 0}).sort("created_at", -1).to_list(200)
    customer_name = items[0]["customer_name"] if items else None
    return {
        "cpf_masked": mask_cpf(payload.cpf),
        "customer_name": customer_name,
        "bookings": _public_bookings(items),
    }


@api.post("/bookings/{booking_id}/cancel")
async def cancel_booking(booking_id: str, cpf: str):
    """Customer cancels own booking. Verifies CPF; respects cancel_min_hours; frees slot atomically."""
    b = await db.bookings.find_one({"id": booking_id})
    if not b:
        raise HTTPException(status_code=404, detail="Reserva não encontrada")
    if b["cpf"] != only_digits(cpf):
        raise HTTPException(status_code=403, detail="CPF não confere com esta reserva")
    if b.get("status") not in ACTIVE_STATUSES:
        raise HTTPException(status_code=400, detail="Reserva já cancelada ou expirada")
    settings = await sset.get_settings(db)
    ok_cancel, reason = _customer_cancel_allowed(b, settings)
    if not ok_cancel:
        raise HTTPException(status_code=400, detail=reason)
    res = await db.bookings.update_one(
        {"id": booking_id, "cpf": only_digits(cpf), "status": {"$in": ACTIVE_STATUSES}},
        {"$set": {
            "status": "cancelled",
            "payment.status": "cancelled",
            "cancelled_at": _now_iso(),
            "cancelled_by": "customer",
        }},
    )
    if res.modified_count != 1:
        raise HTTPException(status_code=409, detail="Não foi possível cancelar (já alterada)")
    ops_metrics.note_booking_cancel("customer")
    await daily_metrics.note_cancelled(db)
    wa_ok = await _notify_cancel_wa(b, source="customer")
    logger.info(
        "event=booking_cancel source=customer booking_id=%s wa=%s",
        booking_id[:8],
        wa_ok,
    )
    return {"ok": True, "whatsapp_notified": wa_ok}


class CustomerRescheduleIn(BaseModel):
    cpf: str
    date: str
    start_time: str


@api.post("/bookings/{booking_id}/reschedule")
async def reschedule_booking(booking_id: str, payload: CustomerRescheduleIn):
    """Customer remarca: CPF + cancel_min_hours on original start; atomic slot move; payment preserved."""
    await bsvc.expire_stale_pending(db)
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Reserva não encontrada")
    if b.get("cpf") != only_digits(payload.cpf):
        raise HTTPException(status_code=403, detail="CPF não confere com esta reserva")
    if b.get("status") not in ACTIVE_STATUSES:
        raise HTTPException(status_code=400, detail="Reserva já cancelada ou expirada")
    settings = await sset.get_settings(db)
    ok_alter, reason = _customer_cancel_allowed(b, settings, action="Remarcação")
    if not ok_alter:
        raise HTTPException(status_code=400, detail=reason)
    old_date, old_time = b.get("date"), b.get("start_time")
    try:
        updated = await bsvc.reschedule_booking_atomic(
            db,
            booking_id=booking_id,
            new_date=payload.date,
            new_start_time=payload.start_time,
            match_extra={"cpf": only_digits(payload.cpf)},
        )
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Horário já reservado")
    except ValueError as e:
        msg = str(e)
        code = 404 if "não encontrada" in msg.lower() else 400
        raise HTTPException(status_code=code, detail=msg)
    wa_ok = await _notify_reschedule_wa(updated, old_date=old_date, old_time=old_time, source="customer")
    logger.info(
        "event=booking_reschedule source=customer booking_id=%s %s %s -> %s %s wa=%s pay=%s",
        booking_id[:8],
        old_date,
        old_time,
        updated.get("date"),
        updated.get("start_time"),
        wa_ok,
        (updated.get("payment") or {}).get("status"),
    )
    return {**_public_booking(updated), "whatsapp_notified": wa_ok}



# =============================================================================
# TOURNAMENTS  (public reads)
# =============================================================================
def _compute_standings(t: dict):
    table = {team["id"]: {
        "team_id": team["id"], "team_name": team["name"], "crest": team.get("crest", "⚽"),
        "P": 0, "W": 0, "D": 0, "L": 0, "GF": 0, "GA": 0, "GD": 0, "Pts": 0,
    } for team in t.get("teams", [])}
    for m in t.get("matches", []):
        if m["status"] != "finished" or not m.get("team_a_id") or not m.get("team_b_id"):
            continue
        a = table.get(m["team_a_id"])
        b = table.get(m["team_b_id"])
        if not a or not b:
            continue
        sa, sb = m["score_a"], m["score_b"]
        a["P"] += 1
        b["P"] += 1
        a["GF"] += sa
        a["GA"] += sb
        b["GF"] += sb
        b["GA"] += sa
        if sa > sb:
            a["W"] += 1
            a["Pts"] += 3
            b["L"] += 1
        elif sa < sb:
            b["W"] += 1
            b["Pts"] += 3
            a["L"] += 1
        else:
            a["D"] += 1
            b["D"] += 1
            a["Pts"] += 1
            b["Pts"] += 1
    for row in table.values():
        row["GD"] = row["GF"] - row["GA"]
    rows = list(table.values())
    rows.sort(key=lambda r: (-r["Pts"], -r["GD"], -r["GF"]))
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    return rows


def _serialize_tournament(t: dict):
    t.pop("_id", None)
    teams_by_id = {tm["id"]: tm for tm in t.get("teams", [])}
    matches = []
    for m in t.get("matches", []):
        m2 = dict(m)
        m2["team_a"] = teams_by_id.get(m.get("team_a_id"))
        m2["team_b"] = teams_by_id.get(m.get("team_b_id"))
        matches.append(m2)
    t["matches"] = matches
    t["standings"] = _compute_standings(t) if t.get("format") == "league" else None
    scorers = []
    for s in t.get("top_scorers", []):
        sc = dict(s)
        sc["team_name"] = teams_by_id.get(s["team_id"], {}).get("name")
        sc["crest"] = teams_by_id.get(s["team_id"], {}).get("crest", "⚽")
        scorers.append(sc)
    scorers.sort(key=lambda x: -x["goals"])
    t["top_scorers"] = scorers
    return t


@api.get("/tournaments")
async def list_tournaments():
    items = await db.tournaments.find({}).to_list(100)
    return [_serialize_tournament(t) for t in items]


@api.get("/tournaments/{tid}")
async def get_tournament(tid: str):
    t = await db.tournaments.find_one({"id": tid})
    if not t:
        raise HTTPException(status_code=404, detail="Torneio não encontrado")
    return _serialize_tournament(t)


# =============================================================================
# ADMIN
# =============================================================================

_ADMIN_ONLY_BOOKING_FIELDS = ("admin_notes", "checked_in_at", "checked_in_by")


def _public_booking(b: Optional[dict]) -> Optional[dict]:
    """Strip admin-only fields from customer-facing booking payloads."""
    if not b:
        return b
    out = {k: v for k, v in b.items() if k not in _ADMIN_ONLY_BOOKING_FIELDS and k != "_id"}
    return out


def _public_bookings(items: list) -> list:
    return [_public_booking(b) for b in items]


def _build_whatsapp_message(b: dict) -> str:
    date_br = "/".join(reversed(b["date"].split("-")))
    return (
        f"⚡ Pedra Azul Arena ⚡\n\n"
        f"Olá, {b['customer_name'].split(' ')[0]}! Sua reserva foi CONFIRMADA ✅\n\n"
        f"🏟 Quadra: {b['court_name']}\n"
        f"📅 Data: {date_br}\n"
        f"⏰ Horário: {b['start_time']}\n"
        f"⚽ Partida: {b['your_team_name']} x {b['opponent_team_name']}\n"
        f"💰 Calção pago: R$ {b['deposit']:.2f}\n\n"
        f"Chegue 10min antes. Boa partida!\n"
        f"— Arena Futsal Premium"
    )


@api.get("/admin/dashboard")
async def admin_dashboard(admin: dict = Depends(require_admin)):
    """KPIs from real bookings — America/Sao_Paulo calendar day."""
    from collections import Counter

    tz = ZoneInfo("America/Sao_Paulo")
    now_local = datetime.now(tz)
    today = now_local.strftime("%Y-%m-%d")
    month_prefix = today[:7]  # YYYY-MM
    now_hm = now_local.strftime("%H:%M")

    bookings = await db.bookings.find({}, {"_id": 0}).to_list(5000)
    confirmed = [b for b in bookings if b.get("status") == "confirmed"]
    pending = [b for b in bookings if b.get("status") == "pending"]
    awaiting = [b for b in bookings if b.get("status") == "awaiting_admin"]
    no_shows = [b for b in bookings if b.get("status") == "no_show"]
    checked_in_today = [
        b for b in bookings
        if b.get("date") == today and b.get("checked_in_at")
    ]
    active = bsvc.ACTIVE_STATUSES

    revenue = sum(float(b.get("deposit") or 0) for b in confirmed)
    full_value = sum(float(b.get("total") or 0) for b in confirmed)

    # Today: all active bookings on the single court
    today_bookings = [
        b for b in bookings
        if b.get("date") == today and b.get("status") in active
    ]
    today_confirmed = [b for b in today_bookings if b.get("status") == "confirmed"]

    runtime = await bsvc.get_runtime(db, today)
    time_slots = runtime["time_slots"]
    total_slots_today = len(time_slots)
    taken_today = {b.get("start_time") for b in today_bookings}
    blocked_today = await bsvc.get_blocked_times(db, bsvc.COURT_ID, today)
    # Free = future bookable slots not taken/blocked
    free_slots_today = 0
    for t in time_slots:
        if t in taken_today or t in blocked_today:
            continue
        if bsvc.is_past_slot(today, t, now_local):
            continue
        free_slots_today += 1

    occ_num = len(today_confirmed)
    occupancy_today = round((occ_num / total_slots_today) * 100, 1) if total_slots_today else 0.0

    # Next upcoming (any active, today or future, after now if today)
    def _upcoming_key(b):
        return (b.get("date") or "", b.get("start_time") or "")

    upcoming_candidates = []
    for b in bookings:
        if b.get("status") not in active:
            continue
        d, t = b.get("date") or "", b.get("start_time") or ""
        if not d or not t:
            continue
        if d > today or (d == today and t > now_hm):
            upcoming_candidates.append(b)
    upcoming_candidates.sort(key=_upcoming_key)
    next_b = upcoming_candidates[0] if upcoming_candidates else None
    next_upcoming = None
    if next_b:
        next_upcoming = {
            "id": next_b.get("id"),
            "date": next_b.get("date"),
            "start_time": next_b.get("start_time"),
            "customer_name": next_b.get("customer_name"),
            "status": next_b.get("status"),
            "court_name": next_b.get("court_name"),
            "deposit": next_b.get("deposit"),
        }

    # Month revenue estimate = sum of deposits for confirmed in current month
    month_confirmed = [b for b in confirmed if (b.get("date") or "").startswith(month_prefix)]
    month_revenue_estimate = sum(float(b.get("deposit") or 0) for b in month_confirmed)

    time_counter = Counter(b["start_time"] for b in confirmed if b.get("start_time"))
    top_times = [{"time": t, "count": c} for t, c in time_counter.most_common(5)]

    daily = {}
    for i in range(6, -1, -1):
        d = (now_local.date() - timedelta(days=i)).isoformat()
        daily[d] = 0.0
    for b in confirmed:
        if b.get("date") in daily:
            daily[b["date"]] += float(b.get("deposit") or 0)
    revenue_series = [{"date": d, "revenue": v} for d, v in daily.items()]

    return {
        "total_bookings": len(bookings),
        "confirmed_bookings": len(confirmed),
        "pending_bookings": len(pending),
        "awaiting_admin_bookings": len(awaiting),
        "no_show_bookings": len(no_shows),
        "checked_in_today_count": len(checked_in_today),
        "revenue_deposits": revenue,
        "revenue_full": full_value,
        "occupancy_today_pct": occupancy_today,
        "top_times": top_times,
        "revenue_series": revenue_series,
        # Cycle 7 KPIs (real data)
        "today_bookings_count": len(today_bookings),
        "today_bookings": [
            {
                "id": b.get("id"),
                "start_time": b.get("start_time"),
                "customer_name": b.get("customer_name"),
                "status": b.get("status"),
                "deposit": b.get("deposit"),
                "checked_in_at": b.get("checked_in_at"),
                "checked_in": bool(b.get("checked_in_at")),
                "admin_notes": b.get("admin_notes") or "",
            }
            for b in sorted(today_bookings, key=lambda x: x.get("start_time") or "")
        ],
        "next_upcoming": next_upcoming,
        "free_slots_today": free_slots_today,
        "total_slots_today": total_slots_today,
        "month_revenue_estimate": month_revenue_estimate,
        "month": month_prefix,
        "today": today,
    }


def _booking_end_time(start_time: str, duration_minutes: int = 60) -> str:
    try:
        h, m = map(int, (start_time or "00:00").split(":")[:2])
    except ValueError:
        return ""
    total = h * 60 + m + int(duration_minutes or 60)
    return f"{(total // 60) % 24:02d}:{total % 60:02d}"


def _mask_cpf_export(b: dict) -> str:
    """Prefer stored cpf_masked; else format digits. Never dump raw secrets."""
    masked = (b.get("cpf_masked") or "").strip()
    if masked:
        return masked
    return mask_cpf(b.get("cpf") or "")


def _admin_bookings_query(
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    q: Optional[str] = None,
) -> dict:
    query: dict = {}
    if status:
        query["status"] = status
    date_clause: dict = {}
    if date_from:
        date_clause["$gte"] = date_from
    if date_to:
        date_clause["$lte"] = date_to
    if date_clause:
        query["date"] = date_clause
    needle = (q or "").strip()
    if needle:
        # Case-insensitive name / phone / whatsapp search (digits help phone match)
        digits = only_digits(needle)
        or_clause = [
            {"customer_name": {"$regex": needle, "$options": "i"}},
            {"whatsapp": {"$regex": needle, "$options": "i"}},
        ]
        if digits and digits != needle:
            or_clause.append({"whatsapp": {"$regex": digits}})
        query["$or"] = or_clause
    return query


async def _admin_fetch_bookings(
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 2000,
) -> list:
    query = _admin_bookings_query(status=status, date_from=date_from, date_to=date_to, q=q)
    return await db.bookings.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)


@api.get("/admin/bookings")
async def admin_list_bookings(
    admin: dict = Depends(require_admin),
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    q: Optional[str] = None,
):
    return await _admin_fetch_bookings(status=status, date_from=date_from, date_to=date_to, q=q, limit=500)


@api.get("/admin/bookings/export.csv")
async def admin_export_bookings_csv(
    admin: dict = Depends(require_admin),
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    q: Optional[str] = None,
):
    """CSV export for admin ops — same filters as list. UTF-8 BOM for Excel."""
    items = await _admin_fetch_bookings(status=status, date_from=date_from, date_to=date_to, q=q, limit=5000)
    buf = io.StringIO()
    # UTF-8 BOM so Excel (pt-BR) opens accents correctly
    buf.write("\ufeff")
    writer = csv.writer(buf)
    writer.writerow([
        "id",
        "date",
        "start",
        "end",
        "customer_name",
        "phone_whatsapp",
        "cpf",
        "status",
        "payment_status",
        "amount",
        "created_at",
    ])
    for b in items:
        pay = b.get("payment") or {}
        amount = b.get("deposit")
        if amount is None:
            amount = pay.get("amount")
        if amount is None:
            amount = b.get("total")
        writer.writerow([
            b.get("id") or "",
            b.get("date") or "",
            b.get("start_time") or "",
            _booking_end_time(b.get("start_time") or "", b.get("duration_minutes") or 60),
            b.get("customer_name") or "",
            b.get("whatsapp") or "",
            _mask_cpf_export(b),
            b.get("status") or "",
            pay.get("status") or "",
            amount if amount is not None else "",
            b.get("created_at") or "",
        ])
    raw = buf.getvalue().encode("utf-8")
    filename = "pedra-azul-reservas.csv"
    return Response(
        content=raw,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@api.post("/admin/bookings/{booking_id}/confirm")
async def admin_confirm_booking(booking_id: str, admin: dict = Depends(require_admin)):
    """Confirms the booking (after admin verified the comprovante).
    Tries Baileys auto-send when connected; always returns wa.me fallback link."""
    b = await db.bookings.find_one({"id": booking_id})
    if not b:
        raise HTTPException(status_code=404, detail="Reserva não encontrada")
    await db.bookings.update_one(
        {"id": booking_id},
        {"$set": {
            "status": "confirmed",
            "payment.status": "paid",
            "payment.confirmed_at": _now_iso(),
        }},
    )
    updated = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    await daily_metrics.note_confirmed(db, updated.get("duration_minutes") or 60)
    logger.info("event=booking_confirm source=admin booking_id=%s", booking_id[:8])
    msg = _build_whatsapp_message(updated)
    wa_link = f"https://wa.me/{updated['whatsapp']}?text={quote(msg)}"
    updated["whatsapp_link"] = wa_link
    updated["whatsapp_message"] = msg

    sent = await whatsapp_bridge.send_text(updated["whatsapp"], msg)
    if sent:
        await db.bookings.update_one(
            {"id": booking_id},
            {"$set": {"whatsapp_sent": True, "whatsapp_sent_at": _now_iso(), "whatsapp_auto": True}},
        )
        updated["whatsapp_sent"] = True
        updated["whatsapp_auto"] = True
    else:
        updated["whatsapp_auto"] = False
    return updated


@api.post("/admin/bookings/{booking_id}/whatsapp_sent")
async def admin_mark_whatsapp_sent(booking_id: str, admin: dict = Depends(require_admin)):
    await db.bookings.update_one(
        {"id": booking_id},
        {"$set": {"whatsapp_sent": True, "whatsapp_sent_at": _now_iso()}},
    )
    return {"ok": True}


@api.post("/admin/bookings/{booking_id}/cancel")
async def admin_cancel_booking(booking_id: str, admin: dict = Depends(require_admin)):
    """Admin can always cancel (no cancel_min_hours). Frees slot atomically; best-effort WA."""
    b = await db.bookings.find_one({"id": booking_id})
    if not b:
        raise HTTPException(status_code=404, detail="Reserva não encontrada")
    res = await db.bookings.update_one(
        {"id": booking_id, "status": {"$in": ACTIVE_STATUSES}},
        {"$set": {
            "status": "cancelled",
            "payment.status": "cancelled",
            "cancelled_at": _now_iso(),
            "cancelled_by": "admin",
        }},
    )
    if res.modified_count != 1:
        # already cancelled/expired — still ok for idempotent admin UX
        if b.get("status") in ("cancelled", "expired"):
            return {"ok": True, "status": b["status"], "whatsapp_notified": False}
        raise HTTPException(status_code=409, detail="Não foi possível cancelar")
    ops_metrics.note_booking_cancel("admin")
    await daily_metrics.note_cancelled(db)
    wa_ok = await _notify_cancel_wa(b, source="admin")
    logger.info("event=booking_cancel source=admin booking_id=%s wa=%s", booking_id[:8], wa_ok)
    return {"ok": True, "whatsapp_notified": wa_ok}


@api.post("/admin/bookings/{booking_id}/no-show")
async def admin_mark_no_show(booking_id: str, admin: dict = Depends(require_admin)):
    """Mark past confirmed/paid booking as no-show (metrics only; slot already past)."""
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Reserva não encontrada")
    if b.get("status") == "no_show":
        return {"ok": True, "status": "no_show", "booking": b}
    status = b.get("status")
    pay = (b.get("payment") or {}).get("status")
    # confirmed (admin-validated PIX) or explicitly paid
    if status != "confirmed" and pay != "paid":
        raise HTTPException(
            status_code=400,
            detail="Só reservas confirmadas/pagas podem ser marcadas como no-show",
        )
    if not bsvc.is_past_slot(b.get("date") or "", b.get("start_time") or ""):
        raise HTTPException(
            status_code=400,
            detail="No-show só para reservas cujo horário já passou",
        )
    # Prefer atomic confirmed→no_show; also allow paid docs that somehow stayed pending
    filt = {"id": booking_id}
    if status == "confirmed":
        filt["status"] = "confirmed"
    else:
        filt["payment.status"] = "paid"
        filt["status"] = {"$nin": ["cancelled", "expired", "no_show"]}
    res = await db.bookings.update_one(
        filt,
        {"$set": {
            "status": "no_show",
            "no_show_at": _now_iso(),
            "no_show_by": "admin",
        }},
    )
    if res.modified_count != 1:
        b2 = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
        if b2 and b2.get("status") == "no_show":
            return {"ok": True, "status": "no_show", "booking": b2}
        raise HTTPException(status_code=409, detail="Não foi possível marcar no-show")
    updated = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    await daily_metrics.note_no_show(db)
    logger.info("event=booking_no_show source=admin booking_id=%s", booking_id[:8])
    return {"ok": True, "status": "no_show", "booking": updated}




class AdminNotesIn(BaseModel):
    notes: str = Field(default="", max_length=500)


@api.patch("/admin/bookings/{booking_id}/notes")
async def admin_update_booking_notes(
    booking_id: str,
    payload: AdminNotesIn,
    admin: dict = Depends(require_admin),
):
    """Internal admin notes — never exposed on public MyBookings / lookup."""
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Reserva não encontrada")
    notes = (payload.notes or "").strip()
    if len(notes) > 500:
        raise HTTPException(status_code=400, detail="Notas: máximo 500 caracteres")
    await db.bookings.update_one(
        {"id": booking_id},
        {"$set": {
            "admin_notes": notes,
            "admin_notes_updated_at": _now_iso(),
            "admin_notes_updated_by": admin.get("email") or "admin",
        }},
    )
    updated = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    logger.info("event=booking_admin_notes booking_id=%s len=%s", booking_id[:8], len(notes))
    return {"ok": True, "admin_notes": notes, "booking": updated}


def _check_in_eligible(b: dict, today: str) -> tuple[bool, str]:
    """Return (ok, error_detail). Only today + confirmed/paid."""
    if (b.get("date") or "") != today:
        return False, "Check-in só para reservas de hoje"
    status = b.get("status")
    pay = (b.get("payment") or {}).get("status")
    if status == "confirmed" or pay == "paid":
        return True, ""
    return False, "Só reservas confirmadas/pagas podem fazer check-in"


@api.post("/admin/bookings/{booking_id}/check-in")
async def admin_check_in_booking(booking_id: str, admin: dict = Depends(require_admin)):
    """Mark customer arrived — today only, confirmed/paid."""
    tz = ZoneInfo("America/Sao_Paulo")
    today = datetime.now(tz).strftime("%Y-%m-%d")
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Reserva não encontrada")
    if b.get("checked_in_at"):
        return {
            "ok": True,
            "checked_in": True,
            "checked_in_at": b.get("checked_in_at"),
            "booking": b,
        }
    ok, reason = _check_in_eligible(b, today)
    if not ok:
        raise HTTPException(status_code=400, detail=reason)
    now = _now_iso()
    res = await db.bookings.update_one(
        {"id": booking_id, "checked_in_at": {"$in": [None, ""]}},
        {"$set": {
            "checked_in_at": now,
            "checked_in_by": admin.get("email") or "admin",
        }},
    )
    updated = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if res.modified_count != 1 and not (updated and updated.get("checked_in_at")):
        raise HTTPException(status_code=409, detail="Não foi possível registrar check-in")
    logger.info("event=booking_check_in booking_id=%s", booking_id[:8])
    return {
        "ok": True,
        "checked_in": True,
        "checked_in_at": updated.get("checked_in_at"),
        "booking": updated,
    }


@api.post("/admin/bookings/{booking_id}/check-in/undo")
async def admin_undo_check_in_booking(booking_id: str, admin: dict = Depends(require_admin)):
    """Clear check-in flag (optional undo)."""
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Reserva não encontrada")
    await db.bookings.update_one(
        {"id": booking_id},
        {"$set": {"checked_in_at": None, "checked_in_by": None}},
    )
    updated = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    logger.info("event=booking_check_in_undo booking_id=%s", booking_id[:8])
    return {
        "ok": True,
        "checked_in": False,
        "checked_in_at": None,
        "booking": updated,
    }


class AdminRescheduleIn(BaseModel):
    date: str
    start_time: str


@api.post("/admin/bookings/{booking_id}/reschedule")
async def admin_reschedule_booking(
    booking_id: str,
    payload: AdminRescheduleIn,
    admin: dict = Depends(require_admin),
):
    """Admin remarca sem janela cancel_min_hours; atomic; payment preserved."""
    await bsvc.expire_stale_pending(db)
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Reserva não encontrada")
    if b.get("status") not in ACTIVE_STATUSES:
        raise HTTPException(status_code=400, detail="Reserva já cancelada ou expirada")
    old_date, old_time = b.get("date"), b.get("start_time")
    try:
        updated = await bsvc.reschedule_booking_atomic(
            db,
            booking_id=booking_id,
            new_date=payload.date,
            new_start_time=payload.start_time,
        )
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Horário já reservado")
    except ValueError as e:
        msg = str(e)
        code = 404 if "não encontrada" in msg.lower() else 400
        raise HTTPException(status_code=code, detail=msg)
    wa_ok = await _notify_reschedule_wa(updated, old_date=old_date, old_time=old_time, source="admin")
    logger.info(
        "event=booking_reschedule source=admin booking_id=%s %s %s -> %s %s wa=%s",
        booking_id[:8],
        old_date,
        old_time,
        updated.get("date"),
        updated.get("start_time"),
        wa_ok,
    )
    return {**updated, "whatsapp_notified": wa_ok}


@api.post("/admin/bookings/{booking_id}/reject")
async def admin_reject_booking(booking_id: str, admin: dict = Depends(require_admin)):
    """Reject PIX comprovante / pending booking — cancels, never confirms.
    One-click from admin fila de informados."""
    b = await db.bookings.find_one({"id": booking_id})
    if not b:
        raise HTTPException(status_code=404, detail="Reserva não encontrada")
    if b["status"] not in ("pending", "awaiting_admin"):
        raise HTTPException(status_code=400, detail="Só rejeita pendente ou informado")
    await db.bookings.update_one(
        {"id": booking_id},
        {"$set": {
            "status": "cancelled",
            "payment.status": "cancelled",
            "payment.rejected_at": _now_iso(),
            "payment.rejected_by": admin.get("email"),
        }},
    )
    ops_metrics.note_booking_cancel("admin_reject")
    await daily_metrics.note_cancelled(db)
    logger.info("event=booking_reject source=admin booking_id=%s", booking_id[:8])
    # Best-effort WA notify customer
    msg = (
        f"Pedra Azul: o comprovante da reserva "
        f"{b.get('date')} {b.get('start_time')} não foi validado. "
        f"A reserva foi cancelada. Se precisar, envie outro comprovante após nova reserva no site."
    )
    sent = await whatsapp_bridge.send_text(b.get("whatsapp") or "", msg)
    return {"ok": True, "id": booking_id, "status": "cancelled", "whatsapp_notified": bool(sent)}


@api.get("/admin/bookings/awaiting")
async def admin_awaiting_queue(admin: dict = Depends(require_admin)):
    """Fila de reservas informadas (awaiting_admin) — precisam validação PIX."""
    await bsvc.expire_stale_pending(db)
    items = await db.bookings.find(
        {"status": "awaiting_admin"},
        {"_id": 0},
    ).sort("payment.comprovante_uploaded_at", 1).to_list(200)
    return {"bookings": items, "count": len(items)}


# =============================================================================
# INTERNAL — WhatsApp sidecar (X-Internal-Token)
# =============================================================================
def _internal_api_token() -> str:
    """Prefer INTERNAL_API_TOKEN; fall back to legacy WHATSAPP_INTERNAL_TOKEN."""
    return (
        os.environ.get("INTERNAL_API_TOKEN")
        or os.environ.get("WHATSAPP_INTERNAL_TOKEN")
        or ""
    ).strip()


def _require_internal(request: Request):
    token = _internal_api_token()
    if not token:
        return  # open in local/dev when unset (same as sidecar)
    got = request.headers.get("x-internal-token") or ""
    if got != token:
        raise HTTPException(status_code=401, detail="Unauthorized")


class WaBookingIn(BaseModel):
    phone: str
    customer_name: str = Field(min_length=2, max_length=80)
    date: str
    start_time: str
    duration_minutes: int = 60


class WaCancelIn(BaseModel):
    phone: str
    booking_id: Optional[str] = None


class AdminBlockIn(BaseModel):
    date: str
    start_time: str
    reason: Optional[str] = Field(default=None, max_length=200)


class AdminBlockDayIn(BaseModel):
    date: str
    reason: Optional[str] = Field(default=None, max_length=200)


class AdminBlockRangeIn(BaseModel):
    date_from: str
    date_to: str
    reason: Optional[str] = Field(default=None, max_length=200)


class AdminUnblockDayIn(BaseModel):
    date: str


class AdminBookingIn(BaseModel):
    date: str
    start_time: str
    customer_name: str = Field(min_length=2, max_length=80)
    whatsapp: str = Field(min_length=8, max_length=20)
    status: Literal["confirmed", "pending"] = "confirmed"


@api.get("/internal/whatsapp/availability")
async def internal_wa_availability(request: Request, date: str, after_hour: Optional[int] = None):
    _require_internal(request)
    return await bsvc.build_availability(db, COURT_ID, date, after_hour=after_hour)


@api.post("/internal/whatsapp/bookings")
async def internal_wa_create_booking(request: Request, payload: WaBookingIn):
    _require_internal(request)
    phone = normalize_whatsapp(payload.phone)
    if len(only_digits(phone)) < 10:
        raise HTTPException(status_code=400, detail="WhatsApp inválido")
    # CPF placeholder for WA channel (identity = phone)
    cpf_digits = f"wa{only_digits(phone)[-9:]}".ljust(11, "0")[:11]
    try:
        booking = await bsvc.create_booking_atomic(
            db,
            court_id=COURT_ID,
            date=payload.date,
            start_time=payload.start_time,
            customer_name=payload.customer_name,
            whatsapp=phone,
            cpf=cpf_digits,
            cpf_masked="WhatsApp",
            your_team_name="WhatsApp",
            opponent_team_name="A definir",
            duration_minutes=payload.duration_minutes,
            source="whatsapp",
            status="confirmed",
            payment_status="pending",
        )
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Horário já reservado")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    ops_metrics.note_booking_create("whatsapp")
    await daily_metrics.note_created(db)
    logger.info(
        "event=booking_create source=whatsapp booking_id=%s date=%s time=%s",
        booking["id"][:8],
        booking["date"],
        booking["start_time"],
    )
    await admin_alerts.notify_admin_new_booking(db, booking)
    return booking


@api.get("/internal/whatsapp/bookings")
async def internal_wa_list_bookings(request: Request, phone: str):
    _require_internal(request)
    variants = phone_variants(phone) or [normalize_whatsapp(phone)]
    items = await db.bookings.find(
        {"whatsapp": {"$in": variants}},
        {"_id": 0},
    ).sort("date", 1).to_list(50)
    # Extra safety: filter with phones_match (covers odd legacy formats)
    items = [b for b in items if phones_match(phone, b.get("whatsapp") or "")]
    return {"bookings": items}


@api.post("/internal/whatsapp/bookings/cancel")
async def internal_wa_cancel(request: Request, payload: WaCancelIn):
    """Cancel only when WhatsApp phone matches the booking (variant-aware)."""
    _require_internal(request)
    variants = phone_variants(payload.phone) or [normalize_whatsapp(payload.phone)]
    q = {
        "whatsapp": {"$in": variants},
        "status": {"$in": ["pending", "awaiting_admin", "confirmed"]},
    }
    if payload.booking_id:
        q["id"] = payload.booking_id
    b = await db.bookings.find_one(q, sort=[("date", 1), ("start_time", 1)])
    if not b or not phones_match(payload.phone, b.get("whatsapp") or ""):
        return {"cancelled": False, "message": "Nenhuma reserva ativa neste número"}
    settings = await sset.get_settings(db)
    ok_cancel, reason = _customer_cancel_allowed(b, settings)
    if not ok_cancel:
        return {"cancelled": False, "message": reason}
    # Atomic: only cancel if phone still matches (prevents id-only cancel without phone)
    res = await db.bookings.update_one(
        {
            "id": b["id"],
            "whatsapp": {"$in": variants},
            "status": {"$in": list(ACTIVE_STATUSES)},
        },
        {"$set": {
            "status": "cancelled",
            "payment.status": "cancelled",
            "cancelled_at": _now_iso(),
            "cancelled_by": "whatsapp",
        }},
    )
    if res.modified_count != 1:
        return {"cancelled": False, "message": "Nenhuma reserva ativa neste número"}
    ops_metrics.note_booking_cancel("whatsapp")
    await daily_metrics.note_cancelled(db)
    logger.info(
        "event=booking_cancel source=whatsapp booking_id=%s date=%s time=%s",
        b["id"][:8],
        b["date"],
        b["start_time"],
    )
    return {
        "cancelled": True,
        "id": b["id"],
        "date": b["date"],
        "start_time": b["start_time"],
        "message": f"Reserva cancelada: {b['date']} às {b['start_time']}. Horário liberado.",
    }


class WaRescheduleIn(BaseModel):
    phone: str
    booking_id: Optional[str] = None
    date: str
    start_time: str


@api.post("/internal/whatsapp/bookings/reschedule")
async def internal_wa_reschedule(request: Request, payload: WaRescheduleIn):
    """Atomic remarcação by WhatsApp phone match; respects cancel_min_hours; payment preserved."""
    _require_internal(request)
    await bsvc.expire_stale_pending(db)
    variants = phone_variants(payload.phone) or [normalize_whatsapp(payload.phone)]
    q = {
        "whatsapp": {"$in": variants},
        "status": {"$in": list(ACTIVE_STATUSES)},
    }
    if payload.booking_id:
        q["id"] = payload.booking_id
    b = await db.bookings.find_one(q, sort=[("date", 1), ("start_time", 1)])
    if not b or not phones_match(payload.phone, b.get("whatsapp") or ""):
        return {"ok": False, "message": "Nenhuma reserva ativa neste número"}
    settings = await sset.get_settings(db)
    ok_alter, reason = _customer_cancel_allowed(b, settings, action="Remarcação")
    if not ok_alter:
        return {"ok": False, "message": reason}
    old_date, old_time = b.get("date"), b.get("start_time")
    try:
        updated = await bsvc.reschedule_booking_atomic(
            db,
            booking_id=b["id"],
            new_date=payload.date,
            new_start_time=payload.start_time,
            match_extra={"whatsapp": {"$in": variants}},
        )
    except DuplicateKeyError:
        return {"ok": False, "message": "Horário já reservado"}
    except ValueError as e:
        return {"ok": False, "message": str(e)}
    logger.info(
        "event=booking_reschedule source=whatsapp booking_id=%s %s %s -> %s %s",
        updated["id"][:8],
        old_date,
        old_time,
        updated.get("date"),
        updated.get("start_time"),
    )
    return {
        "ok": True,
        "id": updated["id"],
        "date": updated["date"],
        "start_time": updated["start_time"],
        "previous_date": old_date,
        "previous_start_time": old_time,
        "status": updated.get("status"),
        "payment_status": (updated.get("payment") or {}).get("status"),
        "message": (
            f"Reserva remarcada: de {old_date} às {old_time} "
            f"para {updated['date']} às {updated['start_time']}."
        ),
    }


@api.post("/internal/whatsapp/comprovante")
async def internal_wa_comprovante(
    request: Request,
    phone: str = Form(...),
    booking_id: Optional[str] = Form(None),
    file: UploadFile = File(...),
):
    """WhatsApp image as PIX proof → awaiting_admin (informado). NEVER auto-confirm."""
    _require_internal(request)
    await bsvc.expire_stale_pending(db)
    variants = phone_variants(phone) or [normalize_whatsapp(phone)]
    q = {
        "whatsapp": {"$in": variants},
        "status": {"$in": ["pending", "awaiting_admin"]},
    }
    if booking_id:
        q["id"] = booking_id
    b = await db.bookings.find_one(q, sort=[("created_at", -1)])
    demote_to_informado = True
    if not b or not phones_match(phone, b.get("whatsapp") or ""):
        # WA-created bookings are often already confirmed with payment pending —
        # attach proof for admin review but do NOT demote the reservation slot.
        q2 = {
            "whatsapp": {"$in": variants},
            "status": "confirmed",
            "payment.status": {"$in": ["pending", "awaiting_confirmation"]},
        }
        b = await db.bookings.find_one(q2, sort=[("created_at", -1)])
        if not b or not phones_match(phone, b.get("whatsapp") or ""):
            raise HTTPException(
                status_code=404,
                detail="Nenhuma reserva pendente neste WhatsApp para anexar comprovante",
            )
        demote_to_informado = False
    content = await file.read()
    url, grid_id = await _save_upload_bytes(content, "comprovantes", file.filename or "wa-comprovante.jpg")
    if demote_to_informado:
        updated = await _attach_comprovante(b["id"], url, grid_id)
        status_out = "awaiting_admin"
    else:
        await db.bookings.update_one(
            {"id": b["id"]},
            {"$set": {
                "payment.status": "awaiting_confirmation",
                "payment.comprovante_url": url,
                "payment.comprovante_uploaded_at": _now_iso(),
                "payment.comprovante_gridfs_id": grid_id,
            }},
        )
        updated = await db.bookings.find_one({"id": b["id"]}, {"_id": 0})
        status_out = updated.get("status")
        logger.info(
            "event=comprovante_attached booking_id=%s status=%s keep_confirmed=true auto_confirm=false",
            b["id"][:8],
            status_out,
        )
    return {
        "ok": True,
        "booking": updated,
        "status": status_out,
        "auto_confirmed": False,
        "message": "Comprovante recebido. Aguardando validação do admin.",
    }


@api.get("/internal/whatsapp/reminders/due")
async def internal_reminders_due(request: Request):
    """Confirmed bookings in settings reminder window (lead ±30min), reminder not sent."""
    _require_internal(request)
    tz = ZoneInfo("America/Sao_Paulo")
    now = datetime.now(tz)
    settings = await sset.get_settings(db)
    try:
        lead_h = int(settings.get("reminder_hours_before") or 3)
    except (TypeError, ValueError):
        lead_h = 3
    lead_h = max(1, min(48, lead_h))
    # Window: start between now+(lead±0.5)h → minutes
    lo_min = lead_h * 60 - 30
    hi_min = lead_h * 60 + 30
    due = []
    # Span enough days for long lead times (up to 48h)
    day_span = max(2, (lead_h // 24) + 2)
    for day_offset in range(0, day_span + 1):
        day = (now + timedelta(days=day_offset)).strftime("%Y-%m-%d")
        cursor = db.bookings.find(
            {
                "date": day,
                "status": "confirmed",
                "reminder_sent": {"$ne": True},
            },
            {"_id": 0},
        )
        async for b in cursor:
            try:
                parts = str(b.get("start_time") or "0:0").split(":")
                hour = int(parts[0])
                minute = int(parts[1]) if len(parts) > 1 else 0
                start_local = now.replace(
                    year=int(day[0:4]), month=int(day[5:7]), day=int(day[8:10]),
                    hour=hour, minute=minute, second=0, microsecond=0,
                )
            except Exception:
                continue
            delta_min = (start_local - now).total_seconds() / 60.0
            if lo_min <= delta_min <= hi_min:
                due.append(b)
    return {
        "bookings": due,
        "reminder_hours_before": lead_h,
        "window_minutes": [lo_min, hi_min],
    }


@api.post("/internal/whatsapp/reminders/{booking_id}/sent")
async def internal_reminder_mark(booking_id: str, request: Request):
    """Atomic claim — only one caller wins (prevents duplicate after restart).

    Race: two pollers may both see the booking as due; the filter
    `reminder_sent != True` makes update_one succeed for exactly one of them
    (modified_count==1). Loser gets ok=false and must skip send.
    """
    _require_internal(request)
    res = await db.bookings.update_one(
        {"id": booking_id, "reminder_sent": {"$ne": True}},
        {"$set": {"reminder_sent": True, "reminder_sent_at": _now_iso()}},
    )
    return {"ok": res.modified_count == 1}


# =============================================================================
# ADMIN — Calendar (single court)
# =============================================================================
@api.get("/admin/calendar")
async def admin_calendar(
    admin: dict = Depends(require_admin),
    start: Optional[str] = None,
    days: int = 1,
):
    tz = ZoneInfo("America/Sao_Paulo")
    if not start:
        start = datetime.now(tz).strftime("%Y-%m-%d")
    # day=1, week=7, month≈28–42 (calendar grid padded)
    if days <= 1:
        days = 1
    elif days <= 7:
        days = 7
    else:
        days = min(max(days, 8), 42)
    return await bsvc.calendar_range(db, start, days=days)


@api.post("/admin/calendar/block")
async def admin_block_slot(payload: AdminBlockIn, admin: dict = Depends(require_admin)):
    runtime = await bsvc.get_runtime(db, payload.date)
    if payload.start_time not in runtime["time_slots"]:
        raise HTTPException(status_code=400, detail="Horário inválido")
    sk = bsvc.slot_key(COURT_ID, payload.date, payload.start_time)
    # refuse if active booking
    existing = await db.bookings.find_one(
        {"slot_key": sk, "status": {"$in": ["pending", "awaiting_admin", "confirmed"]}}
    )
    if existing:
        raise HTTPException(status_code=409, detail="Já existe reserva neste horário")
    reason_clean = (payload.reason or "").strip()[:200] or None
    doc = {
        "id": str(uuid.uuid4()),
        "court_id": COURT_ID,
        "date": payload.date,
        "start_time": payload.start_time,
        "slot_key": sk,
        "created_at": _now_iso(),
        "created_by": admin.get("email"),
    }
    if reason_clean:
        doc["reason"] = reason_clean
    try:
        await db.blocked_slots.update_one(
            {"slot_key": sk},
            {"$set": doc},
            upsert=True,
        )
    except DuplicateKeyError:
        pass
    return {"ok": True, "blocked": doc}


@api.post("/admin/calendar/unblock")
async def admin_unblock_slot(payload: AdminBlockIn, admin: dict = Depends(require_admin)):
    sk = bsvc.slot_key(COURT_ID, payload.date, payload.start_time)
    await db.blocked_slots.delete_one({"slot_key": sk})
    return {"ok": True}


@api.post("/admin/calendar/block-day")
async def admin_block_day(payload: AdminBlockDayIn, admin: dict = Depends(require_admin)):
    try:
        return await bsvc.block_day(
            db,
            date=payload.date,
            reason=payload.reason,
            created_by=admin.get("email"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@api.post("/admin/calendar/block-range")
async def admin_block_range(payload: AdminBlockRangeIn, admin: dict = Depends(require_admin)):
    try:
        return await bsvc.block_date_range(
            db,
            date_from=payload.date_from,
            date_to=payload.date_to,
            reason=payload.reason,
            created_by=admin.get("email"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@api.post("/admin/calendar/unblock-day")
async def admin_unblock_day(payload: AdminUnblockDayIn, admin: dict = Depends(require_admin)):
    try:
        return await bsvc.unblock_day(db, date=payload.date)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@api.post("/admin/calendar/bookings")
async def admin_calendar_create_booking(payload: AdminBookingIn, admin: dict = Depends(require_admin)):
    phone = normalize_whatsapp(payload.whatsapp)
    cpf_digits = f"ad{only_digits(phone)[-9:]}".ljust(11, "0")[:11]
    try:
        booking = await bsvc.create_booking_atomic(
            db,
            court_id=COURT_ID,
            date=payload.date,
            start_time=payload.start_time,
            customer_name=payload.customer_name,
            whatsapp=phone,
            cpf=cpf_digits,
            cpf_masked="Admin",
            your_team_name="Admin",
            opponent_team_name="A definir",
            source="admin",
            status=payload.status,
            payment_status="paid" if payload.status == "confirmed" else "pending",
        )
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Horário já reservado")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    ops_metrics.note_booking_create("admin")
    await daily_metrics.note_created(db)
    logger.info(
        "event=booking_create source=admin booking_id=%s date=%s time=%s",
        booking["id"][:8],
        booking["date"],
        booking["start_time"],
    )
    return booking


# =============================================================================
# ADMIN — Ops metrics (in-memory; no secrets)
# =============================================================================
@api.get("/admin/metrics")
async def admin_metrics(admin: dict = Depends(require_admin)):
    wa_status = await whatsapp_bridge.get_status()
    wa = wa_status.get("status") or "DESCONECTADO"
    ops_metrics.set_wa_status(wa)
    snap = ops_metrics.snapshot(wa)
    # Enrich last_error_code from WA sidecar when present (safe codes/reasons only)
    last_err = wa_status.get("last_disconnect_reason") or wa_status.get("last_error")
    if last_err and not snap.get("last_error_code"):
        ops_metrics.note_error(str(last_err)[:80])
        snap = ops_metrics.snapshot(wa)
    elif last_err:
        snap["last_error_code"] = str(last_err)[:80]
    # Persisted funnel / occupancy (last 7 days)
    try:
        funnel = await daily_metrics.summary_last_n(db, 7)
    except Exception as e:
        logger.warning("daily_metrics summary failed: %s", e)
        funnel = {"days": 7, "series": [], "totals": {}}
    snap["last_7_days"] = funnel
    snap["awaiting_admin_count"] = await db.bookings.count_documents({"status": "awaiting_admin"})
    return snap


# =============================================================================
# ADMIN — WhatsApp (Baileys sidecar proxy + SSE)
# =============================================================================
@api.get("/admin/whatsapp/status")
async def admin_whatsapp_status(admin: dict = Depends(require_admin)):
    return await whatsapp_bridge.get_status()


@api.post("/admin/whatsapp/start")
async def admin_whatsapp_start(admin: dict = Depends(require_admin)):
    try:
        return await whatsapp_bridge.start_session()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@api.post("/admin/whatsapp/logout")
async def admin_whatsapp_logout(admin: dict = Depends(require_admin)):
    try:
        return await whatsapp_bridge.logout_session()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@api.get("/admin/whatsapp/events")
async def admin_whatsapp_events(request: Request, admin: dict = Depends(require_admin)):
    """SSE stream of WhatsApp connection state for Admin QR UI."""
    url = f"{whatsapp_bridge.WHATSAPP_SERVICE_URL}/events"
    headers = whatsapp_bridge._headers()

    async def event_gen():
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream("GET", url, headers=headers) as resp:
                    async for line in resp.aiter_lines():
                        if await request.is_disconnected():
                            break
                        yield (line + "\n").encode("utf-8")
        except Exception as e:
            # Fallback: poll status every 2s if sidecar SSE unavailable
            logger.warning("whatsapp SSE proxy failed, falling back to poll: %s", e)
            while not await request.is_disconnected():
                st = await whatsapp_bridge.get_status()
                payload = {"type": "state", **st, "at": _now_iso()}
                yield f"data: {__import__('json').dumps(payload)}\n\n".encode("utf-8")
                await asyncio.sleep(2)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@api.post("/admin/tournaments/{tid}/matches/{mid}/score")
async def admin_update_match_score(tid: str, mid: str, payload: MatchScoreUpdate,
                                   admin: dict = Depends(require_admin)):
    t = await db.tournaments.find_one({"id": tid})
    if not t:
        raise HTTPException(status_code=404, detail="Torneio não encontrado")
    found = False
    for m in t.get("matches", []):
        if m["id"] == mid:
            m["score_a"] = payload.score_a
            m["score_b"] = payload.score_b
            m["status"] = payload.status
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="Partida não encontrada")
    if t.get("format") == "knockout" and payload.status == "finished":
        _advance_knockout(t, mid)
    await db.tournaments.update_one({"id": tid}, {"$set": {"matches": t["matches"]}})
    return _serialize_tournament(await db.tournaments.find_one({"id": tid}))


def _advance_knockout(t: dict, finished_match_id: str):
    matches = t.get("matches", [])
    match_map = {m["id"]: m for m in matches}
    m = match_map[finished_match_id]
    if not m.get("team_a_id") or not m.get("team_b_id"):
        return
    if m["score_a"] == m["score_b"]:
        return
    winner = m["team_a_id"] if m["score_a"] > m["score_b"] else m["team_b_id"]
    next_round = m["round"] + 1
    next_slot = m["slot"] // 2
    side = "team_a_id" if m["slot"] % 2 == 0 else "team_b_id"
    for nm in matches:
        if nm["round"] == next_round and nm["slot"] == next_slot:
            nm[side] = winner
            break


# =============================================================================
# Startup
# =============================================================================
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.bookings.create_index([("court_id", 1), ("date", 1), ("start_time", 1)])
    await db.bookings.create_index("cpf")
    # Lookups: MyBookings by CPF, WA bot / admin by phone, calendar by date+status
    try:
        await db.bookings.create_index([("date", 1), ("status", 1)], name="bookings_date_status")
    except Exception as e:
        logger.warning("bookings_date_status index: %s", e)
    try:
        await db.bookings.create_index("whatsapp", name="bookings_whatsapp")
    except Exception as e:
        logger.warning("bookings_whatsapp index: %s", e)
    # Atomic anti-double-booking: only one active booking per court+date+slot
    try:
        await db.bookings.create_index(
            [("slot_key", 1)],
            unique=True,
            partialFilterExpression={
                "status": {"$in": ["pending", "awaiting_admin", "confirmed"]},
                "slot_key": {"$type": "string"},
            },
            name="uniq_active_slot_key",
        )
    except Exception as e:
        logger.warning("uniq_active_slot_key index: %s", e)
    # Backfill slot_key for legacy docs (best-effort, non-fatal)
    try:
        async for b in db.bookings.find(
            {"slot_key": {"$exists": False}, "court_id": {"$exists": True}},
            {"_id": 1, "court_id": 1, "date": 1, "start_time": 1},
        ):
            sk = f"{b['court_id']}|{b['date']}|{b['start_time']}"
            await db.bookings.update_one({"_id": b["_id"]}, {"$set": {"slot_key": sk}})
    except Exception as e:
        logger.warning("slot_key backfill: %s", e)
    await db.tournaments.create_index("id", unique=True)
    try:
        await db.blocked_slots.create_index([("slot_key", 1)], unique=True, name="uniq_blocked_slot")
        await db.blocked_slots.create_index([("court_id", 1), ("date", 1)])
    except Exception as e:
        logger.warning("blocked_slots index: %s", e)
    try:
        await db.bookings.update_many(
            {"reminder_sent": {"$exists": False}},
            {"$set": {"reminder_sent": False, "reminder_sent_at": None}},
        )
    except Exception as e:
        logger.warning("reminder_sent backfill: %s", e)
    await run_all_seeds(db)
    await sset.ensure_seeded(db)
    await daily_metrics.ensure_indexes(db)
    logger.info("Arena Futsal Premium API initialized (CPF + WA bot + calendar)")

    # Cycle 18: lightweight localhost WA sidecar self-ping (optional).
    # Does NOT prevent Render Free sleep — only nudges restore while the dyno is already awake.
    # Paid plan still required for 24/7 WhatsApp.
    global _wa_self_ping_task
    try:
        interval_min = float(os.environ.get("WA_SELF_PING_MINUTES", "5") or "5")
    except ValueError:
        interval_min = 5.0
    # Clamp: min 3 min (avoid quota burn), max 30; 0 disables
    if interval_min <= 0:
        logger.info("WA self-ping disabled (WA_SELF_PING_MINUTES<=0)")
        _wa_self_ping_task = None
    else:
        interval_min = max(3.0, min(30.0, interval_min))

        async def _wa_self_ping_loop():
            await asyncio.sleep(20)  # let sidecar bind after start.sh
            while True:
                try:
                    h = await whatsapp_bridge.ping_health()
                    wa = h.get("whatsapp")
                    logger.info(
                        "wa_self_ping status=%s restoring=%s saved=%s",
                        wa,
                        h.get("restoring"),
                        h.get("has_saved_session"),
                    )
                    if wa in ("DESCONECTADO", "ERRO"):
                        await whatsapp_bridge.ensure_started_if_saved()
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    logger.warning("wa_self_ping error: %s", e)
                await asyncio.sleep(interval_min * 60)

        _wa_self_ping_task = asyncio.create_task(_wa_self_ping_loop())
        logger.info(
            "WA self-ping every %.0f min (localhost only; Free sleep still drops WA — use paid for 24/7)",
            interval_min,
        )


@app.on_event("shutdown")
async def shutdown():
    global _wa_self_ping_task
    try:
        if _wa_self_ping_task:
            _wa_self_ping_task.cancel()
            try:
                await _wa_self_ping_task
            except (asyncio.CancelledError, Exception):
                pass
    except Exception:
        pass
    client.close()


app.include_router(api)
# Uploads served by GET /api/uploads/{subdir}/{filename} (disk cache + GridFS) — no StaticFiles mount


# =============================================================================
# Production: serve React build (SPA) when present
# =============================================================================
def _resolve_frontend_build() -> Optional[Path]:
    candidates = [
        ROOT_DIR.parent / "frontend" / "build",
        Path("/app/frontend_build"),
        ROOT_DIR.parent / "frontend_build",
    ]
    for p in candidates:
        if (p / "index.html").is_file():
            return p
    return None


FRONTEND_BUILD = _resolve_frontend_build()
if FRONTEND_BUILD:
    static_dir = FRONTEND_BUILD / "static"
    if static_dir.is_dir():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="react_static")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve CRA assets or index.html for client-side routes. API stays under /api."""
        if full_path.startswith("api"):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = FRONTEND_BUILD / full_path
        if full_path and candidate.is_file():
            # Hashed /static/* can be cached long; HTML/SW must revalidate for deploys
            headers = {}
            name = candidate.name
            if name in ("index.html", "sw.js", "manifest.json") or name.endswith(".html"):
                headers = {"Cache-Control": "no-cache, no-store, must-revalidate"}
            elif full_path.startswith("static/"):
                headers = {"Cache-Control": "public, max-age=31536000, immutable"}
            return FileResponse(candidate, headers=headers)
        return FileResponse(
            FRONTEND_BUILD / "index.html",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )

    logger.info("Serving frontend from %s", FRONTEND_BUILD)

# CORS: set CORS_ORIGINS to explicit origins (comma-separated).
# In production (RENDER or ENV=production), "*" / empty → Pedra Azul + localhost allowlist.
# Wildcard + credentials is unsafe/invalid — when "*" we disable credentials (local/dev OK).
_cors_raw = (os.environ.get("CORS_ORIGINS") or "").strip()
_cors_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()] if _cors_raw else []
_is_prod = bool(
    os.environ.get("RENDER")
    or (os.environ.get("ENV") or "").strip().lower() in ("production", "prod")
)
_DEFAULT_PROD_ORIGINS = [
    "https://pedra-azul.onrender.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]
if not _cors_origins or _cors_origins == ["*"]:
    if _is_prod:
        _cors_origins = list(_DEFAULT_PROD_ORIGINS)
        logger.info("CORS: production allowlist (CORS_ORIGINS was * or empty)")
    else:
        _cors_origins = ["*"]
_cors_wildcard = _cors_origins == ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_credentials=not _cors_wildcard,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Internal-Token", "Accept", "Origin", "X-Forwarded-For"],
)
