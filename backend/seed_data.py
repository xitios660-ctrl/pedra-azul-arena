"""Seed initial demo data: admin user, sample tournaments + matches."""
import os
import uuid
from datetime import datetime, timezone, timedelta

from auth_utils import hash_password, verify_password


async def seed_admin(db):
    admin_email = os.environ.get("ADMIN_EMAIL", "Gugu123@").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "Gugu123@")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "name": "Gugu · Administrador",
            "role": "admin",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"password_hash": hash_password(admin_password), "role": "admin"}},
        )

    # Cleanup old admin if it exists (avoid duplicate admin accounts)
    for old in ("admin@arena.com", "gugu123@"):
        if old != admin_email:
            await db.users.delete_one({"email": old})


async def seed_demo_user(db):
    email = "jogador@arena.com"
    if await db.users.find_one({"email": email}):
        return
    await db.users.insert_one({
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password("Jogador@2026"),
        "name": "Marcos Silva",
        "role": "user",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


async def seed_tournaments(db):
    if await db.tournaments.count_documents({}) > 0:
        return

    # Tournament 1: Copa Arena Premium (with matches in progress)
    t1_id = str(uuid.uuid4())
    teams_1 = [
        {"id": str(uuid.uuid4()), "name": "Tigres FC", "crest": "🐯"},
        {"id": str(uuid.uuid4()), "name": "Lobos United", "crest": "🐺"},
        {"id": str(uuid.uuid4()), "name": "Falcões SC", "crest": "🦅"},
        {"id": str(uuid.uuid4()), "name": "Dragões EC", "crest": "🐲"},
        {"id": str(uuid.uuid4()), "name": "Panteras FC", "crest": "🐆"},
        {"id": str(uuid.uuid4()), "name": "Leões da Vila", "crest": "🦁"},
        {"id": str(uuid.uuid4()), "name": "Águias Reais", "crest": "🦢"},
        {"id": str(uuid.uuid4()), "name": "Touros AC", "crest": "🐂"},
    ]
    now = datetime.now(timezone.utc)
    matches_1 = [
        # Quarter-finals
        {"id": str(uuid.uuid4()), "round": 1, "slot": 0, "team_a_id": teams_1[0]["id"], "team_b_id": teams_1[1]["id"],
         "score_a": 4, "score_b": 2, "status": "finished", "scheduled_at": (now - timedelta(days=2)).isoformat()},
        {"id": str(uuid.uuid4()), "round": 1, "slot": 1, "team_a_id": teams_1[2]["id"], "team_b_id": teams_1[3]["id"],
         "score_a": 1, "score_b": 3, "status": "finished", "scheduled_at": (now - timedelta(days=2)).isoformat()},
        {"id": str(uuid.uuid4()), "round": 1, "slot": 2, "team_a_id": teams_1[4]["id"], "team_b_id": teams_1[5]["id"],
         "score_a": 5, "score_b": 5, "status": "finished", "scheduled_at": (now - timedelta(days=1)).isoformat()},
        {"id": str(uuid.uuid4()), "round": 1, "slot": 3, "team_a_id": teams_1[6]["id"], "team_b_id": teams_1[7]["id"],
         "score_a": 2, "score_b": 6, "status": "finished", "scheduled_at": (now - timedelta(days=1)).isoformat()},
        # Semi-finals
        {"id": str(uuid.uuid4()), "round": 2, "slot": 0, "team_a_id": teams_1[0]["id"], "team_b_id": teams_1[3]["id"],
         "score_a": 3, "score_b": 1, "status": "finished", "scheduled_at": (now + timedelta(hours=1)).isoformat()},
        {"id": str(uuid.uuid4()), "round": 2, "slot": 1, "team_a_id": teams_1[4]["id"], "team_b_id": teams_1[7]["id"],
         "score_a": 0, "score_b": 0, "status": "scheduled", "scheduled_at": (now + timedelta(days=1)).isoformat()},
        # Final
        {"id": str(uuid.uuid4()), "round": 3, "slot": 0, "team_a_id": None, "team_b_id": None,
         "score_a": 0, "score_b": 0, "status": "scheduled", "scheduled_at": (now + timedelta(days=3)).isoformat()},
    ]
    scorers_1 = [
        {"team_id": teams_1[0]["id"], "player": "R. Mendes", "goals": 7},
        {"team_id": teams_1[7]["id"], "player": "K. Oliveira", "goals": 6},
        {"team_id": teams_1[4]["id"], "player": "D. Costa", "goals": 5},
        {"team_id": teams_1[3]["id"], "player": "G. Albuquerque", "goals": 4},
        {"team_id": teams_1[5]["id"], "player": "L. Ferreira", "goals": 4},
    ]
    await db.tournaments.insert_one({
        "id": t1_id,
        "name": "Copa Arena Premium 2026",
        "format": "knockout",
        "status": "live",
        "season": "Temporada 1",
        "banner": "https://images.unsplash.com/photo-1779406283467-5124ba4631c3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NjV8MHwxfHNlYXJjaHwxfHxkYXJrJTIwZnV0c2FsJTIwc3RhZGl1bSUyMG5pZ2h0fGVufDB8fHx8MTc4MDk2OTUxMXww&ixlib=rb-4.1.0&q=85",
        "teams": teams_1,
        "matches": matches_1,
        "top_scorers": scorers_1,
        "created_at": now.isoformat(),
    })

    # Tournament 2: Liga Relâmpago (League format with leaderboard)
    t2_id = str(uuid.uuid4())
    teams_2 = [
        {"id": str(uuid.uuid4()), "name": "Cobras Negras", "crest": "🐍"},
        {"id": str(uuid.uuid4()), "name": "Tubarões FC", "crest": "🦈"},
        {"id": str(uuid.uuid4()), "name": "Búfalos AC", "crest": "🐃"},
        {"id": str(uuid.uuid4()), "name": "Raposas SE", "crest": "🦊"},
        {"id": str(uuid.uuid4()), "name": "Coyotes FC", "crest": "🐺"},
        {"id": str(uuid.uuid4()), "name": "Pegasos EC", "crest": "🦄"},
    ]
    matches_2 = []
    # Generate round robin scoreline
    sample_scores = [(3, 1), (2, 2), (4, 0), (1, 2), (3, 3), (5, 1), (2, 1), (0, 3), (4, 2), (1, 1)]
    idx = 0
    for i in range(len(teams_2)):
        for j in range(i + 1, len(teams_2)):
            sa, sb = sample_scores[idx % len(sample_scores)]
            matches_2.append({
                "id": str(uuid.uuid4()),
                "round": 1, "slot": idx,
                "team_a_id": teams_2[i]["id"],
                "team_b_id": teams_2[j]["id"],
                "score_a": sa, "score_b": sb,
                "status": "finished",
                "scheduled_at": (now - timedelta(days=10 - idx)).isoformat(),
            })
            idx += 1

    scorers_2 = [
        {"team_id": teams_2[0]["id"], "player": "P. Almeida", "goals": 9},
        {"team_id": teams_2[2]["id"], "player": "F. Tavares", "goals": 7},
        {"team_id": teams_2[5]["id"], "player": "V. Santos", "goals": 6},
        {"team_id": teams_2[1]["id"], "player": "J. Pereira", "goals": 5},
    ]
    await db.tournaments.insert_one({
        "id": t2_id,
        "name": "Liga Relâmpago",
        "format": "league",
        "status": "live",
        "season": "Temporada 1",
        "banner": "https://images.unsplash.com/photo-1638573615178-6f2950746614?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2MjJ8MHwxfHNlYXJjaHwxfHxuZW9uJTIwc3BvcnRzJTIwc3RhZGl1bSUyMGxpZ2h0c3xlbnwwfHx8fDE3ODA5Njk1MTF8MA&ixlib=rb-4.1.0&q=85",
        "teams": teams_2,
        "matches": matches_2,
        "top_scorers": scorers_2,
        "created_at": now.isoformat(),
    })


async def run_all_seeds(db):
    await seed_admin(db)
    await seed_demo_user(db)
    await seed_tournaments(db)
    try:
        import site_settings as sset
        await sset.ensure_seeded(db)
    except Exception:
        pass
