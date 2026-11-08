"""Memorial wall — permanent casualty archive + the player-arranged graveyard."""

from typing import List

from fastapi import APIRouter, HTTPException
from models.models import DecorIn, DecorMoveIn, DecorOut, GraveIn, MemorialOut
from lib.db import db
from lib.save import S
from lib.state import memorial_out

router = APIRouter()

MAX_DECOR = 300


@router.get("/memorial", response_model=List[MemorialOut])
async def get_memorial():
    docs = await S.memorial.find().to_list(1000)
    docs.sort(key=lambda d: d.get("died_at", ""), reverse=True)
    return [memorial_out(d) for d in docs]


@router.put("/memorial/{entry_id}/grave", response_model=MemorialOut)
async def place_grave(entry_id: str, input: GraveIn):
    """Lay (or move) a fallen soldier's tombstone. x/y null lifts it back to the tray."""
    if (input.x is None) != (input.y is None):
        raise HTTPException(status_code=422, detail="x and y must both be set or both be null")
    doc = await S.memorial.find_one({"id": entry_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Memorial entry not found")
    await S.memorial.update_one({"id": entry_id}, {"$set": {"grave_x": input.x, "grave_y": input.y}})
    doc.update({"grave_x": input.x, "grave_y": input.y})
    return memorial_out(doc)


@router.get("/graveyard/decor", response_model=List[DecorOut])
async def list_decor():
    docs = await S.graveyard_decor.find().to_list(MAX_DECOR)
    return [DecorOut(**d) for d in docs]


@router.post("/graveyard/decor", response_model=DecorOut)
async def add_decor(input: DecorIn):
    if await S.graveyard_decor.count_documents({}) >= MAX_DECOR:
        raise HTTPException(status_code=409, detail=f"The graveyard holds at most {MAX_DECOR} tributes")
    decor = DecorOut(**input.model_dump())
    await S.graveyard_decor.insert_one(decor.model_dump())
    return decor


@router.put("/graveyard/decor/{decor_id}", response_model=DecorOut)
async def move_decor(decor_id: str, input: DecorMoveIn):
    doc = await S.graveyard_decor.find_one({"id": decor_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Tribute not found")
    await S.graveyard_decor.update_one({"id": decor_id}, {"$set": {"x": input.x, "y": input.y}})
    doc.update({"x": input.x, "y": input.y})
    return DecorOut(**doc)


@router.delete("/graveyard/decor/{decor_id}", status_code=204)
async def remove_decor(decor_id: str):
    res = await S.graveyard_decor.delete_one({"id": decor_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Tribute not found")
