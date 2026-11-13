"""Squad management: roster reads, hiring (requisition), deployment vs. frozen reserve."""

from typing import List

from fastapi import APIRouter, HTTPException
from models.models import BuyItemIn, EquipIn, GameStateOut, HireIn, SoldierOut, StatusIn, UpgradeIn
from lib.db import db
from lib.save import S, save_lock
from lib.gen import make_soldier
from lib.items import EQUIP_SLOTS, ITEMS, UPGRADE_CAP, UPGRADE_COST, UPGRADE_TRACKS
from lib.state import commander_info, get_state, soldier_out, state_out

router = APIRouter()


@router.get("/squad", response_model=List[SoldierOut])
async def get_squad():
    await get_state()  # first touch of a new save creates it (and its founding squad) atomically
    docs = await S.soldiers.find().to_list(500)
    docs.sort(key=lambda d: (0 if d.get("status") == "active" else 1, d.get("hired_at", "")))
    return [soldier_out(d) for d in docs]


@router.post("/squad/hire", response_model=SoldierOut)
async def hire_soldier(input: HireIn):
    state = await get_state()
    info = commander_info(state)
    roster = await S.soldiers.count_documents({})
    cost = 0 if roster == 0 else info["hire_costs"][input.type]  # emergency conscription when the line is empty
    if state["requisition"] < cost:
        raise HTTPException(status_code=402, detail="Insufficient requisition points")

    active = await S.soldiers.count_documents({"status": "active"})
    doc = make_soldier(input.type, "active" if active < info["max_squad"] else "reserve")
    await S.soldiers.insert_one(doc)
    if cost:
        await S.game_state.update_one({"id": state["id"]}, {"$inc": {"requisition": -cost}})
    return soldier_out(doc)


@router.post("/squad/{soldier_id}/status", response_model=SoldierOut)
async def set_soldier_status(soldier_id: str, input: StatusIn):
    doc = await S.soldiers.find_one({"id": soldier_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Soldier not found")
    if input.status == "active" and doc["status"] != "active":
        max_squad = commander_info(await get_state())["max_squad"]
        active = await S.soldiers.count_documents({"status": "active"})
        if active >= max_squad:
            raise HTTPException(
                status_code=409,
                detail=f"Deployment squad is full ({max_squad} men max at your rank) — send someone to reserve first",
            )
    await S.soldiers.update_one({"id": soldier_id}, {"$set": {"status": input.status}})
    doc["status"] = input.status
    return soldier_out(doc)


# ---------------- Barracks update: upgrades + stores ----------------
# (Josh, 2026-11-13. Rules live in lib/items.py.)


@router.post("/squad/upgrade", response_model=SoldierOut)
async def upgrade_soldier(input: UpgradeIn):
    async with save_lock():
        doc = await S.soldiers.find_one({"id": input.soldier_id})
        if not doc:
            raise HTTPException(status_code=404, detail="Soldier not found")
        if input.track not in UPGRADE_TRACKS:
            raise HTTPException(status_code=400, detail="Unknown upgrade track")
        upgrades = dict(doc.get("upgrades") or {})
        level = upgrades.get(input.track, 0)
        if level >= UPGRADE_CAP:
            raise HTTPException(status_code=400, detail="That upgrade is already at its cap")
        if (doc.get("points") or 0) < UPGRADE_COST:
            raise HTTPException(status_code=402, detail="Not enough upgrade points — he earns them by surviving battles")
        upgrades[input.track] = level + 1
        await S.soldiers.update_one(
            {"id": input.soldier_id},
            {"$inc": {"points": -UPGRADE_COST}, "$set": {"upgrades": upgrades}},
        )
        doc["points"] = (doc.get("points") or 0) - UPGRADE_COST
        doc["upgrades"] = upgrades
        return soldier_out(doc)


@router.post("/squad/equip", response_model=SoldierOut)
async def equip_item(input: EquipIn):
    async with save_lock():
        if input.item not in ITEMS:
            raise HTTPException(status_code=400, detail="Unknown item")
        doc = await S.soldiers.find_one({"id": input.soldier_id})
        if not doc:
            raise HTTPException(status_code=404, detail="Soldier not found")
        restrict = ITEMS[input.item]["restrict"]
        if restrict and doc["type"] not in restrict:
            raise HTTPException(
                status_code=400,
                detail=f"Only {' / '.join(restrict)} can carry that",
            )
        equipment = list(doc.get("equipment") or [])
        if input.item in equipment:
            raise HTTPException(status_code=400, detail="He already carries one")
        if len(equipment) >= EQUIP_SLOTS:
            raise HTTPException(status_code=400, detail="Both of his slots are full")
        state = await get_state()
        inventory = dict(state.get("inventory") or {})
        if inventory.get(input.item, 0) < 1:
            raise HTTPException(status_code=400, detail="None in stores")
        inventory[input.item] -= 1
        equipment.append(input.item)
        await S.game_state.update_one({"id": state["id"]}, {"$set": {"inventory": inventory}})
        await S.soldiers.update_one({"id": input.soldier_id}, {"$set": {"equipment": equipment}})
        doc["equipment"] = equipment
        return soldier_out(doc)


@router.post("/squad/unequip", response_model=SoldierOut)
async def unequip_item(input: EquipIn):
    async with save_lock():
        doc = await S.soldiers.find_one({"id": input.soldier_id})
        if not doc:
            raise HTTPException(status_code=404, detail="Soldier not found")
        equipment = list(doc.get("equipment") or [])
        if input.item not in equipment:
            raise HTTPException(status_code=400, detail="He is not carrying that")
        equipment.remove(input.item)
        state = await get_state()
        inventory = dict(state.get("inventory") or {})
        inventory[input.item] = inventory.get(input.item, 0) + 1
        await S.game_state.update_one({"id": state["id"]}, {"$set": {"inventory": inventory}})
        await S.soldiers.update_one({"id": input.soldier_id}, {"$set": {"equipment": equipment}})
        doc["equipment"] = equipment
        return soldier_out(doc)


@router.post("/inventory/buy", response_model=GameStateOut)
async def buy_item(input: BuyItemIn):
    async with save_lock():
        if input.item not in ITEMS:
            raise HTTPException(status_code=400, detail="Unknown item")
        state = await get_state()
        price = ITEMS[input.item]["price"]
        if state["requisition"] < price:
            raise HTTPException(status_code=402, detail="Insufficient requisition points")
        inventory = dict(state.get("inventory") or {})
        inventory[input.item] = inventory.get(input.item, 0) + 1
        await S.game_state.update_one(
            {"id": state["id"]},
            {"$inc": {"requisition": -price}, "$set": {"inventory": inventory}},
        )
        state["requisition"] -= price
        state["inventory"] = inventory
        return state_out(state)
