// Hand-written mirrors of the backend Pydantic models (backend/models/models.py).
// Nothing infers across the HTTP boundary — keep these in sync in the same edit.

export type UnitTypeId = "rifleman" | "medic" | "mg" | "sniper" | "at";
export type EnemyTypeId = "volks" | "grenadier" | "mg42" | "officer" | "panzerfaust" | "flak";
export type SoldierStatus = "active" | "reserve";

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
  quirk: string;
  hometown: string;
  hired_at: string;
}

export interface GameState {
  requisition: number;
  mission_index: number;
  battles_won: number;
  battles_lost: number;
  campaign_complete: boolean;
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
}

export interface BattleResult {
  requisition: number;
  mission_index: number;
  campaign_complete: boolean;
  memorial_names: string[];
}
