// Unit / enemy combat specs. Costs mirror backend/lib/missions.py UNIT_COSTS — keep in sync.
import type { EnemyTypeId, UnitTypeId } from "@/lib/types";

export interface AbilitySpec {
  key: string;
  name: string;
  desc: string;
  cd: number;
  aim: "ground" | "auto";
}

export interface UnitTypeSpec {
  type: UnitTypeId;
  label: string;
  role: string;
  weapon: string;
  cost: number;
  hp: number;
  speed: number;
  range: number;
  vision: number;
  dmg: number;
  fireInterval: number;
  spread: number;
  bulletSpeed: number;
  ability: AbilitySpec;
  blurb: string;
}

export const UNIT_TYPES: Record<UnitTypeId, UnitTypeSpec> = {
  rifleman: {
    type: "rifleman",
    label: "Rifleman",
    role: "Infantry Core",
    weapon: "M1 Garand .30-06",
    cost: 100,
    hp: 120,
    speed: 60,
    range: 220,
    vision: 260,
    dmg: 12,
    fireInterval: 0.55,
    spread: 0.055,
    bulletSpeed: 620,
    ability: { key: "Q", name: "Frag Grenade", desc: "Throw a fragmentation grenade — 60 dmg in a wide burst", cd: 12, aim: "ground" },
    blurb: "The backbone of the line. Cheap, steady, everywhere.",
  },
  medic: {
    type: "medic",
    label: "Medic",
    role: "Field Support",
    weapon: "M1 Carbine + Syrettes",
    cost: 150,
    hp: 90,
    speed: 66,
    range: 160,
    vision: 240,
    dmg: 6,
    fireInterval: 0.5,
    spread: 0.09,
    bulletSpeed: 560,
    ability: { key: "Q", name: "Combat Triage", desc: "Heal the worst-wounded man nearby for 50 HP (passive aura also mends)", cd: 10, aim: "auto" },
    blurb: "Keeps the line breathing. The Axis shoots medics — hide him well.",
  },
  mg: {
    type: "mg",
    label: "MG Gunner",
    role: "Fire Suppression",
    weapon: ".30 Cal M1919",
    cost: 220,
    hp: 110,
    speed: 40,
    range: 280,
    vision: 260,
    dmg: 7,
    fireInterval: 0.18,
    spread: 0.1,
    bulletSpeed: 640,
    ability: { key: "Q", name: "Suppressive Barrage", desc: "Walk 16 rounds across an area — pins everything under them", cd: 14, aim: "ground" },
    blurb: "Pins the enemy in the dirt so your riflemen can move.",
  },
  sniper: {
    type: "sniper",
    label: "Sniper",
    role: "Precision Recon",
    weapon: "Springfield M1903A4",
    cost: 260,
    hp: 70,
    speed: 54,
    range: 400,
    vision: 420,
    dmg: 45,
    fireInterval: 1.1,
    spread: 0.02,
    bulletSpeed: 900,
    ability: { key: "Q", name: "Deadeye Shot", desc: "Instant 120 dmg to the highest-value target in range", cd: 16, aim: "auto" },
    blurb: "Sees far, hits once, never misses twice. Fragile up close.",
  },
  at: {
    type: "at",
    label: "AT Specialist",
    role: "Heavy Ordnance",
    weapon: "M1 Bazooka 60mm",
    cost: 300,
    hp: 100,
    speed: 46,
    range: 240,
    vision: 220,
    dmg: 55,
    fireInterval: 2.2,
    spread: 0.03,
    bulletSpeed: 380,
    ability: { key: "Q", name: "Bunker Buster", desc: "Rocket — 80 dmg with a 65px blast on the toughest target", cd: 14, aim: "auto" },
    blurb: "Emplacements, nests, anything dug in — it stops existing.",
  },
};

export type Threat = "LOW" | "MEDIUM" | "HIGH" | "EXTREME" | "CRITICAL";

export interface EnemyTypeSpec {
  type: EnemyTypeId;
  label: string;
  weapon: string;
  hp: number;
  speed: number;
  range: number;
  vision: number;
  dmg: number;
  fireInterval: number;
  spread: number;
  bulletSpeed: number;
  static?: boolean;
  threat: Threat;
}

export const ENEMY_TYPES: Record<EnemyTypeId, EnemyTypeSpec> = {
  volks: {
    type: "volks", label: "Volkssturm Conscript", weapon: "Kar98k", hp: 60, speed: 55, range: 200,
    vision: 240, dmg: 14, fireInterval: 1.35, spread: 0.07, bulletSpeed: 520, threat: "LOW",
  },
  grenadier: {
    type: "grenadier", label: "Wehrmacht Grenadier", weapon: "MP40 SMG", hp: 95, speed: 60, range: 170,
    vision: 240, dmg: 6, fireInterval: 0.22, spread: 0.12, bulletSpeed: 480, threat: "MEDIUM",
  },
  mg42: {
    type: "mg42", label: "MG42 Bunker Nest", weapon: "MG42 'Hitlersäge'", hp: 280, speed: 0, range: 320,
    vision: 300, dmg: 6, fireInterval: 0.12, spread: 0.1, bulletSpeed: 700, static: true, threat: "EXTREME",
  },
  officer: {
    type: "officer", label: "SS Hauptmann Officer", weapon: "Luger P08 + Morale Aura", hp: 140, speed: 58, range: 200,
    vision: 260, dmg: 10, fireInterval: 0.5, spread: 0.05, bulletSpeed: 520, threat: "HIGH",
  },
  panzerfaust: {
    type: "panzerfaust", label: "Panzerfaust Shocktrooper", weapon: "Anti-tank Rocket", hp: 110, speed: 50, range: 260,
    vision: 260, dmg: 55, fireInterval: 3.2, spread: 0.03, bulletSpeed: 300, threat: "HIGH",
  },
  flak: {
    type: "flak", label: "Flak 38 20mm Emplacement", weapon: "Rapid Autocannon", hp: 320, speed: 0, range: 340,
    vision: 320, dmg: 8, fireInterval: 0.15, spread: 0.12, bulletSpeed: 800, static: true, threat: "CRITICAL",
  },
};

// Death causes by killer type — mirrors the debrief filing.
export const CAUSES: Record<string, string> = {
  volks: "K98 rifle fire",
  grenadier: "MP40 fire",
  mg42: "MG42 fire",
  officer: "Luger fire",
  panzerfaust: "Panzerfaust blast",
  flak: "Flak 38 autocannon",
  grenade: "Fragmentation",
  rocket: "Rocket blast",
};

// Rank ladder — mirrors backend/lib/gen.py RANKS.
const RANKS: Array<[number, string]> = [
  [0, "Pvt."],
  [100, "Cpl."],
  [250, "Sgt."],
  [450, "2nd Lt."],
  [700, "1st Lt."],
  [1000, "Capt."],
];

export function rankFor(xp: number): string {
  let rank = RANKS[0][1];
  for (const [threshold, name] of RANKS) {
    if (xp >= threshold) rank = name;
  }
  return rank;
}
