"""Cycle 4 smoke / regression tests — hit local or BASE_URL API.

Run:
  BASE_URL=http://127.0.0.1:8000 python -m pytest backend/tests/test_smoke.py -q
Or from repo root with API up:
  ./scripts/smoke_test.sh
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
import requests

BASE_URL = (os.environ.get("BASE_URL") or os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = f"{BASE_URL}/api"
TZ = ZoneInfo("America/Sao_Paulo")

# Valid CPF for create tests
SMOKE_CPF = "52998224725"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


def test_health_safe(s):
    r = s.get(f"{API}/health", timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "ok" in data
    assert "db" in data
    assert "whatsapp" in data
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
    r = s.get(f"{API}/admin/dashboard", timeout=10)
    assert r.status_code in (401, 403), r.text
    r2 = s.get(f"{API}/admin/metrics", timeout=10)
    assert r2.status_code in (401, 403), r2.text


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
    r1 = s.post(f"{API}/bookings", json=payload, timeout=15)
    assert r1.status_code in (200, 201, 409), r1.text
    if r1.status_code == 409:
        # slot already taken — conflict path exists
        return
    booking = r1.json()
    r2 = s.post(f"{API}/bookings", json=payload, timeout=15)
    assert r2.status_code == 409, r2.text
    # cleanup
    bid = booking.get("id")
    if bid:
        s.post(f"{API}/bookings/{bid}/cancel", params={"cpf": SMOKE_CPF}, timeout=10)
