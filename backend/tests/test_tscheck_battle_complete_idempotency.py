"""Criterion: battle filings without a battle_id still count once (bug #14).

Two identical defeat POSTs with no battle_id used to move battles_lost
2 -> 3 -> 4. The server now dedupes them by content fingerprint, so a
retry counts once; a genuinely different battle (different fallen /
survivors / duration) still counts.
"""

import uuid

import httpx

BASE_URL = "http://localhost:8001/api"


def fresh_client(tag: str) -> httpx.Client:
    save_id = f"tscheck-battle-complete-{tag}-{uuid.uuid4().hex[:8]}"
    return httpx.Client(base_url=BASE_URL, timeout=30.0, headers={"X-Save-Id": save_id})


def _defeat_payload(squad):
    active = [s for s in squad if s["status"] == "active"]
    return {
        "mission_id": "op_01",
        "victory": False,
        "duration_sec": 123,
        "fallen": [
            {"soldier_id": active[0]["id"], "cause": "MG42 fire", "kills": 2, "damage_taken": 80}
        ],
        "survivors": [
            {"soldier_id": active[1]["id"], "kills": 1, "damage_taken": 10}
        ],
    }


def test_identical_no_id_defeat_counts_once():
    with fresh_client("fp") as c:
        squad = c.get("/squad").json()
        before = c.get("/state").json()["battles_lost"]
        payload = _defeat_payload(squad)
        r1 = c.post("/battle/complete", json=payload)
        assert r1.status_code == 200, r1.text
        r2 = c.post("/battle/complete", json=payload)
        assert r2.status_code == 200, r2.text
        after = c.get("/state").json()["battles_lost"]
        assert after == before + 1, f"battles_lost {before} -> {after}, expected exactly one more"


def test_different_no_id_defeat_counts_twice():
    with fresh_client("fp2") as c:
        squad = c.get("/squad").json()
        before = c.get("/state").json()["battles_lost"]
        p1 = _defeat_payload(squad)
        r1 = c.post("/battle/complete", json=p1)
        assert r1.status_code == 200, r1.text
        # A second, genuinely different defeat: different duration and
        # a different fallen man (the first fallen man is already dead,
        # so pick another active soldier from the fresh roster).
        squad2 = c.get("/squad").json()
        active2 = [s for s in squad2 if s["status"] == "active"]
        assert len(active2) >= 2
        p2 = {
            "mission_id": "op_01",
            "victory": False,
            "duration_sec": 456,
            "fallen": [
                {"soldier_id": active2[0]["id"], "cause": "Mortar bombardment", "kills": 0, "damage_taken": 50}
            ],
            "survivors": [
                {"soldier_id": active2[1]["id"], "kills": 0, "damage_taken": 5}
            ],
        }
        r2 = c.post("/battle/complete", json=p2)
        assert r2.status_code == 200, r2.text
        after = c.get("/state").json()["battles_lost"]
        assert after == before + 2, f"battles_lost {before} -> {after}, expected two more"
