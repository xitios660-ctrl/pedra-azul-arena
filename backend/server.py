"""Arena Futsal Premium — FastAPI backend.
Customer flow uses CPF (no login). Admin flow keeps email/password JWT auth.
"""
from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
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
import booking_service as bsvc
from booking_service import COURT, COURT_ID, TIME_SLOTS, DEPOSIT_RATE

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

# -----------------------------------------------------------------------------
# Setup
# -----------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("arena")

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

UPLOAD_DIR = ROOT_DIR / "uploads"
(UPLOAD_DIR / "crests").mkdir(parents=True, exist_ok=True)
(UPLOAD_DIR / "comprovantes").mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Arena Futsal Premium API")
api = APIRouter(prefix="/api")



# -----------------------------------------------------------------------------
# Light rate limit — public booking create (per IP, in-memory)
# -----------------------------------------------------------------------------
_BOOKING_HITS: dict[str, list[float]] = defaultdict(list)
_BOOKING_LIMIT = int(os.environ.get("BOOKING_RATE_LIMIT", "8"))
_BOOKING_WINDOW = int(os.environ.get("BOOKING_RATE_WINDOW_SEC", "60"))


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _rate_limit_booking(request: Request) -> None:
    ip = _client_ip(request)
    now = time.time()
    hits = [t for t in _BOOKING_HITS[ip] if now - t < _BOOKING_WINDOW]
    if len(hits) >= _BOOKING_LIMIT:
        _BOOKING_HITS[ip] = hits
        raise HTTPException(
            status_code=429,
            detail="Muitas reservas em pouco tempo. Aguarde um minuto e tente novamente.",
        )
    hits.append(now)
    _BOOKING_HITS[ip] = hits

@api.get("/health")
async def health():
    """Public health — no secrets. Used by Render healthCheckPath."""
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
        "court": COURT_ID,
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
async def login(payload: LoginIn, response: Response):
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
    return COURTS


@api.get("/courts/availability")
async def court_availability(court_id: str, date: str):
    await bsvc.expire_stale_pending(db)
    if court_id not in COURT_BY_ID:
        raise HTTPException(status_code=404, detail="Quadra não encontrada")
    try:
        return await bsvc.build_availability(db, court_id, date)
    except ValueError:
        raise HTTPException(status_code=404, detail="Quadra não encontrada")


# =============================================================================
# UPLOADS (public — accept image uploads for crests, anyone can upload)
# =============================================================================
def _save_upload(file: UploadFile, subdir: str) -> str:
    """Save uploaded image, return public URL path."""
    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in {"png", "jpg", "jpeg", "webp", "gif", "svg"}:
        raise HTTPException(status_code=400, detail="Formato de imagem inválido (use PNG, JPG, WEBP)")
    fname = f"{uuid.uuid4().hex}.{ext}"
    out_path = UPLOAD_DIR / subdir / fname
    content = file.file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Imagem muito grande (máx 5MB)")
    out_path.write_bytes(content)
    return f"/api/uploads/{subdir}/{fname}"

def _save_upload_bytes(content: bytes, subdir: str, filename: str | None = None) -> str:
    """Save raw image bytes (WhatsApp comprovante path). Reuses same public URL layout."""
    name = filename or "comprovante.jpg"
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else "jpg"
    if ext not in {"png", "jpg", "jpeg", "webp", "gif"}:
        ext = "jpg"
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Imagem muito grande (máx 5MB)")
    if not content:
        raise HTTPException(status_code=400, detail="Imagem vazia")
    fname = f"{uuid.uuid4().hex}.{ext}"
    out_path = UPLOAD_DIR / subdir / fname
    out_path.write_bytes(content)
    return f"/api/uploads/{subdir}/{fname}"


async def _attach_comprovante(booking_id: str, url: str) -> dict:
    """Mark booking as awaiting_admin (informado). NEVER confirms payment."""
    await db.bookings.update_one(
        {"id": booking_id},
        {"$set": {
            "status": "awaiting_admin",
            "payment.status": "awaiting_confirmation",
            "payment.comprovante_url": url,
            "payment.comprovante_uploaded_at": _now_iso(),
        }},
    )
    updated = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    logger.info(
        "event=comprovante_attached booking_id=%s status=awaiting_admin auto_confirm=false",
        booking_id[:8],
    )
    return updated


@api.post("/uploads/crest")
async def upload_crest(file: UploadFile = File(...)):
    url = _save_upload(file, "crests")
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
    return booking


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
    url = _save_upload(file, "comprovantes")
    return await _attach_comprovante(booking_id, url)


@api.get("/bookings/{booking_id}")
async def get_booking(booking_id: str):
    await bsvc.expire_stale_pending(db)
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Reserva não encontrada")
    return b


@api.post("/bookings/lookup")
async def lookup_by_cpf(payload: LookupIn):
    """Public: look up a customer's bookings by CPF (no login)."""
    await bsvc.expire_stale_pending(db)
    if not validate_cpf(payload.cpf):
        raise HTTPException(status_code=400, detail="CPF inválido")
    cpf_d = only_digits(payload.cpf)
    items = await db.bookings.find({"cpf": cpf_d}, {"_id": 0}).sort("created_at", -1).to_list(200)
    customer_name = items[0]["customer_name"] if items else None
    return {"cpf_masked": mask_cpf(payload.cpf), "customer_name": customer_name, "bookings": items}


@api.post("/bookings/{booking_id}/cancel")
async def cancel_booking(booking_id: str, cpf: str):
    """Customer cancels own booking. Verifies CPF ownership."""
    b = await db.bookings.find_one({"id": booking_id})
    if not b:
        raise HTTPException(status_code=404, detail="Reserva não encontrada")
    if b["cpf"] != only_digits(cpf):
        raise HTTPException(status_code=403, detail="CPF não confere com esta reserva")
    await db.bookings.update_one(
        {"id": booking_id},
        {"$set": {"status": "cancelled", "payment.status": "cancelled"}},
    )
    ops_metrics.note_booking_cancel("customer")
    await daily_metrics.note_cancelled(db)
    logger.info(
        "event=booking_cancel source=customer booking_id=%s",
        booking_id[:8],
    )
    return {"ok": True}


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
def _build_whatsapp_message(b: dict) -> str:
    date_br = "/".join(reversed(b["date"].split("-")))
    return (
        f"⚡ Arena Premium ⚡\n\n"
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
    bookings = await db.bookings.find({}, {"_id": 0}).to_list(2000)
    confirmed = [b for b in bookings if b["status"] == "confirmed"]
    pending = [b for b in bookings if b["status"] == "pending"]
    awaiting = [b for b in bookings if b["status"] == "awaiting_admin"]
    revenue = sum(b.get("deposit", 0) for b in confirmed)
    full_value = sum(b.get("total", 0) for b in confirmed)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    today_confirmed = [b for b in confirmed if b["date"] == today]
    total_slots_today = len(COURTS) * len(TIME_SLOTS)
    occupancy_today = round((len(today_confirmed) / total_slots_today) * 100, 1) if total_slots_today else 0

    from collections import Counter
    time_counter = Counter(b["start_time"] for b in confirmed)
    top_times = [{"time": t, "count": c} for t, c in time_counter.most_common(5)]

    daily = {}
    now = datetime.now(timezone.utc).date()
    for i in range(6, -1, -1):
        d = (now - timedelta(days=i)).isoformat()
        daily[d] = 0
    for b in confirmed:
        if b["date"] in daily:
            daily[b["date"]] += b.get("deposit", 0)
    revenue_series = [{"date": d, "revenue": v} for d, v in daily.items()]

    return {
        "total_bookings": len(bookings),
        "confirmed_bookings": len(confirmed),
        "pending_bookings": len(pending),
        "awaiting_admin_bookings": len(awaiting),
        "revenue_deposits": revenue,
        "revenue_full": full_value,
        "occupancy_today_pct": occupancy_today,
        "top_times": top_times,
        "revenue_series": revenue_series,
    }


@api.get("/admin/bookings")
async def admin_list_bookings(admin: dict = Depends(require_admin), status: Optional[str] = None):
    q = {}
    if status:
        q["status"] = status
    items = await db.bookings.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items


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
    await db.bookings.update_one(
        {"id": booking_id},
        {"$set": {"status": "cancelled", "payment.status": "cancelled"}},
    )
    ops_metrics.note_booking_cancel("admin")
    await daily_metrics.note_cancelled(db)
    logger.info("event=booking_cancel source=admin booking_id=%s", booking_id[:8])
    return {"ok": True}






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
def _require_internal(request: Request):
    token = os.environ.get("WHATSAPP_INTERNAL_TOKEN", "")
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
    # Atomic: only cancel if phone still matches (prevents id-only cancel without phone)
    res = await db.bookings.update_one(
        {
            "id": b["id"],
            "whatsapp": {"$in": variants},
            "status": {"$in": ["pending", "awaiting_admin", "confirmed"]},
        },
        {"$set": {"status": "cancelled", "payment.status": "cancelled"}},
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
    url = _save_upload_bytes(content, "comprovantes", file.filename or "wa-comprovante.jpg")
    if demote_to_informado:
        updated = await _attach_comprovante(b["id"], url)
        status_out = "awaiting_admin"
    else:
        await db.bookings.update_one(
            {"id": b["id"]},
            {"$set": {
                "payment.status": "awaiting_confirmation",
                "payment.comprovante_url": url,
                "payment.comprovante_uploaded_at": _now_iso(),
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
    """Confirmed bookings starting in ~2.5h–3.5h window, reminder not sent."""
    _require_internal(request)
    tz = ZoneInfo("America/Sao_Paulo")
    now = datetime.now(tz)
    # Window: start between now+150min and now+210min
    due = []
    # Check today and tomorrow
    for day_offset in (0, 1):
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
                hour = int(b["start_time"].split(":")[0])
                start_local = now.replace(
                    year=int(day[0:4]), month=int(day[5:7]), day=int(day[8:10]),
                    hour=hour, minute=0, second=0, microsecond=0,
                )
            except Exception:
                continue
            delta_min = (start_local - now).total_seconds() / 60.0
            if 150 <= delta_min <= 210:
                due.append(b)
    return {"bookings": due}


@api.post("/internal/whatsapp/reminders/{booking_id}/sent")
async def internal_reminder_mark(booking_id: str, request: Request):
    """Atomic claim — only one caller wins (prevents duplicate after restart)."""
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
    days = 1 if days <= 1 else (7 if days <= 7 else min(days, 14))
    return await bsvc.calendar_range(db, start, days=days)


@api.post("/admin/calendar/block")
async def admin_block_slot(payload: AdminBlockIn, admin: dict = Depends(require_admin)):
    if payload.start_time not in TIME_SLOTS:
        raise HTTPException(status_code=400, detail="Horário inválido")
    sk = bsvc.slot_key(COURT_ID, payload.date, payload.start_time)
    # refuse if active booking
    existing = await db.bookings.find_one(
        {"slot_key": sk, "status": {"$in": ["pending", "awaiting_admin", "confirmed"]}}
    )
    if existing:
        raise HTTPException(status_code=409, detail="Já existe reserva neste horário")
    doc = {
        "id": str(uuid.uuid4()),
        "court_id": COURT_ID,
        "date": payload.date,
        "start_time": payload.start_time,
        "slot_key": sk,
        "created_at": _now_iso(),
        "created_by": admin.get("email"),
    }
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
    await daily_metrics.ensure_indexes(db)
    logger.info("Arena Futsal Premium API initialized (CPF + WA bot + calendar)")


@app.on_event("shutdown")
async def shutdown():
    client.close()


app.include_router(api)
app.mount("/api/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


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

# CORS: set CORS_ORIGINS to explicit origins in production (comma-separated).
# Default "*" remains for same-origin Docker; credentials + wildcard is browser-limited.
_cors_raw = os.environ.get("CORS_ORIGINS", "*").strip() or "*"
_cors_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)
