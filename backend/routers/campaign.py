"""Campaign: game state, commander, mission list, battle reports (rewards, promotions, permadeath)."""

from datetime import datetime, timezone
from typing import List
import hashlib
import json

from fastapi import APIRouter, HTTPException
from models.models import (
    BattleCompleteIn,
    BattleResultOut,
    CommanderIn,
    GameStateOut,
    MissionOut,
    RadioSupportIn,
    RadioSupportOut,
    ReinforceIn,
    ReinforceOut,
    SaveSummaryOut,
    LastBattleOut,
    WipeIn,
)
from lib.db import db
from lib.save import S, save_lock, sid
from lib.gen import XP_PER_KILL, XP_PER_MISSION, commander_level, COMMANDER_RANKS, level_for, make_epitaph, rank_for
from lib.medals import NAMES, award
from lib.missions import RADIO_SUPPORT_COST, battle_reward, mission_by_index, mission_list, radio_cost
from lib.state import DEFAULT_STATE, STATE_ID, career_wins, get_state, seed_squad, state_out
from lib.graves import assign_graves

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
MAX_REINFORCEMENTS = 3


async def radioman_level() -> int:
    """Highest level (0-6) among the radiomen in the deployed squad,
    or 0 when there is none. A rookie pays full cost; a veteran pays
    5% less per level (max 30% off at level 6)."""
    docs = await S.soldiers.find({"status": "active", "type": "radioman"}).to_list(10)
    return max((level_for(d.get("missions", 0)) for d in docs), default=0)


@router.post("/battle/reinforce", response_model=ReinforceOut)
async def battle_reinforce(input: ReinforceIn):
    """Spend requisition mid-battle to call in an AI-controlled 2nd Platoon team.

    The max-3 cap is enforced here, server-side, under the save lock:
    the old code only checked RP, so a direct API caller could buy
    unlimited teams (the frontend's MAX_REINFORCEMENTS never reached
    the server). The counter is per current mission attempt — a new
    mission, or a filed battle, resets it.
    """
    async with save_lock():
        state = await get_state()
        mission = mission_by_index(state["mission_index"])
        if state["campaign_complete"] or not mission or mission.id != input.mission_id:
            raise HTTPException(status_code=409, detail="That mission is not the current operation")
        level = await radioman_level()
        if level == 0 and await S.soldiers.count_documents({"status": "active", "type": "radioman"}) == 0:
            raise HTTPException(status_code=409, detail="Radio is down — no radioman in the squad")
        cost = radio_cost(REINFORCEMENT_COST[input.kind], level)
        used = state.get("reinforcements_used", 0) if state.get("reinforcements_mission") == input.mission_id else 0
        if used >= MAX_REINFORCEMENTS:
            raise HTTPException(status_code=409, detail="No reinforcements left for this operation (max 3)")
        res = await S.game_state.update_one(
            {"id": STATE_ID, "requisition": {"$gte": cost}},
            {
                "$inc": {"requisition": -cost},
                "$set": {"reinforcements_used": used + 1, "reinforcements_mission": input.mission_id},
            },
        )
        if res.modified_count == 0:
            raise HTTPException(status_code=402, detail="Insufficient requisition points")
        after = await get_state()
        return ReinforceOut(kind=input.kind, cost=cost, requisition=after["requisition"])


@router.post("/battle/radio-support", response_model=RadioSupportOut)
async def battle_radio_support(input: RadioSupportIn):
    """Charge requisition for one radio support call, at the radioman's
    discounted price. The frontend calls the engine to fire the call
    only after this succeeds."""
    if input.kind not in RADIO_SUPPORT_COST:
        raise HTTPException(status_code=422, detail="Unknown radio support call")
    async with save_lock():
        state = await get_state()
        mission = mission_by_index(state["mission_index"])
        if state["campaign_complete"] or not mission or mission.id != input.mission_id:
            raise HTTPException(status_code=409, detail="That mission is not the current operation")
        level = await radioman_level()
        if level == 0 and await S.soldiers.count_documents({"status": "active", "type": "radioman"}) == 0:
            raise HTTPException(status_code=409, detail="Radio is down — no radioman in the squad")
        cost = radio_cost(RADIO_SUPPORT_COST[input.kind], level)
        res = await S.game_state.update_one(
            {"id": STATE_ID, "requisition": {"$gte": cost}},
            {"$inc": {"requisition": -cost}},
        )
        if res.modified_count == 0:
            raise HTTPException(status_code=402, detail="Insufficient requisition points")
        after = await get_state()
        return RadioSupportOut(kind=input.kind, cost=cost, requisition=after["requisition"])


@router.post("/battle/complete", response_model=BattleResultOut)
async def battle_complete(input: BattleCompleteIn):
    # The whole filing is serialised per save: two concurrent POSTs for the
    # same battle (hud effect + pagehide beacon, or a retry) used to both
    # read the pre-battle state, both increment battles_won/lost, both
    # advance the mission and both pay the reward — Battles Lost went 1->3
    # before a battle was fought, then 3->5 for one defeat.
    async with save_lock():
        return await _battle_complete_locked(input)


async def _battle_complete_locked(input: BattleCompleteIn) -> BattleResultOut:
    state = await get_state()
    # Idempotency: a battle_id already filed returns the current result
    # as a no-op, without touching RP, mission, wins/losses or the
    # memorial. This also stops a second filing overwriting last_battle
    # with an empty fallen list (the "No men lost" start-menu bug).
    # Filings without a battle_id get the same protection from a
    # content fingerprint (bug #14): two identical POSTs — same
    # mission, result, duration and fallen/survivor lists — are a
    # retry, not two battles. A genuinely different battle differs in
    # at least one of those fields, and the frontend always sends a
    # battle_id anyway, so the fingerprint only affects old / direct
    # API callers.
    if input.battle_id:
        filing_key = input.battle_id
    else:
        fingerprint = {
            "mission_id": input.mission_id,
            "victory": input.victory,
            "duration_sec": round(input.duration_sec, 1),
            "fallen": sorted(
                (f.soldier_id, f.cause or "", f.kills) for f in input.fallen
            ),
            "deserted": sorted(
                (f.soldier_id, f.cause or "", f.kills) for f in input.deserted
            ),
            "loot_rp": input.loot_rp,
            "survivors": sorted((s.soldier_id, s.kills) for s in input.survivors),
        }
        filing_key = "fp:" + hashlib.sha256(
            json.dumps(fingerprint, sort_keys=True).encode()
        ).hexdigest()[:16]
    filed = state.get("filed_battles") or []
    if filing_key in filed:
        return BattleResultOut(
            requisition=state["requisition"],
            mission_index=state["mission_index"],
            campaign_complete=state["campaign_complete"],
            memorial_names=[],
            promotions=[],
            medals_awarded=[],
            commander_promoted=False,
            commander_rank=COMMANDER_RANKS[commander_level(career_wins(state)) - 1],
        )
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
    # His grave is laid by the game as the report files (Josh, 2026-11-12): keep a
    # running picture of the memorial ground in fall order so each new stone takes
    # the next clear plot behind the men who fell before him.
    grave_docs = await S.memorial.find().to_list(1000)
    for fallen in input.fallen:
        doc = await S.soldiers.find_one({"id": fallen.soldier_id})
        if not doc:
            continue
        kills = doc.get("kills", 0) + fallen.kills
        cause = fallen.cause or "Killed in action"
        new_medals = award(fallen, doc["type"], False, input.victory, False, doc.get("medals", []))
        for m in new_medals:
            medals_awarded.append(f"{doc['name']} — {NAMES[m]} (posthumous)")
        # Guard against a duplicate memorial entry for the same soldier:
        # a re-filed report (or a double-seeded roster) must never put
        # Chester Pruitt on the wall twice.
        existing = await S.memorial.find_one({"id": doc["id"]})
        if not existing:
            new_entry = {
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
            gx, gy = assign_graves(grave_docs + [new_entry])[doc["id"]]
            new_entry["grave_x"], new_entry["grave_y"] = gx, gy
            await S.memorial.insert_one(new_entry)
            grave_docs.append(new_entry)
        await S.soldiers.delete_one({"id": fallen.soldier_id})
        memorial_names.append(doc["name"])

    # Desertion: a man who broke and ran is gone from the roster just
    # like the fallen — but he did not die, so there is no memorial
    # entry, no epitaph, and no posthumous medal.
    for gone in input.deserted:
        doc = await S.soldiers.find_one({"id": gone.soldier_id})
        if not doc:
            continue
        await S.soldiers.delete_one({"id": gone.soldier_id})

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

    # Squad kills for the kill RP: every kill by a deployed squad
    # man, alive, fallen or deserted. NPC (2nd Platoon) kills are not
    # in the report, so they never count.
    total_kills = (
        sum(f.kills for f in input.fallen)
        + sum(g.kills for g in input.deserted)
        + sum(sv.kills for sv in input.survivors)
    )

    mission_index = state["mission_index"]
    campaign_complete = state["campaign_complete"]
    if input.victory:
        mission_index = min(mission_index + 1, len(mission_list()))
        campaign_complete = mission_index >= len(mission_list())
    state_update: dict = {
        "$set": {
            "mission_index": mission_index,
            "campaign_complete": campaign_complete,
            "career_wins": career_wins(state) + (1 if input.victory else 0),
            # A filed battle ends the attempt: the reinforcement counter
            # resets for the next mission / next attempt (bug #13).
            "reinforcements_used": 0,
            "reinforcements_mission": None,
            "last_battle": {
                "mission_code": mission.code,
                "victory": input.victory,
                "fallen": [f"{n}" for n in memorial_names],
                "survivors": len(input.survivors),
                "at": now,
            },
        },
        "$inc": {
            # A win pays the mission reward on top of the kill RP;
            # a loss pays the kill RP only. Kills are the squad's own
            # (survivors + fallen + deserted); NPC kills do not count.
            "requisition": battle_reward(mission.reward, input.victory, total_kills, input.loot_rp),
            "battles_won": 1 if input.victory else 0,
            "battles_lost": 0 if input.victory else 1,
        },
    }
    if filing_key:
        state_update["$addToSet"] = {"filed_battles": filing_key}
    await S.game_state.update_one({"id": STATE_ID}, state_update)
    return BattleResultOut(
        requisition=state["requisition"] + battle_reward(mission.reward, input.victory, total_kills, input.loot_rp),
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
        await db.game_state.replace_one({"save_id": sid(), "id": STATE_ID}, {**DEFAULT_STATE, "save_id": sid()}, upsert=True)
        await S.soldiers.delete_many({})
        await S.memorial.delete_many({})
        await S.graveyard_decor.delete_many({})
        await seed_squad()
    return state_out(await get_state())


@router.post("/campaign/reset", response_model=GameStateOut)
async def reset_campaign():
    """New campaign (Josh, 2026-11-12): the war starts over, the men
    and the dead do not. Campaign state (operation, RP, battle
    record) resets and the commander keeps his career and name,
    but every living soldier stays on the roster exactly as he
    stands — rank, kills, missions, medals, active or reserve —
    and the memorial and graveyard stand untouched: the fallen
    are a permanent record, and the only way to clear them is a
    full New Game wipe. Only a roster left completely empty (the
    whole squad fell) is refilled, by the founding squad
    reporting as replacements. Held under the save lock for the
    whole reset, so a concurrent first touch cannot re-seed
    mid-reset."""
    async with save_lock():
        state = await get_state()
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
                    "filed_battles": [],
                    "reinforcements_used": 0,
                    "reinforcements_mission": None,
                }
            },
            upsert=True,
        )
        if await S.soldiers.count_documents({}) == 0:
            await seed_squad()
        return state_out(await get_state())
