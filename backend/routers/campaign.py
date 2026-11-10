"""Campaign: game state, commander, mission list, battle reports (rewards, promotions, permadeath)."""

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, HTTPException
from models.models import (
    BattleCompleteIn,
    BattleResultOut,
    CommanderIn,
    GameStateOut,
    MissionOut,
    ReinforceIn,
    ReinforceOut,
    SaveSummaryOut,
    LastBattleOut,
    WipeIn,
)
from lib.db import db
from lib.save import S, save_lock, sid
from lib.gen import XP_PER_KILL, XP_PER_MISSION, commander_level, COMMANDER_RANKS, make_epitaph, rank_for
from lib.medals import NAMES, award
from lib.missions import mission_by_index, mission_list
from lib.state import DEFAULT_STATE, STATE_ID, career_wins, get_state, seed_all, seed_squad, state_out

router = APIRouter()


@router.get("/state", response_model=GameStateOut)
async def read_state():
    return state_out(await get_state())


@router.put("/state/commander", response_model=GameStateOut)
async def rename_commander(input: CommanderIn):
    await get_state()
    await S.game_state.update_one({"id": STATE_ID}, {"$set": {"commander_name": input.name.strip()}})
    return state_out(await get_state())


@router.get("/save/summary", response_model=SaveSummaryOut)
async def save_summary():
    """Start-menu status. Read-only: does NOT create a save if none exists."""
    st = await S.game_state.find_one({"id": STATE_ID})
    if not st:
        return SaveSummaryOut(exists=False)
    m = mission_by_index(st.get("mission_index", 0))
    return SaveSummaryOut(
        exists=True,
        mission_code=None if st.get("campaign_complete") or not m else m.code,
        mission_index=st.get("mission_index", 0),
        campaign_complete=bool(st.get("campaign_complete")),
        requisition=st.get("requisition", 0),
        squad_size=await S.soldiers.count_documents({"status": "active"}),
        fallen=await S.memorial.count_documents({}),
        last_battle=LastBattleOut(**st["last_battle"]) if st.get("last_battle") else None,
    )


@router.get("/missions", response_model=List[MissionOut])
async def get_missions():
    return mission_list()


REINFORCEMENT_COST = {"rifle": 15, "heavy": 25}


@router.post("/battle/reinforce", response_model=ReinforceOut)
async def battle_reinforce(input: ReinforceIn):
    """Spend requisition mid-battle to call in an AI-controlled 2nd Platoon team."""
    state = await get_state()
    mission = mission_by_index(state["mission_index"])
    if state["campaign_complete"] or not mission or mission.id != input.mission_id:
        raise HTTPException(status_code=409, detail="That mission is not the current operation")
    cost = REINFORCEMENT_COST[input.kind]
    res = await S.game_state.update_one(
        {"id": STATE_ID, "requisition": {"$gte": cost}}, {"$inc": {"requisition": -cost}}
    )
    if res.modified_count == 0:
        raise HTTPException(status_code=402, detail="Insufficient requisition points")
    after = await get_state()
    return ReinforceOut(kind=input.kind, cost=cost, requisition=after["requisition"])


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
    promotions: list[str] = []
    medals_awarded: list[str] = []
    sole_survivor = len(input.survivors) == 1

    # Permadeath: every fallen soldier is deleted from the roster and etched onto the wall.
    for fallen in input.fallen:
        doc = await S.soldiers.find_one({"id": fallen.soldier_id})
        if not doc:
            continue
        kills = doc.get("kills", 0) + fallen.kills
        cause = fallen.cause or "Killed in action"
        new_medals = award(fallen, doc["type"], False, input.victory, False, doc.get("medals", []))
        for m in new_medals:
            medals_awarded.append(f"{doc['name']} — {NAMES[m]} (posthumous)")
        await S.memorial.insert_one(
            {
                "id": doc["id"],
                "name": doc["name"],
                "type": doc["type"],
                "rank": rank_for(doc.get("missions", 0)),
                "kills": kills,
                "missions_survived": doc.get("missions", 0),
                "cause": cause,
                "mission_code": mission.code,
                "died_at": now,
                "unit": doc.get("unit", ""),
                "hometown": doc.get("hometown", ""),
                "portrait_seed": doc.get("portrait_seed", 0),
                "medals": doc.get("medals", []) + new_medals,
                "story": make_epitaph(doc, cause, mission.code, mission.location, kills),
                "grave_x": None,
                "grave_y": None,
            }
        )
        await S.soldiers.delete_one({"id": fallen.soldier_id})
        memorial_names.append(doc["name"])

    # Survivors bank kills and XP; a victory survived is a promotion. Only men who were
    # deployed are in this list — reserves stay frozen.
    for survivor in input.survivors:
        doc = await S.soldiers.find_one({"id": survivor.soldier_id})
        if not doc or doc.get("status") != "active":
            continue
        before = rank_for(doc.get("missions", 0))
        add_mission = 1 if input.victory else 0
        after = rank_for(doc.get("missions", 0) + add_mission)
        xp = survivor.kills * XP_PER_KILL + (XP_PER_MISSION if input.victory else 0)
        new_medals = award(survivor, doc["type"], True, input.victory, sole_survivor, doc.get("medals", []))
        update: dict = {"$inc": {"kills": survivor.kills, "xp": xp, "missions": add_mission}}
        if new_medals:
            update["$push"] = {"medals": {"$each": new_medals}}
        await S.soldiers.update_one({"id": survivor.soldier_id}, update)
        for m in new_medals:
            medals_awarded.append(f"{doc['name']} — {NAMES[m]}")
        if after != before:
            promotions.append(f"{doc['name']}: {before} → {after}")

    old_level = commander_level(career_wins(state))
    new_level = commander_level(career_wins(state) + (1 if input.victory else 0))

    mission_index = state["mission_index"]
    campaign_complete = state["campaign_complete"]
    if input.victory:
        mission_index = min(mission_index + 1, len(mission_list()))
        campaign_complete = mission_index >= len(mission_list())
    await S.game_state.update_one(
        {"id": STATE_ID},
        {
            "$set": {
                "mission_index": mission_index,
                "campaign_complete": campaign_complete,
                "career_wins": career_wins(state) + (1 if input.victory else 0),
                "last_battle": {
                    "mission_code": mission.code,
                    "victory": input.victory,
                    "fallen": [f"{n}" for n in memorial_names],
                    "survivors": len(input.survivors),
                    "at": now,
                },
            },
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
        promotions=promotions,
        medals_awarded=medals_awarded,
        commander_promoted=new_level > old_level,
        commander_rank=COMMANDER_RANKS[new_level - 1],
    )


@router.post("/campaign/wipe", response_model=GameStateOut)
async def wipe_everything(input: WipeIn):
    """Start all over: roster, campaign, commander career, memorial wall and graveyard — all gone."""
    if input.confirm != "RESET":
        raise HTTPException(status_code=400, detail='Type RESET to confirm')
    # Rewrite the save in place (never delete it) so a concurrent read can't re-seed mid-wipe.
    async with save_lock():
        await db.game_state.replace_one({"save_id": sid()}, {**DEFAULT_STATE, "save_id": sid()}, upsert=True)
        await S.soldiers.delete_many({})
        await S.memorial.delete_many({})
        await S.graveyard_decor.delete_many({})
        await seed_squad()
    return state_out(await get_state())


@router.post("/campaign/reset", response_model=GameStateOut)
async def reset_campaign():
    """Fresh campaign: state + roster reset. The memorial, graveyard and the commander's
    career (rank, name) stand forever."""
    state = await get_state()
    await S.soldiers.delete_many({})
    await S.game_state.update_one(
        {"id": STATE_ID},
        {
            "$set": {
                "last_battle": None,
                "requisition": 300,
                "mission_index": 0,
                "battles_won": 0,
                "battles_lost": 0,
                "campaign_complete": False,
                "career_wins": career_wins(state),
            }
        },
        upsert=True,
    )
    await seed_all()
    return state_out(await get_state())
