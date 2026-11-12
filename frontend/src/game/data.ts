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
  /** A vehicle: no morale, it never breaks or flees. */
  vehicle?: boolean;
}

export const UNIT_TYPES: Record<UnitTypeId, UnitTypeSpec> = {
  tank: {
    type: "tank",
    label: "M4 Sherman",
    role: "Armor Support",
    weapon: "75mm Cannon",
    cost: 0,
    hp: 500,
    speed: 35,
    range: 320,
    vision: 260,
    dmg: 35,
    fireInterval: 2.0,
    spread: 0.05,
    bulletSpeed: 800,
    ability: { key: "Q", name: "Main Gun", desc: "75mm cannon", cd: 0, aim: "auto" },
    blurb: "Armor on call. Not for hire — the radio brings it in.",
    vehicle: true,
  },
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
  radioman: {
    type: "radioman",
    label: "Radioman",
    role: "Field Radio",
    weapon: "SCR-300 Radio + M1 Carbine",
    cost: 150,
    hp: 100,
    speed: 60,
    range: 200,
    vision: 260,
    dmg: 8,
    fireInterval: 0.6,
    spread: 0.07,
    bulletSpeed: 560,
    ability: { key: "Q", name: "Rally Call", desc: "Radio the squad — nearby men recover 15 morale", cd: 20, aim: "auto" },
    blurb: "Carries the radio. No radioman, no reinforcements — if he dies, the radio dies with him.",
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
  /** A vehicle (the Panzer): no morale, it never breaks or flees. */
  vehicle?: boolean;
  threat: Threat;
}

export const ENEMY_TYPES: Record<EnemyTypeId, EnemyTypeSpec> = {
  volks: {
    type: "volks", label: "Volkssturm Conscript", weapon: "Kar98k", hp: 60, speed: 55, range: 200,
    vision: 240, dmg: 14, fireInterval: 1.35, spread: 0.07, bulletSpeed: 520, threat: "LOW",
  },
  funk: {
    type: "funk", label: "Funker Radioman", weapon: "Radio + P08 Pistol", hp: 70, speed: 55, range: 170,
    vision: 240, dmg: 6, fireInterval: 1.0, spread: 0.09, bulletSpeed: 480, threat: "LOW",
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
  scharfschutze: {
    type: "scharfschutze", label: "Scharfschütze Sniper", weapon: "Kar98k ZF39 scope", hp: 70, speed: 45, range: 420,
    vision: 440, dmg: 40, fireInterval: 2.4, spread: 0.02, bulletSpeed: 900, threat: "HIGH",
  },
  mortar: {
    type: "mortar", label: "Granatwerfer 34 Mortar Team", weapon: "8cm mortar (indirect fire)", hp: 120, speed: 0, range: 620,
    vision: 300, dmg: 45, fireInterval: 6, spread: 0.1, bulletSpeed: 300, static: true, threat: "EXTREME",
  },
  fallschirmjager: {
    type: "fallschirmjager", label: "Fallschirmjäger Paratrooper", weapon: "FG42 automatic rifle", hp: 120, speed: 66, range: 220,
    vision: 260, dmg: 11, fireInterval: 0.3, spread: 0.07, bulletSpeed: 620, threat: "HIGH",
  },
  medic: {
    type: "medic", label: "Sanitäter Medic", weapon: "P08 pistol + field dressings", hp: 80, speed: 55, range: 170,
    vision: 240, dmg: 8, fireInterval: 1.0, spread: 0.1, bulletSpeed: 480, threat: "LOW",
  },
  panzer: {
    type: "panzer", label: "Panzer IV Medium Tank", weapon: "75mm KwK 40 cannon", hp: 400, speed: 30, range: 300,
    vision: 240, dmg: 30, fireInterval: 2.0, spread: 0.05, bulletSpeed: 800, vehicle: true, threat: "HIGH",
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
  scharfschutze: "Sniper fire",
  panzer: "75mm cannon fire",
  mortar: "Mortar bombardment",
  fallschirmjager: "FG42 fire",
};

// Real WWII US Army decorations — mirrors backend/lib/medals.py (codes, criteria).
export interface MedalSpec {
  code: string;
  name: string;
  short: string;
  ribbon: string[]; // stripe colors, left→right
  criteria: string;
  bonus: string;
}

export const MEDALS: Record<string, MedalSpec> = {
  cib: { code: "cib", name: "Combat Infantryman Badge", short: "CIB", ribbon: ["#2F5FA8", "#C9CCD1", "#2F5FA8"], criteria: "Survived a combat operation", bonus: "+20 vision" },
  cmb: { code: "cmb", name: "Combat Medical Badge", short: "CMB", ribbon: ["#7E1F2B", "#E9E6DA", "#7E1F2B"], criteria: "Medic healed 100+ HP under fire", bonus: "+50% healing" },
  purple_heart: { code: "purple_heart", name: "Purple Heart", short: "PH", ribbon: ["#E9E6DA", "#5B2A86", "#5B2A86", "#E9E6DA"], criteria: "Wounded in action (40+ damage) — posthumous for the fallen", bonus: "+10 max HP each" },
  bronze_star: { code: "bronze_star", name: "Bronze Star", short: "BSM", ribbon: ["#B22234", "#E9E6DA", "#2F5FA8", "#E9E6DA", "#B22234"], criteria: "4+ kills in one operation (medic: 180+ HP healed)", bonus: "+8% damage each" },
  silver_star: { code: "silver_star", name: "Silver Star", short: "SS", ribbon: ["#2F5FA8", "#E9E6DA", "#B22234", "#E9E6DA", "#2F5FA8"], criteria: "Destroyed an MG42 nest / Flak gun, or killed an SS officer", bonus: "−8% spread (aim) each" },
  dsc: { code: "dsc", name: "Distinguished Service Cross", short: "DSC", ribbon: ["#B22234", "#2F5FA8", "#2F5FA8", "#B22234"], criteria: "8+ kills in one operation", bonus: "−10% fire interval" },
  moh: { code: "moh", name: "Medal of Honor", short: "MoH", ribbon: ["#7FB2E5", "#E9E6DA", "#7FB2E5"], criteria: "12+ kills in one operation, or sole survivor of a victory", bonus: "+20 HP, +10% dmg, −10% spread, −0.1s reaction" },
};

export const MEDAL_ORDER = ["moh", "dsc", "silver_star", "bronze_star", "purple_heart", "cmb", "cib"];

/** Kill RP: every kill by one of your squad men pays 10 RP, win or
 * lose, so progress never feels wasted and a loss with a lot of
 * kills still pays well. A win adds the mission reward on top.
 * Mirrors backend/lib/missions.py KILL_RP — keep in sync. */
export const KILL_RP = 10;

/** Supply crates: rare. Each battle flips a coin — half the
 * battles have one crate, half have none, never more than one.
 * 25 RP each, looted by a squad man who walks up to one. A crate is
 * worth two and a half kills — a real bonus, not a second income.
 * Mirrors backend/lib/missions.py CRATE_RP — keep in sync. */
export const CRATE_RP = 25;
/** Chance a battle has a supply crate at all. */
export const CRATE_CHANCE = 0.5;
/** Never more than one crate in a battle. */
export const MAX_CRATES_PER_MISSION = 1;
/** How close a squad man has to get to loot a crate. */
export const LOOT_RADIUS = 60;

/** RP earned for a battle: the mission reward on a win, plus 10 RP
 * per squad kill, win or lose, plus whatever was looted from crates. */
export function battleReward(reward: number, victory: boolean, kills: number, lootRp = 0): number {
  return (victory ? reward : 0) + kills * KILL_RP + lootRp;
}

/** Quirks that make a man a coward: when his morale breaks he
 * rolls a low chance to run for the edge of the battlefield instead
 * of falling back, and if he reaches it he deserts. On the player
 * side that ends the round. */
export const COWARD_QUIRKS = ["Skittish", "Jumpy"] as const;

export function isCowardQuirk(quirk: string | null | undefined): boolean {
  return !!quirk && (COWARD_QUIRKS as readonly string[]).includes(quirk);
}

export function medalCounts(medals: string[]): Array<[string, number]> {
  const c = new Map<string, number>();
  for (const m of medals) c.set(m, (c.get(m) ?? 0) + 1);
  return MEDAL_ORDER.filter((m) => c.has(m)).map((m) => [m, c.get(m)!]);
}

export function medalBonus(medals: string[]) {
  const n = (code: string) => medals.filter((m) => m === code).length;
  const moh = n("moh") > 0;
  return {
    hp: 10 * n("purple_heart") + (moh ? 20 : 0),
    dmgMult: (1 + 0.08 * n("bronze_star")) * (moh ? 1.1 : 1),
    spreadMult: Math.pow(0.92, n("silver_star")) * (moh ? 0.9 : 1),
    fireMult: n("dsc") > 0 ? 0.9 : 1,
    vision: n("cib") > 0 ? 20 : 0,
    healMult: n("cmb") > 0 ? 1.5 : 1,
    reaction: moh ? -0.1 : 0,
  };
}

// Rank ladder — mirrors backend/lib/gen.py RANKS (one promotion per mission survived).
export const RANKS = ["Pvt.", "Pfc.", "Cpl.", "Sgt.", "S/Sgt.", "T/Sgt.", "1st Sgt."];

// Per-level combat modifiers — every promotion tightens aim and quickens reactions.
export function levelBonus(level: number, commanderBonus: number) {
  return {
    spreadMult: (1 - 0.07 * level) * (1 - commanderBonus),
    fireMult: 1 - 0.04 * level,
    reaction: Math.max(0.12, (0.7 - 0.08 * level) * (1 - commanderBonus)),
  };
}
