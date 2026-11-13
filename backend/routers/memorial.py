"""Memorial wall — permanent casualty archive + the graveyard.

Graves are laid by the game, not the player (Josh, 2026-11-12):
every fallen man already rests in the ground, in the order the
men fell. The player's only hands-on work here is tending —
placing tributes on a grave he picks. There is deliberately no
endpoint that places or moves a grave.
"""

from typing import List

from fastapi import APIRouter, HTTPException
from models.models import DecorIn, DecorMoveIn, DecorOut, MemorialOut
from lib.db import db
from lib.save import S
from lib.state import memorial_out
from lib.graves import assign_graves, decor_position, grave_of

router = APIRouter()

MAX_DECOR = 300


async def ensure_graves() -> list[dict]:
    """All memorial docs in fall order, every one with a grave.

    Entries that already have a position keep it untouched (the
    seeded stones, and any stone placed under the old system);
    entries without one are assigned the next clear plot in fall
    order and the assignment is persisted.
    """
    docs = await S.memorial.find().to_list(1000)
    assignments = assign_graves(docs)
    for entry_id, (x, y) in assignments.items():
        await S.memorial.update_one({"id": entry_id}, {"$set": {"grave_x": x, "grave_y": y}})
    for d in docs:
        if d["id"] in assignments:
            d["grave_x"], d["grave_y"] = assignments[d["id"]]
    return docs


@router.get("/memorial", response_model=List[MemorialOut])
async def get_memorial():
    docs = await ensure_graves()
    docs.sort(key=lambda d: d.get("died_at", ""), reverse=True)
    return [memorial_out(d) for d in docs]


@router.get("/graveyard/decor", response_model=List[DecorOut])
async def list_decor():
    docs = await S.graveyard_decor.find().to_list(MAX_DECOR)
    return [DecorOut(**d) for d in docs]


@router.post("/graveyard/decor", response_model=DecorOut)
async def add_decor(input: DecorIn):
    """Lay a tribute on one man's grave. The position is the
    game's: by his stone, per kind, stacking with his others."""
    if await S.graveyard_decor.count_documents({}) >= MAX_DECOR:
        raise HTTPException(status_code=409, detail=f"The graveyard holds at most {MAX_DECOR} tributes")
    entry = await S.memorial.find_one({"id": input.entry_id})
    if not entry:
        raise HTTPException(status_code=404, detail="Memorial entry not found")
    if grave_of(entry) is None:
        # His grave lands first (it always does — this is a
        # backstop for a tribute filed in the same breath as the
        # battle report that etched him).
        docs = await ensure_graves()
        entry = next((d for d in docs if d["id"] == input.entry_id), entry)
    gx, gy = grave_of(entry)
    same_kind = await S.graveyard_decor.count_documents(
        {"entry_id": input.entry_id, "kind": input.kind}
    )
    x, y = decor_position(gx, gy, input.kind, same_kind)
    decor = DecorOut(kind=input.kind, x=x, y=y, entry_id=input.entry_id)
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
