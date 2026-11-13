"""Pydantic v2 models — each has a hand-written TS mirror in frontend/src/lib/types.ts."""

from datetime import datetime, timezone
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field
import uuid

UnitType = Literal["rifleman", "medic", "mg", "sniper", "at", "radioman", "recon", "engineer"]
SoldierStatus = Literal["active", "reserve"]
EnemyType = Literal["volks", "grenadier", "mg42", "officer", "panzerfaust", "flak", "scharfschutze", "mortar", "fallschirmjager", "medic", "funk", "panzer"]
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
    # Barracks update (Josh, 2026-11-13): spendable upgrade
    # points the man earned himself, his upgrade levels by
    # track, and the stores gear he carries (max 2, no dupes).
    points: int = 0
    upgrades: Dict[str, int] = {}
    equipment: List[str] = []
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
    # Squad stores: item id -> count owned (equipped gear is
    # on the men, not counted here).
    inventory: Dict[str, int] = {}


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
    # Men who broke and ran off the field. Deleted from the roster
    # like the fallen, but never etched on the Memorial — they did not die.
    deserted: List[FallenIn] = []
    survivors: List[SurvivorIn] = []
    loot_rp: int = 0  # RP looted from supply crates this battle.
    # The stores item a supply crate held alongside its RP, if
    # any (engine rolls it; one crate per battle at most).
    loot_item: str | None = None
    # Idempotency key, one per deployment (frontend generates it when a
    # battle is deployed). The same battle filed twice — retry after a
    # failed request, a pagehide retreat beacon racing the hud effect,
    # a reload — must count once. Clients that omit it get the old
    # behaviour (no dedupe), so existing tests still pass.
    battle_id: str | None = None


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


class DecorIn(BaseModel):
    kind: DecorKind
    # Tributes belong to a man (Josh, 2026-11-12): the client says
    # WHOSE grave and WHAT kind; the server lays it by his stone.
    entry_id: str


class DecorMoveIn(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class DecorOut(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    kind: DecorKind
    x: float
    y: float
    # The fallen man this tribute belongs to. None only on legacy
    # field-scatter tributes placed before tributes were per-man.
    entry_id: Optional[str] = None


class ItemGainOut(BaseModel):
    item: str
    source: str  # "loot" (a battlefield crate) or "mission" (a victory award)


class BattleResultOut(BaseModel):
    requisition: int
    mission_index: int
    campaign_complete: bool
    memorial_names: List[str] = []
    promotions: List[str] = []
    medals_awarded: List[str] = []  # "Name — Silver Star"
    commander_promoted: bool = False
    commander_rank: str = ""
    # Barracks update: upgrade points each survivor banked
    # (soldier_id -> points), stores items the battle brought
    # in, and the gear that died with the fallen and the
    # deserted (death takes everything — nothing returns).
    points_gained: Dict[str, int] = {}
    items_gained: List[ItemGainOut] = []
    gear_lost: List[str] = []


ReinforcementKind = Literal["rifle", "heavy"]


class ReinforceIn(BaseModel):
    mission_id: str
    kind: ReinforcementKind


class ReinforceOut(BaseModel):
    kind: ReinforcementKind
    cost: int
    requisition: int


class RadioSupportIn(BaseModel):
    mission_id: str
    kind: str  # one of RADIO_SUPPORT_COST (supply, recon, mortar, smoke, artillery, tank)


class RadioSupportOut(BaseModel):
    kind: str
    cost: int
    requisition: int


class UpgradeIn(BaseModel):
    soldier_id: str
    track: str


class EquipIn(BaseModel):
    soldier_id: str
    item: str


class BuyItemIn(BaseModel):
    item: str


class LastBattleOut(BaseModel):
    mission_code: str
    victory: bool
    fallen: List[str] = []
    survivors: int = 0
    at: str


class SaveSummaryOut(BaseModel):
    """Read-only peek at the save for the start menu; never creates or changes anything."""

    exists: bool
    mission_code: str | None = None
    mission_index: int = 0
    campaign_complete: bool = False
    requisition: int = 0
    squad_size: int = 0
    fallen: int = 0
    last_battle: LastBattleOut | None = None
