"""Criterion: Real WWII medals awarded for feats with bonuses.

Resets campaign to a known state (current mission op_01), files a battle report
with a standout survivor and a fallen man, and checks the medals_awarded payload
plus that /api/squad reflects the survivor's medals afterward.
"""

import httpx


def _reset(client: httpx.Client):
    resp = client.post("/campaign/wipe", json={"confirm": "RESET"})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_battle_complete_awards_medals(client: httpx.Client):
    _reset(client)
    squad = client.get("/squad").json()
    active = [s for s in squad if s["status"] == "active"]
    assert len(active) >= 2, "need at least a survivor and a fallen man"
    survivor_id = active[0]["id"]
    fallen_id = active[1]["id"]

    payload = {
        "mission_id": "op_01",
        "victory": True,
        "duration_sec": 300,
        "fallen": [
            {"soldier_id": fallen_id, "cause": "MG42 fire", "kills": 5, "damage_taken": 120}
        ],
        "survivors": [
            {
                "soldier_id": survivor_id,
                "kills": 9,
                "damage_taken": 55,
                "heavy_kills": 1,
            }
        ],
    }
    resp = client.post("/battle/complete", json=payload)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # medals_awarded is a flat list of "Name — Medal" strings.
    medals_awarded = body["medals_awarded"]
    survivor_name = next(s["name"] for s in squad if s["id"] == survivor_id)
    fallen_name = next(s["name"] for s in squad if s["id"] == fallen_id)

    survivor_medals = [m for m in medals_awarded if m.startswith(survivor_name)]
    fallen_medals = [m for m in medals_awarded if m.startswith(fallen_name)]

    assert any("Combat Infantryman Badge" in m for m in survivor_medals), survivor_medals
    assert any("Purple Heart" in m and "posthumous" not in m for m in survivor_medals), survivor_medals
    assert any("Bronze Star" in m for m in survivor_medals), survivor_medals
    assert any("Silver Star" in m for m in survivor_medals), survivor_medals
    assert any("Distinguished Service Cross" in m for m in survivor_medals), survivor_medals

    assert any("Purple Heart" in m and "posthumous" in m for m in fallen_medals), fallen_medals
    assert any("Bronze Star" in m for m in fallen_medals), fallen_medals

    # Squad listing should now show medal codes on the survivor.
    squad_after = client.get("/squad").json()
    surv = next(s for s in squad_after if s["id"] == survivor_id)
    assert len(surv.get("medals", [])) > 0, surv
