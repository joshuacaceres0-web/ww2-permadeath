"""Squad management: roster reads, hiring (requisition), active/reserve assignment."""

from typing import List

from fastapi import APIRouter, HTTPException
from models.models import HireIn, SoldierOut, StatusIn, UnitType
from lib.db import db
from lib.gen import make_soldier
from lib.missions import UNIT_COSTS
from lib.state import get_state

router = APIRouter()

MAX_ACTIVE = 5


def soldier_out(doc: dict) -> SoldierOut:
    return SoldierOut(**doc)


@router.get("/squad", response_model=List[SoldierOut])
async def get_squad():
    docs = await db.soldiers.find().to_list(500)
    docs.sort(key=lambda d: (0 if d.get("status") == "active" else 1, d.get("hired_at", "")))
    return [soldier_out(d) for d in docs]


@router.post("/squad/hire", response_model=SoldierOut)
async def hire_soldier(input: HireIn):
    state = await get_state()
    roster = await db.soldiers.count_documents({})
    cost = 0 if roster == 0 else UNIT_COSTS[input.type]  # emergency conscription when the line is empty
    if state["requisition"] < cost:
        raise HTTPException(status_code=402, detail="Insufficient requisition points")

    active = await db.soldiers.count_documents({"status": "active"})
    doc = make_soldier(input.type, "active" if active < MAX_ACTIVE else "reserve")
    await db.soldiers.insert_one(doc)
    if cost:
        await db.game_state.update_one(
            {"id": state["id"]}, {"$inc": {"requisition": -cost}}
        )
    return soldier_out(doc)


@router.post("/squad/{soldier_id}/status", response_model=SoldierOut)
async def set_soldier_status(soldier_id: str, input: StatusIn):
    doc = await db.soldiers.find_one({"id": soldier_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Soldier not found")
    if input.status == "active":
        active = await db.soldiers.count_documents({"status": "active"})
        if doc["status"] != "active" and active >= MAX_ACTIVE:
            raise HTTPException(
                status_code=409,
                detail=f"Deployment squad is full ({MAX_ACTIVE} men max) — bench someone first",
            )
    await db.soldiers.update_one({"id": soldier_id}, {"$set": {"status": input.status}})
    doc["status"] = input.status
    return soldier_out(doc)
