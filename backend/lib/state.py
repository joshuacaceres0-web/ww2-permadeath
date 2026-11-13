"""Game-state singleton, commander progression, and seed/backfill helpers."""

import random

from lib.db import db
from lib.save import S, migrate_legacy, save_lock, sid
from pymongo.errors import DuplicateKeyError
from lib.gen import (
    COMMANDER_RANKS,
    HOMETOWNS,
    QUIRKS,
    WINS_PER_COMMANDER_LEVEL,
    cause_phrase,
    commander_level,
    level_for,
    make_backstory,
    make_soldier,
    rank_for,
)
from lib.missions import UNIT_COSTS
from models.models import GameStateOut, MemorialOut, SoldierOut

STATE_ID = "main"

DEFAULT_STATE = {
    "id": STATE_ID,
    "requisition": 300,
    "mission_index": 0,
    "battles_won": 0,
    "battles_lost": 0,
    "campaign_complete": False,
    "commander_name": "Commander",
    # Server-side reinforcement cap (bug #13): the max-3 was frontend
    # only, so a direct API caller could buy unlimited teams. The
    # counter is per current mission attempt and resets when a battle
    # files (see _battle_complete_locked) or the mission changes.
    "reinforcements_used": 0,
    "reinforcements_mission": None,
    # Squad stores (Barracks update): item id -> count.
    "inventory": {},
}

# The founding squad — named, storied, and immediately deployable.
INITIAL_SQUAD = [
    ("Frank Hayes", "rifleman", "active", 7, 2, "Eagle Eye", "Duluth, MN"),
    ("Walter Kowalski", "rifleman", "active", 3, 1, "Farm Boy", "Hamtramck, MI"),
    ("James Baker", "rifleman", "active", 0, 0, "Brooklyn", "Erie, PA"),
    ("Chester Pruitt", "medic", "active", 1, 2, "Preacher", "Savannah, GA"),
    ("Raymond Boyd", "mg", "active", 6, 2, "Tough Bastard", "Amarillo, TX"),
    ("Earl Whitaker", "sniper", "reserve", 8, 3, "Dead Shot", "Bend, OR"),
    ("Leroy Novak", "rifleman", "reserve", 0, 0, "Quiet One", "Scranton, PA"),
]

# The war didn't start when this app did — two men were already on the wall.
INITIAL_MEMORIAL = [
    ("Dale Mercer", "mg", 11, 3, "MG42 fire", "OPERATION OVERLORD", "Omaha Beach, Normandy", "1944-06-06T00:00:00Z", "Bedford, VA"),
    ("Otis Crane", "rifleman", 5, 1, "Mortar bombardment", "OPERATION COBRA", "Saint-Lô, Normandy", "1944-07-25T00:00:00Z", "Butte, MT"),
]


# ---------------- commander ----------------

def career_wins(state: dict) -> int:
    """Commander progress survives campaign resets — it's the player's career, not the campaign's."""
    return state.get("career_wins", state.get("battles_won", 0))


def commander_info(state: dict) -> dict:
    wins = career_wins(state)
    level = commander_level(wins)
    max_level = len(COMMANDER_RANKS)
    discount = min(0.30, 0.05 * (level - 1))
    wins_to_next = 0 if level >= max_level else level * WINS_PER_COMMANDER_LEVEL - wins
    return {
        "commander_name": state.get("commander_name") or "Commander",
        "commander_level": level,
        "commander_rank": COMMANDER_RANKS[level - 1],
        "commander_max_level": max_level,
        "wins_to_next_level": wins_to_next,
        "max_squad": min(8, 4 + level),
        "hire_discount": round(discount, 2),
        "combat_bonus": round(0.04 * (level - 1), 2),
        "hire_costs": {k: round(v * (1 - discount)) for k, v in UNIT_COSTS.items()},
    }


def state_out(state: dict) -> GameStateOut:
    return GameStateOut(
        requisition=state["requisition"],
        mission_index=state["mission_index"],
        battles_won=state["battles_won"],
        battles_lost=state["battles_lost"],
        campaign_complete=state["campaign_complete"],
        inventory=state.get("inventory") or {},
        **commander_info(state),
    )


def soldier_out(doc: dict) -> SoldierOut:
    missions = doc.get("missions", 0)
    return SoldierOut(**{**doc, "level": level_for(missions), "rank": rank_for(missions)})


def memorial_out(doc: dict) -> MemorialOut:
    return MemorialOut(**doc)


async def _binoculars_recon_only() -> None:
    """Binoculars are Recon-only (Josh, 2026-11-13): in a save
    written while snipers could carry them, anyone but a Recon
    wearing a pair hands it back to stores on the next read.
    Nothing is lost — the pair returns to the pool, and the
    sweep is idempotent, so it costs one small query per read
    once no legacy pairs remain."""
    async for doc in S.soldiers.find({"equipment": "binoculars", "type": {"$ne": "recon"}}):
        await S.soldiers.update_one({"id": doc["id"]}, {"$pull": {"equipment": "binoculars"}})
        await S.game_state.update_one({"id": STATE_ID}, {"$inc": {"inventory.binoculars": 1}})


async def get_state() -> dict:
    # The binoculars sweep runs before the read so the state
    # handed back already reflects it, not one read later.
    await _binoculars_recon_only()
    state = await S.game_state.find_one({"id": STATE_ID})
    if state:
        return state
    # A brand-new save slot. Parallel first requests race here, so creation is one atomic
    # upsert (unique index on save_id); only the request that actually inserted seeds the squad.
    # The upsert filter includes the state id, so a doc for another id can never be mistaken
    # for this save's state, and seeding is done inside the same lock (see seed_squad).
    async with save_lock():
        state = await S.game_state.find_one({"id": STATE_ID})
        if state:
            return state
        try:
            res = await db.game_state.update_one(
                {"save_id": sid(), "id": STATE_ID},
                {"$setOnInsert": {**DEFAULT_STATE, "save_id": sid()}},
                upsert=True,
            )
            created = res.upserted_id is not None
        except DuplicateKeyError:
            created = False
        if created:
            await seed_squad()
    return await S.game_state.find_one({"id": STATE_ID})


# ---------------- seed + backfill ----------------

async def backfill() -> None:
    """Give pre-update soldiers/memorial rows a portrait, unit and story."""
    async for doc in S.soldiers.find({"backstory": {"$exists": False}}):
        rng = random.Random(doc["id"])
        await S.soldiers.update_one(
            {"id": doc["id"]},
            {"$set": {"portrait_seed": rng.getrandbits(31), **make_backstory(doc["name"], doc.get("hometown", "Erie, PA"), doc.get("quirk", "Kid"), rng)}},
        )
    async for doc in S.memorial.find({"story": {"$exists": False}}):
        rng = random.Random(doc["id"])
        hometown = doc.get("hometown") or rng.choice(HOMETOWNS)
        info = make_backstory(doc["name"], hometown, rng.choice(QUIRKS), rng)
        story = (
            f"{info['backstory']}\n\n{doc['rank']} {doc['name']} was killed by "
            f"{cause_phrase(doc['cause'])} during {doc['mission_code']}. "
            f"{doc['name'].split(' ')[0]} never made it home."
        )
        await S.memorial.update_one(
            {"id": doc["id"]},
            {"$set": {"story": story, "unit": info["unit"], "hometown": hometown, "portrait_seed": rng.getrandbits(31)}},
        )
    await S.game_state.update_one(
        {"id": STATE_ID, "commander_name": {"$exists": False}},
        {"$set": {"commander_name": "Commander"}},
    )


async def seed_squad() -> None:
    """Idempotent by founding name, under the save lock: concurrent first
    touches, a startup seed, and a wipe can all call this at once, and the
    old check-then-insert (count == 0, then insert_many, no lock) inserted
    the 7-man founding squad twice, so one load showed 7 men and the next
    showed 14, with different RP/mission counts underneath. Only founding
    names that are missing are inserted; hired soldiers are never touched."""
    async with save_lock():
        existing = {d["name"] for d in await S.soldiers.find({"name": {"$in": [n for n, *_ in INITIAL_SQUAD]}}).to_list(20)}
        docs = []
        for name, unit_type, status, kills, missions, quirk, hometown in INITIAL_SQUAD:
            if name in existing:
                continue
            doc = make_soldier(unit_type, status)
            rng = random.Random(name)
            doc.update(
                {
                    "name": name,
                    "kills": kills,
                    "missions": missions,
                    "xp": kills * 20 + missions * 50,
                    "quirk": quirk,
                    "hometown": hometown,
                    "portrait_seed": rng.getrandbits(31),
                    **make_backstory(name, hometown, quirk, rng),
                }
            )
            docs.append(doc)
        if docs:
            await S.soldiers.insert_many(docs)


async def seed_all() -> None:
    """Idempotent: fills only what is missing. Founding memorial only on a brand-new save,
    so a full wipe stays wiped across restarts. Held under the save lock for the
    whole run, so a startup seed cannot race a first-touch request or a wipe."""
    async with save_lock():
        await migrate_legacy()
        brand_new = await S.game_state.find_one({"id": STATE_ID}) is None
        await get_state()
        if await S.soldiers.count_documents({}) == 0:
            await seed_squad()
        if brand_new and await S.memorial.count_documents({}) == 0:
            docs = []
            for i, (name, utype, kills, ops, cause, code, location, died, hometown) in enumerate(INITIAL_MEMORIAL):
                rng = random.Random(name)
                info = make_backstory(name, hometown, "Pops", rng)
                docs.append(
                    {
                        "id": f"founding-{i + 1}",
                        "name": name,
                        "type": utype,
                        "rank": rank_for(ops),
                        "kills": kills,
                        "missions_survived": ops,
                        "cause": cause,
                        "mission_code": code,
                        "died_at": died,
                        "hometown": hometown,
                        "unit": info["unit"],
                        "portrait_seed": rng.getrandbits(31),
                        "story": (
                            f"{info['backstory']}\n\n{rank_for(ops)} {name} was killed by {cause_phrase(cause)} "
                            f"during {code} at {location} — {ops} operations behind him and {kills} confirmed. "
                            f"His mother kept a blue star in the window until the telegram came."
                        ),
                        "grave_x": 0.2 + 0.18 * i,
                        "grave_y": 0.35,
                    }
                )
            # Upsert by fixed id, not blind insert: two saves / two seeds must
            # never create a second Dale Mercer or Otis Crane in one save.
            for d in docs:
                await db.memorial.update_one(
                    {"save_id": sid(), "id": d["id"]}, {"$setOnInsert": {**d, "save_id": sid()}}, upsert=True
                )
        await backfill()
