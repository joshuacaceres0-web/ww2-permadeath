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
  /** Rounds in the weapon's magazine (0 = never reloads:
   * vehicles and crew-served pieces). Reloading (Josh,
   * 2026-11-13): a man cannot fire while he reloads. */
  magSize: number;
  /** Seconds a reload takes: MG belts longest, pistols fastest. */
  reloadTime: number;
  spread: number;
  bulletSpeed: number;
  ability: AbilitySpec;
  blurb: string;
  /** A vehicle: no morale, it never breaks or flees. */
  vehicle?: boolean;
  /** A second weapon for close work (the AT man's trench gun,
   * 2026-11-13): its own damage, reach, magazine and reload,
   * carried alongside the primary. The primary stays reserved
   * for what it was made for — the bazooka only ever fires at
   * vehicles; infantry is the sidearm's work. */
  sidearm?: SidearmSpec;
}

/** A carried second weapon: see UnitTypeSpec.sidearm. */
export interface SidearmSpec {
  name: string;
  dmg: number;
  fireInterval: number;
  range: number;
  magSize: number;
  reloadTime: number;
  spread: number;
  bulletSpeed: number;
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
    range: 360,
    vision: 300,
    dmg: 35,
    fireInterval: 2.0,
    magSize: 0,
    reloadTime: 0,
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
    range: 240,
    vision: 280,
    dmg: 12,
    fireInterval: 0.55,
    magSize: 8,
    reloadTime: 2.2,
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
    range: 170,
    vision: 250,
    dmg: 6,
    fireInterval: 0.5,
    magSize: 15,
    reloadTime: 1.8,
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
    range: 320,
    vision: 300,
    dmg: 7,
    fireInterval: 0.18,
    magSize: 50,
    reloadTime: 4.5,
    spread: 0.1,
    bulletSpeed: 640,
    ability: { key: "Q", name: "Suppressive Barrage", desc: "Walk 16 rounds across an area — pins everything under them", cd: 14, aim: "ground" },
    blurb: "Pins the enemy in the dirt so your riflemen can move. Driven prone, his gun deploys on its bipod: longer reach and tighter fire, but he cannot move until he stands.",
  },
  sniper: {
    type: "sniper",
    label: "Sniper",
    role: "Precision Recon",
    weapon: "Springfield M1903A4",
    cost: 260,
    hp: 70,
    speed: 54,
    range: 460,
    vision: 480,
    dmg: 45,
    fireInterval: 1.1,
    magSize: 5,
    reloadTime: 2.8,
    spread: 0.02,
    bulletSpeed: 900,
    ability: { key: "Q", name: "Deadeye Shot", desc: "Instant 120 dmg to the highest-value target in range", cd: 16, aim: "auto" },
    blurb: "Sees far, hits once, never misses twice. Fragile up close. With a Recon spotting for him he hunts elites first at full range — MG nests, mortar crews, officers and their kind. Alone he cannot pick them out past 200.",
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
    vision: 280,
    dmg: 8,
    fireInterval: 0.6,
    magSize: 15,
    reloadTime: 1.8,
    spread: 0.07,
    bulletSpeed: 560,
    ability: { key: "Q", name: "Rally Call", desc: "Radio the squad — nearby men recover 15 morale", cd: 20, aim: "auto" },
    blurb: "Carries the radio. No radioman, no reinforcements — if he dies, the radio dies with him.",
  },
  at: {
    type: "at",
    label: "AT Specialist",
    role: "Heavy Ordnance",
    weapon: "M1 Bazooka 60mm + M97 Trench Gun",
    cost: 300,
    hp: 100,
    speed: 46,
    range: 260,
    vision: 240,
    dmg: 55,
    fireInterval: 2.2,
    magSize: 1,
    reloadTime: 2.4,
    spread: 0.03,
    bulletSpeed: 380,
    ability: { key: "Q", name: "Bunker Buster", desc: "Rocket — 80 dmg with a 65px blast on the toughest target", cd: 14, aim: "auto" },
    // The bazooka is for armour and nothing else (Josh,
    // 2026-11-13): up close the AT man works a trench gun, and
    // two shots put a man down (32 a hit against the 60 hp
    // conscript every wave is built from). Five shells in the
    // tube, his own reload, independent of the bazooka's.
    sidearm: { name: "M97 Trench Gun", dmg: 32, fireInterval: 0.9, range: 110, magSize: 5, reloadTime: 2.0, spread: 0.09, bulletSpeed: 540 },
    blurb: "Emplacements, nests, anything dug in — it stops existing. The bazooka is for tanks only; up close he works a trench gun.",
  },
  recon: {
    type: "recon",
    label: "Recon",
    role: "Forward Observer",
    weapon: "M1 Carbine + Binoculars",
    cost: 180,
    hp: 85,
    speed: 68,
    range: 230,
    vision: 500,
    dmg: 10,
    fireInterval: 0.6,
    magSize: 15,
    reloadTime: 1.8,
    spread: 0.06,
    bulletSpeed: 600,
    ability: { key: "Q", name: "Mark Target", desc: "Mark one enemy for the squad: he takes heavier fire, and a hidden Recon's mark sets an ambush", cd: 18, aim: "auto" },
    blurb: "The squad's eyes. Spots far, hides in the treeline, and a sniper beside him shoots at full range. He spots elites for the sniper, so the dangerous men die early while they are paired.",
  },
  engineer: {
    type: "engineer",
    label: "Engineer",
    role: "Combat Engineer",
    weapon: "M1 Carbine + Mine Detector",
    cost: 170,
    hp: 100,
    speed: 58,
    range: 200,
    vision: 260,
    dmg: 9,
    fireInterval: 0.55,
    magSize: 15,
    reloadTime: 1.8,
    spread: 0.07,
    bulletSpeed: 580,
    ability: { key: "Q", name: "Deploy Cover", desc: "Throw up a sandbag position where you aim — real cover, wears down under fire", cd: 20, aim: "ground" },
    blurb: "Finds the mines before the squad does and digs them out under fire. Builds cover anywhere.",
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
  /** Rounds before a reload (0 = never: vehicles, mortars). */
  magSize: number;
  /** Seconds a reload takes: MG belts longest, pistols fastest. */
  reloadTime: number;
  spread: number;
  bulletSpeed: number;
  static?: boolean;
  /** A vehicle (the Panzer): no morale, it never breaks or flees. */
  vehicle?: boolean;
  threat: Threat;
}

export const ENEMY_TYPES: Record<EnemyTypeId, EnemyTypeSpec> = {
  volks: {
    type: "volks", label: "Volkssturm Conscript", weapon: "Kar98k", hp: 60, speed: 55, range: 220,
    vision: 260, dmg: 14, fireInterval: 1.35, spread: 0.07, bulletSpeed: 520, threat: "LOW",
    magSize: 5,
    reloadTime: 2.4,
  },
  funk: {
    type: "funk", label: "Funker Radioman", weapon: "Radio + P08 Pistol", hp: 70, speed: 55, range: 180,
    vision: 250, dmg: 6, fireInterval: 1.0, spread: 0.09, bulletSpeed: 480, threat: "LOW",
    magSize: 8,
    reloadTime: 1.2,
  },
  grenadier: {
    type: "grenadier", label: "Wehrmacht Grenadier", weapon: "MP40 SMG", hp: 95, speed: 60, range: 180,
    vision: 250, dmg: 6, fireInterval: 0.22, spread: 0.12, bulletSpeed: 480, threat: "MEDIUM",
    magSize: 32,
    reloadTime: 2.0,
  },
  mg42: {
    type: "mg42", label: "MG42 Bunker Nest", weapon: "MG42 'Hitlersäge'", hp: 280, speed: 0, range: 340,
    vision: 320, dmg: 6, fireInterval: 0.12, spread: 0.1, bulletSpeed: 700, static: true, threat: "EXTREME",
    magSize: 50,
    reloadTime: 4.5,
  },
  officer: {
    type: "officer", label: "SS Hauptmann Officer", weapon: "Luger P08 + Morale Aura", hp: 140, speed: 58, range: 220,
    vision: 280, dmg: 10, fireInterval: 0.5, spread: 0.05, bulletSpeed: 520, threat: "HIGH",
    magSize: 8,
    reloadTime: 1.2,
  },
  panzerfaust: {
    type: "panzerfaust", label: "Panzerfaust Shocktrooper", weapon: "Anti-tank Rocket", hp: 110, speed: 50, range: 260,
    vision: 280, dmg: 55, fireInterval: 3.2, spread: 0.03, bulletSpeed: 300, threat: "HIGH",
    magSize: 1,
    reloadTime: 3.2,
  },
  flak: {
    type: "flak", label: "Flak 38 20mm Emplacement", weapon: "Rapid Autocannon", hp: 320, speed: 0, range: 360,
    vision: 340, dmg: 8, fireInterval: 0.15, spread: 0.12, bulletSpeed: 800, static: true, threat: "CRITICAL",
    magSize: 20,
    reloadTime: 3.5,
  },
  scharfschutze: {
    type: "scharfschutze", label: "Scharfschütze Sniper", weapon: "Kar98k ZF39 scope", hp: 70, speed: 45, range: 460,
    vision: 480, dmg: 40, fireInterval: 2.4, spread: 0.02, bulletSpeed: 900, threat: "HIGH",
    magSize: 5,
    reloadTime: 2.8,
  },

  spotter: {
    // The Scharfschutze's other half (ranges pass, 2026-11-13):
    // a Beobachter who spawns at his sniper's shoulder. His eyes
    // (vision 500, the longest on the field with the allied Recon)
    // are what unlock the sniper's full range; alone, the sniper
    // self-spots at solo range like the player's does. He fights
    // with a carbine when pressed and stays glued to his sniper.
    type: "spotter", label: "Beobachter Spotter", weapon: "Kar98k carbine + Zeiss glass", hp: 80, speed: 66, range: 180,
    vision: 500, dmg: 9, fireInterval: 1.1, spread: 0.06, bulletSpeed: 560, threat: "MEDIUM",
    magSize: 15,
    reloadTime: 1.8,
  },
  mortar: {
    type: "mortar", label: "Granatwerfer 34 Mortar Team", weapon: "8cm mortar (indirect fire)", hp: 120, speed: 0, range: 620,
    vision: 300, dmg: 45, fireInterval: 6, spread: 0.1, bulletSpeed: 300, static: true, threat: "EXTREME",
    magSize: 0,
    reloadTime: 0,
  },
  fallschirmjager: {
    type: "fallschirmjager", label: "Fallschirmjäger Paratrooper", weapon: "FG42 automatic rifle", hp: 120, speed: 66, range: 240,
    vision: 280, dmg: 11, fireInterval: 0.3, spread: 0.07, bulletSpeed: 620, threat: "HIGH",
    magSize: 20,
    reloadTime: 2.2,
  },
  medic: {
    type: "medic", label: "Sanitäter Medic", weapon: "P08 pistol + field dressings", hp: 80, speed: 55, range: 180,
    vision: 250, dmg: 8, fireInterval: 1.0, spread: 0.1, bulletSpeed: 480, threat: "LOW",
    magSize: 8,
    reloadTime: 1.2,
  },
  panzer: {
    type: "panzer", label: "Panzer IV Medium Tank", weapon: "75mm KwK 40 cannon", hp: 400, speed: 30, range: 340,
    vision: 280, dmg: 30, fireInterval: 2.0, spread: 0.05, bulletSpeed: 800, vehicle: true, threat: "HIGH",
    magSize: 0,
    reloadTime: 0,
  },
  halftrack: {
    // The airborne convoy's armoured troop carrier (Josh,
    // 2026-11-12: the convoy is 2 tanks, 1 halftrack, 20 foot).
    // Half the panzer's hide, faster, and its mounted MG42 makes
    // it a real gun platform once the ambush is sprung.
    type: "halftrack", label: "Sd.Kfz. 251 Halftrack", weapon: "MG42 (mounted)", hp: 220, speed: 34, range: 260,
    vision: 280, dmg: 7, fireInterval: 0.45, spread: 0.09, bulletSpeed: 700, vehicle: true, threat: "HIGH",
    magSize: 0,
    reloadTime: 0,
  },
  truck: {
    // The airborne mission's convoy (Josh, 2026-11-12): an
    // unarmed supply truck. It carries no gun and never fires;
    // it is on the field to be ambushed, and the wave is not
    // cleared until the convoy is destroyed with its escort.
    type: "truck", label: "Opel Blitz Supply Truck", weapon: "Unarmed", hp: 150, speed: 30, range: 0,
    vision: 240, dmg: 0, fireInterval: 1.0, spread: 0, bulletSpeed: 0, vehicle: true, threat: "LOW",
    magSize: 0,
    reloadTime: 0,
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
  spotter: "Spotter's carbine fire",
  panzer: "75mm cannon fire",
  mortar: "Mortar bombardment",
  mine: "Tellermine blast",
  fallschirmjager: "FG42 fire",
  halftrack: "Halftrack MG fire",
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

// ----------------------------------------------------------------
// Barracks update (Josh, 2026-11-13): per-man upgrades and the
// squad stores. Mirrors backend/lib/items.py — the backend owns
// prices, restrictions and the points rule; this table owns the
// words and the engine's crate roll. Earned in game only: no
// real money anywhere near any of it.
// ----------------------------------------------------------------

export interface UpgradeTrackDef {
  id: string;
  label: string;
  per: string;
}

export const UPGRADE_TRACKS: UpgradeTrackDef[] = [
  { id: "toughness", label: "Toughness", per: "+12 health per level" },
  { id: "marksmanship", label: "Marksmanship", per: "+8% damage per level" },
  { id: "steady", label: "Steady Hands", per: "Reloads 12% faster per level" },
  { id: "legs", label: "Legs", per: "+6% speed per level" },
  { id: "nerve", label: "Nerve", per: "Morale losses 15% smaller per level" },
  { id: "eyes", label: "Eyes", per: "+25 vision per level" },
];
export const UPGRADE_COST = 2;
export const UPGRADE_CAP = 3;
export const EQUIP_SLOTS = 2;

export interface ItemDef {
  id: string;
  label: string;
  blurb: string;
  price: number;
  restrict?: UnitTypeId[];
  weight: number;
  kind: "gear" | "headgear" | "gun";
}

export const ITEM_DEFS: ItemDef[] = [
  { id: "entrench", label: "Entrenching Tool", blurb: "He digs in properly: cover protects him 15% better.", price: 40, weight: 3, kind: "gear" },
  { id: "ammo", label: "Extra Ammo Pouches", blurb: "Over his issue bandolier: his magazine holds half again as much.", price: 40, weight: 3, kind: "gear" },
  { id: "canteen", label: "Canteen", blurb: "A full canteen and the nerve it buys: morale returns 60% faster.", price: 40, weight: 3, kind: "gear" },
  { id: "dressing", label: "Field Dressing", blurb: "Wounds bind themselves: after 5 quiet seconds he slowly heals, up to 60% health.", price: 40, weight: 3, kind: "gear" },
  { id: "jeepcap", label: "M1941 Jeep Cap", blurb: "Wool knit comfort under the helmet liner: morale returns 30% faster.", price: 40, weight: 3, kind: "headgear" },
  { id: "binoculars", label: "Binoculars", blurb: "Recon only. +60 vision, and a sniper paired with him holds full range out to 220.", price: 75, restrict: ["recon"], weight: 1, kind: "gear" },
  { id: "charm", label: "Lucky Charm", blurb: "Once a battle, a killing hit has a 15% chance to leave him standing on 1 health.", price: 75, weight: 1, kind: "gear" },
  { id: "batteries", label: "Fresh Batteries", blurb: "The radio answers faster: support cooldowns 20% shorter.", price: 75, restrict: ["radioman"], weight: 1, kind: "gear" },
  { id: "aidbag", label: "Aid Bag", blurb: "Proper kit: his healing is 30% stronger.", price: 75, restrict: ["medic"], weight: 1, kind: "gear" },
  { id: "nethelmet", label: "Netted Veteran Helmet", blurb: "Scrim and netting break his outline: the enemy picks him up at 15% shorter range.", price: 75, weight: 1, kind: "headgear" },
  { id: "parahelmet", label: "Paratrooper Helmet", blurb: "An M1C with a chin cup, worn tight: +12 health.", price: 75, weight: 1, kind: "headgear" },
  { id: "pilecap", label: "M1943 Pile Cap", blurb: "Ear flaps down against the din: suppression builds 15% slower.", price: 75, weight: 1, kind: "headgear" },
  { id: "hbtcap", label: "HBT Fatigue Cap", blurb: "Working wear: the cover he digs is half again as strong.", price: 75, restrict: ["engineer"], weight: 1, kind: "headgear" },
  { id: "garrisoncap", label: "Garrison Cap", blurb: "Off duty only: he wears it in the Barracks and takes his M1 into battle. No combat effect.", price: 25, weight: 2, kind: "headgear" },
  { id: "thompson", label: "Thompson M1928", blurb: "The drum fed chopper: a hose of fire up close, and not much past it.", price: 0, restrict: ["rifleman", "medic", "mg", "sniper", "radioman", "recon", "engineer"], weight: 1, kind: "gun" },
  { id: "mp40", label: "Captured MP40", blurb: "Their iron, turned around: steady, honest automatic fire.", price: 0, restrict: ["rifleman", "medic", "mg", "sniper", "radioman", "recon", "engineer"], weight: 1, kind: "gun" },
  { id: "carbine", label: "M1A1 Carbine", blurb: "The folding stock carbine: light, quick and handy at honest ranges.", price: 0, restrict: ["rifleman", "medic", "mg", "sniper", "radioman", "recon", "engineer"], weight: 1, kind: "gun" },
  { id: "springfield", label: "Springfield M1903 (Scoped)", blurb: "A bolt gun with glass: it reaches past everything else on the field, one slow heavy shot at a time.", price: 0, restrict: ["sniper", "recon"], weight: 0.7, kind: "gun" },
  { id: "trench97", label: "M97 Trench Gun", blurb: "The trench broom as a man's main gun: devastating inside a room's length, nothing beyond it.", price: 0, restrict: ["rifleman", "medic", "mg", "sniper", "radioman", "recon", "engineer"], weight: 0.7, kind: "gun" },
  { id: "bar", label: "BAR M1918", blurb: "The automatic rifle: long bursts at rifle ranges, and a slow, heavy reload.", price: 0, restrict: ["mg"], weight: 0.5, kind: "gun" },
  { id: "fg42", label: "Captured FG42", blurb: "The paratroopers' prize: full power automatic fire at rifle reach. The rarest find in the war.", price: 0, restrict: ["rifleman", "medic", "mg", "sniper", "radioman", "recon", "engineer"], weight: 0.3, kind: "gun" },
  // Class items (Josh, 2026-11-13): two per hireable class,
  // locked to that class alone, each tied to the job the class
  // does in battle. They share the same two equip slots as
  // everything else: gear, headgear, guns, class pieces, one
  // pool of two. Prices and weights mirror the backend.
  { id: "bayonet", label: "Fixed Bayonet", blurb: "Fixed steel: inside 70 his shots hit 35% harder.", price: 75, restrict: ["rifleman"], weight: 1, kind: "gear" },
  { id: "grenades", label: "Grenade Bandolier", blurb: "A bandolier of frags: his grenade hits harder and wider, and the next one comes 40% sooner.", price: 75, restrict: ["rifleman"], weight: 1, kind: "gear" },
  { id: "surgical", label: "Surgical Kit", blurb: "A real surgical kit: his healing is half again as strong.", price: 75, restrict: ["medic"], weight: 1, kind: "gear" },
  { id: "morphine", label: "Morphine Syrettes", blurb: "Syrettes in the aid pouch: a man he patches up gains 20 morale, and a broken man he treats steadies.", price: 75, restrict: ["medic"], weight: 1, kind: "gear" },
  { id: "barrel", label: "Spare Barrel", blurb: "Swapped hot under fire: his barrage runs 24 rounds and his belt reloads 30% faster.", price: 75, restrict: ["mg"], weight: 1, kind: "gear" },
  { id: "bearerbox", label: "Ammo Bearer Box", blurb: "An ammo bearer's box at his hip: his belt holds half again as much.", price: 75, restrict: ["mg"], weight: 1, kind: "gear" },
  { id: "ghillie", label: "Ghillie Wrap", blurb: "A full ghillie wrap: the enemy picks him up at 30% shorter range again.", price: 75, restrict: ["sniper"], weight: 1, kind: "gear" },
  { id: "matchammo", label: "Match Ammunition", blurb: "Hand loaded match rounds: +40 range, and his shots group a third tighter.", price: 75, restrict: ["sniper"], weight: 1, kind: "gear" },
  { id: "shaped", label: "Shaped Charge Rounds", blurb: "Shaped charge warheads: his rockets bite armor 40% harder.", price: 75, restrict: ["at"], weight: 1, kind: "gear" },
  { id: "satchel", label: "Satchel Charge", blurb: "Once a battle, close to an enemy vehicle, he throws the satchel instead of a rocket: 260 damage in one bang.", price: 75, restrict: ["at"], weight: 1, kind: "gear" },
  { id: "antenna", label: "Long Range Antenna", blurb: "The tall antenna: support answers come 25% sooner.", price: 75, restrict: ["radioman"], weight: 1, kind: "gear" },
  { id: "codebook", label: "Code Book", blurb: "The squad code book: the first paid radio call of every battle costs nothing.", price: 75, restrict: ["radioman"], weight: 1, kind: "gear" },
  { id: "camonet", label: "Camouflage Net", blurb: "A net over his hide: in foliage he is spotted at barely a third of the usual range.", price: 75, restrict: ["recon"], weight: 1, kind: "gear" },
  { id: "flares", label: "Signal Flares", blurb: "His marks burn longer: Mark Target lasts 16 seconds instead of 10.", price: 75, restrict: ["recon"], weight: 1, kind: "gear" },
  { id: "probekit", label: "Mine Probe Kit", blurb: "Probes and flags: he finds mines at 120 instead of 70, and clears them in 2.5 seconds.", price: 75, restrict: ["engineer"], weight: 1, kind: "gear" },
  { id: "toolroll", label: "Tool Roll", blurb: "A full tool roll: the cover he digs stands at 150 health.", price: 75, restrict: ["engineer"], weight: 1, kind: "gear" },
];

/** Looted guns (Josh, 2026-11-13): found, never sold, and a
 * carried gun REPLACES the man's class weapon with its own full
 * stat line — damage, range, magazine and reload (the reloading
 * system's numbers), fire rate, spread, bullet speed. `sprite`
 * names the drawn weapon variant in sprites.ts. The AT man never
 * appears in a gun restriction list: he keeps his bazooka and
 * trench gun split and does not trade it away. */
export interface GunDef {
  dmg: number;
  range: number;
  magSize: number;
  reloadTime: number;
  fireInterval: number;
  spread: number;
  bulletSpeed: number;
  sprite: "thompson" | "mp40" | "carbine" | "springfield" | "trench" | "bar" | "fg42";
}

export const GUN_DEFS: Record<string, GunDef> = {
  thompson: { dmg: 11, range: 150, magSize: 50, reloadTime: 3.2, fireInterval: 0.11, spread: 0.1, bulletSpeed: 560, sprite: "thompson" },
  mp40: { dmg: 9, range: 185, magSize: 32, reloadTime: 2.0, fireInterval: 0.13, spread: 0.055, bulletSpeed: 560, sprite: "mp40" },
  carbine: { dmg: 10, range: 230, magSize: 15, reloadTime: 1.6, fireInterval: 0.32, spread: 0.045, bulletSpeed: 640, sprite: "carbine" },
  springfield: { dmg: 34, range: 520, magSize: 5, reloadTime: 2.8, fireInterval: 1.6, spread: 0.012, bulletSpeed: 900, sprite: "springfield" },
  trench97: { dmg: 30, range: 110, magSize: 5, reloadTime: 2.2, fireInterval: 0.9, spread: 0.09, bulletSpeed: 540, sprite: "trench" },
  bar: { dmg: 13, range: 300, magSize: 20, reloadTime: 3.4, fireInterval: 0.14, spread: 0.07, bulletSpeed: 720, sprite: "bar" },
  fg42: { dmg: 14, range: 330, magSize: 20, reloadTime: 2.6, fireInterval: 0.12, spread: 0.05, bulletSpeed: 760, sprite: "fg42" },
};
export const ITEM_BY_ID: Record<string, ItemDef> = Object.fromEntries(ITEM_DEFS.map((d) => [d.id, d]));

/** The class-locked items: exactly one class may carry each. */
export const CLASS_ITEM_IDS = new Set([
  "bayonet", "grenades", "surgical", "morphine", "barrel", "bearerbox",
  "ghillie", "matchammo", "shaped", "satchel", "antenna", "codebook",
  "camonet", "flares", "probekit", "toolroll",
]);

/** The weighted stores roll for a battlefield crate, mirroring
 * the backend's victory-award roll (commons 3, the rest 1-2). */
export function rollCrateItem(rng: () => number): string {
  const total = ITEM_DEFS.reduce((t, d) => t + d.weight, 0);
  let roll = rng() * total;
  for (const d of ITEM_DEFS) {
    roll -= d.weight;
    if (roll <= 0) return d.id;
  }
  return ITEM_DEFS[0].id;
}
