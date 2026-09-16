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
from cpf_utils import validate_cpf, mask_cpf, only_digits, normalize_whatsapp
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


@api.get("/health")
async def health():
    """Public health — no secrets. Used by Render healthCheckPath."""
    db_ok = False
    try:
        await db.command("ping")
        db_ok = True
    except Exception:
        db_ok = False
    wa = await whatsapp_bridge.health_label()
    ok = db_ok
    return {"ok": ok, "db": "ok" if db_ok else "error", "whatsapp": wa}



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
COURTS = [
    {"id": "court-1", "name": "Quadra Pedra Azul — Núncio", "type": "Futsal · Society", "price_per_hour": 130, "color": "#2563EB"},
]
COURT_BY_ID = {c["id"]: c for c in COURTS}
TIME_SLOTS = [f"{h:02d}:00" for h in range(8, 24)]
DEPOSIT_RATE = 0.30


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
    if court_id not in COURT_BY_ID:
        raise HTTPException(status_code=404, detail="Quadra não encontrada")
    bookings = await db.bookings.find(
        {"court_id": court_id, "date": date,
         "status": {"$in": ["pending", "awaiting_admin", "confirmed"]}},
        {"_id": 0},
    ).to_list(500)
    taken = {b["start_time"]: b for b in bookings}
    slots = []
    court = COURT_BY_ID[court_id]
    tz = ZoneInfo("America/Sao_Paulo")
    now_local = datetime.now(tz)
    today_local = now_local.strftime("%Y-%m-%d")
    for t in TIME_SLOTS:
        b = taken.get(t)
        if b:
            status = "reserved"
        elif date < today_local:
            status = "unavailable"
        elif date == today_local:
            try:
                hour = int(t.split(":")[0])
                # Slot starts at :00; mark past kickoffs unavailable
                if hour < now_local.hour or (hour == now_local.hour and now_local.minute > 0):
                    status = "unavailable"
                else:
                    status = "available"
            except Exception:
                status = "available"
        else:
            status = "available"
        # Backward-compatible aliases for older FE builds
        legacy = "occupied" if status == "reserved" else ("free" if status == "available" else "unavailable")
        slots.append({
            "time": t,
            "status": status,
            "legacy_status": legacy,
            "booking_status": b["status"] if b else None,
            "price": court["price_per_hour"],
        })
    return {"court": court, "date": date, "slots": slots}


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


@api.post("/uploads/crest")
async def upload_crest(file: UploadFile = File(...)):
    url = _save_upload(file, "crests")
    return {"url": url}


# =============================================================================
# BOOKINGS — CUSTOMER (public, CPF-based)
# =============================================================================
@api.post("/bookings")
async def create_booking(payload: BookingCreate):
    if payload.court_id not in COURT_BY_ID:
        raise HTTPException(status_code=404, detail="Quadra não encontrada")
    if payload.start_time not in TIME_SLOTS:
        raise HTTPException(status_code=400, detail="Horário inválido")
    if not validate_cpf(payload.cpf):
        raise HTTPException(status_code=400, detail="CPF inválido")
    if not only_digits(payload.whatsapp) or len(only_digits(payload.whatsapp)) < 10:
        raise HTTPException(status_code=400, detail="WhatsApp inválido")

    cpf_digits = only_digits(payload.cpf)
    cpf_masked = mask_cpf(payload.cpf)
    whatsapp_digits = normalize_whatsapp(payload.whatsapp)

    # Reject past dates / past slots (America/Sao_Paulo)
    try:
        datetime.strptime(payload.date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Data inválida")
    tz = ZoneInfo("America/Sao_Paulo")
    now_local = datetime.now(tz)
    today_local = now_local.strftime("%Y-%m-%d")
    if payload.date < today_local:
        raise HTTPException(status_code=400, detail="Data já passou")
    if payload.date == today_local:
        hour = int(payload.start_time.split(":")[0])
        if hour < now_local.hour or (hour == now_local.hour and now_local.minute > 0):
            raise HTTPException(status_code=400, detail="Horário indisponível")

    court = COURT_BY_ID[payload.court_id]
    total = court["price_per_hour"] * (payload.duration_minutes / 60)
    deposit = round(total * DEPOSIT_RATE, 2)

    booking = {
        "id": str(uuid.uuid4()),
        "cpf": cpf_digits,
        "cpf_masked": cpf_masked,
        "customer_name": payload.customer_name.strip(),
        "whatsapp": whatsapp_digits,
        "court_id": payload.court_id,
        "court_name": court["name"],
        "date": payload.date,
        "start_time": payload.start_time,
        "duration_minutes": payload.duration_minutes,
        "your_team_name": payload.your_team_name,
        "opponent_team_name": payload.opponent_team_name,
        "your_team_crest": payload.your_team_crest,
        "opponent_team_crest": payload.opponent_team_crest,
        "total": total,
        "deposit": deposit,
        "status": "pending",   # pending (esperando comprovante) -> awaiting_admin -> confirmed | cancelled
        "payment": {
            "method": "pix",
            "status": "pending",
            "qr_code": f"PIX-MOCK-{uuid.uuid4().hex[:16].upper()}",
            "pix_copy_paste": f"00020126360014BR.GOV.BCB.PIX0114arena@premium5204000053039865802BR5913ARENA PREMIUM6009SAO PAULO62070503***6304{uuid.uuid4().hex[:8].upper()}",
            "amount": deposit,
            "created_at": _now_iso(),
            "confirmed_at": None,
            "comprovante_url": None,
            "comprovante_uploaded_at": None,
        },
        "whatsapp_sent": False,
        "whatsapp_sent_at": None,
        "created_at": _now_iso(),
        # Compound uniqueness for active bookings (partial unique index)
        "slot_key": f"{payload.court_id}|{payload.date}|{payload.start_time}",
    }
    # Atomic double-booking prevention: unique partial index on slot_key for active statuses
    try:
        await db.bookings.insert_one(booking)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Horário já reservado")
    booking.pop("_id", None)
    return booking


@api.post("/bookings/{booking_id}/comprovante")
async def upload_comprovante(booking_id: str, file: UploadFile = File(...)):
    """Customer uploads PIX payment proof. Marks booking as awaiting_admin."""
    b = await db.bookings.find_one({"id": booking_id})
    if not b:
        raise HTTPException(status_code=404, detail="Reserva não encontrada")
    if b["status"] == "cancelled":
        raise HTTPException(status_code=400, detail="Reserva cancelada")
    url = _save_upload(file, "comprovantes")
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
    return updated


@api.get("/bookings/{booking_id}")
async def get_booking(booking_id: str):
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Reserva não encontrada")
    return b


@api.post("/bookings/lookup")
async def lookup_by_cpf(payload: LookupIn):
    """Public: look up a customer's bookings by CPF (no login)."""
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
    return {"ok": True}




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
    await run_all_seeds(db)
    logger.info("Arena Futsal Premium API initialized (CPF-mode + WhatsApp bridge)")


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
            return FileResponse(candidate)
        return FileResponse(FRONTEND_BUILD / "index.html")

    logger.info("Serving frontend from %s", FRONTEND_BUILD)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)
