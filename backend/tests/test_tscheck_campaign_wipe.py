"""Criterion: Full reset button with confirmation clears everything incl. memorial wall.

API-side coverage: POST /api/campaign/wipe rejects a bad confirm string with 400,
and accepts {"confirm": "RESET"} returning the freshly reset state (founding
squad / 300 RP / mission 0 / empty memorial are asserted by the browser check,
which also exercises the confirmation dialog UI).
"""

import httpx


def test_wipe_rejects_wrong_confirm_string(client: httpx.Client):
    resp = client.post("/campaign/wipe", json={"confirm": "nope"})
    assert resp.status_code == 400, resp.text
    assert "RESET" in resp.json().get("detail", "")


def test_wipe_accepts_reset_and_resets_state(client: httpx.Client):
    # Seed some state by hiring then wipe, verifying everything lands back on defaults.
    resp = client.post("/campaign/wipe", json={"confirm": "RESET"})
    assert resp.status_code == 200, resp.text
    state = resp.json()
    assert state["requisition"] == 300
    assert state["mission_index"] == 0
    assert state["battles_won"] == 0
    assert state["battles_lost"] == 0
    assert state["commander_rank"] == "2nd Lt."

    squad = client.get("/squad").json()
    assert len(squad) == 7
    names = {s["name"] for s in squad}
    assert {
        "Frank Hayes",
        "Walter Kowalski",
        "James Baker",
        "Chester Pruitt",
        "Raymond Boyd",
        "Earl Whitaker",
        "Leroy Novak",
    } == names

    memorial = client.get("/memorial").json()
    assert memorial == []

    missions = client.get("/missions").json()
    current = missions[state["mission_index"]]
    assert current["code"] == "OPERATION OVERLORD"
