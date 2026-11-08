"""Pydantic v2 models — each has a hand-written TS mirror in frontend/src/lib/types.ts."""

from datetime import datetime, timezone
from typing import List, Literal

from pydantic import BaseModel, Field
import uuid

UnitType = Literal["rifleman", "medic", "mg", "sniper", "at"]
SoldierStatus = Literal["active", "reserve"]
EnemyType = Literal["volks", "grenadier", "mg42", "officer", "panzerfaust", "flak"]


class MissionEnemy(BaseModel):
    type: EnemyType
    wave: int
    count: int


class MissionOut(BaseModel):
    id: str
    index: int
    code: str
    location: str
    objective: str
    difficulty: str
    reward: int
    terrain: str
    brief: str
    enemies: List[MissionEnemy]


class SoldierOut(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    type: UnitType
    status: SoldierStatus
    xp: int = 0
    kills: int = 0
    missions: int = 0
    quirk: str = ""
    hometown: str = ""
    hired_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    )


class HireIn(BaseModel):
    type: UnitType


class StatusIn(BaseModel):
    status: SoldierStatus


class GameStateOut(BaseModel):
    requisition: int
    mission_index: int
    battles_won: int
    battles_lost: int
    campaign_complete: bool


class FallenIn(BaseModel):
    soldier_id: str
    cause: str
    kills: int = 0


class SurvivorIn(BaseModel):
    soldier_id: str
    kills: int


class BattleCompleteIn(BaseModel):
    mission_id: str
    victory: bool
    duration_sec: float = 0
    fallen: List[FallenIn] = []
    survivors: List[SurvivorIn] = []


class MemorialOut(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    type: UnitType
    rank: str
    kills: int = 0
    missions_survived: int = 0
    cause: str
    mission_code: str
    died_at: str


class BattleResultOut(BaseModel):
    requisition: int
    mission_index: int
    campaign_complete: bool
    memorial_names: List[str] = []
