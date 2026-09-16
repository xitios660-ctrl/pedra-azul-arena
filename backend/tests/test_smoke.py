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
    for day_off in (14, 15, 16, 17):
        day = (datetime.now(TZ) + timedelta(days=day_off)).strftime("%Y-%m-%d")
        for start in ("18:00", "19:00", "20:00", "21:00", "22:00"):
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
