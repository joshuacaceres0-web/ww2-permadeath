"""Criterion: Allied reinforcements cost RP.

POST /api/battle/reinforce {mission_id, kind} spends requisition on an AI 2nd Platoon
team mid-battle: 200 on a valid call with cost deducted, 402 when the save can't afford
it, 409 when mission_id isn't the save's current operation, 422 for an unknown kind.

Each test opens its OWN save slot (module-name client fixture is shared across tests in
this file and would race on RP balance) so assertions on exact requisition deltas are safe.
"""

import uuid

import httpx

BASE_URL = "http://localhost:8001/api"


def fresh_client(tag: str) -> httpx.Client:
    save_id = f"tscheck-battle-reinforce-{tag}-{uuid.uuid4().hex[:8]}"
    return httpx.Client(base_url=BASE_URL, timeout=30.0, headers={"X-Save-Id": save_id})


def test_reinforce_rifle_deducts_cost():
    with fresh_client("rifle") as c:
        rp_before = c.get("/state").json()["requisition"]

        resp = c.post("/battle/reinforce", json={"mission_id": "op_01", "kind": "rifle"})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["kind"] == "rifle"
        assert body["cost"] == 15
        assert body["requisition"] == rp_before - 15

        assert c.get("/state").json()["requisition"] == rp_before - 15


def test_reinforce_heavy_costs_25():
    with fresh_client("heavy") as c:
        rp_before = c.get("/state").json()["requisition"]

        resp = c.post("/battle/reinforce", json={"mission_id": "op_01", "kind": "heavy"})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["kind"] == "heavy"
        assert body["cost"] == 25
        assert body["requisition"] == rp_before - 25


def test_reinforce_409_wrong_mission():
    with fresh_client("wrong-mission") as c:
        c.get("/state")  # ensure the save exists
        resp = c.post("/battle/reinforce", json={"mission_id": "op_04", "kind": "rifle"})
        assert resp.status_code == 409, resp.text


def test_reinforce_422_bad_kind():
    with fresh_client("bad-kind") as c:
        c.get("/state")
        resp = c.post("/battle/reinforce", json={"mission_id": "op_01", "kind": "tank"})
        assert resp.status_code == 422, resp.text


def test_reinforce_402_insufficient_rp():
    with fresh_client("insufficient") as c:
        # Drain requisition by hiring riflemen (100 RP each) — the
        # reinforce cap is 3 per mission, so RP can no longer be
        # drained with 20 reinforce calls (bug #13).
        for _ in range(3):
            r = c.post("/squad/hire", json={"type": "rifleman"})
            assert r.status_code == 200, r.text

        state = c.get("/state").json()
        assert state["requisition"] < 25, "fixture setup failed to drain requisition below 25"

        resp = c.post("/battle/reinforce", json={"mission_id": "op_01", "kind": "heavy"})
        assert resp.status_code == 402, resp.text


def test_reinforce_409_after_three_calls():
    # Bug #13: the max-3 cap is enforced server-side, not just in the
    # frontend — a 4th call for the same mission is refused even with
    # RP to spare.
    with fresh_client("cap") as c:
        for i in range(3):
            r = c.post("/battle/reinforce", json={"mission_id": "op_01", "kind": "rifle"})
            assert r.status_code == 200, r.text
        resp = c.post("/battle/reinforce", json={"mission_id": "op_01", "kind": "rifle"})
        assert resp.status_code == 409, resp.text
