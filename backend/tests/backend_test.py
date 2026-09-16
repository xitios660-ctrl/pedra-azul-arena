"""Backend integration tests for Arena Futsal Premium MVP."""
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or "https://inspiring-lehmann-9.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@arena.com"
ADMIN_PASSWORD = "Arena@2026"
DEMO_EMAIL = "jogador@arena.com"
DEMO_PASSWORD = "Jogador@2026"


# -------------------------- Fixtures --------------------------
@pytest.fixture(scope="session")
def s():
    return requests.Session()


@pytest.fixture(scope="session")
def admin_token(s):
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def user_credentials():
    """Create a fresh user for tests."""
    sess = requests.Session()
    email = f"TEST_{uuid.uuid4().hex[:8]}@arena.com"
    r = sess.post(f"{API}/auth/register", json={
        "name": "Test User", "email": email, "password": "Test@1234"
    })
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    return {"email": email, "password": "Test@1234", "access_token": r.json()["access_token"], "user": r.json()["user"]}


@pytest.fixture(scope="session")
def user_token(user_credentials):
    return user_credentials["access_token"]


def H(token):
    return {"Authorization": f"Bearer {token}"}


# -------------------------- Auth --------------------------
class TestAuth:
    def test_admin_login(self, s):
        r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200
        data = r.json()
        assert "access_token" in data
        assert data["user"]["role"] == "admin"
        assert data["user"]["email"] == ADMIN_EMAIL

    def test_demo_user_login(self, s):
        r = s.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "user"

    def test_invalid_login(self, s):
        r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"})
        assert r.status_code == 401

    def test_register_and_me(self, s):
        email = f"TEST_{uuid.uuid4().hex[:8]}@arena.com"
        r = s.post(f"{API}/auth/register", json={"name": "Jo Tester", "email": email, "password": "Test@1234"})
        assert r.status_code == 200
        token = r.json()["access_token"]
        me = s.get(f"{API}/auth/me", headers=H(token))
        assert me.status_code == 200
        assert me.json()["email"] == email.lower()
        assert me.json()["role"] == "user"

    def test_register_duplicate(self, s):
        email = f"TEST_{uuid.uuid4().hex[:8]}@arena.com"
        r1 = s.post(f"{API}/auth/register", json={"name": "Dup", "email": email, "password": "Test@1234"})
        assert r1.status_code == 200
        r2 = s.post(f"{API}/auth/register", json={"name": "Dup", "email": email, "password": "Test@1234"})
        assert r2.status_code == 400

    def test_me_without_token(self, s):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_logout(self, s, admin_token):
        r = s.post(f"{API}/auth/logout", headers=H(admin_token))
        assert r.status_code == 200
        assert r.json().get("ok") is True


# -------------------------- Courts & Availability --------------------------
class TestCourts:
    def test_list_courts(self, s):
        r = s.get(f"{API}/courts")
        assert r.status_code == 200
        courts = r.json()
        assert isinstance(courts, list)
        assert len(courts) == 3
        ids = {c["id"] for c in courts}
        assert ids == {"court-1", "court-2", "court-3"}

    def test_availability(self, s):
        date = "2030-01-01"  # future date, unlikely to be booked
        r = s.get(f"{API}/courts/availability", params={"court_id": "court-1", "date": date})
        assert r.status_code == 200
        data = r.json()
        assert len(data["slots"]) == 16
        assert all(slot["status"] == "free" for slot in data["slots"])

    def test_availability_invalid_court(self, s):
        r = s.get(f"{API}/courts/availability", params={"court_id": "court-x", "date": "2030-01-01"})
        assert r.status_code == 404


# -------------------------- Bookings --------------------------
@pytest.fixture(scope="class")
def booking_ctx(user_token):
    """Create a unique booking slot for booking tests."""
    sess = requests.Session()
    date = "2030-05-15"
    payload = {
        "court_id": "court-1",
        "date": date,
        "start_time": "10:00",
        "duration_minutes": 60,
        "your_team_name": "Test Team",
        "opponent_team_name": "Foe Team",
    }
    r = sess.post(f"{API}/bookings", json=payload, headers=H(user_token))
    assert r.status_code == 200, f"booking create failed: {r.status_code} {r.text}"
    return {"booking": r.json(), "session": sess}


class TestBookings:
    def test_create_requires_auth(self, s):
        r = s.post(f"{API}/bookings", json={
            "court_id": "court-1", "date": "2030-06-01", "start_time": "09:00",
            "your_team_name": "A", "opponent_team_name": "B",
        })
        assert r.status_code == 401

    def test_create_booking_pix_object(self, booking_ctx):
        b = booking_ctx["booking"]
        assert b["status"] == "pending"
        assert b["payment"]["status"] == "pending"
        assert b["payment"]["method"] == "pix"
        assert "qr_code" in b["payment"]
        assert b["payment"]["amount"] == round(180 * 0.30, 2)

    def test_duplicate_slot_conflict(self, user_token, booking_ctx):
        b = booking_ctx["booking"]
        r = requests.post(f"{API}/bookings", headers=H(user_token), json={
            "court_id": b["court_id"], "date": b["date"], "start_time": b["start_time"],
            "your_team_name": "X", "opponent_team_name": "Y",
        })
        assert r.status_code == 409

    def test_my_bookings_lists(self, user_token, booking_ctx):
        r = requests.get(f"{API}/bookings/me", headers=H(user_token))
        assert r.status_code == 200
        items = r.json()
        assert any(it["id"] == booking_ctx["booking"]["id"] for it in items)

    def test_availability_marks_occupied(self, s, booking_ctx):
        b = booking_ctx["booking"]
        r = s.get(f"{API}/courts/availability", params={"court_id": b["court_id"], "date": b["date"]})
        slots = {sl["time"]: sl for sl in r.json()["slots"]}
        assert slots[b["start_time"]]["status"] == "occupied"

    def test_simulate_payment_confirms(self, user_token, booking_ctx):
        b = booking_ctx["booking"]
        r = requests.post(f"{API}/payments/{b['id']}/simulate", headers=H(user_token))
        assert r.status_code == 200
        updated = r.json()
        assert updated["status"] == "confirmed"
        assert updated["payment"]["status"] == "paid"

    def test_cancel_booking(self, user_token):
        # Create a fresh one to cancel
        r = requests.post(f"{API}/bookings", headers=H(user_token), json={
            "court_id": "court-2", "date": "2030-07-10", "start_time": "11:00",
            "your_team_name": "Cancel A", "opponent_team_name": "Cancel B",
        })
        assert r.status_code == 200
        bid = r.json()["id"]
        c = requests.post(f"{API}/bookings/{bid}/cancel", headers=H(user_token))
        assert c.status_code == 200
        # slot becomes free again
        avail = requests.get(f"{API}/courts/availability", params={"court_id": "court-2", "date": "2030-07-10"}).json()
        slots = {sl["time"]: sl for sl in avail["slots"]}
        assert slots["11:00"]["status"] == "free"


# -------------------------- Tournaments --------------------------
class TestTournaments:
    def test_list_two(self, s):
        r = s.get(f"{API}/tournaments")
        assert r.status_code == 200
        items = r.json()
        assert len(items) == 2
        names = {t["name"] for t in items}
        assert "Copa Alto Tietê 2026" in names
        assert "Liga Relâmpago" in names

    def test_knockout_detail(self, s):
        items = s.get(f"{API}/tournaments").json()
        knockout = next(t for t in items if t["format"] == "knockout")
        r = s.get(f"{API}/tournaments/{knockout['id']}")
        assert r.status_code == 200
        data = r.json()
        assert data["format"] == "knockout"
        assert data["standings"] is None
        # matches enriched
        for m in data["matches"]:
            if m.get("team_a_id"):
                assert m["team_a"] is not None
        # top scorers sorted desc
        goals = [s["goals"] for s in data["top_scorers"]]
        assert goals == sorted(goals, reverse=True)

    def test_league_standings(self, s):
        items = s.get(f"{API}/tournaments").json()
        league = next(t for t in items if t["format"] == "league")
        r = s.get(f"{API}/tournaments/{league['id']}")
        assert r.status_code == 200
        data = r.json()
        assert data["standings"] is not None
        assert len(data["standings"]) == len(data["teams"])
        # standings sorted by Pts desc
        pts = [row["Pts"] for row in data["standings"]]
        assert pts == sorted(pts, reverse=True)

    def test_get_invalid(self, s):
        r = s.get(f"{API}/tournaments/does-not-exist")
        assert r.status_code == 404


# -------------------------- Admin --------------------------
class TestAdmin:
    def test_dashboard_requires_admin(self, user_token):
        r = requests.get(f"{API}/admin/dashboard", headers=H(user_token))
        assert r.status_code == 403

    def test_dashboard_admin(self, admin_token):
        r = requests.get(f"{API}/admin/dashboard", headers=H(admin_token))
        assert r.status_code == 200
        data = r.json()
        for key in ("total_bookings", "confirmed_bookings", "pending_bookings",
                    "occupancy_today_pct", "revenue_series", "top_times"):
            assert key in data
        assert len(data["revenue_series"]) == 7

    def test_admin_confirm_booking(self, admin_token, user_token):
        r = requests.post(f"{API}/bookings", headers=H(user_token), json={
            "court_id": "court-3", "date": "2030-08-12", "start_time": "14:00",
            "your_team_name": "AC A", "opponent_team_name": "AC B",
        })
        assert r.status_code == 200
        bid = r.json()["id"]
        c = requests.post(f"{API}/admin/bookings/{bid}/confirm", headers=H(admin_token))
        assert c.status_code == 200
        assert c.json()["status"] == "confirmed"

    def test_admin_cancel_booking(self, admin_token, user_token):
        r = requests.post(f"{API}/bookings", headers=H(user_token), json={
            "court_id": "court-3", "date": "2030-08-13", "start_time": "15:00",
            "your_team_name": "AC C", "opponent_team_name": "AC D",
        })
        bid = r.json()["id"]
        c = requests.post(f"{API}/admin/bookings/{bid}/cancel", headers=H(admin_token))
        assert c.status_code == 200

    def test_admin_update_match_score_advances_knockout(self, admin_token):
        # Find the knockout tournament & a semi-final scheduled match with both teams set
        t_list = requests.get(f"{API}/tournaments").json()
        knockout = next(t for t in t_list if t["format"] == "knockout")
        # Round 2 slot 1 has team_a_id + team_b_id and status scheduled
        target = None
        for m in knockout["matches"]:
            if m["round"] == 2 and m["status"] == "scheduled" and m.get("team_a_id") and m.get("team_b_id"):
                target = m
                break
        if target is None:
            pytest.skip("No suitable scheduled semi-final found")
        winner = target["team_a_id"]
        r = requests.post(
            f"{API}/admin/tournaments/{knockout['id']}/matches/{target['id']}/score",
            headers=H(admin_token),
            json={"score_a": 3, "score_b": 0, "status": "finished"},
        )
        assert r.status_code == 200
        updated = r.json()
        # The final (round 3 slot 0) should now have one team slot set
        final = next(m for m in updated["matches"] if m["round"] == 3 and m["slot"] == 0)
        assert final.get("team_a_id") == winner or final.get("team_b_id") == winner
