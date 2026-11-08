"""Memorial wall — the permanent casualty archive."""

from typing import List

from fastapi import APIRouter
from models.models import MemorialOut
from lib.db import db

router = APIRouter()


@router.get("/memorial", response_model=List[MemorialOut])
async def get_memorial():
    docs = await db.memorial.find().to_list(1000)
    docs.sort(key=lambda d: d.get("died_at", ""), reverse=True)
    return [MemorialOut(**d) for d in docs]
