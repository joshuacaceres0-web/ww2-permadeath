"""Criterion: Game saves correctly: save slots are isolated.

Two distinct X-Save-Id headers must behave as fully independent campaigns: hiring a
soldier / wiping one slot must not change the other slot's /api/squad or
/api/memorial. Never touches "main" — uses two dedicated tscheck-* save ids.
"""

import httpx

BASE = "http://localhost:8001/api"
SAVE_A = "tscheck-isolation-a"
SAVE_B = "tscheck-isolation-b"


def _client(save_id: str) -> httpx.Client:
    return httpx.Client(base_url=BASE, timeout=30.0, headers={"X-Save-Id": save_id})


def test_two_save_slots_are_independent():
    with _client(SAVE_A) as a, _client(SAVE_B) as b:
        # Start both from a known, isolated baseline.
        r = a.post("/campaign/wipe", json={"confirm": "RESET"})
        assert r.status_code == 200, r.text
        r = b.post("/campaign/wipe", json={"confirm": "RESET"})
        assert r.status_code == 200, r.text

        squad_a_before = a.get("/squad").json()
        squad_b_before = b.get("/squad").json()
        memorial_b_before = b.get("/memorial").json()
        count_a_before = len(squad_a_before)
        count_b_before = len(squad_b_before)

        # Mutate slot A only: hire a rifleman.
        state_a = a.get("/state").json()
        hire_cost = state_a["hire_costs"]["rifleman"]
        assert state_a["requisition"] >= hire_cost, "fresh slot should afford a rifleman"
        r = a.post("/squad/hire", json={"type": "rifleman"})
        assert r.status_code == 200, r.text

        # Slot A grew by one soldier.
        squad_a_after = a.get("/squad").json()
        assert len(squad_a_after) == count_a_before + 1, squad_a_after

        # Slot B must be completely untouched.
        squad_b_after = b.get("/squad").json()
        memorial_b_after = b.get("/memorial").json()
        assert len(squad_b_after) == count_b_before, (
            "hiring in save A leaked into save B's squad",
            squad_b_after,
        )
        assert {s["id"] for s in squad_b_before} == {s["id"] for s in squad_b_after}
        assert memorial_b_before == memorial_b_after

        # Wiping slot A must not change slot B's state either.
        state_b_before_wipe = b.get("/state").json()
        r = a.post("/campaign/wipe", json={"confirm": "RESET"})
        assert r.status_code == 200, r.text
        state_b_after_wipe = b.get("/state").json()
        assert state_b_before_wipe["requisition"] == state_b_after_wipe["requisition"]
        assert state_b_before_wipe["mission_index"] == state_b_after_wipe["mission_index"]
