"""Game-state singleton, commander progression, and seed/backfill helpers."""

import random

from lib.db import db
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
        **commander_info(state),
    )


def soldier_out(doc: dict) -> SoldierOut:
    missions = doc.get("missions", 0)
    return SoldierOut(**{**doc, "level": level_for(missions), "rank": rank_for(missions)})


def memorial_out(doc: dict) -> MemorialOut:
    return MemorialOut(**doc)


async def get_state() -> dict:
    state = await db.game_state.find_one({"id": STATE_ID})
    if not state:
        await db.game_state.insert_one(dict(DEFAULT_STATE))
        state = dict(DEFAULT_STATE)
    return state


# ---------------- seed + backfill ----------------

async def backfill() -> None:
    """Give pre-update soldiers/memorial rows a portrait, unit and story."""
    async for doc in db.soldiers.find({"backstory": {"$exists": False}}):
        rng = random.Random(doc["id"])
        await db.soldiers.update_one(
            {"id": doc["id"]},
            {"$set": {"portrait_seed": rng.getrandbits(31), **make_backstory(doc["name"], doc.get("hometown", "Erie, PA"), doc.get("quirk", "Kid"), rng)}},
        )
    async for doc in db.memorial.find({"story": {"$exists": False}}):
        rng = random.Random(doc["id"])
        hometown = doc.get("hometown") or rng.choice(HOMETOWNS)
        info = make_backstory(doc["name"], hometown, rng.choice(QUIRKS), rng)
        story = (
            f"{info['backstory']}\n\n{doc['rank']} {doc['name']} was killed by "
            f"{cause_phrase(doc['cause'])} during {doc['mission_code']}. "
            f"{doc['name'].split(' ')[0]} never made it home."
        )
        await db.memorial.update_one(
            {"id": doc["id"]},
            {"$set": {"story": story, "unit": info["unit"], "hometown": hometown, "portrait_seed": rng.getrandbits(31)}},
        )
    await db.game_state.update_one(
        {"id": STATE_ID, "commander_name": {"$exists": False}},
        {"$set": {"commander_name": "Commander"}},
    )


async def seed_squad() -> None:
    docs = []
    for name, unit_type, status, kills, missions, quirk, hometown in INITIAL_SQUAD:
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
    await db.soldiers.insert_many(docs)


async def seed_all() -> None:
    """Idempotent: fills only what is missing. Safe to run on every boot/seed call."""
    await get_state()
    if await db.soldiers.count_documents({}) == 0:
        await seed_squad()
    if await db.memorial.count_documents({}) == 0:
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
        await db.memorial.insert_many(docs)
    await backfill()
