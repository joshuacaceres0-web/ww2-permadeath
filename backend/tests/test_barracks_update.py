"""Barracks update (Josh, 2026-11-13): upgrade points earned in
battle and spent per man, squad stores with equip rules and RP
prices, and the death rule — a fallen man loses EVERYTHING:
his upgrades, his points and every item he carries. Nothing
returns to stores.

Runs on the module's throwaway save (see conftest) — never main.
"""

import os

import httpx
import pytest

API_URL = f"{os.environ.get('BACKEND_URL', 'http://localhost:8001')}/api"


@pytest.fixture(scope="module", autouse=True)
def _fresh_save():
    """The module save persists across runs, and filed battle_ids
    dedupe — so start from a wiped save or a re-run files nothing
    and the points math below reads stale balances. The save id
    conftest derives carries the package prefix under this
    config (tscheck-tests.test_barracks_update); wipe both
    spellings so the right one is always the clean one."""
    for save_id in ("tscheck-tests.test_barracks_update", "tscheck-test_barracks_update"):
        with httpx.Client(base_url=API_URL, timeout=30.0, headers={"X-Save-Id": save_id}) as c:
            c.post("/campaign/wipe", json={"confirm": "RESET"})
    yield


def _squad(client: httpx.Client):
    return client.get("/squad").json()


def _state(client: httpx.Client):
    return client.get("/state").json()


def _man(client: httpx.Client, name: str):
    return next(s for s in _squad(client) if s["name"] == name)


def _current_mission_id(client: httpx.Client) -> str:
    missions = client.get("/missions").json()
    return missions[_state(client)["mission_index"]]["id"]


def _file_battle(client: httpx.Client, battle_id: str, victory: bool, fallen=None, survivors=None, **extra):
    resp = client.post(
        "/battle/complete",
        json={
            "mission_id": _current_mission_id(client),
            "victory": victory,
            "duration_sec": 120,
            "battle_id": battle_id,
            "fallen": fallen or [],
            "survivors": survivors or [],
            **extra,
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_points_earned_and_spent(client: httpx.Client):
    client.get("/state")  # seed the founding squad
    frank = _man(client, "Frank Hayes")
    assert frank["points"] == 0
    assert frank["upgrades"] == {}
    assert frank["equipment"] == []

    # Surviving a lost battle with 5 kills: 2 for survival + 2
    # for kills (1 per 2 kills, capped at +2) = 4 points.
    result = _file_battle(
        client, "barracks-points-1", victory=False,
        survivors=[{"soldier_id": frank["id"], "kills": 5}],
    )
    assert result["points_gained"][frank["id"]] == 4
    frank = _man(client, "Frank Hayes")
    assert frank["points"] == 4

    # A quiet survival is worth the base 2.
    result = _file_battle(
        client, "barracks-points-2", victory=False,
        survivors=[{"soldier_id": frank["id"], "kills": 0}],
    )
    assert result["points_gained"][frank["id"]] == 2
    assert _man(client, "Frank Hayes")["points"] == 6

    # Spend: 2 points a level.
    resp = client.post("/squad/upgrade", json={"soldier_id": frank["id"], "track": "toughness"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["upgrades"]["toughness"] == 1
    assert body["points"] == 4

    # Unknown track is refused; a broke man is refused.
    resp = client.post("/squad/upgrade", json={"soldier_id": frank["id"], "track": "wings"})
    assert resp.status_code == 400
    walter = _man(client, "Walter Kowalski")
    resp = client.post("/squad/upgrade", json={"soldier_id": walter["id"], "track": "legs"})
    assert resp.status_code == 402


def test_upgrade_cap(client: httpx.Client):
    frank = _man(client, "Frank Hayes")
    # Frank has toughness 1 and 4 points (previous test). Two
    # more levels cap the track at 3; the fourth buy is refused.
    for _ in range(2):
        resp = client.post("/squad/upgrade", json={"soldier_id": frank["id"], "track": "toughness"})
        assert resp.status_code == 200, resp.text
    frank = _man(client, "Frank Hayes")
    assert frank["upgrades"]["toughness"] == 3
    assert frank["points"] == 0
    # Earn fresh points, then try to pass the cap.
    _file_battle(
        client, "barracks-cap-1", victory=False,
        survivors=[{"soldier_id": frank["id"], "kills": 4}],
    )
    resp = client.post("/squad/upgrade", json={"soldier_id": frank["id"], "track": "toughness"})
    assert resp.status_code == 400


def test_buy_equip_rules(client: httpx.Client):
    state = _state(client)
    assert state["inventory"] == {}
    rp0 = state["requisition"]

    # Buy binoculars (75): stores gain one, RP drops.
    resp = client.post("/inventory/buy", json={"item": "binoculars"})
    assert resp.status_code == 200, resp.text
    state = resp.json()
    assert state["inventory"]["binoculars"] == 1
    assert state["requisition"] == rp0 - 75

    # A rifleman cannot carry binoculars.
    frank = _man(client, "Frank Hayes")
    resp = client.post("/squad/equip", json={"soldier_id": frank["id"], "item": "binoculars"})
    assert resp.status_code == 400

    # Nor can the sniper any more (Josh, 2026-11-13): binoculars
    # are Recon only, and the refusal names the class.
    earl = _man(client, "Earl Whitaker")
    resp = client.post("/squad/equip", json={"soldier_id": earl["id"], "item": "binoculars"})
    assert resp.status_code == 400
    assert "recon" in resp.json()["detail"].lower()

    # The Recon can. Hire one (a victory first, to be sure of
    # the RP); his pair empties the stores, and a second pair
    # is refused for duplication.
    _file_battle(
        client, "barracks-buy-topup", victory=True,
        survivors=[{"soldier_id": frank["id"], "kills": 2}],
    )
    resp = client.post("/squad/hire", json={"type": "recon"})
    assert resp.status_code == 200, resp.text
    recon = resp.json()
    resp = client.post("/squad/equip", json={"soldier_id": recon["id"], "item": "binoculars"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["equipment"] == ["binoculars"]
    assert _state(client)["inventory"]["binoculars"] == 0
    resp = client.post("/squad/equip", json={"soldier_id": recon["id"], "item": "binoculars"})
    assert resp.status_code == 400

    # Two slots total: ammo fills the second, a third is refused.
    client.post("/inventory/buy", json={"item": "ammo"})
    client.post("/inventory/buy", json={"item": "canteen"})
    resp = client.post("/squad/equip", json={"soldier_id": recon["id"], "item": "ammo"})
    assert resp.status_code == 200
    resp = client.post("/squad/equip", json={"soldier_id": recon["id"], "item": "canteen"})
    assert resp.status_code == 400

    # Unequip returns the piece to stores.
    resp = client.post("/squad/unequip", json={"soldier_id": recon["id"], "item": "ammo"})
    assert resp.status_code == 200
    assert resp.json()["equipment"] == ["binoculars"]
    assert _state(client)["inventory"]["ammo"] == 1


def test_death_takes_everything(client: httpx.Client):
    # Kit Walter with two pieces and one upgrade level.
    walter = _man(client, "Walter Kowalski")
    _file_battle(
        client, "barracks-death-1", victory=False,
        survivors=[{"soldier_id": walter["id"], "kills": 4}],
    )
    resp = client.post("/squad/upgrade", json={"soldier_id": walter["id"], "track": "nerve"})
    assert resp.status_code == 200
    client.post("/inventory/buy", json={"item": "entrench"})
    client.post("/inventory/buy", json={"item": "dressing"})
    for item in ("entrench", "dressing"):
        resp = client.post("/squad/equip", json={"soldier_id": walter["id"], "item": item})
        assert resp.status_code == 200, resp.text
    inv_before = dict(_state(client)["inventory"])

    result = _file_battle(
        client, "barracks-death-2", victory=False,
        fallen=[{"soldier_id": walter["id"], "cause": "MG42 fire", "kills": 1}],
        survivors=[{"soldier_id": _man(client, "Frank Hayes")["id"], "kills": 0}],
    )
    # The debrief names what died with him...
    assert sorted(result["gear_lost"]) == ["dressing", "entrench"]
    # ...and stores did NOT get any of it back.
    inv_after = _state(client)["inventory"]
    assert inv_after.get("entrench", 0) == inv_before.get("entrench", 0)
    assert inv_after.get("dressing", 0) == inv_before.get("dressing", 0)
    # He is gone from the roster, upgrades and all.
    assert all(s["id"] != walter["id"] for s in _squad(client))


def test_loot_and_victory_award(client: httpx.Client):
    frank = _man(client, "Frank Hayes")
    result = _file_battle(
        client, "barracks-loot-1", victory=True,
        survivors=[{"soldier_id": frank["id"], "kills": 3}],
        loot_item="canteen",
    )
    gained = {(g["item"], g["source"]) for g in result["items_gained"]}
    assert ("canteen", "loot") in gained
    mission_items = [g for g in result["items_gained"] if g["source"] == "mission"]
    assert len(mission_items) == 1, "a victory awards exactly one stores item"
    inv = _state(client)["inventory"]
    assert inv.get("canteen", 0) >= 1
    assert inv.get(mission_items[0]["item"], 0) >= 1



def test_guns_are_loot_only(client: httpx.Client):
    """Josh (2026-11-13): looted guns are FOUND, never sold — the
    shop refuses every gun, while gear still buys normally."""
    for gun in ("thompson", "fg42", "bar"):
        r = client.post("/inventory/buy", json={"item": gun})
        assert r.status_code == 400, (gun, r.text)
        assert "found" in r.json()["detail"]


def test_gun_enters_through_loot_and_equips_once(client: httpx.Client):
    """A crate can hold a gun; it lands in stores like any item,
    equips as the man's weapon, and a second gun is refused —
    one weapon at a time. Two headgear are refused the same way."""
    leroy = _man(client, "Leroy Novak")
    james = _man(client, "James Baker")
    result = _file_battle(
        client, "barracks-gun-1", victory=False,
        survivors=[{"soldier_id": leroy["id"], "kills": 0}],
        loot_item="fg42",
    )
    assert ("fg42", "loot") in {(g["item"], g["source"]) for g in result["items_gained"]}
    assert _state(client)["inventory"].get("fg42", 0) >= 1

    # A second gun into stores, then the equip rules.
    _file_battle(
        client, "barracks-gun-2", victory=False,
        survivors=[{"soldier_id": leroy["id"], "kills": 0}],
        loot_item="mp40",
    )
    r = client.post("/squad/equip", json={"soldier_id": leroy["id"], "item": "fg42"})
    assert r.status_code == 200, r.text
    r = client.post("/squad/equip", json={"soldier_id": leroy["id"], "item": "mp40"})
    assert r.status_code == 400 and "already carries a gun" in r.json()["detail"]
    # Unequip hands the gun back to stores whole.
    r = client.post("/squad/unequip", json={"soldier_id": leroy["id"], "item": "fg42"})
    assert r.status_code == 200, r.text
    assert _state(client)["inventory"].get("fg42", 0) >= 1

    # Headgear: one head, one cover.
    client.post("/inventory/buy", json={"item": "nethelmet"})
    client.post("/inventory/buy", json={"item": "parahelmet"})
    assert client.post("/squad/equip", json={"soldier_id": james["id"], "item": "nethelmet"}).status_code == 200
    r = client.post("/squad/equip", json={"soldier_id": james["id"], "item": "parahelmet"})
    assert r.status_code == 400 and "already wears headgear" in r.json()["detail"]


def test_fallen_man_takes_his_gun_out_of_the_game(client: httpx.Client):
    """The death rule applies to guns exactly like gear: a man
    who falls with a looted gun equipped loses it — the gun
    does not return to inventory, it is gone with him."""
    james = _man(client, "James Baker")
    _file_battle(
        client, "barracks-gun-3", victory=False,
        survivors=[{"soldier_id": james["id"], "kills": 0}],
        loot_item="thompson",
    )
    before = _state(client)["inventory"].get("thompson", 0)
    assert client.post("/squad/equip", json={"soldier_id": james["id"], "item": "thompson"}).status_code == 200
    result = _file_battle(
        client, "barracks-gun-4", victory=False,
        fallen=[{"soldier_id": james["id"], "kills": 1, "cause": "rifle fire"}],
    )
    assert "thompson" in result["gear_lost"], result
    after = _state(client)["inventory"].get("thompson", 0)
    assert after == before - 1, "the equipped gun left stores when issued and never came back"



def test_class_items_refuse_the_wrong_class(client: httpx.Client):
    """Class items (Josh, 2026-11-13): locked to their class,
    refused on the wrong man with the reason named — never a
    silent failure. The restriction is checked before stores,
    so the refusal reads the same whether or not one is owned."""
    # Top the squad's RP up so the buy below is never the story.
    frank = _man(client, "Frank Hayes")
    _file_battle(client, "barracks-class-0", victory=True,
                 survivors=[{"soldier_id": frank["id"], "kills": 5}])
    chester = _man(client, "Chester Pruitt")  # medic
    r = client.post("/squad/equip", json={"soldier_id": chester["id"], "item": "bayonet"})
    assert r.status_code == 400 and "rifleman" in r.json()["detail"], r.text
    r = client.post("/squad/equip", json={"soldier_id": frank["id"], "item": "surgical"})
    assert r.status_code == 400 and "medic" in r.json()["detail"], r.text
    # The right class takes it.
    leroy = _man(client, "Leroy Novak")  # rifleman
    assert client.post("/inventory/buy", json={"item": "bayonet"}).status_code == 200
    r = client.post("/squad/equip", json={"soldier_id": leroy["id"], "item": "bayonet"})
    assert r.status_code == 200, r.text
    assert "bayonet" in r.json()["equipment"]


def test_class_item_loot_lands_and_dies_with_its_man(client: httpx.Client):
    """A looted class item lands in stores like any item, and
    the death rule covers it exactly: Leroy falls carrying the
    bayonet from the test above and it is lost with him."""
    leroy = _man(client, "Leroy Novak")
    result = _file_battle(
        client, "barracks-class-1", victory=False,
        survivors=[{"soldier_id": leroy["id"], "kills": 0}],
        loot_item="toolroll",
    )
    assert ("toolroll", "loot") in {(g["item"], g["source"]) for g in result["items_gained"]}
    assert _state(client)["inventory"].get("toolroll", 0) >= 1

    bayonets_before = _state(client)["inventory"].get("bayonet", 0)
    result = _file_battle(
        client, "barracks-class-2", victory=False,
        fallen=[{"soldier_id": leroy["id"], "kills": 2, "cause": "rifle fire"}],
    )
    assert "bayonet" in result["gear_lost"], result
    assert _state(client)["inventory"].get("bayonet", 0) == bayonets_before


def test_binoculars_legacy_pair_returns_to_stores(client: httpx.Client):
    """A save written while snipers could carry binoculars:
    on the next read the pair comes off the sniper and lands
    back in stores. Nothing is lost, and a Recon's own pair
    is never touched (Josh, 2026-11-13)."""
    from pathlib import Path

    from dotenv import load_dotenv
    from pymongo import MongoClient

    load_dotenv(Path(__file__).parent.parent / ".env")
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    # The stored save id is the client's header run through the
    # server's own cleaning (lib/save.py strips dots and the
    # like) — derive it the same way rather than guessing it.
    import re

    save_id = re.sub(r"[^A-Za-z0-9_-]", "", client.headers.get("X-Save-Id", ""))[:48] or "main"
    earl = _man(client, "Earl Whitaker")
    before = _state(client)["inventory"].get("binoculars", 0)
    db.soldiers.update_one(
        {"save_id": save_id, "id": earl["id"]},
        {"$set": {"equipment": ["binoculars"]}},
    )
    state = _state(client)  # the read runs the sweep
    assert state["inventory"].get("binoculars", 0) == before + 1
    assert _man(client, "Earl Whitaker")["equipment"] == []
    recon = next(s for s in _squad(client) if s["type"] == "recon")
    assert "binoculars" in recon["equipment"]
