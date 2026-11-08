"""Pydantic v2 models — each has a hand-written TS mirror in frontend/src/lib/types.ts."""

from datetime import datetime, timezone
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field
import uuid

UnitType = Literal["rifleman", "medic", "mg", "sniper", "at"]
SoldierStatus = Literal["active", "reserve"]
EnemyType = Literal["volks", "grenadier", "mg42", "officer", "panzerfaust", "flak"]
DecorKind = Literal["poppies", "roses", "lilies", "wreath", "candle", "flag"]


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
    level: int = 0  # derived: one level per mission survived
    rank: str = "Pvt."  # derived from level
    quirk: str = ""
    hometown: str = ""
    unit: str = ""
    backstory: str = ""
    portrait_seed: int = 0
    medals: List[str] = []
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
    commander_name: str
    commander_level: int
    commander_rank: str
    commander_max_level: int
    wins_to_next_level: int  # 0 at max level
    max_squad: int
    hire_discount: float  # 0..1
    combat_bonus: float  # 0..1, aim + reaction bonus for every deployed man
    hire_costs: Dict[str, int]


class CommanderIn(BaseModel):
    name: str = Field(min_length=1, max_length=32)


class FallenIn(BaseModel):
    soldier_id: str
    cause: str
    kills: int = 0
    damage_taken: float = 0
    healed: float = 0
    heavy_kills: int = 0  # MG42 nests / Flak guns destroyed
    officer_kills: int = 0


class SurvivorIn(BaseModel):
    soldier_id: str
    kills: int
    damage_taken: float = 0
    healed: float = 0
    heavy_kills: int = 0
    officer_kills: int = 0


class WipeIn(BaseModel):
    confirm: str  # must be exactly "RESET"


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
    unit: str = ""
    hometown: str = ""
    story: str = ""
    portrait_seed: int = 0
    medals: List[str] = []
    grave_x: Optional[float] = None  # 0..1 position in the graveyard, None = not yet laid
    grave_y: Optional[float] = None


class GraveIn(BaseModel):
    x: Optional[float] = Field(default=None, ge=0, le=1)
    y: Optional[float] = Field(default=None, ge=0, le=1)


class DecorIn(BaseModel):
    kind: DecorKind
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class DecorMoveIn(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class DecorOut(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    kind: DecorKind
    x: float
    y: float


class BattleResultOut(BaseModel):
    requisition: int
    mission_index: int
    campaign_complete: bool
    memorial_names: List[str] = []
    promotions: List[str] = []
    medals_awarded: List[str] = []  # "Name — Silver Star"
    commander_promoted: bool = False
    commander_rank: str = ""
