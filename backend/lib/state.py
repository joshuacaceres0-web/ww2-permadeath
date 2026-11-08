"""Game-state singleton + seed helpers shared by routers and seed.py."""

from lib.gen import make_soldier, rank_for, XP_PER_KILL
from lib.db import db

STATE_ID = "main"

DEFAULT_STATE = {
    "id": STATE_ID,
    "requisition": 300,
    "mission_index": 0,
    "battles_won": 0,
    "battles_lost": 0,
    "campaign_complete": False,
}

# The founding squad — named, storied, and immediately deployable.
INITIAL_SQUAD = [
    ("Frank Hayes", "rifleman", "active", 140, 7, 2, "Eagle Eye", "Duluth, MN"),
    ("Walter Kowalski", "rifleman", "active", 60, 3, 1, "Farm Boy", "Cedar Falls, IA"),
    ("James Baker", "rifleman", "active", 0, 0, 0, "Brooklyn Brawler", "Erie, PA"),
    ("Chester Pruitt", "medic", "active", 90, 1, 2, "Bible Thumper", "Savannah, GA"),
    ("Raymond Boyd", "mg", "active", 120, 6, 2, "Tough Bastard", "Amarillo, TX"),
    ("Earl Whitaker", "sniper", "reserve", 160, 8, 2, "Dead Shot", "Bend, OR"),
    ("Norman Doyle", "rifleman", "reserve", 0, 0, 0, "Quiet One", "Roanoke, VA"),
]

# The war didn't start when this app did — two men were already on the wall.
INITIAL_MEMORIAL = [
    {
        "name": "Dale Mercer",
        "type": "mg",
        "kills": 11,
        "missions_survived": 3,
        "cause": "MG42 fire",
        "mission_code": "OPERATION TONGA",
        "died_at": "1944-06-06T00:00:00Z",
    },
    {
        "name": "Otis Crane",
        "type": "rifleman",
        "kills": 5,
        "missions_survived": 1,
        "cause": "Mortar bombardment",
        "mission_code": "OPERATION COPPERHEAD",
        "died_at": "1944-06-11T00:00:00Z",
    },
]


async def get_state() -> dict:
    state = await db.game_state.find_one({"id": STATE_ID})
    if not state:
        await db.game_state.insert_one(dict(DEFAULT_STATE))
        state = dict(DEFAULT_STATE)
    return state


async def seed_all() -> None:
    """Idempotent: fills only what is missing. Safe to run on every boot/seed call."""
    await get_state()
    if await db.soldiers.count_documents({}) == 0:
        docs = []
        for name, unit_type, status, xp, kills, missions, quirk, hometown in INITIAL_SQUAD:
            doc = make_soldier(unit_type, status)
            doc.update(
                {
                    "name": name,
                    "xp": xp,
                    "kills": kills,
                    "missions": missions,
                    "quirk": quirk,
                    "hometown": hometown,
                }
            )
            docs.append(doc)
        await db.soldiers.insert_many(docs)
    if await db.memorial.count_documents({}) == 0:
        docs = []
        for entry in INITIAL_MEMORIAL:
            docs.append(
                {
                    "id": str(len(docs) + 1),
                    **entry,
                    "rank": rank_for(entry["kills"] * XP_PER_KILL),
                }
            )
        await db.memorial.insert_many(docs)
