// Hand-written mirrors of the backend Pydantic models (backend/models/models.py).
// Nothing infers across the HTTP boundary — keep these in sync in the same edit.

export type UnitTypeId = "rifleman" | "medic" | "mg" | "sniper" | "at" | "radioman" | "recon" | "engineer" | "tank";
export type EnemyTypeId =
  | "volks"
  | "funk"
  | "grenadier"
  | "mg42"
  | "officer"
  | "panzerfaust"
  | "flak"
  | "scharfschutze"
  | "spotter"
  | "mortar"
  | "fallschirmjager"
  | "medic"
  | "panzer"
  | "truck"
  | "halftrack";
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
  /** Barracks update: his own spendable upgrade points, his
   * upgrade levels by track, and the stores gear he carries. */
  points: number;
  upgrades: Record<string, number>;
  equipment: string[];
  hired_at: string;
}

export interface ItemGain {
  item: string;
  source: string; // "loot" | "mission"
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
  /** Squad stores: item id -> count owned (gear on the men
   * is not counted here). */
  inventory: Record<string, number>;
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
  /** The fallen man this tribute belongs to (null only on legacy
   * field scatter placed before tributes were per-man). */
  entry_id: string | null;
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
  /** Barracks update: points each survivor banked, stores
   * items the battle brought in, gear that died with its men. */
  points_gained: Record<string, number>;
  items_gained: ItemGain[];
  gear_lost: string[];
}

export type ReinforcementKind = "rifle" | "heavy";

export interface ReinforceOut {
  kind: ReinforcementKind;
  cost: number;
  requisition: number;
}

export interface LastBattle {
  mission_code: string;
  victory: boolean;
  fallen: string[];
  survivors: number;
  at: string;
}

export interface SaveSummary {
  exists: boolean;
  mission_code: string | null;
  mission_index: number;
  campaign_complete: boolean;
  requisition: number;
  squad_size: number;
  fallen: number;
  last_battle: LastBattle | null;
}
