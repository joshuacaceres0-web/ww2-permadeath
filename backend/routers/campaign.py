"""Campaign: game state, mission list, battle reports (victory rewards + permadeath)."""

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, HTTPException
from models.models import (
    BattleCompleteIn,
    BattleResultOut,
    FallenIn,
    GameStateOut,
    MissionOut,
    SurvivorIn,
)
from lib.db import db
from lib.gen import rank_for, XP_PER_KILL, XP_PER_MISSION
from lib.missions import mission_by_index, mission_list
from lib.state import get_state, seed_all, STATE_ID

router = APIRouter()


@router.get("/state", response_model=GameStateOut)
async def read_state():
    state = await get_state()
    return GameStateOut(
        requisition=state["requisition"],
        mission_index=state["mission_index"],
        battles_won=state["battles_won"],
        battles_lost=state["battles_lost"],
        campaign_complete=state["campaign_complete"],
    )


@router.get("/missions", response_model=List[MissionOut])
async def get_missions():
    return mission_list()


@router.post("/battle/complete", response_model=BattleResultOut)
async def battle_complete(input: BattleCompleteIn):
    state = await get_state()
    if state["campaign_complete"]:
        raise HTTPException(status_code=409, detail="Campaign already complete")
    mission = mission_by_index(state["mission_index"])
    if not mission or mission.id != input.mission_id:
        raise HTTPException(status_code=409, detail="That mission is not the current operation")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    memorial_names: list[str] = []

    # Permadeath: every fallen soldier is deleted from the roster and etched onto the wall.
    for fallen in input.fallen:
        doc = await db.soldiers.find_one({"id": fallen.soldier_id})
        if not doc:
            continue
        entry = {
            "id": doc["id"],
            "name": doc["name"],
            "type": doc["type"],
            "rank": rank_for(doc.get("xp", 0) + fallen.kills * XP_PER_KILL),
            "kills": doc.get("kills", 0) + fallen.kills,
            "missions_survived": doc.get("missions", 0),
            "cause": fallen.cause or "Killed in action",
            "mission_code": mission.code,
            "died_at": now,
        }
        await db.memorial.insert_one(entry)
        await db.soldiers.delete_one({"id": fallen.soldier_id})
        memorial_names.append(doc["name"])

    # Survivors bank kills and mission XP; the server computes XP from kills.
    for survivor in input.survivors:
        xp = survivor.kills * XP_PER_KILL + (XP_PER_MISSION if input.victory else 0)
        await db.soldiers.update_one(
            {"id": survivor.soldier_id},
            {"$inc": {"kills": survivor.kills, "xp": xp, "missions": 1 if input.victory else 0}},
        )

    mission_index = state["mission_index"]
    campaign_complete = state["campaign_complete"]
    if input.victory:
        mission_index = min(mission_index + 1, len(mission_list()))
        campaign_complete = mission_index >= len(mission_list())
    await db.game_state.update_one(
        {"id": STATE_ID},
        {
            "$set": {"mission_index": mission_index, "campaign_complete": campaign_complete},
            "$inc": {
                "requisition": mission.reward if input.victory else 0,
                "battles_won": 1 if input.victory else 0,
                "battles_lost": 0 if input.victory else 1,
            },
        },
    )
    return BattleResultOut(
        requisition=state["requisition"] + (mission.reward if input.victory else 0),
        mission_index=mission_index,
        campaign_complete=campaign_complete,
        memorial_names=memorial_names,
    )


@router.post("/campaign/reset", response_model=GameStateOut)
async def reset_campaign():
    """Fresh campaign: state + roster reset, the memorial stands forever."""
    await db.soldiers.delete_many({})
    await db.game_state.update_one(
        {"id": STATE_ID},
        {
            "$set": {
                "requisition": 300,
                "mission_index": 0,
                "battles_won": 0,
                "battles_lost": 0,
                "campaign_complete": False,
            }
        },
        upsert=True,
    )
    await seed_all()
    state = await get_state()
    return GameStateOut(
        requisition=state["requisition"],
        mission_index=state["mission_index"],
        battles_won=state["battles_won"],
        battles_lost=state["battles_lost"],
        campaign_complete=state["campaign_complete"],
    )
