"""Memorial permanence (Josh, 2026-11-12): keep ALL KIA even after
campaigns. The fallen are a permanent record: a new campaign
(POST /campaign/reset) leaves every memorial entry and grave
decoration exactly as it stood, and the living carry over with
their rank, kills, missions and medals — the campaign and RP
start fresh, the men and the dead do not. The ONLY way to clear
the Memorial is a New Game (POST /campaign/wipe).

Runs on the module's throwaway save (see conftest) — never main.
"""

import httpx


def _squad(client: httpx.Client):
    return client.get("/squad").json()


def _memorial(client: httpx.Client):
    return client.get("/memorial").json()


def _file_battle(client: httpx.Client, battle_id: str, fallen, survivors):
    resp = client.post(
        "/battle/complete",
        json={
            "mission_id": "op_01",
            "victory": False,
            "duration_sec": 120,
            "battle_id": battle_id,
            "fallen": fallen,
            "survivors": survivors,
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_fallen_decor_and_survivors_survive_new_campaign(client: httpx.Client):
    client.get("/state")  # first touch: seeds the founding squad
    squad = _squad(client)
    assert len(squad) == 7
    victim = next(s for s in squad if s["status"] == "active")
    survivor = next(s for s in squad if s["status"] == "active" and s["id"] != victim["id"])
    survivor_kills = survivor["kills"]
    survivor_missions = survivor["missions"]

    _file_battle(
        client,
        "perm-battle-1",
        fallen=[{"soldier_id": victim["id"], "cause": "MG42 fire", "kills": 2}],
        survivors=[{"soldier_id": survivor["id"], "kills": 5}],
    )

    wall = _memorial(client)
    entries = [m for m in wall if m["id"] == victim["id"]]
    assert len(entries) == 1, "the fallen man is on the wall exactly once"
    grave = (entries[0]["grave_x"], entries[0]["grave_y"])
    assert grave != (None, None), "his grave was laid as the report filed"

    decor = client.post("/graveyard/decor", json={"kind": "poppies", "entry_id": victim["id"]})
    assert decor.status_code == 200, decor.text

    state = client.post("/campaign/reset").json()
    assert state["mission_index"] == 0
    assert state["requisition"] == 300
    assert state["campaign_complete"] is False

    wall_after = _memorial(client)
    entries_after = [m for m in wall_after if m["id"] == victim["id"]]
    assert len(entries_after) == 1, "still exactly one entry after the new campaign"
    assert (entries_after[0]["grave_x"], entries_after[0]["grave_y"]) == grave
    assert entries_after[0]["story"] == entries[0]["story"]
    assert entries_after[0]["medals"] == entries[0]["medals"]

    decor_after = client.get("/graveyard/decor").json()
    assert len(decor_after) == 1
    assert decor_after[0]["entry_id"] == victim["id"]
    assert decor_after[0]["kind"] == "poppies"
    assert (decor_after[0]["x"], decor_after[0]["y"]) == (decor.json()["x"], decor.json()["y"])

    roster = _squad(client)
    carried = next((s for s in roster if s["id"] == survivor["id"]), None)
    assert carried is not None, "the survivor starts the new campaign with you"
    assert carried["kills"] == survivor_kills + 5, "his kills carried, he was not reseeded"
    assert carried["missions"] == survivor_missions
    assert all(s["id"] != victim["id"] for s in roster), "the fallen man stays fallen"


def test_second_campaign_filing_adds_without_duplicates(client: httpx.Client):
    squad = _squad(client)
    wall_before = _memorial(client)
    assert len(wall_before) == 1  # the man from the first campaign
    victim2 = next(s for s in squad if s["status"] == "active")
    survivor = next(s for s in squad if s["status"] == "active" and s["id"] != victim2["id"])

    body = {
        "mission_id": "op_01",
        "victory": False,
        "duration_sec": 90,
        "battle_id": "perm-battle-2",
        "fallen": [{"soldier_id": victim2["id"], "cause": "Mortar bombardment", "kills": 1}],
        "survivors": [{"soldier_id": survivor["id"], "kills": 1}],
    }
    resp = client.post("/battle/complete", json=body)
    assert resp.status_code == 200, resp.text
    # The same filing again (a retry) must not duplicate anyone.
    resp = client.post("/battle/complete", json=body)
    assert resp.status_code == 200, resp.text

    wall = _memorial(client)
    assert len(wall) == 2
    ids = [m["id"] for m in wall]
    assert len(set(ids)) == 2, "no duplicate entries on the wall"
    names = [m["name"] for m in wall]
    assert len(set(names)) == 2


def test_only_new_game_clears_the_memorial(client: httpx.Client):
    resp = client.post("/campaign/wipe", json={"confirm": "RESET"})
    assert resp.status_code == 200, resp.text
    assert _memorial(client) == []
    assert client.get("/graveyard/decor").json() == []
    assert len(_squad(client)) == 7


def test_finished_campaign_carries_survivors_commander_and_the_wall(client: httpx.Client):
    """Josh's exact scenario (2026-11-12): finish a campaign with
    named survivors, start a new campaign — the survivors are
    present with their stats intact, the commander keeps his
    career rank and level (so his radio unlocks stay open), the
    KIA are still in the Memorial — then a New Game clears both."""
    client.get("/state")
    squad = _squad(client)
    assert len(squad) == 7
    victim = next(s for s in squad if s["status"] == "active")
    survivor = next(s for s in squad if s["status"] == "active" and s["id"] != victim["id"])
    seed_kills = survivor["kills"]
    seed_missions = survivor["missions"]

    # Fight the whole war: four victories, Overlord to Permafrost.
    for i, mission_id in enumerate(["op_01", "op_02", "op_03", "op_04"]):
        body = {
            "mission_id": mission_id,
            "victory": True,
            "duration_sec": 300,
            "battle_id": f"carry-war-{i}",
            "fallen": [{"soldier_id": victim["id"], "cause": "Sniper fire", "kills": 1}] if i == 0 else [],
            "survivors": [{"soldier_id": survivor["id"], "kills": 3 if i == 0 else 1}],
        }
        resp = client.post("/battle/complete", json=body)
        assert resp.status_code == 200, resp.text

    state = client.get("/state").json()
    assert state["campaign_complete"] is True
    rank_at_finish = state["commander_rank"]
    assert rank_at_finish != "2nd Lt.", "four career wins promoted the commander"
    assert len(_memorial(client)) == 1

    state = client.post("/campaign/reset").json()
    assert state["campaign_complete"] is False
    assert state["mission_index"] == 0
    assert state["requisition"] == 300, "RP is the campaign's, and it resets"
    assert state["commander_rank"] == rank_at_finish, (
        "the commander is a career: rank and level carry, so every radio "
        "call gated by his level stays unlocked"
    )

    roster = _squad(client)
    carried = next((s for s in roster if s["id"] == survivor["id"]), None)
    assert carried is not None, "the survivor starts the new campaign with you"
    assert carried["kills"] == seed_kills + 6, "his kills are intact, not a rookie reset"
    assert carried["missions"] == seed_missions + 4, "his experience is intact"
    assert all(s["id"] != victim["id"] for s in roster)

    wall = _memorial(client)
    assert len(wall) == 1 and wall[0]["id"] == victim["id"], "the KIA is still in the Memorial"

    # And the one way to clear any of it: a New Game.
    resp = client.post("/campaign/wipe", json={"confirm": "RESET"})
    assert resp.status_code == 200, resp.text
    assert _memorial(client) == []
    state = client.get("/state").json()
    assert state["commander_rank"] == "2nd Lt.", "a New Game wipes the career too"
    assert len(_squad(client)) == 7


def test_empty_roster_refills_and_the_wall_still_stands(client: httpx.Client):
    squad = _squad(client)
    assert len(squad) == 7
    _file_battle(
        client,
        "perm-battle-wipeout",
        fallen=[{"soldier_id": s["id"], "cause": "Artillery", "kills": 0} for s in squad],
        survivors=[],
    )
    assert _squad(client) == []
    assert len(_memorial(client)) == 7

    client.post("/campaign/reset")
    refilled = _squad(client)
    assert len(refilled) == 7, "replacements report when nobody is left"
    wall = _memorial(client)
    assert len(wall) == 7, "the wall stands even after a wipeout and a new campaign"
    assert len({m["id"] for m in wall}) == 7

    # Leave the throwaway save clean.
    client.post("/campaign/wipe", json={"confirm": "RESET"})
