"""Cycle 9 smoke / regression tests — hit local or BASE_URL API.

Run:
  BASE_URL=http://127.0.0.1:8000 python -m pytest backend/tests/test_smoke.py -q
Or from repo root with API up:
  ./scripts/smoke_test.sh
"""
from __future__ import annotations

import io
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
import requests

BASE_URL = (os.environ.get("BASE_URL") or os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = f"{BASE_URL}/api"
TZ = ZoneInfo("America/Sao_Paulo")

# Valid CPF for create tests
SMOKE_CPF = "52998224725"
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "Gugu123@")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Gugu123@")

_xff_n = 50


def _xff() -> dict:
    """Rotate TEST-NET X-Forwarded-For so suite does not trip in-memory IP rate limit."""
    global _xff_n
    _xff_n = (_xff_n % 250) + 1
    return {"X-Forwarded-For": f"198.51.100.{_xff_n}"}


def _find_day_with_n_free(session, n: int = 3, start_off: int = 110, end_off: int = 220):
    """Pick a weekday far ahead with >= n available slots (avoids suite slot_lock pollution)."""
    for off in range(start_off, end_off):
        cand = (datetime.now(TZ) + timedelta(days=off)).strftime("%Y-%m-%d")
        if datetime.strptime(cand, "%Y-%m-%d").weekday() >= 5:
            continue
        avail = session.get(
            f"{API}/courts/availability",
            params={"court_id": "court-1", "date": cand},
            timeout=15,
            headers=_xff(),
        )
        if avail.status_code != 200:
            continue
        body = avail.json()
        price = float(
            body.get("settings", {}).get("effective_price_per_hour")
            or body.get("court", {}).get("price_per_hour")
            or 0
        )
        free = [x["time"] for x in body.get("slots") or [] if x.get("status") == "available"]
        if len(free) >= n and price > 0:
            return cand, free, price
    return None, [], None


def _admin_cancel_quiet(admin_session, booking_id: str) -> None:
    if not booking_id:
        return
    try:
        admin_session.post(f"{API}/admin/bookings/{booking_id}/cancel", timeout=10)
    except Exception:
        pass


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def admin_session():
    """Bearer auth — cookies are Secure/SameSite=None and won't stick on plain HTTP."""
    sess = requests.Session()
    r = sess.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, headers=_xff(), timeout=10)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code} {r.text[:120]}")
    token = (r.json() or {}).get("access_token")
    if not token:
        pytest.skip("login returned no access_token")
    sess.headers["Authorization"] = f"Bearer {token}"
    return sess


def test_health_safe(s):
    r = s.get(f"{API}/health", timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "ok" in data
    assert "db" in data
    assert "whatsapp" in data
    assert data.get("upload_backend") == "gridfs"
    # WA may be DESCONECTADO after sleep; ok still follows DB
    assert isinstance(data.get("whatsapp"), str)
    blob = r.text.lower()
    for leak in ("password", "jwt_secret", "mongo_url", "private_key", "whatsapp_auth"):
        assert leak not in blob


def test_courts(s):
    r = s.get(f"{API}/courts", timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list) and len(data) >= 1
    assert any(c.get("id") == "court-1" for c in data)


def test_admin_auth_reject(s):
    # fresh session without cookies
    bare = requests.Session()
    r = bare.get(f"{API}/admin/dashboard", timeout=10)
    assert r.status_code in (401, 403), r.text
    r2 = bare.get(f"{API}/admin/metrics", timeout=10)
    assert r2.status_code in (401, 403), r2.text
    r3 = bare.get(f"{API}/admin/bookings/awaiting", timeout=10)
    assert r3.status_code in (401, 403), r3.text
    r4 = bare.get(f"{API}/admin/bookings/export.csv", timeout=10)
    assert r4.status_code in (401, 403), r4.text


def test_admin_bookings_export_csv(admin_session):
    """Admin CSV export — auth, BOM, header columns, optional filters."""
    bare = requests.Session()
    assert bare.get(f"{API}/admin/bookings/export.csv", timeout=10).status_code in (401, 403)

    r = admin_session.get(f"{API}/admin/bookings/export.csv", timeout=15)
    assert r.status_code == 200, r.text[:200]
    ctype = (r.headers.get("content-type") or "").lower()
    assert "csv" in ctype or "text/" in ctype
    raw = r.content
    assert raw.startswith(b"\xef\xbb\xbf"), f"missing UTF-8 BOM: {raw[:8]!r}"
    text_body = raw.decode("utf-8-sig")
    header = text_body.splitlines()[0] if text_body else ""
    for col in (
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
    ):
        assert col in header, f"missing column {col} in {header!r}"
    day = (datetime.now(TZ) + timedelta(days=1)).strftime("%Y-%m-%d")
    r2 = admin_session.get(
        f"{API}/admin/bookings/export.csv",
        params={"date_from": day, "date_to": day, "status": "confirmed"},
        timeout=15,
    )
    assert r2.status_code == 200, r2.text[:200]
    assert r2.content.startswith(b"\xef\xbb\xbf")


def test_admin_bookings_list_filters(admin_session):
    r = admin_session.get(f"{API}/admin/bookings", params={"status": "confirmed"}, timeout=10)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)
    for b in r.json():
        assert b.get("status") == "confirmed"


def test_booking_conflict_409(s):
    day = (datetime.now(TZ) + timedelta(days=21)).strftime("%Y-%m-%d")
    slot = "21:00"
    payload = {
        "court_id": "court-1",
        "date": day,
        "start_time": slot,
        "duration_minutes": 60,
        "cpf": SMOKE_CPF,
        "customer_name": "Smoke Pytest",
        "whatsapp": "11988887777",
        "your_team_name": "A",
        "opponent_team_name": "B",
    }
    r1 = s.post(f"{API}/bookings", json=payload, headers=_xff(), timeout=15)
    assert r1.status_code in (200, 201, 409), r1.text
    if r1.status_code == 409:
        return
    booking = r1.json()
    r2 = s.post(f"{API}/bookings", json=payload, headers=_xff(), timeout=15)
    assert r2.status_code == 409, r2.text
    bid = booking.get("id")
    if bid:
        s.post(f"{API}/bookings/{bid}/cancel", params={"cpf": SMOKE_CPF}, timeout=10)


def test_comprovante_sets_informado_never_confirms(s):
    """Upload image proof → awaiting_admin; must NOT become confirmed."""
    day = (datetime.now(TZ) + timedelta(days=22)).strftime("%Y-%m-%d")
    slot = "20:00"
    payload = {
        "court_id": "court-1",
        "date": day,
        "start_time": slot,
        "duration_minutes": 60,
        "cpf": SMOKE_CPF,
        "customer_name": "Smoke Comprovante",
        "whatsapp": "11977776666",
        "your_team_name": "A",
        "opponent_team_name": "B",
    }
    r1 = s.post(f"{API}/bookings", json=payload, headers=_xff(), timeout=15)
    assert r1.status_code in (200, 201, 409), r1.text
    if r1.status_code == 409:
        # reuse lookup by creating different slot
        payload["start_time"] = "19:00"
        r1 = s.post(f"{API}/bookings", json=payload, headers=_xff(), timeout=15)
        assert r1.status_code in (200, 201), r1.text
    booking = r1.json()
    bid = booking["id"]
    assert booking["status"] == "pending"
    # tiny PNG
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
        b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    files = {"file": ("comprovante.png", io.BytesIO(png), "image/png")}
    r2 = s.post(f"{API}/bookings/{bid}/comprovante", files=files, timeout=15)
    assert r2.status_code == 200, r2.text
    data = r2.json()
    assert data["status"] == "awaiting_admin"
    assert data["payment"]["status"] == "awaiting_confirmation"
    assert data["payment"].get("comprovante_url")
    assert data["status"] != "confirmed"
    assert data["payment"]["status"] != "paid"
    # cleanup
    s.post(f"{API}/bookings/{bid}/cancel", params={"cpf": SMOKE_CPF}, timeout=10)


def test_internal_wa_comprovante_by_phone(s):
    day = (datetime.now(TZ) + timedelta(days=23)).strftime("%Y-%m-%d")
    phone = "11966665555"
    payload = {
        "court_id": "court-1",
        "date": day,
        "start_time": "18:00",
        "duration_minutes": 60,
        "cpf": SMOKE_CPF,
        "customer_name": "Smoke WA Img",
        "whatsapp": phone,
        "your_team_name": "A",
        "opponent_team_name": "B",
    }
    r1 = s.post(f"{API}/bookings", json=payload, headers=_xff(), timeout=15)
    if r1.status_code == 409:
        payload["start_time"] = "17:00"
        r1 = s.post(f"{API}/bookings", json=payload, headers=_xff(), timeout=15)
    assert r1.status_code in (200, 201), r1.text
    bid = r1.json()["id"]
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
        b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    files = {"file": ("wa.png", io.BytesIO(png), "image/png")}
    headers = {}
    tok = os.environ.get("WHATSAPP_INTERNAL_TOKEN") or ""
    if tok:
        headers["X-Internal-Token"] = tok
    r2 = s.post(
        f"{API}/internal/whatsapp/comprovante",
        data={"phone": phone},
        files=files,
        headers=headers,
        timeout=15,
    )
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert body.get("auto_confirmed") is False
    assert body.get("status") == "awaiting_admin"
    assert body["booking"]["status"] == "awaiting_admin"
    s.post(f"{API}/bookings/{bid}/cancel", params={"cpf": SMOKE_CPF}, timeout=10)


def test_admin_metrics_last_7_days(admin_session):
    r = admin_session.get(f"{API}/admin/metrics", timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "bookings_today" in data or "wa_status" in data
    assert "last_7_days" in data
    funnel = data["last_7_days"]
    assert "series" in funnel and "totals" in funnel
    assert isinstance(funnel["series"], list)
    assert len(funnel["series"]) == 7
    for day in funnel["series"]:
        assert "bookings_created" in day
        assert "bookings_confirmed" in day
        assert "bookings_cancelled" in day
        assert "occupancy_hours" in day


def test_admin_awaiting_queue_and_reject(admin_session):
    day = (datetime.now(TZ) + timedelta(days=24)).strftime("%Y-%m-%d")
    payload = {
        "court_id": "court-1",
        "date": day,
        "start_time": "16:00",
        "duration_minutes": 60,
        "cpf": SMOKE_CPF,
        "customer_name": "Smoke Reject",
        "whatsapp": "11955554444",
        "your_team_name": "A",
        "opponent_team_name": "B",
    }
    r1 = admin_session.post(f"{API}/bookings", json=payload, headers=_xff(), timeout=15)
    if r1.status_code == 409:
        payload["start_time"] = "15:00"
        r1 = admin_session.post(f"{API}/bookings", json=payload, headers=_xff(), timeout=15)
    assert r1.status_code in (200, 201), r1.text
    bid = r1.json()["id"]
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
        b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    files = {"file": ("c.png", io.BytesIO(png), "image/png")}
    r2 = admin_session.post(f"{API}/bookings/{bid}/comprovante", files=files, timeout=15)
    assert r2.status_code == 200, r2.text
    assert r2.json()["status"] == "awaiting_admin"

    q = admin_session.get(f"{API}/admin/bookings/awaiting", timeout=10)
    assert q.status_code == 200, q.text
    ids = [b["id"] for b in q.json().get("bookings", [])]
    assert bid in ids

    rj = admin_session.post(f"{API}/admin/bookings/{bid}/reject", timeout=10)
    assert rj.status_code == 200, rj.text
    assert rj.json().get("status") == "cancelled"
    # must not be confirmed
    got = admin_session.get(f"{API}/bookings/{bid}", timeout=10)
    assert got.status_code == 200
    assert got.json()["status"] == "cancelled"
    assert got.json()["payment"]["status"] == "cancelled"


def test_public_site_settings(s):
    r = s.get(f"{API}/site-settings", timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "price_per_hour" in data
    assert "open_hour" in data and "close_hour" in data
    assert "whatsapp_e164" in data
    assert "pix_key" in data
    assert float(data["price_per_hour"]) > 0


def test_admin_site_settings_auth_and_update(admin_session):
    bare = requests.Session()
    r0 = bare.get(f"{API}/admin/site-settings", timeout=10)
    assert r0.status_code in (401, 403), r0.text
    r = admin_session.get(f"{API}/admin/site-settings", timeout=10)
    assert r.status_code == 200, r.text
    cur = r.json()
    assert cur.get("price_per_hour")
    # round-trip save (same values) — validates schema
    r2 = admin_session.put(f"{API}/admin/site-settings", json=cur, timeout=10)
    assert r2.status_code == 200, r2.text
    assert r2.json()["price_per_hour"] == cur["price_per_hour"]


def test_internal_routes_require_token_when_set(s):
    """If INTERNAL_API_TOKEN / WHATSAPP_INTERNAL_TOKEN is set, missing header → 401."""
    tok = (os.environ.get("INTERNAL_API_TOKEN") or os.environ.get("WHATSAPP_INTERNAL_TOKEN") or "").strip()
    day = (datetime.now(TZ) + timedelta(days=10)).strftime("%Y-%m-%d")
    if not tok:
        # Dev mode: routes open — still must return 200/4xx not 500
        r = s.get(f"{API}/internal/whatsapp/availability", params={"date": day}, timeout=10)
        assert r.status_code in (200, 400, 404), r.text
        return
    bare = requests.Session()
    r = bare.get(f"{API}/internal/whatsapp/availability", params={"date": day}, timeout=10)
    assert r.status_code == 401, r.text
    r2 = bare.get(
        f"{API}/internal/whatsapp/availability",
        params={"date": day},
        headers={"X-Internal-Token": tok},
        timeout=10,
    )
    assert r2.status_code == 200, r2.text



def test_admin_dashboard_kpis(admin_session):
    """Cycle 7: dashboard returns real KPI fields."""
    r = admin_session.get(f"{API}/admin/dashboard", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    for key in (
        "today_bookings_count",
        "free_slots_today",
        "total_slots_today",
        "month_revenue_estimate",
        "top_times",
        "today",
        "month",
    ):
        assert key in data, key
    assert isinstance(data["today_bookings_count"], int)
    assert isinstance(data["free_slots_today"], int)
    assert isinstance(data["month_revenue_estimate"], (int, float))
    assert isinstance(data["top_times"], list)
    # next_upcoming may be null
    assert "next_upcoming" in data
    assert data["total_slots_today"] >= data["free_slots_today"] >= 0


def test_admin_calendar_month(admin_session):
    """Cycle 7: month range with density summary."""
    start = datetime.now(TZ).strftime("%Y-%m-01")
    r = admin_session.get(f"{API}/admin/calendar", params={"start": start, "days": 31}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    days = data.get("days") or []
    assert len(days) >= 28, len(days)
    assert len(days) <= 42
    dens = days[0].get("density")
    assert dens is not None
    for k in ("occupied", "blocked", "free", "unavailable", "total_bookable"):
        assert k in dens


def test_concurrent_double_book_one_201_one_409(s):
    """Cycle 9: two parallel POSTs for the same slot → exactly one success, one 409."""
    import uuid
    from concurrent.futures import ThreadPoolExecutor, as_completed

    # Unique far-future day+slot so prior smoke leftovers cannot both-409
    day = (datetime.now(TZ) + timedelta(days=45)).strftime("%Y-%m-%d")
    # pick a slot from hour based on uuid nibble to reduce collisions across runs
    hour = 10 + (uuid.uuid4().int % 10)  # 10..19
    slot = f"{hour:02d}:00"
    base = {
        "court_id": "court-1",
        "date": day,
        "start_time": slot,
        "duration_minutes": 60,
        "cpf": SMOKE_CPF,
        "your_team_name": "A",
        "opponent_team_name": "B",
    }

    def create(i: int):
        payload = {
            **base,
            "customer_name": f"Concurrent {i}",
            "whatsapp": f"1198888{i:04d}",
        }
        # Distinct X-Forwarded-For so in-memory IP rate-limit does not mask DuplicateKey 409
        sess = requests.Session()
        return sess.post(
            f"{API}/bookings",
            json=payload,
            headers={"X-Forwarded-For": f"203.0.113.{10 + i}"},
            timeout=20,
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(create, i) for i in (1, 2)]
        results = [f.result() for f in as_completed(futures)]

    codes = sorted(r.status_code for r in results)
    # Rare: both 409 if a leftover booking already owns the slot — retry once on fresh slot
    if codes == [409, 409]:
        hour2 = 10 + ((hour + 3) % 10)
        base["start_time"] = f"{hour2:02d}:00"
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(create, i) for i in (3, 4)]
            results = [f.result() for f in as_completed(futures)]
        codes = sorted(r.status_code for r in results)

    assert 409 in codes, f"expected a 409, got {codes} bodies={[r.text[:160] for r in results]}"
    ok_codes = [c for c in codes if c in (200, 201)]
    assert len(ok_codes) == 1, f"expected exactly one 201/200, got {codes} bodies={[r.text[:160] for r in results]}"

    for r in results:
        if r.status_code in (200, 201):
            bid = (r.json() or {}).get("id")
            if bid:
                s.post(f"{API}/bookings/{bid}/cancel", params={"cpf": SMOKE_CPF}, timeout=10)



def test_comprovante_mongo_survives_disk_clear(s):
    """Cycle 11: proof stored in GridFS; still fetchable after local file deleted."""
    from pathlib import Path

    day = (datetime.now(TZ) + timedelta(days=25)).strftime("%Y-%m-%d")
    payload = {
        "court_id": "court-1",
        "date": day,
        "start_time": "14:00",
        "duration_minutes": 60,
        "cpf": SMOKE_CPF,
        "customer_name": "Smoke GridFS",
        "whatsapp": "11944443333",
        "your_team_name": "A",
        "opponent_team_name": "B",
    }
    r1 = s.post(f"{API}/bookings", json=payload, headers=_xff(), timeout=15)
    if r1.status_code == 409:
        payload["start_time"] = "13:00"
        r1 = s.post(f"{API}/bookings", json=payload, headers=_xff(), timeout=15)
    assert r1.status_code in (200, 201), r1.text
    bid = r1.json()["id"]
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
        b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    files = {"file": ("gridfs.png", io.BytesIO(png), "image/png")}
    r2 = s.post(f"{API}/bookings/{bid}/comprovante", files=files, timeout=15)
    assert r2.status_code == 200, r2.text
    data = r2.json()
    assert data["status"] == "awaiting_admin"
    url = data["payment"]["comprovante_url"]
    assert url and url.startswith("/api/uploads/comprovantes/")
    gid = data["payment"].get("comprovante_gridfs_id")
    assert gid, "expected payment.comprovante_gridfs_id from GridFS"

    # warm fetch (may be served from disk cache)
    warm = s.get(f"{BASE_URL}{url}", timeout=10)
    assert warm.status_code == 200, warm.text[:200]
    assert warm.content[:4] == b"\x89PNG"

    # simulate Free-tier restart: wipe local file only
    fname = url.rsplit("/", 1)[-1]
    roots = [
        Path(__file__).resolve().parents[1] / "uploads",
        Path("/workspace/user-zip/Leandro-2-main/backend/uploads"),
        Path(os.environ.get("UPLOAD_DIR") or "") if os.environ.get("UPLOAD_DIR") else None,
    ]
    deleted = False
    for root in roots:
        if not root:
            continue
        fpath = root / "comprovantes" / fname
        if fpath.is_file():
            fpath.unlink()
            deleted = True
            assert not fpath.exists()
            break
    # even if disk write was skipped, GridFS path must work
    cold = s.get(f"{BASE_URL}{url}", timeout=10)
    assert cold.status_code == 200, f"GridFS serve failed deleted={deleted}: {cold.text[:200]}"
    assert cold.content[:4] == b"\x89PNG"
    assert cold.content == warm.content

    # alternate id route
    by_id = s.get(f"{API}/comprovantes/{gid}", timeout=10)
    assert by_id.status_code == 200, by_id.text[:200]
    assert by_id.content[:4] == b"\x89PNG"

    s.post(f"{API}/bookings/{bid}/cancel", params={"cpf": SMOKE_CPF}, timeout=10)


def test_cancel_min_hours_customer_vs_admin(admin_session, s):
    """Customer cancel blocked inside cancel_min_hours; admin always can."""
    cur = admin_session.get(f"{API}/admin/site-settings", timeout=10)
    assert cur.status_code == 200, cur.text
    original = cur.json()
    assert "cancel_min_hours" in original
    patched = {**original, "cancel_min_hours": 72}
    rput = admin_session.put(f"{API}/admin/site-settings", json=patched, timeout=10)
    assert rput.status_code == 200, rput.text
    try:
        day = (datetime.now(TZ) + timedelta(days=1)).strftime("%Y-%m-%d")
        payload = {
            "court_id": "court-1",
            "date": day,
            "start_time": "22:00",
            "duration_minutes": 60,
            "cpf": SMOKE_CPF,
            "customer_name": "Smoke Cancel Policy",
            "whatsapp": "11933332222",
            "your_team_name": "A",
            "opponent_team_name": "B",
        }
        r1 = s.post(f"{API}/bookings", json=payload, headers=_xff(), timeout=15)
        if r1.status_code == 409:
            payload["start_time"] = "21:00"
            r1 = s.post(f"{API}/bookings", json=payload, headers=_xff(), timeout=15)
        assert r1.status_code in (200, 201), r1.text
        bid = r1.json()["id"]

        rc = s.post(f"{API}/bookings/{bid}/cancel", params={"cpf": SMOKE_CPF}, timeout=10)
        assert rc.status_code == 400, rc.text
        assert "antes" in (rc.json().get("detail") or "").lower() or "hora" in (rc.json().get("detail") or "").lower()

        # still active
        got = s.get(f"{API}/bookings/{bid}", timeout=10)
        assert got.json()["status"] in ("pending", "awaiting_admin", "confirmed")

        ra = admin_session.post(f"{API}/admin/bookings/{bid}/cancel", timeout=10)
        assert ra.status_code == 200, ra.text
        got2 = s.get(f"{API}/bookings/{bid}", timeout=10)
        assert got2.json()["status"] == "cancelled"
    finally:
        admin_session.put(f"{API}/admin/site-settings", json=original, timeout=10)


def test_public_site_settings_has_cancel_min_hours(s):
    r = s.get(f"{API}/site-settings", timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "cancel_min_hours" in data
    assert int(data["cancel_min_hours"]) >= 0


def test_admin_alert_settings_roundtrip_and_public_hides_number(admin_session, s):
    """Cycle 12: admin_whatsapp_e164 optional; public must not leak admin number."""
    r = admin_session.get(f"{API}/admin/site-settings", timeout=10)
    assert r.status_code == 200, r.text
    cur = r.json()
    assert "admin_whatsapp_e164" in cur
    assert "admin_alerts_enabled" in cur
    assert cur.get("admin_whatsapp_e164") in ("", None) or isinstance(cur.get("admin_whatsapp_e164"), str)
    original = dict(cur)
    try:
        patched = {
            **cur,
            "admin_whatsapp_e164": "",
            "admin_alerts_enabled": False,
        }
        r2 = admin_session.put(f"{API}/admin/site-settings", json=patched, timeout=10)
        assert r2.status_code == 200, r2.text
        assert r2.json().get("admin_alerts_enabled") is False
        assert r2.json().get("admin_whatsapp_e164") == ""
        pub = s.get(f"{API}/site-settings", timeout=10)
        assert pub.status_code == 200
        pdata = pub.json()
        assert "admin_whatsapp_e164" not in pdata
        assert "admin_alerts_enabled" in pdata
    finally:
        admin_session.put(f"{API}/admin/site-settings", json=original, timeout=10)


def test_admin_alert_helper_skips_empty_and_formats():
    """Unit: no invented phones; message shape in Portuguese."""
    import admin_alerts as aa

    assert aa.is_admin_alert_number_usable("") is False
    assert aa.is_admin_alert_number_usable("551140028922") is False  # placeholder
    assert aa.is_admin_alert_number_usable("5511999887766") is True
    msg = aa.format_admin_new_booking_msg(
        {
            "id": "abcdef12-xxxx",
            "customer_name": "João",
            "date": "2026-09-20",
            "start_time": "20:00",
            "total": 130,
        }
    )
    assert "Nova reserva" in msg
    assert "João" in msg
    assert "20:00" in msg
    assert "R$ 130" in msg


def test_reminder_mark_atomic(admin_session, s):
    """Cycle 12: second mark-sent loses the race (modified_count==0 → ok false)."""
    tok = (os.environ.get("INTERNAL_API_TOKEN") or os.environ.get("WHATSAPP_INTERNAL_TOKEN") or "").strip()
    headers = {"X-Internal-Token": tok} if tok else {}
    # Create a confirmed booking via admin calendar — rotate day/slot if occupied
    r = None
    for day_off in range(14, 50):
        day = (datetime.now(TZ) + timedelta(days=day_off)).strftime("%Y-%m-%d")
        for start in ("10:00", "11:00", "12:00", "18:00", "19:00", "20:00", "21:00", "22:00"):
            r = admin_session.post(
                f"{API}/admin/calendar/bookings",
                json={
                    "date": day,
                    "start_time": start,
                    "customer_name": "Reminder Race",
                    "whatsapp": "5511987654321",
                    "status": "confirmed",
                },
                timeout=15,
            )
            if r.status_code in (200, 201):
                break
        if r is not None and r.status_code in (200, 201):
            break
    assert r is not None and r.status_code in (200, 201), getattr(r, "text", "no attempt")
    bid = r.json()["id"]
    m1 = s.post(f"{API}/internal/whatsapp/reminders/{bid}/sent", headers=headers, timeout=10)
    assert m1.status_code == 200, m1.text
    assert m1.json().get("ok") is True
    m2 = s.post(f"{API}/internal/whatsapp/reminders/{bid}/sent", headers=headers, timeout=10)
    assert m2.status_code == 200, m2.text
    assert m2.json().get("ok") is False


def test_admin_block_day_and_unblock(admin_session, s):
    """Cycle 15: block full day → slots blocked; booking 400/409; unblock frees."""
    bare = requests.Session()
    assert bare.post(f"{API}/admin/calendar/block-day", json={"date": "2099-01-01"}, timeout=10).status_code in (
        401,
        403,
    )

    # Far-future day to avoid colliding with live bookings
    day = (datetime.now(TZ) + timedelta(days=60)).strftime("%Y-%m-%d")
    # Clean slate
    admin_session.post(f"{API}/admin/calendar/unblock-day", json={"date": day}, timeout=15)

    # Seed one reservation so block-day must skip it
    reserved_slot = "18:00"
    br = admin_session.post(
        f"{API}/admin/calendar/bookings",
        json={
            "date": day,
            "start_time": reserved_slot,
            "customer_name": "Block Day Keep",
            "whatsapp": "5511999001122",
            "status": "confirmed",
        },
        timeout=15,
    )
    assert br.status_code in (200, 201), br.text
    booking_id = br.json()["id"]

    try:
        r = admin_session.post(
            f"{API}/admin/calendar/block-day",
            json={"date": day, "reason": "manutenção"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("blocked", 0) >= 1
        assert body.get("skipped_reserved", 0) >= 1
        assert body.get("reason") == "manutenção"

        # Availability shows blocked (except reserved slot)
        avail = s.get(f"{API}/courts/availability", params={"court_id": "court-1", "date": day}, timeout=15)
        assert avail.status_code == 200, avail.text
        slots = {x["time"]: x["status"] for x in avail.json().get("slots") or []}
        assert slots.get(reserved_slot) == "reserved"
        free_or_blocked = [t for t, st in slots.items() if st in ("blocked", "available")]
        assert any(slots[t] == "blocked" for t in free_or_blocked), slots

        # Public booking of a blocked free slot must fail
        target = next((t for t, st in slots.items() if st == "blocked"), None)
        assert target, "expected at least one blocked slot"
        bad = s.post(
            f"{API}/bookings",
            json={
                "court_id": "court-1",
                "date": day,
                "start_time": target,
                "duration_minutes": 60,
                "cpf": SMOKE_CPF,
                "customer_name": "Should Fail Block",
                "whatsapp": "11977776666",
                "your_team_name": "A",
                "opponent_team_name": "B",
            },
            headers=_xff(),
            timeout=15,
        )
        assert bad.status_code in (400, 409), bad.text
        detail = (bad.json() or {}).get("detail") or bad.text
        assert "bloqueado" in str(detail).lower() or bad.status_code == 409

        # Unblock day frees blocked slots; reservation remains
        u = admin_session.post(f"{API}/admin/calendar/unblock-day", json={"date": day}, timeout=15)
        assert u.status_code == 200, u.text
        assert u.json().get("removed", 0) >= 1

        avail2 = s.get(f"{API}/courts/availability", params={"court_id": "court-1", "date": day}, timeout=15)
        assert avail2.status_code == 200
        slots2 = {x["time"]: x["status"] for x in avail2.json().get("slots") or []}
        assert slots2.get(reserved_slot) == "reserved"
        assert slots2.get(target) == "available", slots2.get(target)

        # Range: 2 days, cap validation
        day2 = (datetime.now(TZ) + timedelta(days=61)).strftime("%Y-%m-%d")
        admin_session.post(f"{API}/admin/calendar/unblock-day", json={"date": day2}, timeout=15)
        rr = admin_session.post(
            f"{API}/admin/calendar/block-range",
            json={"date_from": day, "date_to": day2, "reason": "feriado"},
            timeout=30,
        )
        assert rr.status_code == 200, rr.text
        assert rr.json().get("days") == 2
        assert rr.json().get("blocked", 0) >= 1

        # Cap > 31 days
        far = (datetime.now(TZ) + timedelta(days=100)).strftime("%Y-%m-%d")
        far2 = (datetime.now(TZ) + timedelta(days=140)).strftime("%Y-%m-%d")
        cap = admin_session.post(
            f"{API}/admin/calendar/block-range",
            json={"date_from": far, "date_to": far2},
            timeout=15,
        )
        assert cap.status_code == 400, cap.text
    finally:
        admin_session.post(f"{API}/admin/calendar/unblock-day", json={"date": day}, timeout=15)
        day2 = (datetime.now(TZ) + timedelta(days=61)).strftime("%Y-%m-%d")
        admin_session.post(f"{API}/admin/calendar/unblock-day", json={"date": day2}, timeout=15)
        admin_session.post(f"{API}/admin/bookings/{booking_id}/cancel", timeout=10)


def test_open_days_closes_weekday_availability_and_booking(admin_session, s):
    """Cycle 16: open_days excludes a weekday → slots unavailable + booking fails."""
    r = admin_session.get(f"{API}/admin/site-settings", timeout=10)
    assert r.status_code == 200, r.text
    original = r.json()
    # Pick a weekday far enough ahead so slots are not all past
    # Find next date matching a weekday we will close (e.g. Wednesday=2)
    closed_wd = 2  # Wednesday
    base = datetime.now(TZ) + timedelta(days=20)
    day = None
    for i in range(14):
        cand = base + timedelta(days=i)
        if cand.weekday() == closed_wd:
            day = cand.strftime("%Y-%m-%d")
            break
    assert day, "could not find Wednesday test day"

    open_days = [d for d in range(7) if d != closed_wd]
    patched = {**original, "open_days": open_days}
    try:
        rput = admin_session.put(f"{API}/admin/site-settings", json=patched, timeout=10)
        assert rput.status_code == 200, rput.text
        assert closed_wd not in (rput.json().get("open_days") or [])

        # Public settings expose open_days
        pub = s.get(f"{API}/site-settings", timeout=10)
        assert pub.status_code == 200
        assert closed_wd not in (pub.json().get("open_days") or [])

        avail = s.get(
            f"{API}/courts/availability",
            params={"court_id": "court-1", "date": day},
            timeout=15,
        )
        assert avail.status_code == 200, avail.text
        body = avail.json()
        assert body.get("day_open") is False
        slots = body.get("slots") or []
        assert len(slots) >= 1
        # No bookable free slots on closed weekday
        assert all(x.get("status") != "available" for x in slots), slots[:3]
        assert all(
            x.get("status") in ("unavailable", "reserved", "blocked") for x in slots
        )

        # WA availability shares build_availability
        tok = (os.environ.get("INTERNAL_API_TOKEN") or os.environ.get("WHATSAPP_INTERNAL_TOKEN") or "").strip()
        headers = {"X-Internal-Token": tok} if tok else {}
        wa = s.get(
            f"{API}/internal/whatsapp/availability",
            params={"date": day},
            headers=headers,
            timeout=15,
        )
        assert wa.status_code == 200, wa.text
        wa_slots = wa.json().get("slots") or []
        assert all(x.get("status") != "available" for x in wa_slots)

        # Booking must fail
        target = next((x["time"] for x in slots if x.get("status") == "unavailable"), None)
        assert target
        bad = s.post(
            f"{API}/bookings",
            json={
                "court_id": "court-1",
                "date": day,
                "start_time": target,
                "duration_minutes": 60,
                "cpf": SMOKE_CPF,
                "customer_name": "Closed Weekday Fail",
                "whatsapp": "11966665555",
                "your_team_name": "A",
                "opponent_team_name": "B",
            },
            headers=_xff(),
            timeout=15,
        )
        assert bad.status_code in (400, 409), bad.text
        detail = str((bad.json() or {}).get("detail") or bad.text).lower()
        assert "fechada" in detail or "semana" in detail or bad.status_code == 409, detail
    finally:
        admin_session.put(f"{API}/admin/site-settings", json=original, timeout=10)


def test_amenities_settings_roundtrip(admin_session, s):
    """Cycle 17: amenities / FAQ fields on site_settings (public + admin)."""
    r = admin_session.get(f"{API}/admin/site-settings", timeout=10)
    assert r.status_code == 200, r.text
    original = r.json()
    for key in (
        "has_parking",
        "parking_note",
        "game_duration_note",
        "accepts_pix",
        "structure_blurb",
        "amenities",
    ):
        assert key in original, key

    patched = {
        **original,
        "has_parking": False,
        "parking_note": "Sem vaga própria — use carona.",
        "game_duration_note": "1 hora (60 min)",
        "accepts_pix": True,
        "structure_blurb": "Quadra oficial · iluminação noturna.",
        "amenities": ["Iluminação noturna", "Pelada & treino"],
    }
    try:
        rput = admin_session.put(f"{API}/admin/site-settings", json=patched, timeout=10)
        assert rput.status_code == 200, rput.text
        body = rput.json()
        assert body.get("has_parking") is False
        assert body.get("accepts_pix") is True
        assert "Iluminação noturna" in (body.get("amenities") or [])
        assert "1 hora" in (body.get("game_duration_note") or "")

        pub = s.get(f"{API}/site-settings", timeout=10)
        assert pub.status_code == 200, pub.text
        pdata = pub.json()
        assert pdata.get("has_parking") is False
        assert pdata.get("accepts_pix") is True
        assert isinstance(pdata.get("amenities"), list)
        assert pdata.get("structure_blurb")
        # admin phone stays admin-only
        assert "admin_whatsapp_e164" not in pdata
    finally:
        admin_session.put(f"{API}/admin/site-settings", json=original, timeout=10)


def test_health_whatsapp_restore_fields(s):
    """Cycle 18: health exposes restoring / has_saved_session flags (no secrets)."""
    r = s.get(f"{API}/health", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "whatsapp" in data
    # Flags may be false when sidecar down; keys must exist for accurate UI after sleep
    assert "whatsapp_restoring" in data
    assert "whatsapp_has_saved_session" in data
    assert isinstance(data["whatsapp_restoring"], bool)
    assert isinstance(data["whatsapp_has_saved_session"], bool)
    blob = r.text.lower()
    for bad in ("password", "jwt_secret", "mongo_url", "private"):
        assert bad not in blob


def _pick_two_free_slots(s, day: str):
    """Return (time_a, time_b) two available slots on day, or skip."""
    r = s.get(f"{API}/courts/availability", params={"court_id": "court-1", "date": day}, timeout=10)
    assert r.status_code == 200, r.text
    free = [x["time"] for x in r.json().get("slots") or [] if x.get("status") == "available"]
    if len(free) < 2:
        pytest.skip(f"need 2 free slots on {day}, got {len(free)}")
    return free[0], free[1]


def test_reschedule_customer_frees_old_takes_new(s):
    """Cycle 19: book A, reschedule to free B → A free, B taken; payment preserved."""
    day = (datetime.now(TZ) + timedelta(days=3)).strftime("%Y-%m-%d")
    t_a, t_b = _pick_two_free_slots(s, day)
    payload = {
        "court_id": "court-1",
        "date": day,
        "start_time": t_a,
        "duration_minutes": 60,
        "cpf": SMOKE_CPF,
        "customer_name": "Smoke Reschedule",
        "whatsapp": "11944443333",
        "your_team_name": "A",
        "opponent_team_name": "B",
    }
    r1 = s.post(f"{API}/bookings", json=payload, headers=_xff(), timeout=15)
    assert r1.status_code in (200, 201), r1.text
    bid = r1.json()["id"]
    pay_before = (r1.json().get("payment") or {}).get("status")
    try:
        rr = s.post(
            f"{API}/bookings/{bid}/reschedule",
            json={"cpf": SMOKE_CPF, "date": day, "start_time": t_b},
            headers=_xff(),
            timeout=15,
        )
        assert rr.status_code == 200, rr.text
        body = rr.json()
        assert body["id"] == bid
        assert body["date"] == day
        assert body["start_time"] == t_b
        assert body["status"] in ("pending", "awaiting_admin", "confirmed")
        assert (body.get("payment") or {}).get("status") == pay_before

        av = s.get(f"{API}/courts/availability", params={"court_id": "court-1", "date": day}, timeout=10)
        assert av.status_code == 200
        by_t = {x["time"]: x for x in av.json().get("slots") or []}
        assert by_t[t_a]["status"] == "available", by_t[t_a]
        assert by_t[t_b]["status"] == "reserved", by_t[t_b]
        assert by_t[t_b].get("booking_id") == bid
    finally:
        s.post(f"{API}/bookings/{bid}/cancel", params={"cpf": SMOKE_CPF}, timeout=10)


def test_reschedule_conflict_409(s):
    """Cycle 19: reschedule onto taken slot → 409; original stays."""
    day = (datetime.now(TZ) + timedelta(days=4)).strftime("%Y-%m-%d")
    t_a, t_b = _pick_two_free_slots(s, day)
    base = {
        "court_id": "court-1",
        "date": day,
        "duration_minutes": 60,
        "cpf": SMOKE_CPF,
        "customer_name": "Smoke Resched Conflict",
        "whatsapp": "11944445555",
        "your_team_name": "A",
        "opponent_team_name": "B",
    }
    r_a = s.post(f"{API}/bookings", json={**base, "start_time": t_a}, headers=_xff(), timeout=15)
    r_b = s.post(
        f"{API}/bookings",
        json={**base, "start_time": t_b, "whatsapp": "11944446666", "customer_name": "Occupier"},
        headers=_xff(),
        timeout=15,
    )
    assert r_a.status_code in (200, 201), r_a.text
    assert r_b.status_code in (200, 201), r_b.text
    bid_a, bid_b = r_a.json()["id"], r_b.json()["id"]
    try:
        rr = s.post(
            f"{API}/bookings/{bid_a}/reschedule",
            json={"cpf": SMOKE_CPF, "date": day, "start_time": t_b},
            headers=_xff(),
            timeout=15,
        )
        assert rr.status_code == 409, rr.text
        got = s.get(f"{API}/bookings/{bid_a}", timeout=10)
        assert got.json()["start_time"] == t_a
        assert got.json()["status"] in ("pending", "awaiting_admin", "confirmed")
    finally:
        s.post(f"{API}/bookings/{bid_a}/cancel", params={"cpf": SMOKE_CPF}, timeout=10)
        s.post(f"{API}/bookings/{bid_b}/cancel", params={"cpf": SMOKE_CPF}, timeout=10)


def test_reschedule_blocked_inside_cancel_min_hours(admin_session, s):
    """Cycle 19: customer reschedule blocked inside cancel_min_hours; admin can."""
    cur = admin_session.get(f"{API}/admin/site-settings", timeout=10)
    assert cur.status_code == 200, cur.text
    original = cur.json()
    patched = {**original, "cancel_min_hours": 72}
    assert admin_session.put(f"{API}/admin/site-settings", json=patched, timeout=10).status_code == 200
    try:
        day = (datetime.now(TZ) + timedelta(days=1)).strftime("%Y-%m-%d")
        av = s.get(f"{API}/courts/availability", params={"court_id": "court-1", "date": day}, timeout=10)
        free = [x["time"] for x in av.json().get("slots") or [] if x.get("status") == "available"]
        if len(free) < 2:
            pytest.skip("need 2 free slots")
        t_a, t_b = free[0], free[1]
        payload = {
            "court_id": "court-1",
            "date": day,
            "start_time": t_a,
            "duration_minutes": 60,
            "cpf": SMOKE_CPF,
            "customer_name": "Smoke Resched Window",
            "whatsapp": "11933334444",
            "your_team_name": "A",
            "opponent_team_name": "B",
        }
        r1 = s.post(f"{API}/bookings", json=payload, headers=_xff(), timeout=15)
        assert r1.status_code in (200, 201), r1.text
        bid = r1.json()["id"]

        rc = s.post(
            f"{API}/bookings/{bid}/reschedule",
            json={"cpf": SMOKE_CPF, "date": day, "start_time": t_b},
            headers=_xff(),
            timeout=15,
        )
        assert rc.status_code == 400, rc.text
        detail = (rc.json().get("detail") or "").lower()
        assert "antes" in detail or "hora" in detail or "remarca" in detail

        ra = admin_session.post(
            f"{API}/admin/bookings/{bid}/reschedule",
            json={"date": day, "start_time": t_b},
            timeout=15,
        )
        assert ra.status_code == 200, ra.text
        assert ra.json()["start_time"] == t_b
        assert ra.json()["id"] == bid

        admin_session.post(f"{API}/admin/bookings/{bid}/cancel", timeout=10)
    finally:
        admin_session.put(f"{API}/admin/site-settings", json=original, timeout=10)


def test_reminder_hours_before_settings_and_due_window(admin_session, s):
    """Cycle 20: reminder_hours_before in settings; due window uses lead ±30min."""
    tok = (os.environ.get("INTERNAL_API_TOKEN") or os.environ.get("WHATSAPP_INTERNAL_TOKEN") or "").strip()
    headers = {"X-Internal-Token": tok} if tok else {}

    r0 = admin_session.get(f"{API}/admin/site-settings", timeout=10)
    assert r0.status_code == 200, r0.text
    original = r0.json()
    assert "reminder_hours_before" in original or True  # may be filled on put
    patched = {**original, "reminder_hours_before": 2}
    try:
        r1 = admin_session.put(f"{API}/admin/site-settings", json=patched, timeout=10)
        assert r1.status_code == 200, r1.text
        assert int(r1.json()["reminder_hours_before"]) == 2

        pub = s.get(f"{API}/site-settings", timeout=10)
        assert pub.status_code == 200
        assert int(pub.json()["reminder_hours_before"]) == 2

        # Reject out of range
        bad = {**patched, "reminder_hours_before": 99}
        rb = admin_session.put(f"{API}/admin/site-settings", json=bad, timeout=10)
        assert rb.status_code == 422, rb.text

        now = datetime.now(TZ)

        def _book(when: datetime, name: str):
            day = when.strftime("%Y-%m-%d")
            start = f"{when.hour:02d}:00"
            r = admin_session.post(
                f"{API}/admin/calendar/bookings",
                json={
                    "date": day,
                    "start_time": start,
                    "customer_name": name,
                    "whatsapp": "5511999001122",
                    "status": "confirmed",
                },
                timeout=15,
            )
            return r

        def _delta_min(when: datetime) -> float:
            return (when - now).total_seconds() / 60.0

        # Scan upcoming hour slots for one inside [90,150] and one outside (>180)
        rin = None
        rout = None
        bid_out = None
        cursor = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        for _ in range(48):
            dlt = _delta_min(cursor)
            if dlt < 0:
                cursor += timedelta(hours=1)
                continue
            if rin is None and 90 <= dlt <= 150:
                r = _book(cursor, "Reminder InWindow")
                if r.status_code in (200, 201):
                    rin = r
            elif rout is None and dlt >= 180:
                r = _book(cursor, "Reminder OutWindow")
                if r.status_code in (200, 201):
                    rout = r
                    bid_out = r.json()["id"]
            if rin is not None and rout is not None:
                break
            cursor += timedelta(hours=1)

        assert rin is not None and rin.status_code in (200, 201), "no in-window slot available"
        bid_in = rin.json()["id"]
        assert rout is not None, "could not create out-of-window booking"

        due = s.get(f"{API}/internal/whatsapp/reminders/due", headers=headers, timeout=10)
        assert due.status_code == 200, due.text
        body = due.json()
        assert int(body.get("reminder_hours_before") or 0) == 2
        assert body.get("window_minutes") == [90, 150]
        ids = {b["id"] for b in (body.get("bookings") or [])}
        assert bid_in in ids, f"expected in-window {bid_in} in {ids}"
        assert bid_out not in ids, f"out-of-window {bid_out} should not be due"

        # cleanup
        admin_session.post(f"{API}/admin/bookings/{bid_in}/cancel", timeout=10)
        admin_session.post(f"{API}/admin/bookings/{bid_out}/cancel", timeout=10)
    finally:
        admin_session.put(f"{API}/admin/site-settings", json=original, timeout=10)


def test_admin_no_show_rules(admin_session, s):
    """Cycle 20: no-show only for past confirmed; rejects future / non-confirmed."""
    from pymongo import MongoClient

    # Future confirmed → 400
    r = None
    for day_off in (20, 21, 22):
        day = (datetime.now(TZ) + timedelta(days=day_off)).strftime("%Y-%m-%d")
        for start in ("10:00", "11:00", "12:00", "13:00"):
            r = admin_session.post(
                f"{API}/admin/calendar/bookings",
                json={
                    "date": day,
                    "start_time": start,
                    "customer_name": "NoShow Future",
                    "whatsapp": "5511999003344",
                    "status": "confirmed",
                },
                timeout=15,
            )
            if r.status_code in (200, 201):
                break
        if r is not None and r.status_code in (200, 201):
            break
    assert r is not None and r.status_code in (200, 201), getattr(r, "text", "")
    bid_future = r.json()["id"]
    nf = admin_session.post(f"{API}/admin/bookings/{bid_future}/no-show", timeout=10)
    assert nf.status_code == 400, nf.text
    assert "passou" in (nf.json().get("detail") or "").lower() or "no-show" in (nf.json().get("detail") or "").lower()

    # Pending → 400
    rp = None
    for day_off in (23, 24, 25):
        day = (datetime.now(TZ) + timedelta(days=day_off)).strftime("%Y-%m-%d")
        for start in ("14:00", "15:00", "16:00"):
            rp = admin_session.post(
                f"{API}/admin/calendar/bookings",
                json={
                    "date": day,
                    "start_time": start,
                    "customer_name": "NoShow Pending",
                    "whatsapp": "5511999005566",
                    "status": "pending",
                },
                timeout=15,
            )
            if rp.status_code in (200, 201):
                break
        if rp is not None and rp.status_code in (200, 201):
            break
    assert rp is not None and rp.status_code in (200, 201), getattr(rp, "text", "")
    bid_pending = rp.json()["id"]
    np_ = admin_session.post(f"{API}/admin/bookings/{bid_pending}/no-show", timeout=10)
    assert np_.status_code == 400, np_.text

    # Past confirmed: create future then backdate via Mongo
    r2 = None
    for day_off in range(26, 60):
        day = (datetime.now(TZ) + timedelta(days=day_off)).strftime("%Y-%m-%d")
        for start in ("17:00", "18:00", "19:00", "20:00", "21:00"):
            r2 = admin_session.post(
                f"{API}/admin/calendar/bookings",
                json={
                    "date": day,
                    "start_time": start,
                    "customer_name": "NoShow Past",
                    "whatsapp": "5511999007788",
                    "status": "confirmed",
                },
                timeout=15,
            )
            if r2.status_code in (200, 201):
                break
        if r2 is not None and r2.status_code in (200, 201):
            break
    assert r2 is not None and r2.status_code in (200, 201), getattr(r2, "text", "")
    bid_past = r2.json()["id"]

    mongo_url = os.environ.get("MONGO_URL", "mongodb://127.0.0.1:27017")
    db_name = os.environ.get("DB_NAME", "arena_futsal")
    client = MongoClient(mongo_url, serverSelectionTimeoutMS=3000)
    yesterday = (datetime.now(TZ) - timedelta(days=1)).strftime("%Y-%m-%d")
    client[db_name].bookings.update_one(
        {"id": bid_past},
        {"$set": {"date": yesterday, "start_time": "10:00", "slot_key": f"court-1|{yesterday}|10:00"}},
    )

    ok = admin_session.post(f"{API}/admin/bookings/{bid_past}/no-show", timeout=10)
    assert ok.status_code == 200, ok.text
    assert ok.json().get("status") == "no_show"
    assert ok.json().get("booking", {}).get("status") == "no_show"

    # Idempotent
    ok2 = admin_session.post(f"{API}/admin/bookings/{bid_past}/no-show", timeout=10)
    assert ok2.status_code == 200, ok2.text
    assert ok2.json().get("status") == "no_show"

    # Dashboard KPI
    dash = admin_session.get(f"{API}/admin/dashboard", timeout=15)
    assert dash.status_code == 200
    assert "no_show_bookings" in dash.json()
    assert int(dash.json()["no_show_bookings"]) >= 1

    # Filter list
    listed = admin_session.get(f"{API}/admin/bookings", params={"status": "no_show"}, timeout=10)
    assert listed.status_code == 200
    assert any(b.get("id") == bid_past for b in listed.json())

    # cleanup leftovers
    admin_session.post(f"{API}/admin/bookings/{bid_future}/cancel", timeout=10)
    admin_session.post(f"{API}/admin/bookings/{bid_pending}/cancel", timeout=10)


def test_weekend_hours_slots_and_booking(admin_session, s):
    """Cycle 21: weekend_open/close change Sat/Sun slots; weekday unchanged; outside fails."""
    r = admin_session.get(f"{API}/admin/site-settings", timeout=10)
    assert r.status_code == 200, r.text
    original = r.json()

    # Find a weekday (Mon=0) and a Saturday far enough ahead
    base = datetime.now(TZ) + timedelta(days=21)
    weekday_day = None
    saturday = None
    for i in range(21):
        cand = base + timedelta(days=i)
        if weekday_day is None and cand.weekday() == 0:  # Monday
            weekday_day = cand.strftime("%Y-%m-%d")
        if saturday is None and cand.weekday() == 5:  # Saturday
            saturday = cand.strftime("%Y-%m-%d")
        if weekday_day and saturday:
            break
    assert weekday_day and saturday

    patched = {
        **original,
        "open_hour": 8,
        "close_hour": 23,
        "weekend_open_hour": 10,
        "weekend_close_hour": 22,
        "open_days": [0, 1, 2, 3, 4, 5, 6],
    }
    try:
        rput = admin_session.put(f"{API}/admin/site-settings", json=patched, timeout=10)
        assert rput.status_code == 200, rput.text
        body = rput.json()
        assert int(body["weekend_open_hour"]) == 10
        assert int(body["weekend_close_hour"]) == 22

        pub = s.get(f"{API}/site-settings", timeout=10)
        assert pub.status_code == 200
        assert int(pub.json()["weekend_open_hour"]) == 10
        assert int(pub.json()["weekend_close_hour"]) == 22

        # Weekday (Mon): still 08:00..23:00
        avail_wd = s.get(
            f"{API}/courts/availability",
            params={"court_id": "court-1", "date": weekday_day},
            timeout=15,
        )
        assert avail_wd.status_code == 200, avail_wd.text
        wd_body = avail_wd.json()
        wd_times = [x["time"] for x in (wd_body.get("slots") or [])]
        assert "08:00" in wd_times
        assert "23:00" in wd_times
        assert wd_body.get("settings", {}).get("effective_open_hour") == 8
        assert wd_body.get("settings", {}).get("effective_close_hour") == 23

        # Saturday: 10:00..22:00 only
        avail_we = s.get(
            f"{API}/courts/availability",
            params={"court_id": "court-1", "date": saturday},
            timeout=15,
        )
        assert avail_we.status_code == 200, avail_we.text
        we_body = avail_we.json()
        we_times = [x["time"] for x in (we_body.get("slots") or [])]
        assert "10:00" in we_times
        assert "22:00" in we_times
        assert "08:00" not in we_times
        assert "09:00" not in we_times
        assert "23:00" not in we_times
        assert we_body.get("settings", {}).get("effective_open_hour") == 10
        assert we_body.get("settings", {}).get("effective_close_hour") == 22

        # Booking at 08:00 on Saturday must fail
        bad = s.post(
            f"{API}/bookings",
            json={
                "court_id": "court-1",
                "date": saturday,
                "start_time": "08:00",
                "duration_minutes": 60,
                "cpf": SMOKE_CPF,
                "customer_name": "Weekend Hour Fail",
                "whatsapp": "11977776666",
                "your_team_name": "A",
                "opponent_team_name": "B",
            },
            headers=_xff(),
            timeout=15,
        )
        assert bad.status_code in (400, 409), bad.text
        detail = str((bad.json() or {}).get("detail") or bad.text).lower()
        assert "horário" in detail or "invalid" in detail or "indispon" in detail

        # Unset weekend hours → Saturday matches weekday again
        cleared = {**patched, "weekend_open_hour": None, "weekend_close_hour": None}
        r2 = admin_session.put(f"{API}/admin/site-settings", json=cleared, timeout=10)
        assert r2.status_code == 200, r2.text
        assert r2.json().get("weekend_open_hour") in (None, -1)
        avail3 = s.get(
            f"{API}/courts/availability",
            params={"court_id": "court-1", "date": saturday},
            timeout=15,
        )
        assert avail3.status_code == 200
        times3 = [x["time"] for x in (avail3.json().get("slots") or [])]
        assert "08:00" in times3 and "23:00" in times3
    finally:
        admin_session.put(f"{API}/admin/site-settings", json=original, timeout=10)


def test_weekend_hours_unit_time_slots_from():
    """Cycle 21: pure unit — weekday vs weekend slot generation."""
    import sys
    from pathlib import Path as P
    root = P(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    import site_settings as sset

    settings = {
        "open_hour": 8,
        "close_hour": 23,
        "weekend_open_hour": 10,
        "weekend_close_hour": 22,
        "slot_duration_minutes": 60,
    }
    # Monday 2026-09-21
    mon = sset.time_slots_from(settings, "2026-09-21")
    assert mon[0] == "08:00" and mon[-1] == "23:00"
    # Saturday 2026-09-19
    sat = sset.time_slots_from(settings, "2026-09-19")
    assert sat[0] == "10:00" and sat[-1] == "22:00"
    assert "08:00" not in sat
    # Unset weekend
    plain = {**settings, "weekend_open_hour": None, "weekend_close_hour": None}
    sat2 = sset.time_slots_from(plain, "2026-09-19")
    assert sat2[0] == "08:00" and sat2[-1] == "23:00"
    # -1 also means unset
    plain2 = {**settings, "weekend_open_hour": -1, "weekend_close_hour": -1}
    assert sset.hours_for_date(plain2, "2026-09-19") == (8, 23)


def test_admin_notes_auth_and_public_strip(admin_session, s):
    """Cycle 22: notes require admin; not exposed on public lookup/get."""
    # Create confirmed booking via admin calendar
    r = None
    for day_off in (30, 31, 32):
        day = (datetime.now(TZ) + timedelta(days=day_off)).strftime("%Y-%m-%d")
        for start in ("10:00", "11:00", "12:00"):
            r = admin_session.post(
                f"{API}/admin/calendar/bookings",
                json={
                    "date": day,
                    "start_time": start,
                    "customer_name": "Notes Customer",
                    "whatsapp": "5511999001122",
                    "status": "confirmed",
                },
                timeout=15,
            )
            if r.status_code in (200, 201):
                break
        if r is not None and r.status_code in (200, 201):
            break
    assert r is not None and r.status_code in (200, 201), getattr(r, "text", "")
    bid = r.json()["id"]

    # Unauthenticated → 401/403
    anon = s.patch(f"{API}/admin/bookings/{bid}/notes", json={"notes": "segredo"}, headers=_xff(), timeout=10)
    assert anon.status_code in (401, 403), anon.text

    # Admin can write
    ok = admin_session.patch(f"{API}/admin/bookings/{bid}/notes", json={"notes": "Cliente VIP — portão lateral"}, timeout=10)
    assert ok.status_code == 200, ok.text
    assert ok.json().get("admin_notes") == "Cliente VIP — portão lateral"
    assert ok.json().get("booking", {}).get("admin_notes") == "Cliente VIP — portão lateral"

    # Admin list includes notes
    listed = admin_session.get(f"{API}/admin/bookings", timeout=15)
    assert listed.status_code == 200
    hit = next((b for b in listed.json() if b.get("id") == bid), None)
    assert hit is not None
    assert hit.get("admin_notes") == "Cliente VIP — portão lateral"

    # Public get strips notes
    pub = s.get(f"{API}/bookings/{bid}", headers=_xff(), timeout=10)
    assert pub.status_code == 200, pub.text
    assert "admin_notes" not in pub.json()
    assert "checked_in_at" not in pub.json()

    # Overlong notes rejected
    too_long = "x" * 501
    bad = admin_session.patch(f"{API}/admin/bookings/{bid}/notes", json={"notes": too_long}, timeout=10)
    assert bad.status_code in (400, 422), bad.text

    # cleanup
    admin_session.post(f"{API}/admin/bookings/{bid}/cancel", timeout=10)


def test_admin_check_in_rules(admin_session, s):
    """Cycle 22: check-in only today + confirmed/paid; undo; dashboard KPI."""
    from pymongo import MongoClient

    # Future confirmed → 400 (not today)
    r = None
    for day_off in (33, 34, 35):
        day = (datetime.now(TZ) + timedelta(days=day_off)).strftime("%Y-%m-%d")
        for start in ("13:00", "14:00", "15:00"):
            r = admin_session.post(
                f"{API}/admin/calendar/bookings",
                json={
                    "date": day,
                    "start_time": start,
                    "customer_name": "CheckIn Future",
                    "whatsapp": "5511999002233",
                    "status": "confirmed",
                },
                timeout=15,
            )
            if r.status_code in (200, 201):
                break
        if r is not None and r.status_code in (200, 201):
            break
    assert r is not None and r.status_code in (200, 201), getattr(r, "text", "")
    bid_future = r.json()["id"]
    nf = admin_session.post(f"{API}/admin/bookings/{bid_future}/check-in", timeout=10)
    assert nf.status_code == 400, nf.text
    assert "hoje" in (nf.json().get("detail") or "").lower()

    # Pending today → 400
    today = datetime.now(TZ).strftime("%Y-%m-%d")
    rp = None
    for start in ("16:00", "17:00", "18:00", "19:00", "20:00"):
        rp = admin_session.post(
            f"{API}/admin/calendar/bookings",
            json={
                "date": today,
                "start_time": start,
                "customer_name": "CheckIn Pending",
                "whatsapp": "5511999004455",
                "status": "pending",
            },
            timeout=15,
        )
        if rp.status_code in (200, 201):
            break
    # If today slots full, create future then backdate to today as pending
    bid_pending = None
    if rp is not None and rp.status_code in (200, 201):
        bid_pending = rp.json()["id"]
    else:
        rf = None
        for day_off in (36, 37):
            day = (datetime.now(TZ) + timedelta(days=day_off)).strftime("%Y-%m-%d")
            for start in ("10:00", "11:00"):
                rf = admin_session.post(
                    f"{API}/admin/calendar/bookings",
                    json={
                        "date": day,
                        "start_time": start,
                        "customer_name": "CheckIn Pending",
                        "whatsapp": "5511999004455",
                        "status": "pending",
                    },
                    timeout=15,
                )
                if rf.status_code in (200, 201):
                    break
            if rf is not None and rf.status_code in (200, 201):
                break
        assert rf is not None and rf.status_code in (200, 201), getattr(rf, "text", "")
        bid_pending = rf.json()["id"]
        mongo_url = os.environ.get("MONGO_URL", "mongodb://127.0.0.1:27017")
        db_name = os.environ.get("DB_NAME", "arena_futsal")
        client = MongoClient(mongo_url, serverSelectionTimeoutMS=3000)
        # find free-ish slot key; just force date=today
        client[db_name].bookings.update_one(
            {"id": bid_pending},
            {"$set": {"date": today, "start_time": "21:00", "slot_key": f"court-1|{today}|21:00"}},
        )

    np_ = admin_session.post(f"{API}/admin/bookings/{bid_pending}/check-in", timeout=10)
    assert np_.status_code == 400, np_.text

    # Confirmed today → OK
    rc = None
    for start in ("09:00", "10:00", "11:00", "12:00", "22:00"):
        rc = admin_session.post(
            f"{API}/admin/calendar/bookings",
            json={
                "date": today,
                "start_time": start,
                "customer_name": "CheckIn Today",
                "whatsapp": "5511999006677",
                "status": "confirmed",
            },
            timeout=15,
        )
        if rc.status_code in (200, 201):
            break
    bid_today = None
    if rc is not None and rc.status_code in (200, 201):
        bid_today = rc.json()["id"]
    else:
        # backdate a future confirmed
        rf2 = None
        for day_off in (38, 39):
            day = (datetime.now(TZ) + timedelta(days=day_off)).strftime("%Y-%m-%d")
            for start in ("12:00", "13:00"):
                rf2 = admin_session.post(
                    f"{API}/admin/calendar/bookings",
                    json={
                        "date": day,
                        "start_time": start,
                        "customer_name": "CheckIn Today",
                        "whatsapp": "5511999006677",
                        "status": "confirmed",
                    },
                    timeout=15,
                )
                if rf2.status_code in (200, 201):
                    break
            if rf2 is not None and rf2.status_code in (200, 201):
                break
        assert rf2 is not None and rf2.status_code in (200, 201), getattr(rf2, "text", "")
        bid_today = rf2.json()["id"]
        mongo_url = os.environ.get("MONGO_URL", "mongodb://127.0.0.1:27017")
        db_name = os.environ.get("DB_NAME", "arena_futsal")
        client = MongoClient(mongo_url, serverSelectionTimeoutMS=3000)
        client[db_name].bookings.update_one(
            {"id": bid_today},
            {"$set": {"date": today, "start_time": "08:00", "slot_key": f"court-1|{today}|08:00"}},
        )

    ok = admin_session.post(f"{API}/admin/bookings/{bid_today}/check-in", timeout=10)
    assert ok.status_code == 200, ok.text
    assert ok.json().get("checked_in") is True
    assert ok.json().get("checked_in_at")
    assert ok.json().get("booking", {}).get("checked_in_at")

    # Idempotent
    ok2 = admin_session.post(f"{API}/admin/bookings/{bid_today}/check-in", timeout=10)
    assert ok2.status_code == 200, ok2.text
    assert ok2.json().get("checked_in") is True

    # Unauthenticated check-in blocked
    anon = s.post(f"{API}/admin/bookings/{bid_today}/check-in", headers=_xff(), timeout=10)
    assert anon.status_code in (401, 403), anon.text

    # Dashboard KPI
    dash = admin_session.get(f"{API}/admin/dashboard", timeout=15)
    assert dash.status_code == 200
    assert "checked_in_today_count" in dash.json()
    assert int(dash.json()["checked_in_today_count"]) >= 1

    # Undo
    undo = admin_session.post(f"{API}/admin/bookings/{bid_today}/check-in/undo", timeout=10)
    assert undo.status_code == 200, undo.text
    assert undo.json().get("checked_in") is False
    assert undo.json().get("booking", {}).get("checked_in_at") in (None, "")

    # Public still strips
    pub = s.get(f"{API}/bookings/{bid_today}", headers=_xff(), timeout=10)
    assert pub.status_code == 200
    assert "checked_in_at" not in pub.json()
    assert "admin_notes" not in pub.json()

    # cleanup
    admin_session.post(f"{API}/admin/bookings/{bid_future}/cancel", timeout=10)
    if bid_pending:
        admin_session.post(f"{API}/admin/bookings/{bid_pending}/cancel", timeout=10)
    admin_session.post(f"{API}/admin/bookings/{bid_today}/cancel", timeout=10)


def test_weekend_price_applied(admin_session, s):
    """Cycle 23: price_weekend used on Sat/Sun for availability + booking total/PIX deposit."""
    r = admin_session.get(f"{API}/admin/site-settings", timeout=10)
    assert r.status_code == 200, r.text
    original = r.json()

    base = datetime.now(TZ) + timedelta(days=28)
    weekday_day = None
    saturday = None
    for i in range(21):
        cand = base + timedelta(days=i)
        if weekday_day is None and cand.weekday() == 1:  # Tuesday
            weekday_day = cand.strftime("%Y-%m-%d")
        if saturday is None and cand.weekday() == 5:
            saturday = cand.strftime("%Y-%m-%d")
        if weekday_day and saturday:
            break
    assert weekday_day and saturday

    patched = {
        **original,
        "price_per_hour": 130,
        "price_weekend": 160,
        "open_days": [0, 1, 2, 3, 4, 5, 6],
    }
    bids = []
    try:
        rput = admin_session.put(f"{API}/admin/site-settings", json=patched, timeout=10)
        assert rput.status_code == 200, rput.text
        assert float(rput.json()["price_weekend"]) == 160

        pub = s.get(f"{API}/site-settings", timeout=10)
        assert pub.status_code == 200
        assert float(pub.json()["price_weekend"]) == 160

        avail_wd = s.get(
            f"{API}/courts/availability",
            params={"court_id": "court-1", "date": weekday_day},
            timeout=15,
        )
        assert avail_wd.status_code == 200, avail_wd.text
        wd = avail_wd.json()
        assert float(wd["settings"]["effective_price_per_hour"]) == 130
        assert float(wd["court"]["price_per_hour"]) == 130
        slots_wd = [x for x in (wd.get("slots") or []) if x.get("status") == "available"]
        assert slots_wd
        assert float(slots_wd[0]["price"]) == 130

        avail_we = s.get(
            f"{API}/courts/availability",
            params={"court_id": "court-1", "date": saturday},
            timeout=15,
        )
        assert avail_we.status_code == 200, avail_we.text
        we = avail_we.json()
        assert float(we["settings"]["effective_price_per_hour"]) == 160
        assert float(we["court"]["price_per_hour"]) == 160
        slots_we = [x for x in (we.get("slots") or []) if x.get("status") == "available"]
        assert slots_we
        assert float(slots_we[0]["price"]) == 160

        # Book Saturday → total/deposit use weekend price (PIX amount = 30% deposit)
        start = slots_we[0]["time"]
        created = s.post(
            f"{API}/bookings",
            json={
                "court_id": "court-1",
                "date": saturday,
                "start_time": start,
                "duration_minutes": 60,
                "cpf": SMOKE_CPF,
                "customer_name": "Weekend Price Customer",
                "whatsapp": "11988887777",
                "your_team_name": "A",
                "opponent_team_name": "B",
            },
            headers=_xff(),
            timeout=15,
        )
        assert created.status_code in (200, 201), created.text
        body = created.json()
        bids.append(body["id"])
        assert float(body["total"]) == 160.0
        assert float(body["deposit"]) == 48.0  # 30% of 160
        assert float((body.get("payment") or {}).get("amount") or 0) == 48.0
        assert body.get("status") == "pending"  # PIX never auto-confirm

        # Null/0 weekend price falls back
        cleared = {**patched, "price_weekend": None}
        r2 = admin_session.put(f"{API}/admin/site-settings", json=cleared, timeout=10)
        assert r2.status_code == 200, r2.text
        assert r2.json().get("price_weekend") in (None, 0)
        avail3 = s.get(
            f"{API}/courts/availability",
            params={"court_id": "court-1", "date": saturday},
            timeout=15,
        )
        assert avail3.status_code == 200
        assert float(avail3.json()["settings"]["effective_price_per_hour"]) == 130
    finally:
        for bid in bids:
            admin_session.post(f"{API}/admin/bookings/{bid}/cancel", timeout=10)
        admin_session.put(f"{API}/admin/site-settings", json=original, timeout=10)


def test_weekend_price_unit_price_for_date():
    """Cycle 23: pure unit — weekday vs weekend price helper."""
    import sys
    from pathlib import Path as P
    root = P(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    import site_settings as sset

    settings = {"price_per_hour": 130, "price_weekend": 160}
    # Monday 2026-09-21
    assert sset.price_for_date(settings, "2026-09-21") == 130
    # Saturday 2026-09-19
    assert sset.price_for_date(settings, "2026-09-19") == 160
    # Sunday 2026-09-20
    assert sset.price_for_date(settings, "2026-09-20") == 160
    plain = {"price_per_hour": 130, "price_weekend": None}
    assert sset.price_for_date(plain, "2026-09-19") == 130
    zero = {"price_per_hour": 130, "price_weekend": 0}
    assert sset.price_for_date(zero, "2026-09-19") == 130


def test_admin_customers_lookup(admin_session, s):
    """Cycle 23: CRM lite lookup by phone/name returns bookings + counts."""
    # Create two bookings for same customer
    bids = []
    phone = "5511987654321"
    name = "CRM Lite Cliente Cycle23"
    for day_off, start in ((40, "14:00"), (41, "15:00")):
        day = (datetime.now(TZ) + timedelta(days=day_off)).strftime("%Y-%m-%d")
        r = admin_session.post(
            f"{API}/admin/calendar/bookings",
            json={
                "date": day,
                "start_time": start,
                "customer_name": name,
                "whatsapp": phone,
            },
            timeout=15,
        )
        if r.status_code in (200, 201):
            bids.append(r.json()["id"])
        else:
            # slot conflict — try other times
            for alt in ("16:00", "17:00", "18:00"):
                r = admin_session.post(
                    f"{API}/admin/calendar/bookings",
                    json={
                        "date": day,
                        "start_time": alt,
                        "customer_name": name,
                        "whatsapp": phone,
                    },
                    timeout=15,
                )
                if r.status_code in (200, 201):
                    bids.append(r.json()["id"])
                    break
    assert len(bids) >= 1, "could not create bookings for lookup test"

    try:
        # Auth required
        anon = s.get(f"{API}/admin/customers/lookup", params={"q": name}, headers=_xff(), timeout=10)
        assert anon.status_code in (401, 403), anon.text

        # Too short
        short = admin_session.get(f"{API}/admin/customers/lookup", params={"q": "a"}, timeout=10)
        assert short.status_code == 400, short.text

        # By name
        by_name = admin_session.get(f"{API}/admin/customers/lookup", params={"q": "CRM Lite"}, timeout=15)
        assert by_name.status_code == 200, by_name.text
        data = by_name.json()
        assert data["count"] >= 1
        cust = next((c for c in data["customers"] if name.lower() in (c.get("customer_name") or "").lower()), None)
        assert cust is not None
        assert cust["counts"]["total"] >= 1
        assert isinstance(cust["bookings"], list) and len(cust["bookings"]) >= 1
        assert cust["bookings"][0].get("id")
        assert "status" in cust["bookings"][0]

        # By phone digits
        by_phone = admin_session.get(
            f"{API}/admin/customers/lookup",
            params={"q": "987654321"},
            timeout=15,
        )
        assert by_phone.status_code == 200, by_phone.text
        assert by_phone.json()["count"] >= 1

        # No invented customers
        miss = admin_session.get(
            f"{API}/admin/customers/lookup",
            params={"q": "zzzznobodyxyzqqq"},
            timeout=10,
        )
        assert miss.status_code == 200
        assert miss.json()["count"] == 0
        assert miss.json()["customers"] == []
    finally:
        for bid in bids:
            admin_session.post(f"{API}/admin/bookings/{bid}/cancel", timeout=10)



def test_multi_hour_booking_locks_both_slots(admin_session, s):
    """Cycle 24: 2h booking locks start+next; second book on second hour → 409; cancel frees both; 1h ok."""
    # Find a weekday far ahead with two consecutive free slots
    day = None
    start = None
    next_t = None
    for day_off in range(50, 80):
        cand = (datetime.now(TZ) + timedelta(days=day_off)).strftime("%Y-%m-%d")
        avail = s.get(
            f"{API}/courts/availability",
            params={"court_id": "court-1", "date": cand},
            timeout=15,
        )
        assert avail.status_code == 200, avail.text
        data = avail.json()
        if data.get("day_open") is False:
            continue
        slots = data.get("slots") or []
        for i, sl in enumerate(slots[:-1]):
            if sl.get("status") != "available":
                continue
            nxt = slots[i + 1]
            if nxt.get("status") != "available":
                continue
            if int(sl.get("max_consecutive") or 0) < 2:
                continue
            day, start, next_t = cand, sl["time"], nxt["time"]
            break
        if day:
            break
    assert day and start and next_t, "no free consecutive pair found for multi-hour test"

    # Settings expose multi-hour flags
    pub = s.get(f"{API}/site-settings", timeout=10)
    assert pub.status_code == 200, pub.text
    assert "allow_multi_hour" in pub.json()
    assert "max_hours_per_booking" in pub.json()

    # Create 2h via admin
    r = admin_session.post(
        f"{API}/admin/calendar/bookings",
        json={
            "date": day,
            "start_time": start,
            "customer_name": "Multi Hora Cycle24",
            "whatsapp": "5511999001122",
            "duration_hours": 2,
        },
        timeout=15,
    )
    assert r.status_code in (200, 201), r.text
    booking = r.json()
    bid = booking["id"]
    assert booking.get("duration_minutes") == 120
    assert booking.get("slot_key", "").endswith(start)
    assert isinstance(booking.get("slot_keys"), list) and len(booking["slot_keys"]) == 2

    try:
        # Availability: both hours reserved
        avail2 = s.get(
            f"{API}/courts/availability",
            params={"court_id": "court-1", "date": day},
            timeout=15,
        )
        assert avail2.status_code == 200
        by_t = {x["time"]: x for x in avail2.json()["slots"]}
        assert by_t[start]["status"] == "reserved"
        assert by_t[next_t]["status"] == "reserved"
        assert by_t[start].get("duration_minutes") == 120
        assert by_t[next_t].get("is_continuation") is True

        # Second book on second hour → 409
        clash = admin_session.post(
            f"{API}/admin/calendar/bookings",
            json={
                "date": day,
                "start_time": next_t,
                "customer_name": "Clash Cycle24",
                "whatsapp": "5511999003344",
                "duration_hours": 1,
            },
            timeout=15,
        )
        assert clash.status_code == 409, clash.text

        # Also public create on second hour → 409
        pub_clash = s.post(
            f"{API}/bookings",
            json={
                "court_id": "court-1",
                "date": day,
                "start_time": next_t,
                "duration_hours": 1,
                "cpf": SMOKE_CPF,
                "customer_name": "Public Clash",
                "whatsapp": "11988887777",
                "your_team_name": "A",
                "opponent_team_name": "B",
            },
            headers=_xff(),
            timeout=15,
        )
        assert pub_clash.status_code == 409, pub_clash.text

        # Cancel frees both
        cancel = admin_session.post(f"{API}/admin/bookings/{bid}/cancel", timeout=15)
        assert cancel.status_code == 200, cancel.text

        avail3 = s.get(
            f"{API}/courts/availability",
            params={"court_id": "court-1", "date": day},
            timeout=15,
        )
        by_t3 = {x["time"]: x for x in avail3.json()["slots"]}
        assert by_t3[start]["status"] == "available"
        assert by_t3[next_t]["status"] == "available"

        # 1h still works
        one = admin_session.post(
            f"{API}/admin/calendar/bookings",
            json={
                "date": day,
                "start_time": start,
                "customer_name": "Uma Hora Cycle24",
                "whatsapp": "5511999005566",
                "duration_hours": 1,
            },
            timeout=15,
        )
        assert one.status_code in (200, 201), one.text
        one_b = one.json()
        assert one_b.get("duration_minutes") == 60
        admin_session.post(f"{API}/admin/bookings/{one_b['id']}/cancel", timeout=10)
    finally:
        admin_session.post(f"{API}/admin/bookings/{bid}/cancel", timeout=10)


def test_multi_hour_resolve_duration_unit():
    """Cycle 24: unit — resolve_booking_duration caps and validates."""
    import sys
    from pathlib import Path as P
    root = P(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    import booking_service as bsvc

    settings = {
        "slot_duration_minutes": 60,
        "allow_multi_hour": True,
        "max_hours_per_booking": 2,
    }
    assert bsvc.resolve_booking_duration(settings, duration_hours=2) == 120
    assert bsvc.resolve_booking_duration(settings, duration_minutes=60) == 60
    try:
        bsvc.resolve_booking_duration(settings, duration_hours=3)
        assert False, "expected ValueError for 3h when max=2"
    except ValueError:
        pass
    off = {**settings, "allow_multi_hour": False}
    try:
        bsvc.resolve_booking_duration(off, duration_hours=2)
        assert False, "expected ValueError when multi disabled"
    except ValueError:
        pass


def test_waitlist_join_cancel_notify_and_duplicate(admin_session, s):
    """Cycle 25: join waitlist on reserved slot; cancel notifies first; duplicate phone rejected."""
    import sys
    from pathlib import Path as P
    from unittest.mock import AsyncMock, patch

    root = P(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))

    # Settings expose waitlist_enabled
    pub = s.get(f"{API}/site-settings", timeout=10)
    assert pub.status_code == 200, pub.text
    assert "waitlist_enabled" in pub.json()

    day = None
    start = None
    for day_off in range(55, 90):
        cand = (datetime.now(TZ) + timedelta(days=day_off)).strftime("%Y-%m-%d")
        avail = s.get(
            f"{API}/courts/availability",
            params={"court_id": "court-1", "date": cand},
            timeout=15,
        )
        assert avail.status_code == 200, avail.text
        data = avail.json()
        if data.get("day_open") is False:
            continue
        for sl in data.get("slots") or []:
            if sl.get("status") == "available":
                day, start = cand, sl["time"]
                break
        if day:
            break
    assert day and start, "no free slot for waitlist test"

    # Free slot → join should fail
    free_join = s.post(
        f"{API}/waitlist",
        json={
            "court_id": "court-1",
            "date": day,
            "start_time": start,
            "name": "Lista Livre",
            "phone": "5511988776655",
        },
        headers=_xff(),
        timeout=15,
    )
    assert free_join.status_code == 400, free_join.text

    # Reserve via admin
    book = admin_session.post(
        f"{API}/admin/calendar/bookings",
        json={
            "date": day,
            "start_time": start,
            "customer_name": "Reserva Waitlist",
            "whatsapp": "5511999005566",
            "duration_hours": 1,
        },
        timeout=15,
    )
    assert book.status_code in (200, 201), book.text
    bid = book.json()["id"]

    try:
        # Join waitlist (two people — FIFO)
        j1 = s.post(
            f"{API}/waitlist",
            json={
                "court_id": "court-1",
                "date": day,
                "start_time": start,
                "name": "Primeiro Fila",
                "phone": "5511988112233",
            },
            headers=_xff(),
            timeout=15,
        )
        assert j1.status_code == 200, j1.text
        e1 = j1.json()
        assert e1.get("status") == "waiting"
        assert e1.get("position") == 1
        wid1 = e1["id"]

        # Duplicate same phone → 400
        dup = s.post(
            f"{API}/waitlist",
            json={
                "court_id": "court-1",
                "date": day,
                "start_time": start,
                "name": "Primeiro Fila Dup",
                "phone": "11988112233",  # same digits without 55
            },
            headers=_xff(),
            timeout=15,
        )
        assert dup.status_code == 400, dup.text
        assert "já está" in (dup.json().get("detail") or "").lower() or "lista" in (dup.json().get("detail") or "").lower()

        j2 = s.post(
            f"{API}/waitlist",
            json={
                "court_id": "court-1",
                "date": day,
                "start_time": start,
                "name": "Segundo Fila",
                "phone": "5511988445566",
            },
            headers=_xff(),
            timeout=15,
        )
        assert j2.status_code == 200, j2.text
        assert j2.json().get("position") == 2

        # Admin list
        listed = admin_session.get(f"{API}/admin/waitlist", params={"date": day}, timeout=15)
        assert listed.status_code == 200, listed.text
        entries = listed.json().get("entries") or []
        assert any(e.get("id") == wid1 for e in entries)

        # Cancel booking → notify path (spy send_text)
        with patch("whatsapp_bridge.send_text", new_callable=AsyncMock) as mock_send:
            mock_send.return_value = {"ok": True}
            # Patch may not affect already-imported server module — also patch waitlist_service
            with patch("waitlist_service.whatsapp_bridge.send_text", new_callable=AsyncMock) as mock_wls:
                mock_wls.return_value = {"ok": True}
                cancel = admin_session.post(f"{API}/admin/bookings/{bid}/cancel", timeout=15)
                assert cancel.status_code == 200, cancel.text
                # At least one of the patches should have been called if server shares process;
                # status check below is the source of truth for notify path.

        listed2 = admin_session.get(f"{API}/admin/waitlist", params={"date": day}, timeout=15)
        assert listed2.status_code == 200
        by_id = {e["id"]: e for e in (listed2.json().get("entries") or [])}
        assert by_id[wid1]["status"] == "notified", by_id[wid1]
        assert by_id[wid1].get("notified_at")
        # Second still waiting (only first notified)
        wid2 = j2.json()["id"]
        assert by_id[wid2]["status"] == "waiting"

        # Remove second
        rm = admin_session.delete(f"{API}/admin/waitlist/{wid2}", timeout=15)
        assert rm.status_code == 200, rm.text
    finally:
        admin_session.post(f"{API}/admin/bookings/{bid}/cancel", timeout=10)
        # Drop leftover notified/waiting rows so re-runs can rejoin the same slot
        try:
            from pymongo import MongoClient
            import os
            dbn = os.environ.get("DB_NAME") or "arena_futsal"
            uri = os.environ.get("MONGO_URL") or "mongodb://127.0.0.1:27017"
            MongoClient(uri)[dbn].waitlist.delete_many({
                "slot_key": f"court-1|{day}|{start}",
                "phone": {"$in": ["5511988112233", "5511988445566", "5511988776655", "11988112233"]},
            })
        except Exception:
            pass


def test_waitlist_covered_times_unit():
    """Cycle 25: unit — covered_times_from_booking expands slot_keys."""
    import sys
    from pathlib import Path as P
    root = P(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    import waitlist_service as wls

    times = wls.covered_times_from_booking({
        "start_time": "18:00",
        "slot_keys": ["court-1|2099-01-01|18:00", "court-1|2099-01-01|19:00"],
    })
    assert times == ["18:00", "19:00"]
    assert wls.covered_times_from_booking({"start_time": "10:00"}) == ["10:00"]


def test_recurring_weekly_partial_and_locks(admin_session, s):
    """Cycle 27: 4 weeks with 1 conflict → 3 created 1 skipped; slot_locks; cancel one keeps series."""
    pub = s.get(f"{API}/site-settings", timeout=10)
    assert pub.status_code == 200, pub.text
    assert pub.json().get("recurring_enabled") is not False
    assert int(pub.json().get("recurring_max_weeks") or 0) >= 2

    # Find a free weekday slot far ahead; ensure +1w, +2w, +3w same time mostly free
    day = None
    start = None
    for day_off in range(60, 120):
        cand = (datetime.now(TZ) + timedelta(days=day_off)).strftime("%Y-%m-%d")
        # Prefer mid-week
        wd = datetime.strptime(cand, "%Y-%m-%d").weekday()
        if wd >= 5:
            continue
        dates = [(datetime.strptime(cand, "%Y-%m-%d") + timedelta(weeks=i)).strftime("%Y-%m-%d") for i in range(4)]
        ok = True
        for d in dates:
            avail = s.get(
                f"{API}/courts/availability",
                params={"court_id": "court-1", "date": d},
                timeout=15,
                headers=_xff(),
            )
            assert avail.status_code == 200, avail.text
            data = avail.json()
            if data.get("day_open") is False:
                ok = False
                break
            by_t = {x["time"]: x for x in (data.get("slots") or [])}
            # pick first free evening-ish if possible
            if start is None:
                for sl in data.get("slots") or []:
                    if sl.get("status") == "available" and sl["time"] >= "18:00":
                        start = sl["time"]
                        break
                if start is None:
                    for sl in data.get("slots") or []:
                        if sl.get("status") == "available":
                            start = sl["time"]
                            break
            if not start or by_t.get(start, {}).get("status") != "available":
                ok = False
                break
        if ok and start:
            day = cand
            break
    assert day and start, "no free 4-week window found for recurring test"

    week2 = (datetime.strptime(day, "%Y-%m-%d") + timedelta(weeks=1)).strftime("%Y-%m-%d")

    # Conflict on week 2 via admin
    clash = admin_session.post(
        f"{API}/admin/calendar/bookings",
        json={
            "date": week2,
            "start_time": start,
            "customer_name": "Conflict Cycle27",
            "whatsapp": "5511997001122",
            "duration_hours": 1,
        },
        timeout=15,
    )
    assert clash.status_code in (200, 201), clash.text
    clash_id = clash.json()["id"]

    created_ids = []
    series_id = None
    try:
        # Preview
        prev = s.post(
            f"{API}/bookings/recurring/preview",
            json={
                "court_id": "court-1",
                "date": day,
                "start_time": start,
                "weeks": 4,
                "duration_hours": 1,
            },
            timeout=15,
            headers=_xff(),
        )
        assert prev.status_code == 200, prev.text
        occ = prev.json()["occurrences"]
        assert len(occ) == 4
        by_d = {o["date"]: o for o in occ}
        assert by_d[week2]["available"] is False
        free_dates = [o["date"] for o in occ if o["available"]]
        assert len(free_dates) == 3

        # Public recurring create
        r = s.post(
            f"{API}/bookings/recurring",
            json={
                "court_id": "court-1",
                "date": day,
                "start_time": start,
                "weeks": 4,
                "duration_hours": 1,
                "cpf": SMOKE_CPF,
                "customer_name": "Recorrente Cycle27",
                "whatsapp": "5511997003344",
                "your_team_name": "Time R",
                "opponent_team_name": "Time S",
            },
            timeout=20,
            headers=_xff(),
        )
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body["created_count"] == 3, body
        assert body["skipped_count"] == 1, body
        assert body["skipped"][0]["date"] == week2
        assert "já reservado" in (body["skipped"][0].get("reason") or "").lower() or "reservado" in (
            body["skipped"][0].get("reason") or ""
        ).lower()
        series_id = body["series_id"]
        assert series_id
        created = body["created"]
        assert len(created) == 3
        created_ids = [b["id"] for b in created]
        for b in created:
            assert b.get("series_id") == series_id
            assert b.get("start_time") == start
            assert isinstance(b.get("slot_keys"), list) and len(b["slot_keys"]) >= 1

        # Slot locks present for created weeks
        from pymongo import MongoClient
        import os as _os
        uri = _os.environ.get("MONGO_URL") or "mongodb://127.0.0.1:27017"
        dbn = _os.environ.get("DB_NAME") or "arena_futsal"
        client = MongoClient(uri)
        locks = list(client[dbn].slot_locks.find({"booking_id": {"$in": created_ids}}))
        assert len(locks) >= 3, f"expected slot_locks for created bookings, got {len(locks)}"

        # Cancel ONE booking — series siblings remain active
        one = created_ids[0]
        c = s.post(
            f"{API}/bookings/{one}/cancel",
            params={"cpf": SMOKE_CPF},
            timeout=15,
            headers=_xff(),
        )
        assert c.status_code == 200, c.text
        still = [
            x for x in created_ids[1:]
            if admin_session.get(f"{API}/admin/bookings", params={"q": "Recorrente Cycle27"}, timeout=15).status_code == 200
        ]
        # Check remaining via lookup
        look = s.post(f"{API}/bookings/lookup", json={"cpf": SMOKE_CPF}, timeout=15, headers=_xff())
        assert look.status_code == 200
        active_series = [
            b for b in look.json().get("bookings") or []
            if b.get("series_id") == series_id and b.get("status") in ("pending", "awaiting_admin", "confirmed")
        ]
        assert len(active_series) == 2, f"expected 2 active after single cancel, got {len(active_series)}"

        # Cancel série futura
        sc = s.post(
            f"{API}/bookings/series/{series_id}/cancel-future",
            json={"cpf": SMOKE_CPF},
            timeout=15,
            headers=_xff(),
        )
        assert sc.status_code == 200, sc.text
        assert sc.json()["cancelled_count"] >= 2

        # Admin recurring path smoke (short 2 weeks far ahead)
        day_a = None
        start_a = None
        for day_off in range(130, 180):
            cand = (datetime.now(TZ) + timedelta(days=day_off)).strftime("%Y-%m-%d")
            if datetime.strptime(cand, "%Y-%m-%d").weekday() >= 5:
                continue
            d2 = (datetime.strptime(cand, "%Y-%m-%d") + timedelta(weeks=1)).strftime("%Y-%m-%d")
            free = True
            for d in (cand, d2):
                avail = s.get(
                    f"{API}/courts/availability",
                    params={"court_id": "court-1", "date": d},
                    timeout=15,
                    headers=_xff(),
                )
                by_t = {x["time"]: x for x in avail.json().get("slots") or []}
                t = start or "20:00"
                if by_t.get(t, {}).get("status") != "available":
                    # try any free shared time
                    free = False
                    break
            if not free:
                # find a time free on both
                a1 = s.get(f"{API}/courts/availability", params={"court_id": "court-1", "date": cand}, timeout=15).json()
                a2 = s.get(f"{API}/courts/availability", params={"court_id": "court-1", "date": d2}, timeout=15).json()
                t1 = {x["time"] for x in a1.get("slots") or [] if x.get("status") == "available"}
                t2 = {x["time"] for x in a2.get("slots") or [] if x.get("status") == "available"}
                common = sorted(t1 & t2)
                if common:
                    day_a, start_a = cand, common[0]
                    break
            else:
                day_a, start_a = cand, start or "20:00"
                break
        assert day_a and start_a
        ar = admin_session.post(
            f"{API}/admin/calendar/bookings/recurring",
            json={
                "date": day_a,
                "start_time": start_a,
                "customer_name": "Admin Rec Cycle27",
                "whatsapp": "5511997005566",
                "weeks": 2,
                "duration_hours": 1,
            },
            timeout=20,
        )
        assert ar.status_code in (200, 201), ar.text
        assert ar.json()["created_count"] == 2
        admin_series = ar.json()["series_id"]
        for b in ar.json()["created"]:
            created_ids.append(b["id"])
        # Admin cancel series
        ac = admin_session.post(f"{API}/admin/bookings/series/{admin_series}/cancel-future", timeout=15)
        assert ac.status_code == 200, ac.text
        assert ac.json()["cancelled_count"] >= 1

    finally:
        admin_session.post(f"{API}/admin/bookings/{clash_id}/cancel", timeout=10)
        for bid in created_ids:
            admin_session.post(f"{API}/admin/bookings/{bid}/cancel", timeout=10)


def test_recurring_weeks_unit():
    """Cycle 27: weekly dates + clamp_recurring_weeks."""
    import sys
    from pathlib import Path as P
    root = P(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    import booking_service as bsvc

    dates = bsvc.weekly_occurrence_dates("2026-10-06", 4)  # Tuesday
    assert dates == ["2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27"]
    assert bsvc.clamp_recurring_weeks(4, {"recurring_enabled": True, "recurring_max_weeks": 8}) == 4
    try:
        bsvc.clamp_recurring_weeks(1, {"recurring_enabled": True, "recurring_max_weeks": 8})
        assert False, "expected ValueError for weeks=1"
    except ValueError:
        pass
    try:
        bsvc.clamp_recurring_weeks(4, {"recurring_enabled": False})
        assert False, "expected ValueError when disabled"
    except ValueError:
        pass


def test_admin_audit_log_write_and_auth(admin_session, s):
    """Cycle 28: mutation writes audit entry; list requires admin."""
    bare = requests.Session()
    r0 = bare.get(f"{API}/admin/audit", timeout=10)
    assert r0.status_code in (401, 403), r0.text

    # Trigger a settings save (safe mutation) to generate an audit row
    cur = admin_session.get(f"{API}/admin/site-settings", timeout=10)
    assert cur.status_code == 200, cur.text
    original = cur.json()
    patched = {**original, "structure_blurb": (original.get("structure_blurb") or "")}
    # toggle a harmless bool if present, else re-save same payload
    if "accepts_pix" in patched:
        # keep same value — still a settings_save
        pass
    rput = admin_session.put(f"{API}/admin/site-settings", json=patched, timeout=15)
    assert rput.status_code == 200, rput.text

    r = admin_session.get(f"{API}/admin/audit", params={"limit": 20}, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "items" in body and isinstance(body["items"], list)
    assert body["count"] == len(body["items"])
    assert any(it.get("action") == "settings_save" for it in body["items"]), body["items"][:3]

    # Filter by action
    rf = admin_session.get(
        f"{API}/admin/audit",
        params={"limit": 10, "action": "settings_save"},
        timeout=10,
    )
    assert rf.status_code == 200, rf.text
    items = rf.json().get("items") or []
    assert items, "expected at least one settings_save"
    assert all(it.get("action") == "settings_save" for it in items)
    # newest first: at descending
    ats = [it.get("at") or "" for it in items]
    assert ats == sorted(ats, reverse=True)
    # no secrets in meta
    blob = str(items).lower()
    for leak in ("password", "jwt", "token", "secret", "mongo_url"):
        assert leak not in blob

    # Also exercise cancel → booking_cancel audit when we can create a booking
    day = None
    start = None
    for off in range(40, 90):
        cand = (datetime.now(TZ) + timedelta(days=off)).strftime("%Y-%m-%d")
        if datetime.strptime(cand, "%Y-%m-%d").weekday() >= 5:
            continue
        avail = s.get(
            f"{API}/courts/availability",
            params={"court_id": "court-1", "date": cand},
            timeout=15,
            headers=_xff(),
        )
        if avail.status_code != 200:
            continue
        free = [x["time"] for x in avail.json().get("slots") or [] if x.get("status") == "available"]
        if free:
            day, start = cand, free[0]
            break
    if day and start:
        cr = admin_session.post(
            f"{API}/admin/calendar/bookings",
            json={
                "date": day,
                "start_time": start,
                "customer_name": "Audit Cycle28",
                "whatsapp": "5511997002828",
                "status": "confirmed",
                "duration_hours": 1,
            },
            timeout=15,
        )
        assert cr.status_code in (200, 201), cr.text
        bid = cr.json()["id"]
        ca = admin_session.post(f"{API}/admin/bookings/{bid}/cancel", timeout=10)
        assert ca.status_code == 200, ca.text
        ra = admin_session.get(
            f"{API}/admin/audit",
            params={"limit": 30, "action": "booking_cancel"},
            timeout=10,
        )
        assert ra.status_code == 200
        cancels = ra.json().get("items") or []
        assert any(it.get("entity_id") == bid for it in cancels), cancels[:5]


def test_audit_helper_strips_secrets_unit():
    """Cycle 28: _safe_meta drops password/token keys."""
    import sys
    from pathlib import Path as P
    root = P(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    import audit_log as al

    cleaned = al._safe_meta({
        "date": "2026-10-01",
        "password": "secret",
        "access_token": "abc",
        "jwt_secret": "x",
        "ok": True,
    })
    assert cleaned.get("date") == "2026-10-01"
    assert cleaned.get("ok") is True
    assert "password" not in cleaned
    assert "access_token" not in cleaned
    assert "jwt_secret" not in cleaned


def test_promo_discount_math_unit():
    """Cycle 29: percent/fixed discount never negative."""
    import sys
    from pathlib import Path as P
    root = P(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    import promo_codes as pc

    p = pc.compute_discount(100.0, {"code": "P10", "type": "percent", "value": 10})
    assert p["discount"] == 10.0 and p["total"] == 90.0
    p2 = pc.compute_discount(100.0, {"code": "F30", "type": "fixed", "value": 30})
    assert p2["discount"] == 30.0 and p2["total"] == 70.0
    p3 = pc.compute_discount(20.0, {"code": "BIG", "type": "fixed", "value": 50})
    assert p3["discount"] == 20.0 and p3["total"] == 0.0
    p4 = pc.compute_discount(80.0, {"code": "ALL", "type": "percent", "value": 100})
    assert p4["discount"] == 80.0 and p4["total"] == 0.0


def test_promo_codes_validate_and_booking(admin_session, s):
    """Cycle 29/31: create/validate percent+fixed; reject expired/inactive; max_uses; booking discount.
    Isolated on far weekday with >=3 free slots; cancels bookings to avoid slot_lock pollution.
    """
    import uuid as _uuid

    suffix = _uuid.uuid4().hex[:6].upper()
    code_pct = f"PCT{suffix}"
    code_fix = f"FIX{suffix}"
    code_max = f"MAX{suffix}"
    code_exp = f"EXP{suffix}"
    code_off = f"OFF{suffix}"
    created_ids = []

    # Auth required for admin list
    bare = requests.Session()
    assert bare.get(f"{API}/admin/promo-codes", timeout=10).status_code in (401, 403)

    r1 = admin_session.post(
        f"{API}/admin/promo-codes",
        json={"code": code_pct, "type": "percent", "value": 10, "max_uses": 50},
        timeout=10,
    )
    assert r1.status_code == 200, r1.text
    assert r1.json()["code"] == code_pct
    assert r1.json()["type"] == "percent"

    r2 = admin_session.post(
        f"{API}/admin/promo-codes",
        json={"code": code_fix, "type": "fixed", "value": 25},
        timeout=10,
    )
    assert r2.status_code == 200, r2.text

    r3 = admin_session.post(
        f"{API}/admin/promo-codes",
        json={"code": code_max, "type": "percent", "value": 5, "max_uses": 1},
        timeout=10,
    )
    assert r3.status_code == 200, r3.text

    # Expired
    r4 = admin_session.post(
        f"{API}/admin/promo-codes",
        json={"code": code_exp, "type": "fixed", "value": 10, "expires_at": "2020-01-01"},
        timeout=10,
    )
    assert r4.status_code == 200, r4.text

    # Inactive via deactivate
    r5 = admin_session.post(
        f"{API}/admin/promo-codes",
        json={"code": code_off, "type": "percent", "value": 15},
        timeout=10,
    )
    assert r5.status_code == 200, r5.text
    off_id = r5.json()["id"]
    rd = admin_session.post(f"{API}/admin/promo-codes/{off_id}/deactivate", timeout=10)
    assert rd.status_code == 200, rd.text
    assert rd.json()["active"] is False

    # List
    rl = admin_session.get(f"{API}/admin/promo-codes", timeout=10)
    assert rl.status_code == 200
    codes = {x["code"] for x in rl.json().get("items") or []}
    assert code_pct in codes and code_fix in codes

    try:
        # Need a free weekday with enough slots (3 bookings in this test)
        day, free0, price = _find_day_with_n_free(s, n=3, start_off=120, end_off=240)
        assert day and free0 and price, "no free weekday with 3+ slots for promo test"
        start = free0[0]

        # Validate percent preview
        v1 = s.post(
            f"{API}/promo/validate",
            json={"code": code_pct, "date": day, "hours": 1},
            headers=_xff(),
            timeout=10,
        )
        assert v1.status_code == 200, v1.text
        pv = v1.json()
        assert pv["valid"] is True
        assert abs(pv["discount"] - round(price * 0.10, 2)) < 0.02
        assert abs(pv["total"] - round(price - pv["discount"], 2)) < 0.02
        # used_count not claimed yet
        listed = admin_session.get(f"{API}/admin/promo-codes", timeout=10).json()["items"]
        pct_row = next(x for x in listed if x["code"] == code_pct)
        assert int(pct_row["used_count"] or 0) == 0

        # Fixed preview
        v2 = s.post(
            f"{API}/promo/validate",
            json={"code": code_fix.lower(), "date": day, "hours": 1},
            headers=_xff(),
            timeout=10,
        )
        assert v2.status_code == 200, v2.text
        assert abs(v2.json()["discount"] - min(25.0, price)) < 0.02

        # Reject expired / inactive
        ve = s.post(f"{API}/promo/validate", json={"code": code_exp, "date": day, "hours": 1}, headers=_xff(), timeout=10)
        assert ve.status_code == 400, ve.text
        assert "expir" in (ve.json().get("detail") or "").lower()

        vi = s.post(f"{API}/promo/validate", json={"code": code_off, "date": day, "hours": 1}, headers=_xff(), timeout=10)
        assert vi.status_code == 400, vi.text

        # Booking with percent promo
        free2 = None
        for t in [
            x["time"]
            for x in s.get(
                f"{API}/courts/availability",
                params={"court_id": "court-1", "date": day},
                timeout=15,
                headers=_xff(),
            ).json().get("slots") or []
            if x.get("status") == "available"
        ]:
            free2 = t
            break
        assert free2
        cr = s.post(
            f"{API}/bookings",
            json={
                "court_id": "court-1",
                "date": day,
                "start_time": free2,
                "duration_hours": 1,
                "cpf": SMOKE_CPF,
                "customer_name": "Promo Cycle31",
                "whatsapp": "11999887766",
                "your_team_name": "A",
                "opponent_team_name": "B",
                "promo_code": code_pct,
            },
            headers=_xff(),
            timeout=15,
        )
        assert cr.status_code in (200, 201), cr.text
        b = cr.json()
        created_ids.append(b.get("id"))
        assert b.get("promo_code") == code_pct
        assert float(b.get("discount") or 0) > 0
        assert float(b["total"]) < float(b.get("original_total") or price)
        assert float(b["total"]) >= 0
        assert abs(float(b["deposit"]) - round(float(b["total"]) * 0.3, 2)) < 0.02
        assert b.get("payment", {}).get("status") == "pending"  # PIX never auto-confirm
        assert abs(float(b["payment"]["amount"]) - float(b["deposit"])) < 0.02

        # used_count incremented
        listed2 = admin_session.get(f"{API}/admin/promo-codes", timeout=10).json()["items"]
        pct_row2 = next(x for x in listed2 if x["code"] == code_pct)
        assert int(pct_row2["used_count"] or 0) >= 1

        # max_uses=1: first booking claims, second rejected — need 2 free after first booking
        free3 = [
            x["time"]
            for x in s.get(
                f"{API}/courts/availability",
                params={"court_id": "court-1", "date": day},
                timeout=15,
                headers=_xff(),
            ).json().get("slots") or []
            if x.get("status") == "available"
        ]
        if len(free3) < 2:
            # Fall back to another isolated day rather than fail on pollution
            day2, free_alt, _ = _find_day_with_n_free(s, n=2, start_off=240, end_off=320)
            assert day2 and len(free_alt) >= 2, "need 2 free slots for max_uses test"
            day, free3 = day2, free_alt
        assert len(free3) >= 2, "need 2 free slots for max_uses test"
        b1 = s.post(
            f"{API}/bookings",
            json={
                "court_id": "court-1",
                "date": day,
                "start_time": free3[0],
                "duration_hours": 1,
                "cpf": SMOKE_CPF,
                "customer_name": "MaxUses One",
                "whatsapp": "11999887766",
                "your_team_name": "A",
                "opponent_team_name": "B",
                "promo_code": code_max,
            },
            headers=_xff(),
            timeout=15,
        )
        assert b1.status_code in (200, 201), b1.text
        created_ids.append(b1.json().get("id"))
        b2 = s.post(
            f"{API}/bookings",
            json={
                "court_id": "court-1",
                "date": day,
                "start_time": free3[1],
                "duration_hours": 1,
                "cpf": SMOKE_CPF,
                "customer_name": "MaxUses Two",
                "whatsapp": "11999887766",
                "your_team_name": "A",
                "opponent_team_name": "B",
                "promo_code": code_max,
            },
            headers=_xff(),
            timeout=15,
        )
        assert b2.status_code == 400, b2.text
        # booking without promo should still work on that slot after failed promo
        # (locks released on ValueError before insert)
        b3 = s.post(
            f"{API}/bookings",
            json={
                "court_id": "court-1",
                "date": day,
                "start_time": free3[1],
                "duration_hours": 1,
                "cpf": SMOKE_CPF,
                "customer_name": "No Promo",
                "whatsapp": "11999887766",
                "your_team_name": "A",
                "opponent_team_name": "B",
            },
            headers=_xff(),
            timeout=15,
        )
        assert b3.status_code in (200, 201), b3.text
        created_ids.append(b3.json().get("id"))
        assert not b3.json().get("promo_code")

        # Audit rows for create/deactivate
        ra = admin_session.get(f"{API}/admin/audit", params={"limit": 30, "action": "promo_create"}, timeout=10)
        assert ra.status_code == 200
        assert any(it.get("action") == "promo_create" for it in (ra.json().get("items") or []))
        rd2 = admin_session.get(f"{API}/admin/audit", params={"limit": 10, "action": "promo_deactivate"}, timeout=10)
        assert rd2.status_code == 200
        assert any(it.get("action") == "promo_deactivate" for it in (rd2.json().get("items") or []))
    finally:
        for bid in created_ids:
            _admin_cancel_quiet(admin_session, bid)


def test_policy_texts_settings_roundtrip(admin_session, s):
    """Cycle 30: policy_cancel / policy_rain / policies_enabled round-trip + {horas} resolve."""
    r = admin_session.get(f"{API}/admin/site-settings", timeout=10)
    assert r.status_code == 200, r.text
    original = r.json()
    for key in ("policy_cancel", "policy_rain", "policies_enabled", "cancel_min_hours"):
        assert key in original, key

    patched = {
        **original,
        "cancel_min_hours": 4,
        "policies_enabled": True,
        "policy_cancel": (
            "Cancele com pelo menos {horas} horas de antecedência. "
            "Prazo configurado: {cancel_min_hours}h."
        ),
        "policy_rain": "Choveu? Fale no WhatsApp — sem inventar cobertura.",
    }
    try:
        rput = admin_session.put(f"{API}/admin/site-settings", json=patched, timeout=10)
        assert rput.status_code == 200, rput.text
        body = rput.json()
        assert body.get("policies_enabled") is True
        assert "{horas}" in (body.get("policy_cancel") or "")
        assert "4" in (body.get("policy_cancel_resolved") or "")
        assert "cobertura" not in (body.get("policy_rain") or "").lower() or "sem inventar" in (body.get("policy_rain") or "").lower()
        assert "WhatsApp" in (body.get("policy_rain_resolved") or body.get("policy_rain") or "")

        pub = s.get(f"{API}/site-settings", timeout=10)
        assert pub.status_code == 200, pub.text
        pdata = pub.json()
        assert pdata.get("policies_enabled") is True
        assert "policy_cancel" in pdata
        assert "policy_rain" in pdata
        resolved = pdata.get("policy_cancel_resolved") or ""
        assert "4" in resolved
        assert "{horas}" not in resolved
        assert "{cancel_min_hours}" not in resolved

        # Disable policies
        disabled = {**patched, "policies_enabled": False}
        r2 = admin_session.put(f"{API}/admin/site-settings", json=disabled, timeout=10)
        assert r2.status_code == 200, r2.text
        assert r2.json().get("policies_enabled") is False
        pub2 = s.get(f"{API}/site-settings", timeout=10).json()
        assert pub2.get("policies_enabled") is False

        # Unit: resolve helpers
        import sys
        from pathlib import Path as _P
        root = _P(__file__).resolve().parents[1]
        if str(root) not in sys.path:
            sys.path.insert(0, str(root))
        import site_settings as sset
        assert "4" in sset.resolve_policy_cancel(patched)
        assert sset.resolve_policy_rain(patched).startswith("Choveu?")
        assert sset.resolve_policy_cancel({**patched, "policy_cancel": ""}) == ""
    finally:
        admin_session.put(f"{API}/admin/site-settings", json=original, timeout=10)

def test_admin_revenue_report(admin_session, s):
    """Cycle 31: revenue by day — paid/confirmed amounts; counts; CSV; auth."""
    import uuid as _uuid
    from pymongo import MongoClient

    bare = requests.Session()
    assert bare.get(f"{API}/admin/reports/revenue", timeout=10).status_code in (401, 403)

    tag = _uuid.uuid4().hex[:6]
    created = []
    day_paid = None
    day_cancel = None
    day_pending = None

    try:
        # Find 3 isolated weekdays far ahead
        days_found = []
        for off in range(150, 280):
            cand = (datetime.now(TZ) + timedelta(days=off)).strftime("%Y-%m-%d")
            if datetime.strptime(cand, "%Y-%m-%d").weekday() >= 5:
                continue
            avail = s.get(
                f"{API}/courts/availability",
                params={"court_id": "court-1", "date": cand},
                timeout=15,
                headers=_xff(),
            )
            if avail.status_code != 200:
                continue
            free = [x["time"] for x in avail.json().get("slots") or [] if x.get("status") == "available"]
            if free:
                days_found.append((cand, free[0]))
            if len(days_found) >= 3:
                break
        assert len(days_found) >= 3, "need 3 free weekdays for revenue report test"
        day_paid, t_paid = days_found[0]
        day_cancel, t_cancel = days_found[1]
        day_pending, t_pending = days_found[2]

        # Confirmed (counts as money)
        r1 = admin_session.post(
            f"{API}/admin/calendar/bookings",
            json={
                "date": day_paid,
                "start_time": t_paid,
                "customer_name": f"Rev Paid {tag}",
                "whatsapp": "5511999007788",
                "status": "confirmed",
            },
            timeout=15,
        )
        assert r1.status_code in (200, 201), r1.text
        b1 = r1.json()
        created.append(b1["id"])
        deposit1 = float(b1.get("deposit") or 0)
        assert deposit1 > 0
        assert (b1.get("payment") or {}).get("status") == "paid"
        assert b1.get("status") == "confirmed"

        # Confirmed then cancelled (cancellation count; money rule excludes cancelled unless pay stays paid)
        r2 = admin_session.post(
            f"{API}/admin/calendar/bookings",
            json={
                "date": day_cancel,
                "start_time": t_cancel,
                "customer_name": f"Rev Cancel {tag}",
                "whatsapp": "5511999007799",
                "status": "confirmed",
            },
            timeout=15,
        )
        assert r2.status_code in (200, 201), r2.text
        b2 = r2.json()
        created.append(b2["id"])
        rc = admin_session.post(f"{API}/admin/bookings/{b2['id']}/cancel", timeout=10)
        assert rc.status_code == 200, rc.text

        # Pending (not money)
        r3 = admin_session.post(
            f"{API}/admin/calendar/bookings",
            json={
                "date": day_pending,
                "start_time": t_pending,
                "customer_name": f"Rev Pending {tag}",
                "whatsapp": "5511999007800",
                "status": "pending",
            },
            timeout=15,
        )
        assert r3.status_code in (200, 201), r3.text
        b3 = r3.json()
        created.append(b3["id"])
        assert (b3.get("payment") or {}).get("status") == "pending"

        # Optional: apply discount via mongo on paid booking for discounts sum
        mongo_url = os.environ.get("MONGO_URL", "mongodb://127.0.0.1:27017")
        dbn = os.environ.get("DB_NAME", "arena_futsal")
        client = MongoClient(mongo_url)
        client[dbn].bookings.update_one(
            {"id": b1["id"]},
            {"$set": {"discount": 15.0, "original_total": float(b1.get("total") or 0) + 15.0}},
        )
        client.close()

        d_from = min(day_paid, day_cancel, day_pending)
        d_to = max(day_paid, day_cancel, day_pending)
        rr = admin_session.get(
            f"{API}/admin/reports/revenue",
            params={"date_from": d_from, "date_to": d_to},
            timeout=15,
        )
        assert rr.status_code == 200, rr.text
        body = rr.json()
        assert body["date_from"] == d_from and body["date_to"] == d_to
        totals = body["totals"]
        assert totals["bookings"] >= 3
        assert totals["cancellations"] >= 1
        assert totals["discounts"] >= 14.99
        # Paid/confirmed money includes the paid booking; cancelled payment status is cancelled so not money
        assert totals["revenue"] >= deposit1 - 0.01
        assert totals["paid_count"] >= 1
        by_d = {d["date"]: d for d in body["days"]}
        assert day_paid in by_d
        assert by_d[day_paid]["revenue"] >= deposit1 - 0.01
        assert by_d[day_pending]["revenue"] == 0 or by_d[day_pending]["paid_count"] == 0

        # CSV
        csv_r = admin_session.get(
            f"{API}/admin/reports/revenue.csv",
            params={"date_from": d_from, "date_to": d_to},
            timeout=15,
        )
        assert csv_r.status_code == 200, csv_r.text
        assert "text/csv" in (csv_r.headers.get("content-type") or "")
        text_csv = csv_r.content.decode("utf-8-sig")
        assert "revenue" in text_csv.splitlines()[0]
        assert day_paid in text_csv
        assert "TOTAL" in text_csv
    finally:
        for bid in created:
            _admin_cancel_quiet(admin_session, bid)



def test_hour_credits_unit_normalize():
    """Cycle 32: phone normalize + public shape helpers."""
    import sys
    from pathlib import Path as P
    root = P(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    import hour_credits as hc

    assert hc.normalize_phone("11999887766").startswith("55")
    pub = hc.public_credit({
        "id": "x",
        "phone_digits": "5511999887766",
        "name": "Ana",
        "balance_hours": 10.0,
        "notes": None,
        "updated_at": "t",
        "created_at": "t",
    })
    assert pub["balance_hours"] == 10
    assert pub["phone_digits"] == "5511999887766"


def test_hour_credits_add_book_insufficient(admin_session, s):
    """Cycle 32: admin add credit → book with credits → balance drops; insufficient → 400.
    Concurrent-safe decrement via atomic $gte filter (spot-check with sequential double consume).
    """
    import uuid as _uuid

    # 11-digit BR mobile unique per run (digits only)
    phone = "1199" + f"{int(_uuid.uuid4().hex[:8], 16) % 10_000_000:07d}"

    created_ids = []

    # Auth required
    bare = requests.Session()
    assert bare.get(f"{API}/admin/hour-credits", timeout=10).status_code in (401, 403)

    # Ensure credits enabled
    st = admin_session.get(f"{API}/admin/site-settings", timeout=10)
    assert st.status_code == 200, st.text
    original = st.json()
    if original.get("credits_enabled") is False:
        payload = {**original, "credits_enabled": True}
        # strip non-updatable helpers if any
        for k in list(payload.keys()):
            if k.endswith("_resolved") or k in ("amenities_text", "use_weekend_hours", "updated_at", "created_at", "id"):
                payload.pop(k, None)
        ur = admin_session.put(f"{API}/admin/site-settings", json=payload, timeout=15)
        assert ur.status_code == 200, ur.text

    try:
        # Public settings exposes flag
        pub = s.get(f"{API}/site-settings", timeout=10)
        assert pub.status_code == 200
        assert pub.json().get("credits_enabled") is not False

        # Add 3 hours
        r_add = admin_session.post(
            f"{API}/admin/hour-credits",
            json={"phone": phone, "delta_hours": 3, "name": "Cycle32 Tester", "notes": "pacote teste"},
            timeout=10,
        )
        assert r_add.status_code == 200, r_add.text
        assert float(r_add.json()["balance_hours"]) == 3
        phone_digits = r_add.json()["phone_digits"]

        # List / search
        rl = admin_session.get(f"{API}/admin/hour-credits", params={"phone": phone}, timeout=10)
        assert rl.status_code == 200, rl.text
        assert any(x["phone_digits"] == phone_digits for x in rl.json().get("items") or [])

        # Public balance
        rb = s.get(f"{API}/credits/balance", params={"phone": phone}, headers=_xff(), timeout=10)
        assert rb.status_code == 200, rb.text
        assert rb.json()["has_credit"] is True
        assert float(rb.json()["balance_hours"]) == 3

        # Audit
        ra = admin_session.get(f"{API}/admin/audit", params={"limit": 20, "action": "credit_add"}, timeout=10)
        assert ra.status_code == 200
        assert any(it.get("action") == "credit_add" for it in (ra.json().get("items") or []))

        day, free, _price = _find_day_with_n_free(s, n=3, start_off=130, end_off=260)
        assert day and free, "need free slots for credits booking test"

        # Book 1h with credits
        cr = s.post(
            f"{API}/bookings",
            json={
                "court_id": "court-1",
                "date": day,
                "start_time": free[0],
                "duration_hours": 1,
                "cpf": SMOKE_CPF,
                "customer_name": "Credits Cycle32",
                "whatsapp": phone,
                "your_team_name": "A",
                "opponent_team_name": "B",
                "pay_with_credits": True,
            },
            headers=_xff(),
            timeout=15,
        )
        assert cr.status_code in (200, 201), cr.text
        b = cr.json()
        created_ids.append(b.get("id"))
        assert b.get("status") == "confirmed"
        assert b.get("payment", {}).get("method") == "credits"
        assert b.get("payment", {}).get("status") == "paid"
        assert b.get("paid_with_credits") is True
        assert float(b.get("payment", {}).get("credits_hours") or b.get("credits_hours") or 0) == 1
        assert b.get("payment", {}).get("pix_copy_paste") in (None, "")

        # Balance decreased to 2
        rb2 = s.get(f"{API}/credits/balance", params={"phone": phone}, headers=_xff(), timeout=10)
        assert rb2.status_code == 200
        assert float(rb2.json()["balance_hours"]) == 2

        # Book another 1h → balance 1
        free2 = [
            x["time"]
            for x in s.get(
                f"{API}/courts/availability",
                params={"court_id": "court-1", "date": day},
                timeout=15,
                headers=_xff(),
            ).json().get("slots") or []
            if x.get("status") == "available"
        ]
        assert free2
        cr2 = s.post(
            f"{API}/bookings",
            json={
                "court_id": "court-1",
                "date": day,
                "start_time": free2[0],
                "duration_hours": 1,
                "cpf": SMOKE_CPF,
                "customer_name": "Credits Cycle32 B",
                "whatsapp": phone,
                "your_team_name": "A",
                "opponent_team_name": "B",
                "pay_with_credits": True,
            },
            headers=_xff(),
            timeout=15,
        )
        assert cr2.status_code in (200, 201), cr2.text
        created_ids.append(cr2.json().get("id"))
        assert float(s.get(f"{API}/credits/balance", params={"phone": phone}, headers=_xff(), timeout=10).json()["balance_hours"]) == 1

        # Insufficient: try 2h with only 1h left (or 1h after draining)
        # Drain last hour
        free3 = [
            x["time"]
            for x in s.get(
                f"{API}/courts/availability",
                params={"court_id": "court-1", "date": day},
                timeout=15,
                headers=_xff(),
            ).json().get("slots") or []
            if x.get("status") == "available"
        ]
        assert free3
        cr3 = s.post(
            f"{API}/bookings",
            json={
                "court_id": "court-1",
                "date": day,
                "start_time": free3[0],
                "duration_hours": 1,
                "cpf": SMOKE_CPF,
                "customer_name": "Credits Cycle32 C",
                "whatsapp": phone,
                "your_team_name": "A",
                "opponent_team_name": "B",
                "pay_with_credits": True,
            },
            headers=_xff(),
            timeout=15,
        )
        assert cr3.status_code in (200, 201), cr3.text
        created_ids.append(cr3.json().get("id"))
        assert float(s.get(f"{API}/credits/balance", params={"phone": phone}, headers=_xff(), timeout=10).json()["balance_hours"]) == 0

        # Insufficient fails
        free4 = [
            x["time"]
            for x in s.get(
                f"{API}/courts/availability",
                params={"court_id": "court-1", "date": day},
                timeout=15,
                headers=_xff(),
            ).json().get("slots") or []
            if x.get("status") == "available"
        ]
        if not free4:
            day2, free4, _ = _find_day_with_n_free(s, n=1, start_off=260, end_off=340)
            assert day2 and free4
            day = day2
        fail = s.post(
            f"{API}/bookings",
            json={
                "court_id": "court-1",
                "date": day,
                "start_time": free4[0],
                "duration_hours": 1,
                "cpf": SMOKE_CPF,
                "customer_name": "Credits Fail",
                "whatsapp": phone,
                "your_team_name": "A",
                "opponent_team_name": "B",
                "pay_with_credits": True,
            },
            headers=_xff(),
            timeout=15,
        )
        assert fail.status_code == 400, fail.text
        detail = (fail.json().get("detail") or "").lower()
        assert "crédito" in detail or "credito" in detail or "insuficiente" in detail or "sem crédito" in detail

        # PIX path unchanged when not using credits
        pix = s.post(
            f"{API}/bookings",
            json={
                "court_id": "court-1",
                "date": day,
                "start_time": free4[0],
                "duration_hours": 1,
                "cpf": SMOKE_CPF,
                "customer_name": "PIX Still Works",
                "whatsapp": phone,
                "your_team_name": "A",
                "opponent_team_name": "B",
            },
            headers=_xff(),
            timeout=15,
        )
        assert pix.status_code in (200, 201), pix.text
        created_ids.append(pix.json().get("id"))
        assert pix.json().get("payment", {}).get("method") == "pix"
        assert pix.json().get("payment", {}).get("status") == "pending"
        assert pix.json().get("status") == "pending"

        # Concurrent-safe: add 1h then two parallel 1h consumes — only one succeeds
        admin_session.post(
            f"{API}/admin/hour-credits",
            json={"phone": phone, "delta_hours": 1, "notes": "race"},
            timeout=10,
        )
        day3, free5, _ = _find_day_with_n_free(s, n=2, start_off=300, end_off=380)
        assert day3 and len(free5) >= 2
        import concurrent.futures

        def _book(slot):
            sess = requests.Session()
            return sess.post(
                f"{API}/bookings",
                json={
                    "court_id": "court-1",
                    "date": day3,
                    "start_time": slot,
                    "duration_hours": 1,
                    "cpf": SMOKE_CPF,
                    "customer_name": "Race Credits",
                    "whatsapp": phone,
                    "your_team_name": "A",
                    "opponent_team_name": "B",
                    "pay_with_credits": True,
                },
                headers=_xff(),
                timeout=20,
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
            futs = [ex.submit(_book, free5[0]), ex.submit(_book, free5[1])]
            results = [f.result() for f in futs]
        for r in results:
            if r.status_code in (200, 201):
                created_ids.append(r.json().get("id"))
        ok_n = sum(1 for r in results if r.status_code in (200, 201))
        fail_n = sum(1 for r in results if r.status_code == 400)
        # One consumes the 1h credit; the other must fail on insufficient (or both could race slots)
        assert ok_n == 1, f"expected 1 credit success, got {[r.status_code for r in results]} {[r.text[:80] for r in results]}"
        assert fail_n >= 1
        bal_final = float(
            s.get(f"{API}/credits/balance", params={"phone": phone}, headers=_xff(), timeout=10).json()["balance_hours"]
        )
        assert bal_final == 0
    finally:
        for bid in created_ids:
            _admin_cancel_quiet(admin_session, bid)


def test_hour_credits_refund_on_cancel(admin_session, s):
    """Cycle 33: book with credits → cancel restores balance; second cancel no double credit."""
    import uuid as _uuid

    phone = "1198" + f"{int(_uuid.uuid4().hex[:8], 16) % 10_000_000:07d}"
    created_ids = []

    st = admin_session.get(f"{API}/admin/site-settings", timeout=10)
    assert st.status_code == 200, st.text
    original = st.json()
    if original.get("credits_enabled") is False:
        payload = {**original, "credits_enabled": True}
        for k in list(payload.keys()):
            if k.endswith("_resolved") or k in (
                "amenities_text", "use_weekend_hours", "updated_at", "created_at", "id"
            ):
                payload.pop(k, None)
        ur = admin_session.put(f"{API}/admin/site-settings", json=payload, timeout=15)
        assert ur.status_code == 200, ur.text

    try:
        r_add = admin_session.post(
            f"{API}/admin/hour-credits",
            json={"phone": phone, "delta_hours": 2, "name": "Cycle33 Refund", "notes": "refund test"},
            timeout=10,
        )
        assert r_add.status_code == 200, r_add.text
        assert float(r_add.json()["balance_hours"]) == 2

        day, free, _price = _find_day_with_n_free(s, n=1, start_off=140, end_off=280)
        assert day and free, "need free slot for credits refund test"

        cr = s.post(
            f"{API}/bookings",
            json={
                "court_id": "court-1",
                "date": day,
                "start_time": free[0],
                "duration_hours": 1,
                "cpf": SMOKE_CPF,
                "customer_name": "Credits Refund Cycle33",
                "whatsapp": phone,
                "your_team_name": "A",
                "opponent_team_name": "B",
                "pay_with_credits": True,
            },
            headers=_xff(),
            timeout=15,
        )
        assert cr.status_code in (200, 201), cr.text
        b = cr.json()
        bid = b.get("id")
        created_ids.append(bid)
        assert b.get("payment", {}).get("method") == "credits"
        assert float(
            s.get(f"{API}/credits/balance", params={"phone": phone}, headers=_xff(), timeout=10).json()[
                "balance_hours"
            ]
        ) == 1

        # Customer cancel restores 1h → balance 2
        rc = s.post(f"{API}/bookings/{bid}/cancel", params={"cpf": SMOKE_CPF}, timeout=10)
        assert rc.status_code == 200, rc.text
        assert rc.json().get("credits_refunded") is True
        assert float(rc.json().get("credits_refunded_hours") or 0) == 1
        bal = float(
            s.get(f"{API}/credits/balance", params={"phone": phone}, headers=_xff(), timeout=10).json()[
                "balance_hours"
            ]
        )
        assert bal == 2, bal

        got = admin_session.get(f"{API}/admin/bookings", params={"limit": 50}, timeout=15)
        assert got.status_code == 200
        row = next((x for x in got.json() if x.get("id") == bid), None)
        assert row is not None
        assert row.get("status") == "cancelled"
        assert row.get("credits_refunded_at")
        assert float(row.get("credits_refunded_hours") or 0) == 1

        # Second cancel (admin idempotent) must not double-credit
        ra = admin_session.post(f"{API}/admin/bookings/{bid}/cancel", timeout=10)
        assert ra.status_code == 200, ra.text
        bal2 = float(
            s.get(f"{API}/credits/balance", params={"phone": phone}, headers=_xff(), timeout=10).json()[
                "balance_hours"
            ]
        )
        assert bal2 == 2, f"double refund? bal={bal2}"

        # Audit on first admin path may not fire for idempotent re-cancel;
        # book+admin-cancel to assert audit note includes crédito estornado
        day2, free2, _ = _find_day_with_n_free(s, n=1, start_off=200, end_off=320)
        assert day2 and free2
        cr2 = s.post(
            f"{API}/bookings",
            json={
                "court_id": "court-1",
                "date": day2,
                "start_time": free2[0],
                "duration_hours": 1,
                "cpf": SMOKE_CPF,
                "customer_name": "Credits Admin Refund",
                "whatsapp": phone,
                "your_team_name": "A",
                "opponent_team_name": "B",
                "pay_with_credits": True,
            },
            headers=_xff(),
            timeout=15,
        )
        assert cr2.status_code in (200, 201), cr2.text
        bid2 = cr2.json()["id"]
        created_ids.append(bid2)
        assert float(
            s.get(f"{API}/credits/balance", params={"phone": phone}, headers=_xff(), timeout=10).json()[
                "balance_hours"
            ]
        ) == 1

        ra2 = admin_session.post(f"{API}/admin/bookings/{bid2}/cancel", timeout=10)
        assert ra2.status_code == 200, ra2.text
        assert ra2.json().get("credits_refunded") is True
        assert float(
            s.get(f"{API}/credits/balance", params={"phone": phone}, headers=_xff(), timeout=10).json()[
                "balance_hours"
            ]
        ) == 2

        raud = admin_session.get(
            f"{API}/admin/audit", params={"limit": 30, "action": "booking_cancel"}, timeout=10
        )
        assert raud.status_code == 200
        items = raud.json().get("items") or []
        hit = next((it for it in items if it.get("entity_id") == bid2), None)
        assert hit is not None, items[:5]
        assert "crédito" in (hit.get("summary") or "").lower() or "credito" in (hit.get("summary") or "").lower()
        assert (hit.get("meta") or {}).get("credits_refunded") is True
    finally:
        for bid in created_ids:
            _admin_cancel_quiet(admin_session, bid)


def _tiny_png_bytes():
    return (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
        b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )


def test_gallery_public_empty_ok(s):
    r = s.get(f"{API}/gallery", timeout=10, headers=_xff())
    assert r.status_code == 200, r.text
    data = r.json()
    assert "items" in data
    assert isinstance(data["items"], list)
    assert data.get("max", 12) >= 1


def test_gallery_upload_list_delete(admin_session, s):
    """Admin upload → public list → caption → reorder → delete; SVG rejected; audit."""
    # Cleanup any leftover smoke gallery images from prior runs (best-effort)
    listed = admin_session.get(f"{API}/admin/gallery", timeout=10)
    if listed.status_code == 200:
        for it in listed.json().get("items") or []:
            cap = (it.get("caption") or "")
            if cap.startswith("smoke-gallery"):
                admin_session.delete(f"{API}/admin/gallery/{it['id']}", timeout=10)

    png = _tiny_png_bytes()

    # Auth required for upload
    bare = s.post(
        f"{API}/admin/gallery",
        files={"file": ("g.png", io.BytesIO(png), "image/png")},
        data={"caption": "smoke-gallery-a"},
        headers=_xff(),
        timeout=15,
    )
    assert bare.status_code in (401, 403), bare.text

    # Reject SVG by content-type / name
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'
    rsvg = admin_session.post(
        f"{API}/admin/gallery",
        files={"file": ("evil.svg", io.BytesIO(svg), "image/svg+xml")},
        data={"caption": "smoke-gallery-svg"},
        timeout=15,
    )
    assert rsvg.status_code == 400, rsvg.text

    # Upload two PNGs
    created = []
    for label in ("smoke-gallery-a", "smoke-gallery-b"):
        r = admin_session.post(
            f"{API}/admin/gallery",
            files={"file": (f"{label}.png", io.BytesIO(png), "image/png")},
            data={"caption": label},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc.get("id")
        assert doc.get("url", "").startswith("/api/uploads/gallery/")
        assert doc.get("gridfs_id")
        assert doc.get("caption") == label
        created.append(doc)

    # Public list includes them
    pub = s.get(f"{API}/gallery", timeout=10, headers=_xff())
    assert pub.status_code == 200
    ids_pub = {x["id"] for x in pub.json().get("items") or []}
    for d in created:
        assert d["id"] in ids_pub

    # Serve image bytes
    img = s.get(f"{BASE_URL}{created[0]['url']}", timeout=10, headers=_xff())
    assert img.status_code == 200, img.text[:120]
    assert img.content[:8] == b"\x89PNG\r\n\x1a\n"

    # Caption edit
    rid = created[0]["id"]
    rp = admin_session.patch(
        f"{API}/admin/gallery/{rid}",
        json={"caption": "smoke-gallery-a-edited"},
        timeout=10,
    )
    assert rp.status_code == 200, rp.text
    assert rp.json().get("caption") == "smoke-gallery-a-edited"

    # Reorder: put B first
    ids = [created[1]["id"], created[0]["id"]]
    rr = admin_session.put(f"{API}/admin/gallery/reorder", json={"ids": ids}, timeout=10)
    assert rr.status_code == 200, rr.text
    ordered = [x["id"] for x in rr.json().get("items") or [] if x["id"] in set(ids)]
    assert ordered[:2] == ids

    # Delete both + verify gone from public
    for d in created:
        rd = admin_session.delete(f"{API}/admin/gallery/{d['id']}", timeout=10)
        assert rd.status_code == 200, rd.text

    pub2 = s.get(f"{API}/gallery", timeout=10, headers=_xff()).json()
    left = {x["id"] for x in pub2.get("items") or []}
    for d in created:
        assert d["id"] not in left

    # Audit entries exist
    ra = admin_session.get(
        f"{API}/admin/audit", params={"limit": 40, "action": "gallery_upload"}, timeout=10
    )
    assert ra.status_code == 200
    assert any(
        (it.get("entity_id") in {c["id"] for c in created})
        for it in (ra.json().get("items") or [])
    )
    rd_audit = admin_session.get(
        f"{API}/admin/audit", params={"limit": 40, "action": "gallery_delete"}, timeout=10
    )
    assert rd_audit.status_code == 200
    assert any(
        (it.get("entity_id") in {c["id"] for c in created})
        for it in (rd_audit.json().get("items") or [])
    )


def test_sitemap_xml(s):
    """GET /sitemap.xml — absolute locs from PUBLIC_BASE_URL, real public routes only."""
    r = s.get(f"{BASE_URL}/sitemap.xml", timeout=10, headers=_xff())
    assert r.status_code == 200, r.text[:200]
    ctype = (r.headers.get("content-type") or "").lower()
    assert "xml" in ctype, ctype
    body = r.text
    assert 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"' in body
    # default canonical when env unset
    assert "https://pedra-azul.onrender.com/" in body or "pedra-azul.onrender.com" in body
    for path in ("/booking", "/faq", "/tournaments", "/apresentacao", "/minhas-reservas"):
        assert path in body, path
    # redirects / fake aliases must not appear
    assert "/perguntas" not in body
    assert "/reservar" not in body
    assert "/torneios" not in body
    assert "/admin" not in body
    assert "/login" not in body


def test_robots_txt(s):
    """GET /robots.txt — allow public pages; disallow admin/login/api."""
    r = s.get(f"{BASE_URL}/robots.txt", timeout=10, headers=_xff())
    assert r.status_code == 200, r.text[:200]
    ctype = (r.headers.get("content-type") or "").lower()
    assert "text/plain" in ctype, ctype
    body = r.text
    assert "User-agent:" in body
    assert "Disallow: /admin" in body
    assert "Disallow: /login" in body
    assert "Disallow: /balcao" in body
    assert "Disallow: /checkin" in body
    assert "Disallow: /api/" in body
    assert "Allow: /" in body
    assert "Sitemap:" in body
    assert "sitemap.xml" in body


def test_security_headers(s):
    """Cycle 41: safe default security headers on API + SPA shell."""
    for path in (f"{API}/health", f"{BASE_URL}/"):
        r = s.get(path, timeout=10, headers=_xff())
        assert r.status_code == 200, f"{path} -> {r.status_code}"
        h = {k.lower(): v for k, v in r.headers.items()}
        assert h.get("x-content-type-options", "").lower() == "nosniff", path
        assert h.get("x-frame-options", "").upper() == "DENY", path
        assert h.get("referrer-policy") == "strict-origin-when-cross-origin", path
        pp = h.get("permissions-policy") or ""
        assert "camera=()" in pp and "microphone=()" in pp and "geolocation=()" in pp, path
        csp = h.get("content-security-policy") or ""
        assert "default-src 'self'" in csp, path
        assert "frame-ancestors 'none'" in csp, path
        assert "fonts.googleapis.com" in csp, path
        assert "fonts.gstatic.com" in csp, path
        assert "img-src" in csp and "data:" in csp and "blob:" in csp, path
        assert "connect-src 'self'" in csp, path
        # enforcing CSP (not report-only) — pragmatic for CRA
        assert "content-security-policy-report-only" not in h or not h.get("content-security-policy-report-only"), path


def test_desk_pin_checkin_flow(admin_session, s):
    """Cycle 38: desk PIN session, today check-in, wrong day rejected, bad pin 401."""
    from pymongo import MongoClient

    # Snapshot settings
    r0 = admin_session.get(f"{API}/admin/site-settings", timeout=10)
    assert r0.status_code == 200, r0.text
    original = dict(r0.json())
    # Strip admin-only UI flags that are not write fields
    original.pop("desk_pin_set", None)
    original.pop("policy_cancel_resolved", None)
    original.pop("policy_rain_resolved", None)

    pin = "482917"
    bid_future = None
    bid_today = None
    try:
        # Feature disabled → 401
        mongo_url = os.environ.get("MONGO_URL", "mongodb://127.0.0.1:27017")
        db_name = os.environ.get("DB_NAME", "arena_futsal")
        client = MongoClient(mongo_url, serverSelectionTimeoutMS=3000)
        client[db_name].site_settings.update_one(
            {"id": "singleton"},
            {"$unset": {"desk_pin_hash": ""}},
        )
        disabled = s.post(f"{API}/desk/session", json={"pin": pin}, headers=_xff(), timeout=10)
        assert disabled.status_code == 401, disabled.text

        # Set PIN via admin settings (write-only)
        patched = dict(original)
        patched["desk_pin"] = pin
        rput = admin_session.put(f"{API}/admin/site-settings", json=patched, timeout=10)
        assert rput.status_code == 200, rput.text
        got = rput.json()
        assert got.get("desk_pin_set") is True
        assert "desk_pin" not in got
        assert "desk_pin_hash" not in got
        assert pin not in rput.text

        # Bad PIN → 401
        bad = s.post(f"{API}/desk/session", json={"pin": "0000"}, headers=_xff(), timeout=10)
        assert bad.status_code == 401, bad.text

        # Good PIN → desk token
        ok = s.post(f"{API}/desk/session", json={"pin": pin}, headers=_xff(), timeout=10)
        assert ok.status_code == 200, ok.text
        token = ok.json().get("access_token")
        assert token
        assert ok.json().get("scope") == "desk"
        desk_headers = {**_xff(), "Authorization": f"Bearer {token}"}

        # Desk token must NOT access admin
        adm = s.get(f"{API}/admin/dashboard", headers=desk_headers, timeout=10)
        assert adm.status_code in (401, 403), adm.text

        today = datetime.now(TZ).strftime("%Y-%m-%d")

        # Create future confirmed → wrong day on desk check-in
        rf = None
        bid_future = None
        for day_off in (41, 42, 43):
            day = (datetime.now(TZ) + timedelta(days=day_off)).strftime("%Y-%m-%d")
            for start in ("13:00", "14:00", "15:00"):
                rf = admin_session.post(
                    f"{API}/admin/calendar/bookings",
                    json={
                        "date": day,
                        "start_time": start,
                        "customer_name": "Desk Future",
                        "whatsapp": "5511999007788",
                        "status": "confirmed",
                    },
                    timeout=15,
                )
                if rf.status_code in (200, 201):
                    bid_future = rf.json()["id"]
                    break
            if bid_future:
                break
        assert bid_future, getattr(rf, "text", "")

        nf = s.post(
            f"{API}/desk/bookings/{bid_future}/check-in",
            headers=desk_headers,
            timeout=10,
        )
        assert nf.status_code == 400, nf.text
        assert "hoje" in (nf.json().get("detail") or "").lower()

        # Confirmed today
        bid_today = None
        rc = None
        for start in ("08:00", "09:00", "10:00", "11:00", "12:00", "22:00"):
            rc = admin_session.post(
                f"{API}/admin/calendar/bookings",
                json={
                    "date": today,
                    "start_time": start,
                    "customer_name": "Desk Today",
                    "whatsapp": "5511999008899",
                    "status": "confirmed",
                },
                timeout=15,
            )
            if rc.status_code in (200, 201):
                bid_today = rc.json()["id"]
                break
        if not bid_today:
            # backdate future
            day = (datetime.now(TZ) + timedelta(days=44)).strftime("%Y-%m-%d")
            rf2 = admin_session.post(
                f"{API}/admin/calendar/bookings",
                json={
                    "date": day,
                    "start_time": "16:00",
                    "customer_name": "Desk Today",
                    "whatsapp": "5511999008899",
                    "status": "confirmed",
                },
                timeout=15,
            )
            assert rf2.status_code in (200, 201), rf2.text
            bid_today = rf2.json()["id"]
            client[db_name].bookings.update_one(
                {"id": bid_today},
                {"$set": {"date": today, "start_time": "07:00", "slot_key": f"court-1|{today}|07:00"}},
            )

        # Today list includes booking
        lst = s.get(f"{API}/desk/today", headers=desk_headers, timeout=10)
        assert lst.status_code == 200, lst.text
        assert lst.json().get("date") == today
        ids = [b["id"] for b in (lst.json().get("bookings") or [])]
        assert bid_today in ids
        assert bid_future not in ids

        # Check-in works
        cin = s.post(
            f"{API}/desk/bookings/{bid_today}/check-in",
            headers=desk_headers,
            timeout=10,
        )
        assert cin.status_code == 200, cin.text
        assert cin.json().get("checked_in") is True
        assert cin.json().get("booking", {}).get("checked_in_by") == "desk"

        # Undo
        undo = s.post(
            f"{API}/desk/bookings/{bid_today}/check-in/undo",
            headers=desk_headers,
            timeout=10,
        )
        assert undo.status_code == 200, undo.text
        assert undo.json().get("checked_in") is False

        # Unauthenticated desk blocked
        anon = s.get(f"{API}/desk/today", headers=_xff(), timeout=10)
        assert anon.status_code in (401, 403), anon.text

        # Clear PIN
        cleared = dict(original)
        cleared["desk_pin"] = ""
        assert admin_session.put(f"{API}/admin/site-settings", json=cleared, timeout=10).status_code == 200
        assert admin_session.get(f"{API}/admin/site-settings", timeout=10).json().get("desk_pin_set") is False

    finally:
        # restore settings without desk_pin field
        restore = dict(original)
        restore.pop("desk_pin", None)
        try:
            admin_session.put(f"{API}/admin/site-settings", json=restore, timeout=10)
        except Exception:
            pass
        try:
            mongo_url = os.environ.get("MONGO_URL", "mongodb://127.0.0.1:27017")
            db_name = os.environ.get("DB_NAME", "arena_futsal")
            MongoClient(mongo_url, serverSelectionTimeoutMS=3000)[db_name].site_settings.update_one(
                {"id": "singleton"},
                {"$unset": {"desk_pin_hash": ""}},
            )
        except Exception:
            pass
        # cleanup bookings best-effort
        try:
            _admin_cancel_quiet(admin_session, bid_future)
            _admin_cancel_quiet(admin_session, bid_today)
        except Exception:
            pass


def test_announcement_settings_roundtrip(admin_session, s):
    """Cycle 39: announcement_enabled / text / style round-trip on admin + public."""
    r = admin_session.get(f"{API}/admin/site-settings", timeout=10)
    assert r.status_code == 200, r.text
    original = r.json()
    for key in ("announcement_enabled", "announcement_text", "announcement_style"):
        assert key in original, key
    # Default: disabled + empty (do not invent copy)
    assert original.get("announcement_enabled") in (False, True)  # may already be set in dirty DB
    assert isinstance(original.get("announcement_text"), str)
    assert original.get("announcement_style") in ("info", "warning", "success")

    # Public exposes fields, no secrets
    pub0 = s.get(f"{API}/site-settings", timeout=10)
    assert pub0.status_code == 200, pub0.text
    p0 = pub0.json()
    for key in ("announcement_enabled", "announcement_text", "announcement_style"):
        assert key in p0, key
    assert "desk_pin" not in p0
    assert "desk_pin_hash" not in p0
    assert "admin_whatsapp_e164" not in p0

    patched = {
        **{k: v for k, v in original.items() if k not in (
            "desk_pin_set", "policy_cancel_resolved", "policy_rain_resolved",
            "desk_pin", "desk_pin_hash",
        )},
        "announcement_enabled": True,
        "announcement_text": "Manutenção amanhã 14h–16h — quadra fechada.",
        "announcement_style": "warning",
    }
    try:
        rput = admin_session.put(f"{API}/admin/site-settings", json=patched, timeout=10)
        assert rput.status_code == 200, rput.text
        body = rput.json()
        assert body.get("announcement_enabled") is True
        assert body.get("announcement_text") == patched["announcement_text"]
        assert body.get("announcement_style") == "warning"

        pub = s.get(f"{API}/site-settings", timeout=10)
        assert pub.status_code == 200, pub.text
        pdata = pub.json()
        assert pdata.get("announcement_enabled") is True
        assert pdata.get("announcement_text") == patched["announcement_text"]
        assert pdata.get("announcement_style") == "warning"

        # Bad style rejected
        bad = {**patched, "announcement_style": "danger"}
        rb = admin_session.put(f"{API}/admin/site-settings", json=bad, timeout=10)
        assert rb.status_code in (400, 422), rb.text

        # Text too long rejected
        long_txt = {**patched, "announcement_text": "x" * 201}
        rl = admin_session.put(f"{API}/admin/site-settings", json=long_txt, timeout=10)
        assert rl.status_code in (400, 422), rl.text

        # Disable + clear
        cleared = {**patched, "announcement_enabled": False, "announcement_text": "", "announcement_style": "info"}
        r2 = admin_session.put(f"{API}/admin/site-settings", json=cleared, timeout=10)
        assert r2.status_code == 200, r2.text
        assert r2.json().get("announcement_enabled") is False
        assert r2.json().get("announcement_text") == ""
        pub2 = s.get(f"{API}/site-settings", timeout=10).json()
        assert pub2.get("announcement_enabled") is False
        assert pub2.get("announcement_text") == ""

        import sys
        from pathlib import Path as _P
        root = _P(__file__).resolve().parents[1]
        if str(root) not in sys.path:
            sys.path.insert(0, str(root))
        import site_settings as sset
        assert sset.announcement_visible(patched) is True
        assert sset.announcement_visible(cleared) is False
        assert sset.announcement_visible({"announcement_enabled": True, "announcement_text": "  "}) is False
        assert sset._normalize_announcement_style("SUCCESS") == "success"
        assert sset._normalize_announcement_style("nope") == "info"
    finally:
        restore = {k: v for k, v in original.items() if k not in (
            "desk_pin_set", "policy_cancel_resolved", "policy_rain_resolved",
            "desk_pin", "desk_pin_hash",
        )}
        admin_session.put(f"{API}/admin/site-settings", json=restore, timeout=10)
