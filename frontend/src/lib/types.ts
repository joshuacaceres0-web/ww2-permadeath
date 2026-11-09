// Hand-written mirrors of the backend Pydantic models (backend/models/models.py).
// Nothing infers across the HTTP boundary — keep these in sync in the same edit.

export type UnitTypeId = "rifleman" | "medic" | "mg" | "sniper" | "at";
export type EnemyTypeId =
  | "volks"
  | "grenadier"
  | "mg42"
  | "officer"
  | "panzerfaust"
  | "flak"
  | "scharfschutze"
  | "mortar"
  | "fallschirmjager";
export type SoldierStatus = "active" | "reserve";
export type DecorKind = "poppies" | "roses" | "lilies" | "wreath" | "candle" | "flag";

export interface MissionEnemy {
  type: EnemyTypeId;
  wave: number;
  count: number;
}

export interface Mission {
  id: string;
  index: number;
  code: string;
  location: string;
  objective: string;
  difficulty: string;
  reward: number;
  terrain: string;
  brief: string;
  enemies: MissionEnemy[];
}

export interface Soldier {
  id: string;
  name: string;
  type: UnitTypeId;
  status: SoldierStatus;
  xp: number;
  kills: number;
  missions: number;
  level: number;
  rank: string;
  quirk: string;
  hometown: string;
  unit: string;
  backstory: string;
  portrait_seed: number;
  medals: string[];
  hired_at: string;
}

export interface GameState {
  requisition: number;
  mission_index: number;
  battles_won: number;
  battles_lost: number;
  campaign_complete: boolean;
  commander_name: string;
  commander_level: number;
  commander_rank: string;
  commander_max_level: number;
  wins_to_next_level: number;
  max_squad: number;
  hire_discount: number;
  combat_bonus: number;
  hire_costs: Record<UnitTypeId, number>;
}

export interface MemorialEntry {
  id: string;
  name: string;
  type: UnitTypeId;
  rank: string;
  kills: number;
  missions_survived: number;
  cause: string;
  mission_code: string;
  died_at: string;
  unit: string;
  hometown: string;
  story: string;
  portrait_seed: number;
  medals: string[];
  grave_x: number | null;
  grave_y: number | null;
}

export interface Decor {
  id: string;
  kind: DecorKind;
  x: number;
  y: number;
}

export interface BattleResult {
  requisition: number;
  mission_index: number;
  campaign_complete: boolean;
  memorial_names: string[];
  promotions: string[];
  medals_awarded: string[];
  commander_promoted: boolean;
  commander_rank: string;
}

export type ReinforcementKind = "rifle" | "heavy";

export interface ReinforceOut {
  kind: ReinforcementKind;
  cost: number;
  requisition: number;
}

export interface SaveSummary {
  exists: boolean;
  mission_code: string | null;
  mission_index: number;
  campaign_complete: boolean;
  requisition: number;
  squad_size: number;
  fallen: number;
}
