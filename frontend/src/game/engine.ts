// VANGUARD '44 battle engine — real-time top-down WW2 tactics with tactical pause,
// fog of war, suppression, waves, and permadeath reporting. Pure canvas + rAF.

import { CAUSES, CRATE_CHANCE, CRATE_RP, ENEMY_TYPES, LOOT_RADIUS, UNIT_TYPES, isCowardQuirk, levelBonus, medalBonus } from "./data";
import type { EnemyTypeId, Mission, UnitTypeId } from "@/lib/types";
import { loadSettings, SHAKE_FACTOR } from "@/lib/settings";
import { setSfxMuted, setSfxVolume, sfx, whistleSfx } from "./sfx";
import { FEET_X, SPR_H, drawBoom, pixelize, sprite, type Head, type Pose, type Weapon } from "./sprites";

export const MAP_W = 4000;
export const MAP_H = 1350;
/** Half the road's width (the road is drawn 46 wide). */
export const ROAD_HALF = 23;
/** The tank road's centerline y at a given x. The road is the cubic
 * bezier from (0, MAP_H/2) to (MAP_W, MAP_H/2) with control points at
 * (0.3W, y0-90) and (0.7W, y0+90) — the same curve buildTerrain draws.
 * Inverts the bezier's x by binary search (x is monotonic in t), so
 * the tank and the road-clearance filter agree on where the road is. */
export function roadYAt(x: number): number {
  const y0 = MAP_H / 2;
  const cx = Math.max(0, Math.min(MAP_W, x));
  const bx = (t: number) => {
    const u = 1 - t;
    return 3 * u * u * t * (MAP_W * 0.3) + 3 * u * t * t * (MAP_W * 0.7) + t * t * t * MAP_W;
  };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (bx(mid) < cx) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  const u = 1 - t;
  return u * u * u * y0 + 3 * u * u * t * (y0 - 90) + 3 * u * t * t * (y0 + 90) + t * t * t * y0;
}
const VIEW_W = 1600; // world units visible at once — the camera scrolls over the rest
const VIEW_H = 900;
const CELL = 24;
const COLS = Math.ceil(MAP_W / CELL);
const ROWS = Math.ceil(MAP_H / CELL);
const UNIT_R = 9;
// NPC tactical fallback tuning (2026-11-12): a 2nd Platoon man at
// this share of his health or less falls back; healed above the
// rejoin share, he goes back to the fight.
const NPC_FALLBACK_HP = 0.35;
const NPC_REJOIN_HP = 0.6;
// Near-miss band for mortar shells (2026-11-12): a shell that
// lands within this far beyond its damage radius still rattles
// the men it missed — suppression and morale, no wound.
const NEAR_MISS_BAND = 45;
// The airborne convoy's road speed: a slow, cautious roll west.
const CONVOY_SPEED = 26;
const PAN_SPEED = 900;
const PX = 3; // world units per screen pixel — the whole battlefield renders as chunky pixel art
const MIN_SCALE = 0.7; // zoomed in so the chunky sprites read clearly
const PIXEL_FONT = "24px Silkscreen, monospace";
const snap = (v: number) => Math.round(v / PX) * PX;

/** A destroyed vehicle stays on the field as a burnt wreck —
 * never a body (Josh, 2026-11-12). kind is the enemy type for
 * axis vehicles, "tank" for the player's Sherman. */
interface Wreck {
  x: number;
  y: number;
  kind: string;
  flip: boolean;
  axis: boolean;
  /** Battle clock at the kill, for embers and smoke that die
   * down as the wreck cools. */
  t0: number;
}

interface Corpse {
  x: number;
  y: number;
  img: HTMLCanvasElement;
  axis: boolean;
}

// Sprite look for each unit: palette, headgear, weapon.
function lookOf(u: { side: "allies" | "axis"; type: UnitTypeId; enemyType: EnemyTypeId | null; npc: boolean }): { pal: string; head: Head; weapon: Weapon } {
  if (u.side === "allies") {
    const weapon: Weapon = ({ rifleman: "rifle", medic: "none", mg: "mg", sniper: "sniper", at: "bazooka", radioman: "rifle", recon: "smg", engineer: "rifle", tank: "none" } as const)[u.type];
    return { pal: u.npc ? "usNpc" : "us", head: u.type === "medic" ? "us-medic" : "us", weapon };
  }
  switch (u.enemyType) {
    case "volks": return { pal: "volks", head: "cap", weapon: "rifle" };
    case "grenadier": return { pal: "wehr", head: "stahl", weapon: "smg" };
    case "mg42": return { pal: "wehr", head: "stahl", weapon: "mg" };
    case "officer": return { pal: "officer", head: "officer", weapon: "pistol" };
    case "panzerfaust": return { pal: "wehr", head: "stahl", weapon: "panzerfaust" };
    case "flak": return { pal: "wehr", head: "stahl", weapon: "flak" };
    case "scharfschutze": return { pal: "sniperDe", head: "stahl", weapon: "sniper" };
    case "mortar": return { pal: "wehr", head: "stahl", weapon: "mortar" };
    case "fallschirmjager": return { pal: "para", head: "para", weapon: "rifle" };
    case "medic": return { pal: "wehr", head: "stahl", weapon: "pistol" };
    case "funk": return { pal: "wehr", head: "stahl", weapon: "pistol" };
    default: return { pal: "wehr", head: "stahl", weapon: "rifle" };
  }
}

export type Variant = "beach" | "airborne" | "";
export type Formation = "wedge" | "line" | "column" | "spread";
export type SquadOrder = "attack" | "defend" | "formup";
export type Reinforcement = "rifle" | "heavy";
export const MAX_REINFORCEMENTS = 3;

/** Radio support: what a living radioman can call in from the RADIO
 * menu, on top of his Rally Call (Q) and the reinforcements. All three
 * are player-called (AUTO never calls them, same as reinforcements)
 * and all three need the radio up — kill the radioman and they stop
 * until another is hired. Cooldowns are per battle. */
export type RadioSupportKind = "artillery" | "supply" | "recon" | "mortar" | "smoke" | "tank";
export const ARTILLERY_CD = 60;
export const SUPPLY_CD = 45;
/** Recon (Josh, 2026-11-12): a sniper fights at full range only
 * with a Recon near him; alone he self-spots at solo range. A
 * Recon hidden in foliage is spotted by the enemy at barely
 * half the normal distance, until his own fire gives him away. */
export const RECON_PAIR_DIST = 90;
export const SNIPER_SOLO_RANGE = 260;
export const RECON_SPOT_FACTOR = 0.55;
export const RECON_REVEAL_SECONDS = 3;
/** Engineer (Josh, 2026-11-12): the detector finds mines
 * within 70; a revealed mine within reach gets four seconds of
 * still, exposed work to clear; he walks to a revealed mine
 * within 130 when the field is quiet. */
export const ENGINEER_DETECT_RANGE = 70;
export const ENGINEER_CLEAR_RANGE = 26;
export const ENGINEER_CLEAR_SECONDS = 4;
export const ENGINEER_SEEK_RANGE = 130;
export const RECON_CD = 30;
export const MORTAR_CD = 25;
export const SMOKE_CD = 45;
export const ARTY_SHELLS = 3;
export const ARTY_AOE = 70;
export const ARTY_DMG = 70;
export const MORTAR_AOE = 50;
export const MORTAR_DMG = 60;
export const SUPPLY_HEAL = 50;
export const RECON_RADIUS = 300;
export const SMOKE_RADIUS = 150;
export const SMOKE_DURATION = 20;

/** Radio calls, one per commander level, in unlock order. The
 * commander has 8 ranks (2nd Lt. to Maj. Gen.), so 8 calls get one
 * level each. Rally Call is level 1 (every commander has it); the
 * tank is level 8 (Maj. Gen. only). */
export type RadioCallKind = "rally" | "reinforce" | "supply" | "recon" | "mortar" | "smoke" | "artillery" | "tank";

/** Base RP cost of each radio support call at radioman level 0 (a
 * rookie pays full cost). Rally Call is free (his own ability,
 * cooldown only). Mirrors backend/lib/missions.py. */
export const RADIO_SUPPORT_COST: Record<RadioSupportKind, number> = {
  supply: 10,
  recon: 10,
  mortar: 20,
  smoke: 15,
  artillery: 30,
  tank: 60,
};
/** 5% off per radioman level (max 30% off at level 6). */
export const RADIO_DISCOUNT_PER_LEVEL = 0.05;
/** What a radio call costs at a given radioman level (0-6). Rounds
 * half up, matching the backend's int(x + 0.5). */
export function radioCost(base: number, radiomanLevel: number): number {
  return Math.max(0, Math.round(base * (1 - RADIO_DISCOUNT_PER_LEVEL * radiomanLevel)));
}
/** Cooldowns (seconds left, 0 = ready) for the six menu call-ins. */
export type SupportCd = { artillery: number; supply: number; recon: number; mortar: number; smoke: number; tank: number };
export const RADIO_CALL_LEVEL: Record<RadioCallKind, number> = {
  rally: 1,
  reinforce: 2,
  supply: 3,
  recon: 4,
  mortar: 5,
  smoke: 6,
  artillery: 7,
  tank: 8,
};

interface Order {
  x: number;
  y: number;
}

interface Unit {
  id: number;
  side: "allies" | "axis";
  type: UnitTypeId;
  enemyType: EnemyTypeId | null;
  soldierId: string | null;
  name: string;
  rank: string;
  level: number;
  reaction: number;
  x: number;
  y: number;
  facing: number;
  hp: number;
  maxHp: number;
  speed: number;
  range: number;
  vision: number;
  dmg: number;
  fireInterval: number;
  spread: number;
  bulletSpeed: number;
  isStatic: boolean;
  /** A vehicle (the Sherman): no morale, it never breaks or flees. */
  vehicle: boolean;
  /** A counter-attacker: spawned by a random counter-attack, he charges
   * the player's squad and ignores the camp-and-defend rule. */
  counterAttack: boolean;
  /** Aggressive: a Wave 2 or Wave 3 man. He charges on spawn instead
   * of camping and defending — the reinforcements come at the player,
   * they do not wait to be found. Same charge as a counter-attacker. */
  aggressive?: boolean;
  /** Garrison home (where the man spawned) and his current patrol
   * target. A camping enemy patrols around his home instead of
   * standing frozen: he walks slowly to a point near home, then picks
   * another, so the defense is alive even when nothing is spotted. */
  homeX: number;
  homeY: number;
  patrolX: number;
  patrolY: number;
  /** Wave 1 trench garrison: the man holds the first trench line,
   * and patrols along it instead of wandering open ground. */
  trenchHold?: boolean;
  /** Airborne variant only: this unit belongs to the enemy
   * convoy (a truck or one of its escort). The convoy marches
   * west along the road until first contact; see the convoy
   * branch in the movement chain. */
  convoy?: boolean;
  /** Beach landing intro: the man is still inside his Higgins
   * boat. Hidden, harmless, and not yet ashore; landX/landY are
   * where he comes ashore when his boat's ramp drops. */
  embarked?: boolean;
  landX?: number;
  landY?: number;
  /** Retreat: the man reached the west edge during a fall back
   * and is out of the battle — alive on the roster, no corpse,
   * no casualty filing. */
  extracted?: boolean;
  /** Airborne intro: when this man's jump starts (seconds into
   * the intro, keyed to the C-47 passing his x) and how long he
   * hangs under canopy. */
  dropStart?: number;
  dropDur?: number;
  /** Airborne intro: set the moment his boots touch, so the
   * landing dust puffs exactly once. */
  landed?: boolean;
  orders: Order[];
  attackId: number | null;
  targetId: number | null;
  cooldown: number;
  suppression: number;
  pinned: boolean;
  // Morale: 0-100, starts at 100. Falls under fire, casualties and
  // suppression; recovers out of fire, faster near a medic or a
  // leader. At 20 or below the man breaks and falls back; at 45 he
  // rallies and fights again. A coward is different: he has less
  // nerve, so he breaks at 50, and when he breaks he ROLLS — a low
  // chance (fleeChance) he runs for the edge instead of falling back.
  // Fleeing is RNG, not a guarantee. A fleeing man's nerve does not
  // come back on its own while broken, and he rallies at 65 — so one
  // rally call from a radioman (or a Funker) steadies him, and a few
  // seconds near a medic does too.
  morale: number;
  broken: boolean;
  lastHitT: number;
  /** Coward: when his morale breaks he runs for the nearest edge of
   * the map instead of falling back, and deserts if he reaches it.
   * Coward is the trait (who CAN flee); willFlee is this break's
   * roll (whether he DOES). */
  coward: boolean;
  /** This break's flee roll landed: he is running for the edge. */
  willFlee: boolean;
  /** Seconds this coward has spent fleeing while broken. Desertion
   * needs 2s of flight, so a man who breaks on the deployment line
   * does not vanish before a rally call can reach him. */
  fleeT: number;
  /** True once he has deserted: off the field, not dead, not in the Memorial. */
  fled: boolean;
  /** Tactical fallback (NPC allies): at 35% health or less the man
   * breaks off, pulls back west to cover near the rear, and holds
   * there until healed above 60%, then rejoins. Set and cleared by
   * the fallback check in update; all NPC allies, every mission. */
  npcFallback?: boolean;
  /** NPC squads (Josh, 2026-11-12): 2nd Platoon men deploy in
   * squads of 8 with a leader; followers anchor to their leader
   * like the player's men anchor to theirs. Undefined for the
   * player's men, paid reinforcement teams, and lone NPCs. */
  npcSquad?: number;
  /** The current leader of his NPC squad, kept fresh by
   * npcSquadLeaderOf (succession: rank, then kills, then level). */
  npcLeader?: boolean;
  /** Marked by a Recon (until this time): the squad sees him
   * through fog and his wounds run heavier under their fire. */
  markedUntil?: number;
  /** The mark came from a hidden Recon: the first allied hit
   * springs the ambush and hits hardest, once. */
  markedAmbush?: boolean;
  /** When this unit last fired a shot (battle clock). A Recon
   * who just fired has given himself away for a few seconds. */
  lastShotT?: number;
  /** Engineer at work on a mine this tick: hands busy, no fire. */
  clearing?: boolean;
  /** Prone: dropped flat under heavy fire (suppression 70+).
   * Harder to hit at range, no protection up close, slower
   * movement and fire. Footmen only. */
  prone?: boolean;
  /** The tick time at which the unit last actually moved
   * (position changed in moveToward). The WASD drive moves the
   * leader outside his own unit turn, so the prone fire gate
   * checks this as well as the turn's own movement flag. */
  movedT?: number;
  abilityCd: number;
  burst: number;
  burstTimer: number;
  burstTarget: { x: number; y: number } | null;
  kills: number;
  alive: boolean;
  walk: number;
  // medal tracking
  damageTaken: number;
  healed: number;
  heavyKills: number;
  officerKills: number;
  dmgMult: number;
  healMult: number;
  // pathing toward a moving focus
  chase: Order[];
  repathT: number;
  npc: boolean; // AI-controlled friendly (not the player's squad, no permadeath)
  cover: Cover | null;
  coverT: number;
  // Unstuck / cover-seek state. stuckT accumulates while a unit has a
  // move order but makes no progress; lastX/lastY is the position sampled
  // at the start of that window. coverSeekT is the cooldown between
  // automatic cover-seeking attempts, so a unit does not re-path to cover
  // every frame.
  stuckT: number;
  lastX: number;
  lastY: number;
  stuckFails: number;
  coverSeekT: number;
  // Cover-seek blacklist: after the stuck detector drops a wedged cover
  // order, the destination it was heading for is banned for 10s so the
  // unit does not immediately re-order to the same unreachable cover
  // spot and wedge again. coverIdleT tracks how long an NPC/axis unit
  // has sat in cover with no target in range/LOS.
  coverBanT: number;
  coverBanX: number;
  coverBanY: number;
  coverIdleT: number;
  // Stuck-progress tracking: the destination the unit is trying to
  // reach, and how far away it was when tracking started. The old
  // detector only checked raw displacement in the last second, so a
  // unit shoved sideways by separation, or sliding along a wall, could
  // move a few units a second and reset the fail counter forever while
  // never getting any closer to where it was going.
  stuckDestX: number;
  stuckDestY: number;
  stuckDestD: number;
  // Chase ban: after the stuck detector drops a wedged order, the unit
  // may not chase again for 5s. Without it, an axis/NPC unit whose prey
  // is behind a wall drops its chase, then re-chases the same prey in
  // the next frame, wedges again, drops again — a loop the cover
  // cooldown never saw, because chase has no cooldown of its own.
  chaseBanT: number;
  // animation
  deathT?: number;
  /** Battle time of death, stamped in kill(). Drives the squad
   * dock order: the fallen collect at the far right in the order
   * they fell (Josh, 2026-11-12). Undefined while alive. */
  diedAt?: number;
  shootT?: number;
  prevWalk?: number;
}

interface Cover {
  x: number;
  y: number;
  r: number;
  q: number; // chance a bullet from the far side is stopped
  // Tactical cover (2026-11-11): light cover (sandbags, crates,
  // hedgerows, trees, bushes) stops some rounds and breaks under
  // fire; heavy cover (ruin walls, wrecks, buildings, pillboxes)
  // stops most rounds, takes far more punishment, and shelters 2
  // men instead of 1. No type on old saves means light.
  type?: "light" | "heavy";
  // Destructible cover (sandbags, crates): explosions wear it down until it's gone.
  kind?: "sandbag" | "crate" | "trench";
  hp?: number;
  maxHp?: number;
  q0?: number;
  blocker?: Blocker;
}

interface Bullet {
  ox: number;
  oy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  side: "allies" | "axis";
  dmg: number;
  suppress: number;
  life: number;
  sourceType: string;
  killerId: number | null;
  ally: boolean;
}

interface Projectile {
  x: number;
  y: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t: number;
  dur: number;
  side: "allies" | "axis";
  dmg: number;
  aoe: number;
  kind: "grenade" | "rocket";
  sourceType: string;
  killerId: number | null;
  smokeT: number;
  /** True once this shell's incoming whistle has been played
   * (about a second before impact; the only warning a mortar
   * round gives now). */
  whistled?: boolean;
}

interface Boat {
  x: number;
  y: number;
  men: Unit[];
  /** How many of her men are ashore so far. */
  out: number;
  /** Seconds since the bow reached the shoreline (ramp timing). */
  timer: number;
  /** Disembark clock: a man every 0.22s once the ramp is down. */
  releaseT: number;
  /** Wake foam spawn clock while she is still moving. */
  wakeT: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  kind: "muzzle" | "blood" | "dust" | "smoke" | "spark" | "heal" | "ring" | "boom" | "foam" | "leaf";
}

export type BlockerKind = "tree" | "ruin" | "building" | "hedgerow" | "wreck" | "crate" | "hedgehog" | "pillbox" | "bush" | "trench" | "obstacle";
interface Blocker {
  x: number;
  y: number;
  r: number;
  kind?: BlockerKind;
  /** Which placed object this circle belongs to (one ruin, one
   * building, one hedgerow line). Circles of the SAME object
   * are meant to touch (a wall is a row of circles); circles
   * of DIFFERENT objects must never overlap (Josh, 2026-11-12:
   * ruins and houses sat on top of other objects). */
  obj?: number;
  /** Foliage only: battle clock of the last rustle through
   * this tree or bush, for the moving-foliage draw. */
  rustleT?: number;
}

export interface HudUnit {
  id: number;
  soldierId: string | null;
  name: string;
  rank: string;
  level: number;
  type: UnitTypeId;
  hp: number;
  maxHp: number;
  suppression: number;
  pinned: boolean;
  morale: number;
  broken: boolean;
  /** A coward: breaks and runs for the edge, deserts if he reaches it. */
  coward: boolean;
  abilityCd: number;
  abilityCdMax: number;
  kills: number;
  alive: boolean;
  /** Battle time of death (null while alive). The dock lists the
   * fallen at the far right in fall order. */
  diedAt: number | null;
  orders: number;
}

export interface LogLine {
  t: number;
  text: string;
  kind: "info" | "kill" | "death" | "wave" | "win" | "lose";
}

export interface HudSnapshot {
  elapsed: number;
  paused: boolean;
  briefing: boolean;
  state: "active" | "victory" | "defeat";
  units: HudUnit[];
  selectedIds: number[];
  enemiesAlive: number;
  wave: number;
  waves: number;
  aimUnitId: number | null;
  log: LogLine[];
  formation: Formation;
  touchBox: boolean;
  reinforcementsLeft: number;
  /** True while a squad radioman is alive: radio support is up. */
  radioLive: boolean;
  /** Seconds left on each radio support call-in (0 = ready). */
  supportCd: SupportCd;
  /** True once the tank has been called this battle (once per battle). */
  tankUsed: boolean;
  /** What each radio support call costs right now, at the living
   * radioman's level (a rookie pays full cost, a veteran pays less). */
  supportCost: Record<RadioSupportKind, number>;
  /** What the two reinforcement teams cost right now, same discount. */
  reinforceCost: { rifle: number; heavy: number };
  /** True while an enemy Funker is alive: enemy call-ins are armed. */
  enemyRadioLive: boolean;
  autoBattle: boolean;
  leaderId: number | null;
  squadOrder: SquadOrder;
  /** True while a retreat is running: player control is over
   * and the squad is falling back on its own. The UI banners
   * it so the dead controls read as a state, not a bug. */
  retreating: boolean;
  // Fireteams: living player-squad ids in Alpha / Bravo, empty when
  // the squad has not been split. The UI shows SPLIT / ALPHA / BRAVO
  // / MERGE from these.
  teamA: number[];
  teamB: number[];
}

export interface FallenReport {
  soldierId: string;
  cause: string;
  kills: number;
  damageTaken: number;
  healed: number;
  heavyKills: number;
  officerKills: number;
}

export interface SurvivorReport {
  soldierId: string;
  kills: number;
  damageTaken: number;
  healed: number;
  heavyKills: number;
  officerKills: number;
}

/** A supply crate on the map: a squad man who walks up to it
 * loots it for CRATE_RP. Not a cover crate (those are Blocker kind
 * "crate") — this one holds RP. */
export interface SupplyCrate {
  x: number;
  y: number;
  looted: boolean;
}

export interface BattleReport {
  missionId: string;
  victory: boolean;
  durationSec: number;
  fallen: FallenReport[];
  /** Men who broke and ran off the field. Same shape as fallen. */
  deserted: FallenReport[];
  survivors: SurvivorReport[];
  /** RP looted from supply crates this battle. */
  lootRp: number;
}

export interface ReplayUnit {
  id: number;
  side: "allies" | "axis";
  npc: boolean;
  type: string;
  enemyType: string | null;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  kills: number;
  cover: boolean;
  /** Directional cover the man is actually using, or null. */
  coverType: "light" | "heavy" | null;
  /** "trench" when the man is in a trench, so the replay shield matches the live game. */
  coverKind: "trench" | null;
  /** Morale 0-100 at this frame, and whether he is broken. */
  morale: number;
  broken: boolean;
  /** True for the player's medic, the 2nd Platoon medic and the Axis Sanitaeter. */
  medic: boolean;
  /** True once the man has deserted and left the field. */
  fled: boolean;
  /** True for either side's radio man (squad radioman or enemy Funker). */
  radio: boolean;
}

export interface ReplayFrame {
  t: number;
  phase: string;
  battleState: string;
  wave: number;
  units: ReplayUnit[];
  /** Supply crates on the map, with their looted state, so replays
   * show them the same way the live game does. */
  crates: Array<{ x: number; y: number; looted: boolean }>;
}

export interface ReplayObstacle {
  x: number;
  y: number;
  r: number;
  kind: BlockerKind;
}

export interface BattleReplay {
  mission: string;
  mapW: number;
  mapH: number;
  durationSec: number;
  result: "active" | "victory" | "defeat";
  obstacles: ReplayObstacle[];
  frames: ReplayFrame[];
}

// Deterministic PRNG so a mission always generates the same battlefield.
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

const prefersReducedMotion =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface SquadInput {
  id: string;
  name: string;
  type: UnitTypeId;
  rank: string;
  level: number;
  medals: string[];
  /** The man's quirk ("Skittish", "Jumpy", ...). A cowardly quirk makes him a coward. */
  quirk?: string;
}

// ---------------- pathfinding (A* on the CELL grid, 8-way, LOS-smoothed) ----------------

function buildBlockedGrid(blockers: Blocker[]): Uint8Array {
  const g = new Uint8Array(COLS * ROWS);
  for (const b of blockers) {
    if (b.kind === "trench") continue; // dug in, not built up: men walk in and fight from inside
    if (b.kind === "tree" || b.kind === "bush") continue; // foliage: troops push through it now
    const r = b.r + UNIT_R * 0.7;
    const c0 = Math.max(0, Math.floor((b.x - r) / CELL));
    const c1 = Math.min(COLS - 1, Math.floor((b.x + r) / CELL));
    const r0 = Math.max(0, Math.floor((b.y - r) / CELL));
    const r1 = Math.min(ROWS - 1, Math.floor((b.y + r) / CELL));
    for (let gy = r0; gy <= r1; gy++)
      for (let gx = c0; gx <= c1; gx++) {
        const dx = (gx + 0.5) * CELL - b.x;
        const dy = (gy + 0.5) * CELL - b.y;
        if (dx * dx + dy * dy <= r * r) g[gy * COLS + gx] = 1;
      }
  }
  return g;
}

function nearestOpen(g: Uint8Array, cx: number, cy: number): [number, number] {
  if (!g[cy * COLS + cx]) return [cx, cy];
  for (let rad = 1; rad < 12; rad++)
    for (let dy = -rad; dy <= rad; dy++)
      for (let dx = -rad; dx <= rad; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && y >= 0 && x < COLS && y < ROWS && !g[y * COLS + x]) return [x, y];
      }
  return [cx, cy];
}

function lineClear(g: Uint8Array, x0: number, y0: number, x1: number, y1: number): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.ceil(d / (CELL / 3));
  for (let i = 1; i < steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const y = y0 + ((y1 - y0) * i) / steps;
    if (g[Math.floor(y / CELL) * COLS + Math.floor(x / CELL)]) return false;
  }
  return true;
}

// Like lineClear, but with a full unit-radius clearance on both sides of
// the line. The plain check only samples the centre line, so a
// string-pulled path could graze a blocker: the unit then walked straight
// into it, resolveCollisions pushed it back out, and it sat there forever
// with orders still queued. Paths smoothed with this check keep a unit's
// whole body clear of blockers.
function lineClearWide(g: Uint8Array, x0: number, y0: number, x1: number, y1: number): boolean {
  if (!lineClear(g, x0, y0, x1, y1)) return false;
  const d = Math.hypot(x1 - x0, y1 - y0);
  if (d < 1) return true;
  const nx = (-(y1 - y0) / d) * UNIT_R;
  const ny = ((x1 - x0) / d) * UNIT_R;
  return lineClear(g, x0 + nx, y0 + ny, x1 + nx, y1 + ny) && lineClear(g, x0 - nx, y0 - ny, x1 - nx, y1 - ny);
}

// Binary-heap priority queue for A*: the old open list was a plain array
// scanned linearly for the minimum every step, O(n^2) on a 100x57 grid,
// which is why long cross-map paths were slow and could hit the iteration
// cap before reaching the goal.
function heapPush(heap: number[], f: Float32Array, i: number) {
  heap.push(i);
  let c = heap.length - 1;
  while (c > 0) {
    const p = (c - 1) >> 1;
    if (f[heap[p]] <= f[heap[c]]) break;
    [heap[p], heap[c]] = [heap[c], heap[p]];
    c = p;
  }
}

function heapPop(heap: number[], f: Float32Array): number {
  const top = heap[0];
  const last = heap.pop()!;
  if (heap.length) {
    heap[0] = last;
    let p = 0;
    for (;;) {
      const l = p * 2 + 1;
      const r = l + 1;
      let s = p;
      if (l < heap.length && f[heap[l]] < f[heap[s]]) s = l;
      if (r < heap.length && f[heap[r]] < f[heap[s]]) s = r;
      if (s === p) break;
      [heap[p], heap[s]] = [heap[s], heap[p]];
      p = s;
    }
  }
  return top;
}

function findPath(g: Uint8Array, sx: number, sy: number, tx: number, ty: number): Order[] {
  if (lineClearWide(g, sx, sy, tx, ty)) return [{ x: tx, y: ty }];
  const clampC = (v: number, m: number) => Math.max(0, Math.min(m - 1, v));
  const [scx, scy] = nearestOpen(g, clampC(Math.floor(sx / CELL), COLS), clampC(Math.floor(sy / CELL), ROWS));
  const [tcx, tcy] = nearestOpen(g, clampC(Math.floor(tx / CELL), COLS), clampC(Math.floor(ty / CELL), ROWS));
  const start = scy * COLS + scx;
  const goal = tcy * COLS + tcx;
  if (start === goal) return [{ x: tx, y: ty }];
  const gScore = new Float32Array(COLS * ROWS).fill(Infinity);
  const came = new Int32Array(COLS * ROWS).fill(-1);
  const closed = new Uint8Array(COLS * ROWS);
  const inOpen = new Uint8Array(COLS * ROWS);
  const open: number[] = [];
  const f = new Float32Array(COLS * ROWS).fill(Infinity);
  gScore[start] = 0;
  const h = (i: number) => Math.hypot((i % COLS) - tcx, Math.floor(i / COLS) - tcy);
  f[start] = h(start);
  heapPush(open, f, start);
  inOpen[start] = 1;
  let iter = 0;
  // Best cell reached, by heuristic distance to the goal. If the goal
  // turns out unreachable (walled off, iteration cap), the path ends at
  // the closest reachable cell instead of the old fallback: a straight
  // line to the blocked target, which the unit walked into forever.
  let best = start;
  let bestH = h(start);
  let reached = false;
  while (open.length && iter++ < 20000) {
    const cur = heapPop(open, f);
    inOpen[cur] = 0;
    if (cur === goal) {
      reached = true;
      break;
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (f[cur] - gScore[cur] < bestH) {
      best = cur;
      bestH = f[cur] - gScore[cur];
    }
    const cx = cur % COLS;
    const cy = Math.floor(cur / COLS);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        const ni = ny * COLS + nx;
        if (g[ni] || closed[ni]) continue;
        if (dx && dy && (g[cy * COLS + nx] || g[ny * COLS + cx])) continue; // no corner cutting
        const tentative = gScore[cur] + (dx && dy ? 1.414 : 1);
        if (tentative < gScore[ni]) {
          gScore[ni] = tentative;
          came[ni] = cur;
          f[ni] = tentative + h(ni);
          if (!inOpen[ni]) {
            heapPush(open, f, ni);
            inOpen[ni] = 1;
          } else {
            // Score improved for a cell already queued: re-heapify by
            // pushing a duplicate; the closed check above discards the
            // stale entry when it is popped.
            heapPush(open, f, ni);
          }
        }
      }
  }
  const end = reached ? goal : best;
  const cells: Order[] = [];
  for (let i = end; i !== -1 && i !== start; i = came[i]) {
    cells.push({ x: (i % COLS) * CELL + CELL / 2, y: Math.floor(i / COLS) * CELL + CELL / 2 });
  }
  cells.reverse();
  if (reached && !g[Math.floor(ty / CELL) * COLS + Math.floor(tx / CELL)]) cells[cells.length - 1] = { x: tx, y: ty };
  // String-pull: drop waypoints we can see past, with full unit clearance.
  const out: Order[] = [];
  let ax = sx;
  let ay = sy;
  for (let i = 0; i < cells.length; i++) {
    const next = cells[i + 1];
    if (next && lineClearWide(g, ax, ay, next.x, next.y)) continue;
    out.push(cells[i]);
    ax = cells[i].x;
    ay = cells[i].y;
  }
  return out.length ? out : [{ x: (end % COLS) * CELL + CELL / 2, y: Math.floor(end / COLS) * CELL + CELL / 2 }];
}

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private onHud: (h: HudSnapshot) => void;

  private view = { s: 1, ox: 0, oy: 0 };
  private raf = 0;
  private last = 0;
  private running = false;

  private mission: Mission | null = null;
  private units: Unit[] = [];
  private bullets: Bullet[] = [];
  private projectiles: Projectile[] = [];
  private particles: Particle[] = [];
  private blockers: Blocker[] = [];
  private blocked: Uint8Array = new Uint8Array(COLS * ROWS);
  private covers: Cover[] = [];
  /** Beach only: the hedgehog blockers, cached for the obstacle
   * belt slowdown in moveToward. */
  private hedgehogs: Blocker[] = [];
  /** Trees and bushes: soft cover a footman can push through
   * (Josh, 2026-11-12). Cached once per battle. */
  private foliage: Blocker[] = [];
  /** Tellermines, laid in setup: in the beach sand (x 300-780)
   * and in the airborne landing fields (x 480-1560). An armed
   * mine under an allied man's feet goes off once; the axis
   * never triggers its own fields. Drawn small and dark — you
   * find them by stepping on them, or by bringing an Engineer:
   * his detector reveals the mines near him (red ring and flag),
   * and he can clear a revealed one with four seconds of work. */
  private mines: { x: number; y: number; armed: boolean; revealed?: boolean; cleared?: boolean; clearT?: number }[] = [];
  private corpses: Corpse[] = [];
  private wrecks: Wreck[] = [];
  /** A fall back is in progress: the squad is withdrawing to
   * the west edge under fire (see retreat()). */
  private retreating = false;
  /** Retreat flankers (Josh, 2026-11-12): seconds on the battle
   * clock at which the enemy flanking groups arrive to cut off
   * a retreat, and whether they have arrived. Set by retreat(). */
  private flankersAt = 0;
  private flankersSpawned = false;
  private speed = 1; // Settings: game speed multiplier
  private shakeK = 1; // Settings: screen shake strength
  private touchPan: { x: number; y: number; cx: number; cy: number; moved: boolean; t0: number } | null = null;
  private touchBox = false;
  private formation: Formation = "wedge";
  private reinforcements = 0;
  private coverLogT = 0;
  private holdPan = { x: 0, y: 0 };
  private cam = { x: 0, y: 0 };
  private viewW = VIEW_W;
  private viewH = VIEW_H;
  private keys = new Set<string>();
  private variant: Variant = "";
  /** Airborne variant: true once the enemy convoy has made
   * first contact with the paratroopers. The march ends, the
   * trucks halt, and the escort deploys to fight. */
  private convoyContact = false;
  /** The convoy halftrack carries a squad in its troop bay:
   * true once it has unloaded them at first contact (Josh,
   * 2026-11-12). Once per battle, and only if it lives that long. */
  private halftrackDropped = false;
  /** Intro sequences (Josh, 2026-11-12): the Higgins boat
   * landing on the beach and the C-47 drop on the airborne
   * variant. Drawn in the game's own art, a few seconds long,
   * then control passes to the player. introT counts seconds
   * since begin(); -1 means no intro is running. While an intro
   * runs, update() advances only the intro: no combat, no
   * movement AI, no replay frames. */
  private boats: Boat[] = [];
  private introKind: "boats" | "drop" | null = null;
  private introT = -1;
  private dropEnd = 0;
  private terrain: HTMLCanvasElement | null = null;
  private tctx: CanvasRenderingContext2D | null = null;
  private fog: HTMLCanvasElement | null = null;
  private fogCtx: CanvasRenderingContext2D | null = null;
  private visible: Uint8Array = new Uint8Array(COLS * ROWS);
  private explored: Uint8Array = new Uint8Array(COLS * ROWS);
  private fogT = 0;

  private nextId = 1;
  private waveIndex = 0;
  private waves: Array<Array<{ type: EnemyTypeId; count: number }>> = [];
  private nextWaveT = 0;
  /** Coward chance: the share of Volkssturm conscripts who are
   * cowards. A coward is only a man who CAN flee — the flee itself
   * is a separate roll (fleeChance) each time he breaks. */
  private cowardChance = 0.25;
  /** Flee chance: when a coward's morale breaks, this is the roll
   * for running for the edge instead of falling back. A roll, not a
   * guarantee — most coward-breaks still fall back — but high enough
   * to actually see: at 25% the mechanic fired zero times in eight
   * AUTO battles, because breaks themselves are only about three a
   * battle. The knob for rarer is this number; the other knobs are
   * cowardChance, the break line (50) and the doubled nerve loss
   * (moraleLoss). */
  private fleeChance = 0.4;
  /** Flee chance for a man who is NOT a coward: any man whose morale
   * breaks rolls this small chance to run. Cowards roll the bigger
   * number above, and break more often besides (doubled nerve loss),
   * so they are still the ones who usually run. */
  private fleeChanceNormal = 0.1;
  /** Enemy radio: seconds until this wave's Funker calls in 2 more men,
   * and whether this wave's one call-in has already happened. */
  private enemyRadioT = 0;
  /** Random counter-attacks: seconds until the next one, and how many
   * have already happened this battle (at most COUNTER_ATTACK_MAX).
   * A counter-attack is 2 men who charge the player's squad, ignoring
   * the camp-and-defend rule — a surprise push, not a wave. */
  private counterAttackT = 0;
  private counterAttacks = 0;
  private readonly COUNTER_ATTACK_MAX = 2;
  // Radio support cooldowns (seconds left). Tick down in update().
  private artyCd = 0;
  private supplyCd = 0;
  private reconCd = 0;
  private mortarCd = 0;
  private smokeCd = 0;
  /** True once the tank has been called this battle (once per battle). */
  private tankCalled = false;
  /** Smoke zones on the map: {x, y, r, t} — t is seconds left. */
  private smokeZones: Array<{ x: number; y: number; r: number; t: number }> = [];
  /** Commander level (1-8) — gates the radio calls, one per level. */
  private commanderLevel = 1;
  private enemyRadioCalled = false;
  /** Supply crates on this map, and the RP looted from them. Crates
   * are public so the replay recorder and tests can read them. */
  crates: SupplyCrate[] = [];
  private lootRp = 0;
  /** Crate chance: the roll for whether this battle has a supply
   * crate at all. A field, like fleeChance, so tests can force it. */
  private crateChance = CRATE_CHANCE;
  private elapsed = 0;
  // Stalemate breaker (bug #2): when neither side has hurt the other
  // for 60s — allies in cover vs a static MG42 out of its own range,
  // a mortar out of range, nobody in range of anybody — the battle
  // soft-locks forever (cover-hold sims ran the full 480s). After 60s
  // of no combat every living mobile unit is ordered to hunt its
  // nearest enemy, statics included as targets (they never move).
  // This is a design choice, not a balance tweak: it overrides a
  // player squad's hold position, and only fires after a full minute
  // with no HP lost on either side, so a deliberate hold is safe for
  // 60s. Josh can revert it; it changes no damage, health, or counts.
  private stalemateT = 0;
  private stalemateHp = -1;
  private stalemateAlive = -1;
  private stalemateActive = false;
  private phase: "briefing" | "battle" | "over" = "briefing";
  private paused = false;
  // Auto Battle: when on, the player's squad fights on its own using
  // the same chase / cover / fire logic as the NPC allies, and manual
  // orders are off. Any manual order takes command back instantly.
  private autoBattle = false;
  // Team leader system (Josh, 2026-11-12): the player drives ONE
  // leader directly; every other deployed squad man is an AI
  // follower anchored to him. AUTO survives only as the internal
  // test driver, never as a player mode.
  private leaderId: number | null = null;
  private squadOrder: SquadOrder = "formup";
  private manualShot: { x: number; y: number; until: number } | null = null;
  // Twin-stick touch (Josh, 2026-11-12): the left stick drives
  // the leader like WASD, the right stick aims and fires him.
  private touchMove: { x: number; y: number } | null = null;
  private touchAimVec: { x: number; y: number } | null = null;
  private touchAimTarget = false;
  private autoAbilityT = 0;
  // Battle replay: one snapshot every 0.5s, kept in memory only, so
  // the debrief screen can play the battle back after it ends.
  private replayFrames: ReplayFrame[] = [];
  private replayT = 0;
  private battleState: "active" | "victory" | "defeat" = "active";
  private shake = 0;

  private selected: number[] = [];
  // Fireteams for flanking: splitSquad() divides the living player
  // squad into Alpha (first half) and Bravo (rest). They are just
  // id lists — orders still go to whatever is selected, so Alpha can
  // go left while Bravo goes right. Dead men drop out of the lists
  // when they are read, never by editing the lists mid-battle.
  private teamA: number[] = [];
  private teamB: number[] = [];
  // Full-map view: when on, resize() zooms out to fit the whole
  // 3200x1350 map in the canvas instead of the normal 1600x900
  // camera window, so no scrolling is needed to see it all.
  private fitWholeMap = false;
  private aimUnitId: number | null = null;
  private mouse = { x: 0, y: 0, inside: false };
  private marquee: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private dragging = false;

  private fallen: FallenReport[] = [];
  /** Men who broke and ran off the field. Deleted from the roster on
   * filing, like the fallen — but never etched on the Memorial. */
  private deserted: FallenReport[] = [];
  private log: LogLine[] = [];
  private hudT = 0;
  private dirty = false;

  constructor(canvas: HTMLCanvasElement, onHud: (h: HudSnapshot) => void) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.onHud = onHud;
    void document.fonts?.load(PIXEL_FONT).catch(() => {});
    const st = loadSettings();
    this.speed = st.speed;
    this.shakeK = SHAKE_FACTOR[st.shake];
    setSfxVolume(st.volume);
    setSfxMuted(st.muted);
  }

  /** Supply crates are rare: a coin flip decides whether this
   * battle has one at all, and never more than one. When the flip
   * lands, the crate goes on a random open spot from the fixed
   * candidates, so it can sit anywhere in the mid-field. A candidate
   * inside a building, a wall or a trench line is never picked, so
   * every terrain kind gets a reachable crate when one spawns. */
  private placeCrates() {
    if (Math.random() >= this.crateChance) {
      this.crates = [];
      return;
    }
    const spots: Array<[number, number]> = [
      [1300, 450], [1300, 900], [1600, 675],
      [2000, 450], [2000, 900], [2300, 675], [2600, 450], [2600, 900],
      [3400, 450], [3400, 900], [3700, 675],
    ];
    const open = (x: number, y: number) => {
      const cx = Math.floor(x / CELL);
      const cy = Math.floor(y / CELL);
      return cx >= 0 && cy >= 0 && cx < COLS && cy < ROWS && !this.blocked[cy * COLS + cx];
    };
    const openSpots = spots.filter(([x, y]) => open(x, y));
    if (openSpots.length === 0) {
      this.crates = [];
      return;
    }
    // Random open spot, not always the first one, so the crate is not
    // in the same place every battle that has one. Never more than
    // one crate in a battle.
    const spot = openSpots[Math.floor(Math.random() * openSpots.length)];
    this.crates = [{ x: spot[0], y: spot[1], looted: false }];
  }

  // ---------------- lifecycle ----------------

  setup(mission: Mission, squad: SquadInput[], commanderBonus = 0, variant: Variant = "", commanderLevel = 1, leaderSoldierId = "") {
    this.variant = variant;
    this.mission = mission;
    this.units = [];
    this.bullets = [];
    this.projectiles = [];
    this.particles = [];
    this.fallen = [];
    this.deserted = [];
    this.crates = [];
    this.lootRp = 0;
    this.corpses = [];
    this.wrecks = [];
    this.retreating = false;
    this.flankersAt = 0;
    this.flankersSpawned = false;
    this.halftrackDropped = false;
    this.log = [];
    this.selected = [];
    this.teamA = [];
    this.teamB = [];
    this.fitWholeMap = false;
    this.aimUnitId = null;
    this.elapsed = 0;
    this.stalemateT = 0;
    this.stalemateHp = -1;
    this.stalemateAlive = -1;
    this.stalemateActive = false;
    this.phase = "briefing";
    this.paused = false;
    this.battleState = "active";
    this.waveIndex = 0;
    this.nextWaveT = 0;
    this.enemyRadioT = 0;
    this.enemyRadioCalled = false;
    this.counterAttackT = 45 + Math.random() * 45;
    this.counterAttacks = 0;
    this.artyCd = 0;
    this.supplyCd = 0;
    this.reconCd = 0;
    this.mortarCd = 0;
    this.smokeCd = 0;
    this.tankCalled = false;
    this.smokeZones = [];
    this.commanderLevel = commanderLevel;
    this.reinforcements = 0;
    this.touchBox = false;

    // Group enemy specs into waves.
    const byWave = new Map<number, Array<{ type: EnemyTypeId; count: number }>>();
    for (const e of mission.enemies) {
      const list = byWave.get(e.wave) ?? [];
      list.push({ type: e.type, count: e.count });
      byWave.set(e.wave, list);
    }
    this.waves = [...byWave.keys()].sort((a, b) => a - b).map((k) => byWave.get(k)!);

    const rng = mulberry32(hashStr(mission.id));
    const kind = mission.terrain === "dday" ? (variant === "airborne" ? "airborne" : "beach") : mission.terrain;
    const built = buildTerrain(kind, rng);
    // Paint smooth, then crush to a palette-reduced pixel canvas (1 px = PX world units).
    this.terrain = pixelize(built.canvas, PX);
    this.blockers = built.blockers;
    this.blocked = buildBlockedGrid(built.blockers);
    this.covers = built.covers;
    this.hedgehogs = built.blockers.filter((b) => b.kind === "hedgehog");
    this.foliage = built.blockers.filter((b) => b.kind === "tree" || b.kind === "bush");
    // Beach mines (Josh's suggestion, 2026-11-12): Tellermines in
    // the sand among the hedgehogs. The landing force triggers
    // them; the defenders know their own lanes and do not. The
    // beach trail stays clear — the tank follows it.
    this.mines = [];
    if (kind === "beach") {
      for (let i = 0; i < 60 && this.mines.length < 24; i++) {
        const mx = 320 + rng() * 460;
        const my = 60 + rng() * (MAP_H - 120);
        if (Math.abs(my - roadYAt(mx)) < 46) continue;
        if (this.hedgehogs.some((h) => dist(mx, my, h.x, h.y) < 34)) continue;
        if (this.mines.some((m) => dist(mx, my, m.x, m.y) < 52)) continue;
        this.mines.push({ x: mx, y: my, armed: true });
      }
    } else if (kind === "airborne") {
      // Mines for the airborne fields too (Josh: both missions,
      // 2026-11-12): anti-landing mines sown in the fields around
      // the drop zone, x 480-1560, that the paratroopers cross to
      // reach their ambush positions. The road stays clear, so
      // the convoy still rolls, and the convoy and its escort
      // never trigger them — same rule as the beach.
      for (let i = 0; i < 60 && this.mines.length < 18; i++) {
        const mx = 480 + rng() * 1080;
        const my = 60 + rng() * (MAP_H - 120);
        if (Math.abs(my - roadYAt(mx)) < 46) continue;
        if (this.mines.some((m) => dist(mx, my, m.x, m.y) < 52)) continue;
        this.mines.push({ x: mx, y: my, armed: true });
      }
    }
    this.placeCrates();
    this.tctx = this.terrain.getContext("2d");
    this.tctx?.setTransform(1 / PX, 0, 0, 1 / PX, 0, 0);

    this.fog = document.createElement("canvas");
    this.fog.width = COLS;
    this.fog.height = ROWS;
    this.fogCtx = this.fog.getContext("2d");
    this.visible = new Uint8Array(COLS * ROWS);
    this.explored = new Uint8Array(COLS * ROWS);

    this.replayFrames = [];
    this.replayT = 0;
    this.autoBattle = false;
    this.convoyContact = false;
    this.spawnAllies(squad, rng, commanderBonus);
    // Team leader: the briefing pick when given, else the most
    // experienced man deployed. Selection locks onto him.
    this.squadOrder = "formup";
    this.manualShot = null;
    const roster = this.units.filter((u) => u.side === "allies" && !u.npc && u.soldierId);
    const picked = leaderSoldierId ? roster.find((u) => u.soldierId === leaderSoldierId) : undefined;
    const lead = picked ?? this.mostExperienced(roster);
    this.leaderId = lead ? lead.id : null;
    this.selected = lead ? [lead.id] : [];
    // 2nd Platoon: weak allies, so they support the fight but can
    // never clear a wave on their own — in the Emergent play test
    // Wave 1 was cleared entirely by them while the player's squad stood
    // idle and fired nothing. The real count was 2 + min(3, mission.index),
    // i.e. 2-5; Josh picked 12 on 2026-11-11, and on 2026-11-12 he
    // raised the Overlord beach landing to 32: a full landing force
    // to match the hardened beach defense (9 MG42s and 3 mortars in
    // wave 1 alone). The other missions stay at 12. Still weak,
    // spread down the western edge so they do not spawn stacked on
    // each other. The airborne drop fields the same 32 (Josh,
    // 2026-11-12: same number as the beach) — with 12 and the old
    // drop zone AUTO went 0 for 6, wiped in under 71 seconds.
    const npcAllies = mission.terrain === "dday" ? 32 : 12;
    this.spawnNpcAllies(npcAllies, rng);
    this.spawnWave(0);
    // Intro sequences: built here, run by update() after begin().
    this.boats = [];
    this.introKind = null;
    this.introT = -1;
    if (kind === "beach") {
      // The landing: the squad rides its own boat, the 32 NPCs
      // ride in sticks of 8 — 5 boats, spread down the coast by
      // where their men were headed, never one clump. Landing
      // spots sit on the sand just east of the waterline (268-
      // 292), west of the mine band (which now starts at 320).
      const alliesNow = this.units.filter((u) => u.side === "allies");
      const groups: Unit[][] = [alliesNow.filter((u) => !u.npc)];
      const npcList = alliesNow.filter((u) => u.npc);
      for (let i = 0; i < npcList.length; i += 8) groups.push(npcList.slice(i, i + 8));
      this.boats = groups
        .filter((g) => g.length > 0)
        .map((men) => {
          const y = men.reduce((s, u) => s + u.y, 0) / men.length;
          men.forEach((u, idx) => {
            u.embarked = true;
            u.landX = 268 + rng() * 24;
            // Spread wide along the shore: a stick strung over
            // ~240 of beach, not a knot at the ramp — a knot is
            // a mortar target and walks into one MG lane.
            u.landY = Math.max(40, Math.min(MAP_H - 40, y + (idx - (men.length - 1) / 2) * 34 + (rng() - 0.5) * 36));
          });
          return { x: 26, y, men, out: 0, timer: 0, releaseT: 0, wakeT: 0 };
        });
      this.introKind = "boats";
    } else if (kind === "airborne") {
      // The drop: the C-47 crosses west to east at 314/s; a man
      // exits as it passes his x and hangs under canopy for
      // about 1.3s. His spawn position is his landing spot.
      this.dropEnd = 0;
      for (const u of this.units) {
        if (u.side !== "allies") continue;
        u.dropStart = (u.x + 80) / 314;
        u.dropDur = 1.25 + rng() * 0.3;
        this.dropEnd = Math.max(this.dropEnd, u.dropStart + u.dropDur);
      }
      this.introKind = "drop";
    }
    this.recomputeFog();
    this.resize();
    this.dirty = true;
    const allies = this.units.filter((u) => u.side === "allies");
    if (allies.length) this.centerOn(allies.reduce((t, u) => t + u.x, 0) / allies.length, allies.reduce((t, u) => t + u.y, 0) / allies.length);
    this.pushLog(`${mission.code} — assets in position. Awaiting your order.`, "info");
    this.recordReplayFrame();
  }

  begin() {
    if (this.phase !== "briefing") return;
    this.phase = "battle";
    if (this.introKind) this.introT = 0;
    this.dirty = true;
    this.pushLog("Contact! Weapons free — good hunting.", "info");
    if (this.radioLive()) {
      this.pushLog("Radioman on the net — reinforcements available.", "info");
    } else {
      this.pushLog("No radioman — radio support is down. Hire one in the Barracks.", "info");
    }
  }

  attach() {
    this.running = true;
    this.last = performance.now();
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKeyUp);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKeyUp);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    if (this.fitWholeMap) {
      const s = Math.min(rect.width / MAP_W, rect.height / MAP_H);
      this.canvas.width = Math.max(1, Math.round(rect.width / (PX * s)));
      this.canvas.height = Math.max(1, Math.round(rect.height / (PX * s)));
      this.viewW = MAP_W;
      this.viewH = MAP_H;
      this.view = { s, ox: 0, oy: 0 };
      this.cam.x = 0;
      this.cam.y = 0;
      return;
    }
    const s = Math.max(MIN_SCALE, Math.min(rect.width / VIEW_W, rect.height / VIEW_H));
    // Low-res backing store, upscaled with `image-rendering: pixelated`: true chunky pixels.
    this.canvas.width = Math.max(1, Math.round(rect.width / (PX * s)));
    this.canvas.height = Math.max(1, Math.round(rect.height / (PX * s)));
    this.viewW = Math.min(MAP_W, rect.width / s);
    this.viewH = Math.min(MAP_H, rect.height / s);
    this.view = {
      s,
      ox: (rect.width - this.viewW * s) / 2,
      oy: (rect.height - this.viewH * s) / 2,
    };
    this.clampCam();
  }

  private clampCam() {
    this.cam.x = Math.max(0, Math.min(MAP_W - this.viewW, this.cam.x));
    this.cam.y = Math.max(0, Math.min(MAP_H - this.viewH, this.cam.y));
  }

  /** The battle camera's lock target (Josh, 2026-11-12): the
   * team leader. During an intro the lock sits on his landing
   * spot (his boat grounds there, his parachute comes down
   * there). When he is down or out, the middle of the men
   * still on the field. In a retreat the lock does not run at
   * all: the view is the fitted full map until the battle
   * files (see retreat()). Null only when there is nobody to
   * watch. */
  private cameraTarget(): { x: number; y: number } | null {
    const L = this.leaderUnit();
    if (this.introT >= 0 && L) return { x: L.landX ?? L.x, y: L.landY ?? L.y };
    if (L && L.alive && !L.extracted) return { x: L.x, y: L.y };
    const men = this.units.filter((u) => u.side === "allies" && !u.npc && u.alive);
    if (men.length) {
      return {
        x: men.reduce((s, u) => s + u.x, 0) / men.length,
        y: men.reduce((s, u) => s + u.y, 0) / men.length,
      };
    }
    return L ? { x: L.x, y: L.y } : null;
  }

  /** Hard lock (Josh, 2026-11-12): the battle view re-centers
   * on the lock target every tick, exactly, with no clamp at
   * the map edges — centered at all times is the rule, so
   * near an edge the view shows past the battlefield rather
   * than let the leader drift off-center. One frame snap, no
   * follow lag. Full map is the only exception, and update()
   * only lets it live while the battle is paused. */
  private lockCamera() {
    if (this.phase !== "battle" || this.fitWholeMap) return;
    const t = this.cameraTarget();
    if (!t) return;
    this.cam.x = t.x - this.viewW / 2;
    this.cam.y = t.y - this.viewH / 2;
  }

  centerOn(x: number, y: number) {
    this.cam.x = x - this.viewW / 2;
    this.cam.y = y - this.viewH / 2;
    this.clampCam();
  }

  private recordReplayFrame() {
    this.replayFrames.push({
      t: Math.round(this.elapsed * 10) / 10,
      phase: this.phase,
      battleState: this.battleState,
      wave: this.waveIndex + 1,
      crates: this.crates.map((c) => ({ x: c.x, y: c.y, looted: c.looted })),
      units: this.units.map((u) => ({
        id: u.id,
        side: u.side,
        npc: u.npc,
        type: u.type,
        enemyType: u.enemyType,
        name: u.name,
        x: Math.round(u.x),
        y: Math.round(u.y),
        hp: Math.round(u.hp),
        maxHp: u.maxHp,
        alive: u.alive,
        kills: u.kills,
        cover: !!u.cover,
        coverType: u.cover ? (u.cover.type ?? "light") : null,
        coverKind: u.cover?.kind === "trench" ? "trench" : null,
        morale: Math.round(u.morale),
        broken: u.broken,
        medic: this.isMedic(u),
        radio: this.isRadioman(u),
        fled: !!u.fled,
      })),
    });
  }

  /** The battle just played, as a replay: one frame every 0.5s. */
  getReplay(): BattleReplay | null {
    if (!this.mission) return null;
    const last = this.replayFrames[this.replayFrames.length - 1];
    if (!last || last.t < Math.round(this.elapsed * 10) / 10) this.recordReplayFrame();
    return {
      mission: this.mission.code,
      mapW: MAP_W,
      mapH: MAP_H,
      durationSec: Math.round(this.elapsed),
      result: this.battleState,
      obstacles: this.blockers.map((b) => ({ x: b.x, y: b.y, r: b.r, kind: b.kind ?? "obstacle" })),
      frames: this.replayFrames,
    };
  }

  getReport(): BattleReport | null {
    if (!this.mission) return null;
    return {
      missionId: this.mission.id,
      victory: this.battleState === "victory",
      durationSec: Math.round(this.elapsed),
      fallen: this.fallen,
      deserted: this.deserted,
      lootRp: this.lootRp,
      survivors: this.units
        .filter((u) => u.side === "allies" && u.alive && u.soldierId)
        .map((u) => ({
          soldierId: u.soldierId!,
          kills: u.kills,
          damageTaken: Math.round(u.damageTaken),
          healed: Math.round(u.healed),
          heavyKills: u.heavyKills,
          officerKills: u.officerKills,
        })),
    };
  }

  // ---------------- public controls ----------------

  togglePause() {
    if (this.phase !== "battle") return;
    this.paused = !this.paused;
    this.dirty = true;
  }

  setPaused(p: boolean) {
    if (this.phase !== "battle" || this.paused === p) return;
    this.paused = p;
    this.dirty = true;
  }

  /** Auto Battle: on, the squad fights on its own; off, you have it back. */
  setAutoBattle(on: boolean) {
    if (this.phase !== "battle" || this.autoBattle === on) return;
    this.autoBattle = on;
    this.autoAbilityT = 0;
    if (on) {
      // Hand the men over clean: drop any manual orders and selection,
      // so no stale move / attack order fights the auto AI.
      for (const u of this.units) {
        if (u.side === "allies" && !u.npc) {
          u.orders = [];
          u.chase = [];
          u.attackId = null;
        }
      }
      this.selected = [];
      this.aimUnitId = null;
      this.pushLog("AUTO BATTLE — the squad fights on its own. Tap AUTO to take command.", "info");
    } else {
      this.pushLog("Manual command — you have the squad.", "info");
    }
    this.dirty = true;
  }

  toggleAutoBattle() {
    this.setAutoBattle(!this.autoBattle);
  }

  isAutoBattle() {
    return this.autoBattle;
  }

  /** Rank seniority on the backend ladder: higher is more senior. */
  private rankSeniority(u: Unit): number {
    const ladder = ["Pvt.", "Pfc.", "Cpl.", "Sgt.", "S/Sgt.", "T/Sgt.", "1st Sgt."];
    const i = ladder.indexOf(u.rank);
    return i >= 0 ? i : 0;
  }

  /** Experience order (Josh's succession rule): rank first, then
   * level, then kills, roster order as the final tiebreak. */
  mostExperienced(men: Unit[]): Unit | null {
    let best: Unit | null = null;
    for (const u of men) {
      if (!best) { best = u; continue; }
      const ra = this.rankSeniority(u), rb = this.rankSeniority(best);
      if (ra !== rb) { if (ra > rb) best = u; continue; }
      if (u.level !== best.level) { if (u.level > best.level) best = u; continue; }
      if (u.kills !== best.kills) { if (u.kills > best.kills) best = u; continue; }
    }
    return best;
  }

  leaderUnit(): Unit | null {
    if (this.leaderId === null) return null;
    const u = this.unitById(this.leaderId);
    return u && u.alive ? u : null;
  }

  /** A deployed squad man who follows the leader: roster man,
   * alive, not the leader himself, not a vehicle. */
  isFollower(u: Unit): boolean {
    return u.side === "allies" && !u.npc && !u.vehicle && u.soldierId !== null && u.id !== this.leaderId;
  }

  /** Briefing pick: name the team leader before the assault.
   * Battle-phase changes are not allowed; succession handles
   * a leader falling. */
  setLeaderPick(soldierId: string) {
    if (this.phase !== "briefing") return;
    const u = this.units.find((m) => m.side === "allies" && !m.npc && m.soldierId === soldierId);
    if (!u) return;
    this.leaderId = u.id;
    this.selected = [u.id];
    this.dirty = true;
  }

  /** Camera to a unit (SquadDock card click). */
  focusUnit(id: number) {
    // In battle this no longer moves the camera: the view is
    // hard locked to the team leader (Josh, 2026-11-12), and a
    // squad dock click must not break the lock. Outside battle
    // it centers as before.
    if (this.phase === "battle") return;
    const u = this.unitById(id);
    if (u) this.centerOn(u.x, u.y);
  }

  setSquadOrder(o: SquadOrder) {
    if (this.phase !== "battle" || this.retreating || this.squadOrder === o) return;
    this.squadOrder = o;
    for (const u of this.units) if (this.isFollower(u)) u.chase = [];
    this.pushLog(o === "attack" ? "Squad order: ATTACK." : o === "defend" ? "Squad order: DEFEND." : "Squad order: FORM UP.", "info");
    this.dirty = true;
  }

  getSquadOrder(): SquadOrder {
    return this.squadOrder;
  }

  /** Left click in battle: the leader fires. On an enemy, that
   * enemy becomes his target until it dies; on open ground he
   * fires at the point for a short window. Range and LOS come
   * from the normal fire rules: he never chases a click. */
  leaderShootAt(x: number, y: number) {
    if (this.phase !== "battle" || this.autoBattle || this.retreating) return;
    const L = this.leaderUnit();
    if (!L || L.broken) return;
    let foe: Unit | null = null;
    let bestD = 30;
    for (const u of this.units) {
      if (u.side !== "axis" || !u.alive) continue;
      const d = dist(x, y, u.x, u.y);
      if (d < bestD) { foe = u; bestD = d; }
    }
    if (foe) {
      L.attackId = foe.id;
      this.manualShot = null;
    } else {
      L.attackId = null;
      this.manualShot = { x, y, until: this.elapsed + 1.5 };
    }
    this.dirty = true;
  }

  /** Right click in battle: the leader uses his class ability,
   * aimed abilities landing at the clicked point, exactly like
   * pressing Q and clicking there in one motion. */
  leaderAbilityAt(x: number, y: number) {
    if (this.phase !== "battle" || this.retreating) return;
    const L = this.leaderUnit();
    if (!L) return;
    this.startAim(L.id);
    if (this.aimUnitId === L.id) {
      this.aimUnitId = null;
      this.castGround(L, x, y);
      this.dirty = true;
    }
  }

  /** Where a follower belongs: his formation slot around the
   * leader, slots handed out in roster order. */
  private followerSlot(u: Unit, leader: Unit): { x: number; y: number } {
    const followers = this.units.filter((m) => this.isFollower(m) && m.alive);
    const idx = Math.max(0, followers.findIndex((m) => m.id === u.id));
    const off = this.formationSlot(idx, Math.max(1, followers.length), leader.facing);
    return {
      x: Math.max(12, Math.min(MAP_W - 12, leader.x + off.x)),
      y: Math.max(12, Math.min(MAP_H - 12, leader.y + off.y)),
    };
  }

  /** Follower anchoring inside the AI branch. Returns true or
   * false when the anchor decides this tick (move to the slot,
   * or hold at it), or null to run the normal prey logic. A
   * medic chasing a wounded man of his own side is never
   * anchored away from the healing. */
  private followerMove(u: Unit, prey: Unit | null, dt: number): boolean | null {
    // The stalemate hunt is a squad-wide advance by design: the
    // anchor stands down while it runs, or it would recreate
    // the soft-lock the breaker exists to break.
    if (this.stalemateActive) return null;
    const leader = this.leaderUnit();
    if (!leader || leader.id === u.id) return null;
    // A medic may leave his post for a wounded man of the
    // squad — but only near the leader. Chasing wounded men
    // across the map strands him from the men he covers.
    if (this.isMedic(u) && prey && prey.side === u.side && dist(prey.x, prey.y, leader.x, leader.y) <= 160) return null;
    const slot = this.followerSlot(u, leader);
    const dSlot = dist(u.x, u.y, slot.x, slot.y);
    const dLeader = dist(u.x, u.y, leader.x, leader.y);
    if (this.squadOrder === "formup") {
      if (dSlot > 30) return this.chaseTo(u, slot.x, slot.y, dt);
      u.chase = [];
      return false;
    }
    if (this.squadOrder === "defend") {
      const preyClose = prey
        ? prey.side === u.side || dist(prey.x, prey.y, leader.x, leader.y) <= 180
        : false;
      if (preyClose) return null;
      if (dSlot > 40) return this.chaseTo(u, slot.x, slot.y, dt);
      u.chase = [];
      return false;
    }
    // attack: free to engage, but leashed to the leader
    if (dLeader > 260) return this.chaseTo(u, slot.x, slot.y, dt);
    return null;
  }

  /** Any manual order takes command back from Auto Battle instantly. */
  private takeManualControl() {
    if (!this.autoBattle) return;
    this.autoBattle = false;
    this.pushLog("Manual command — you have the squad.", "info");
    this.dirty = true;
  }

  selectAll() {
    this.takeManualControl();
    this.selected = this.units.filter((u) => u.side === "allies" && u.alive && !u.npc).map((u) => u.id);
    this.dirty = true;
  }

  /** Split the living player squad into two fireteams for flanking:
   * Alpha gets the first half, Bravo the rest. Alpha is selected
   * right away so it can be ordered first. A 1-man squad cannot
   * split. Splitting again re-splits the current living squad. */
  splitSquad() {
    const squad = this.units.filter((u) => u.side === "allies" && u.alive && !u.npc);
    if (squad.length < 2) return;
    const half = Math.ceil(squad.length / 2);
    this.teamA = squad.slice(0, half).map((u) => u.id);
    this.teamB = squad.slice(half).map((u) => u.id);
    this.selectTeam(0);
    this.pushLog(`Squad split — Alpha (${this.teamA.length}) and Bravo (${this.teamB.length}). Order each team on its own.`, "info");
  }

  /** Living ids of one fireteam, in squad order. */
  private teamIds(i: 0 | 1): number[] {
    const ids = i === 0 ? this.teamA : this.teamB;
    return ids.filter((id) => {
      const u = this.unitById(id);
      return u?.alive && u.side === "allies" && !u.npc;
    });
  }

  /** Select one fireteam (0 = Alpha, 1 = Bravo). No-op when not split. */
  selectTeam(i: 0 | 1) {
    const ids = this.teamIds(i);
    if (!ids.length) return;
    this.takeManualControl();
    this.selected = ids;
    this.aimUnitId = null;
    this.dirty = true;
  }

  /** Merge the fireteams back into one squad and select everyone. */
  mergeSquads() {
    if (!this.teamA.length && !this.teamB.length) return;
    this.teamA = [];
    this.teamB = [];
    this.selectAll();
    this.pushLog("Squads merged — one squad again.", "info");
  }

  /** Full-map view on/off: zoom out to the whole map, or back to the
   * normal camera window. Re-runs resize so it takes effect at once.
   * While a retreat runs, the full map is the retreat's view (Josh,
   * 2026-11-12) and cannot be switched off until the battle files. */
  setFitMap(on: boolean) {
    if (!on && this.retreating) return;
    if (this.fitWholeMap === on) return;
    this.fitWholeMap = on;
    this.resize();
    this.dirty = true;
  }

  isFitMap() {
    return this.fitWholeMap;
  }

  /** Retreat is a break and run now, not an instant filing
   * and not a controlled withdrawal (Josh, 2026-11-12).
   * Pressing it ends player control outright: WASD, clicks,
   * squad orders, abilities, the touch sticks, radio support
   * and reinforcements all go dead, and every living roster
   * man, leader included, runs for the west edge on his own
   * while the battle keeps running — the enemy keeps
   * shooting, men can be hit, pinned, or break on the way
   * out. A man who reaches the west edge extracts
   * (extract()); when every roster man is out, dead, or
   * deserted, the battle files as a defeat through the usual
   * path, so kills already made still pay their kill RP and
   * the mission does not advance. The 2nd Platoon is not
   * ordered back: they hold where they stand and cover it.
   * The Sherman has no driver either: it rolls west down
   * the road on its own and never halts to trade fire. */
  retreat() {
    if (this.phase !== "battle" || this.battleState !== "active" || this.retreating) return;
    this.retreating = true;
    // The retreat is watched whole (Josh, 2026-11-12): the view
    // pulls out to the fitted full map the moment the retreat
    // starts and stays there, live, until the battle files —
    // the squad running west, the platoon covering, the
    // flankers coming in — superseding the retreat camera lock
    // (last leader, then the runners' middle) that shipped with
    // the camera hard lock. It is NOT the Esc menu's paused
    // full-map look: update() lets this fit live while the
    // battle runs, and setFitMap refuses to drop it mid-retreat.
    this.setFitMap(true);
    // The enemy does not watch a retreat leave: a few seconds
    // in, flanking groups come in off the north and south edges
    // to cut the withdrawal off (Josh, 2026-11-12).
    this.flankersAt = this.elapsed + 6;
    if (this.autoBattle) this.setAutoBattle(false);
    // Player control ends here (Josh, 2026-11-12): every input
    // path checks retreating and goes dead, and any shot or aim
    // in flight is cancelled. The squad runs on its own now.
    this.manualShot = null;
    this.touchMove = null;
    this.touchAimVec = null;
    this.touchAimTarget = false;
    this.aimUnitId = null;
    for (const u of this.units) {
      if (u.side !== "allies" || u.npc || !u.alive) continue;
      u.attackId = null;
      u.chase = [];
      u.orders = findPath(this.blocked, u.x, u.y, 24, Math.max(60, Math.min(MAP_H - 60, u.y)));
    }
    this.pushLog("Fall back! Every man to the west edge — the mission is scrubbed once the squad is out.", "lose");
    this.pushLog("Control is gone: the squad is falling back on its own.", "info");
    this.dirty = true;
  }

  /** A man who made it to the west edge during a fall back is
   * out: off the field, alive on the roster, no corpse and no
   * casualty filing. */
  private extract(u: Unit) {
    u.extracted = true;
    u.alive = false;
    u.orders = [];
    u.chase = [];
    this.selected = this.selected.filter((id) => id !== u.id);
    this.pushLog(`${u.name} made it out.`, "info");
    this.dirty = true;
  }

  startAim(unitId: number) {
    if (this.phase !== "battle" || this.retreating) return;
    this.takeManualControl();
    const u = this.unitById(unitId);
    if (!u || !u.alive || u.abilityCd > 0 || u.broken) return;
    const spec = UNIT_TYPES[u.type].ability;
    if (spec.aim === "auto") {
      this.castAuto(u);
      return;
    }
    this.aimUnitId = unitId;
    this.dirty = true;
  }

  cancelAim() {
    this.aimUnitId = null;
    this.dirty = true;
  }

  /** NPC squad makeup (Josh, 2026-11-12): squads of 8 built from
   * the same classes the player hires. Slot 0 is the leader, a
   * rifleman; medic and MG are always aboard; the support slot
   * rotates sniper, AT, recon, engineer by squad number, so a
   * 32-man landing fields one of each. A radioman rides in a full
   * squad too (he is the platoon's own set; he does NOT open the
   * player's radio, radioLive counts only the player's men).
   * Small squads keep leader, medic and MG in the first slots. */
  private npcSquadTypes(squadIdx: number, size: number): UnitTypeId[] {
    const support: UnitTypeId[] = ["sniper", "at", "recon", "engineer"];
    if (size >= 8) {
      return ["rifleman", "rifleman", "rifleman", "medic", "mg", support[squadIdx % 4], "radioman", "rifleman"];
    }
    const small: UnitTypeId[] = ["rifleman", "rifleman", "medic", "mg", "rifleman", support[squadIdx % 4], "radioman"];
    return small.slice(0, size);
  }

  private spawnNpcAllies(n: number, rng: () => number) {
    // 2nd Platoon deploys in squads (Josh, 2026-11-12): chunks of
    // 8, each with its own leader and anchor point, spread down
    // the western edge (or across the drop zone when airborne) so
    // a squad lands together and forms up together. Men keep the
    // weak 2nd Platoon scaling (see addNpc): they support the
    // fight instead of winning it alone.
    const squadCount = Math.max(1, Math.ceil(n / 8));
    let placedCount = 0;
    for (let s = 0; s < squadCount && placedCount < n; s++) {
      const size = Math.min(8, n - placedCount);
      const types = this.npcSquadTypes(s, size);
      const anchorY = squadCount === 1 ? MAP_H / 2 : 170 + (s * (MAP_H - 340)) / (squadCount - 1);
      for (let j = 0; j < size; j++) {
        if (this.variant === "airborne") {
          this.addNpc(types[j], 160 + s * 110 + rng() * 70, anchorY + (rng() * 130 - 65), j, rng(), true, s, j === 0);
        } else {
          this.addNpc(types[j], 90 + rng() * 80, anchorY + (j - (size - 1) / 2) * 36 + rng() * 14, j, rng(), true, s, j === 0);
        }
        placedCount++;
      }
    }
  }

  /** The living leader of an NPC squad: the most senior man left,
   * by rank, then kills, then level (the player's succession
   * order, with kills ahead of level for men whose rank field is
   * a name prefix). Keeps the npcLeader flags fresh as a side
   * effect. Null when the squad is wiped out. */
  npcSquadLeaderOf(squadIdx: number): Unit | null {
    const members = this.units.filter((u) => u.npc && u.alive && u.npcSquad === squadIdx);
    if (!members.length) return null;
    const seniority = (u: Unit) => ["Pvt.", "Pfc.", "Cpl.", "Sgt.", "S/Sgt.", "T/Sgt.", "1st Sgt."].indexOf(u.rank);
    const leader = [...members].sort(
      (a, b) => seniority(b) - seniority(a) || b.kills - a.kills || b.level - a.level || a.id - b.id,
    )[0];
    for (const m of members) m.npcLeader = m.id === leader.id;
    return leader;
  }

  /** NPC follower anchoring: a 2nd Platoon man stays with his
   * squad leader the way a follower stays with the team leader.
   * Returns true/false when the anchor decides this tick, null to
   * run the normal prey logic. The leader himself runs the normal
   * logic: he is the one advancing the squad. */
  private npcAnchorMove(u: Unit, prey: Unit | null, dt: number): boolean | null {
    if (this.stalemateActive) return null;
    if (u.npcSquad === undefined) return null;
    const anchor = this.npcSquadLeaderOf(u.npcSquad);
    if (!anchor || anchor.id === u.id) return null;
    // A medic may leave his post for a wounded squadmate nearby,
    // same leash as the player's medic (near the anchor).
    if (this.isMedic(u) && prey && prey.side === u.side && dist(prey.x, prey.y, anchor.x, anchor.y) <= 160) return null;
    const mates = this.units.filter((m) => m.npc && m.alive && m.npcSquad === u.npcSquad && m.id !== anchor.id);
    const idx = Math.max(0, mates.findIndex((m) => m.id === u.id));
    const off = this.formationSlot(idx, Math.max(1, mates.length), anchor.facing);
    const slot = {
      x: Math.max(12, Math.min(MAP_W - 12, anchor.x + off.x)),
      y: Math.max(12, Math.min(MAP_H - 12, anchor.y + off.y)),
    };
    // An enemy hard on the squad: free to fight it, leashed.
    if (prey && prey.side !== u.side && dist(prey.x, prey.y, anchor.x, anchor.y) <= 200 && dist(u.x, u.y, anchor.x, anchor.y) <= 300) {
      return null;
    }
    if (dist(u.x, u.y, slot.x, slot.y) > 36) return this.chaseTo(u, slot.x, slot.y, dt);
    u.chase = [];
    return false;
  }

  /** The radioman's level (0-6): the highest level among the living
   * deployed radiomen. A rookie is 0, a veteran is 6. The backend uses
   * the same rule (highest-level active radioman), so the two agree
   * on the price. */
  radiomanLevel(): number {
    let best = 0;
    for (const u of this.units) {
      if (u.side === "allies" && u.alive && !u.npc && u.type === "radioman") {
        best = Math.max(best, u.level);
      }
    }
    return best;
  }

  /** What a radio support call costs right now, at the living
   * radioman's level. No radioman: the full base cost (the call is
   * gated off anyway, so this is only a display number). */
  supportCost(kind: RadioSupportKind): number {
    return radioCost(RADIO_SUPPORT_COST[kind], this.radiomanLevel());
  }

  /** What a reinforcement team costs right now, same discount. */
  reinforceCost(kind: "rifle" | "heavy"): number {
    return radioCost(kind === "rifle" ? 15 : 25, this.radiomanLevel());
  }

  /** Can this support call be fired right now (gates only, no RP
   * check, no firing)? The frontend checks this before charging RP,
   * so the backend is only called for a call that will land. */
  canSupport(kind: RadioSupportKind): boolean {
    if (this.phase !== "battle" || this.battleState !== "active") return false;
    if (this.retreating) return false; // break and run: nobody works the radio
    if (!this.radioLive()) return false;
    if (this.commanderLevel < RADIO_CALL_LEVEL[kind]) return false;
    if (kind === "artillery") return this.artyCd <= 0;
    if (kind === "supply") return this.supplyCd <= 0;
    if (kind === "recon") return this.reconCd <= 0;
    if (kind === "mortar") return this.mortarCd <= 0;
    if (kind === "smoke") return this.smokeCd <= 0;
    return !this.tankCalled;
  }

  /** Radio support lives or dies with the radioman: a living, deployed squad radioman. */
  radioLive(): boolean {
    return this.units.some((u) => u.side === "allies" && !u.npc && u.alive && u.type === "radioman");
  }

  /** Enemy radio: a living Funker on the field. When he dies, the enemy call-ins stop. */
  enemyRadioLive(): boolean {
    return this.units.some((u) => u.side === "axis" && u.alive && u.enemyType === "funk");
  }

  private isFunker(u: Unit): boolean {
    return u.side === "axis" && u.enemyType === "funk";
  }

  /** Either side's radio man: the squad radioman or the enemy Funker. */
  private isRadioman(u: Unit): boolean {
    return (u.side === "allies" && u.type === "radioman") || this.isFunker(u);
  }

  /** The Funker's call-in: 2 fresh Volkssturm from the east edge, once per wave. */
  private spawnEnemyCallIn() {
    const rng = Math.random;
    for (let i = 0; i < 2; i++) {
      this.spawnEnemyUnit("volks", MAP_W - 40 - rng() * 90, 90 + rng() * (MAP_H - 180), rng);
    }
    this.pushLog("Enemy radio: two more men coming through the trees!", "wave");
  }

  /** A random counter-attack: 2 men (a grenadier and a volks) charge in
   * from the east edge and head straight for the player's squad. They
   * are marked counterAttack, so the camp-and-defend rule does not hold
   * them back — they are the attack. */
  private spawnCounterAttack() {
    const rng = Math.random;
    const types: EnemyTypeId[] = ["grenadier", "volks"];
    for (const t of types) {
      const before = this.units.length;
      this.spawnEnemyUnit(t, MAP_W - 40 - rng() * 90, 90 + rng() * (MAP_H - 180), rng);
      const u = this.units[before];
      if (u) u.counterAttack = true;
    }
    this.pushLog("Enemy counter-attack — they are coming at us!", "wave");
  }

  /** The halftrack's troop bay (Josh, 2026-11-12): six men ride
   * in the back of the convoy halftrack — 4 volks and 2
   * grenadiers. The moment the convoy makes contact they pile
   * out both sides and deploy around it as its escort. They are
   * extra men the halftrack was carrying, on top of the 20 foot
   * in the column. If the halftrack dies on the march, they die
   * with it: no drop. */
  private unloadHalftrack() {
    if (this.halftrackDropped) return;
    const half = this.units.find((u) => u.alive && u.side === "axis" && u.enemyType === "halftrack");
    if (!half) return;
    this.halftrackDropped = true;
    const rng = Math.random;
    const types: EnemyTypeId[] = ["volks", "grenadier", "volks", "volks", "grenadier", "volks"];
    types.forEach((t, i) => {
      const sideOff = i % 2 === 0 ? -56 : 56;
      const backOff = (Math.floor(i / 2) - 1) * 36;
      const u = this.spawnEnemyUnit(t, half.x + backOff, half.y + sideOff, rng, false);
      u.convoy = true;
      u.homeX = u.x;
      u.homeY = u.y;
    });
    this.pushLog("The halftrack is unloading troops!", "wave");
    this.dirty = true;
  }

  /** Retreat flankers (Josh, 2026-11-12): when the squad falls
   * back, the enemy sends groups in off the north and south map
   * edges, level with the withdrawing squad, to cut it off.
   * Three men a flank (a grenadier between two volks), marked
   * like a counter-attack so no camp rule holds them: they come
   * straight at the squad. An ambush force on top of the wave
   * counts, not drawn from them. Once per retreat. */
  private spawnFlankers() {
    const rng = Math.random;
    const men = this.units.filter((u) => u.side === "allies" && !u.npc && u.alive);
    const cx = men.length
      ? Math.max(350, Math.min(MAP_W - 350, men.reduce((s, u) => s + u.x, 0) / men.length))
      : 400;
    const types: EnemyTypeId[] = ["volks", "grenadier", "volks"];
    for (const edgeY of [46, MAP_H - 46]) {
      types.forEach((t, i) => {
        const before = this.units.length;
        this.spawnEnemyUnit(t, cx + (i - 1) * 52 + (rng() * 30 - 15), edgeY, rng);
        const u = this.units[before];
        if (u) {
          u.counterAttack = true;
          u.aggressive = true;
        }
      });
    }
    this.pushLog("Enemy flankers — they are cutting off the retreat, north and south!", "wave");
    this.dirty = true;
  }

  /** The Funker's rally: nearby enemy men recover 15 morale over the
   * radio, on a 20s cooldown — the mirror of the squad radioman's
   * Rally Call. Only fires when somebody nearby actually needs it. */
  private funkerRally(u: Unit) {    if (u.abilityCd > 0 || u.broken) return;
    const low = this.units.filter(
      (a) => a.side === "axis" && a.alive && a.morale < 100 && dist(u.x, u.y, a.x, a.y) <= 150,
    );
    if (!low.length) return;
    for (const a of low) {
      if (a.broken && a.willFlee) a.morale = 65; // steadies a fleeing man
      else a.morale = Math.min(100, a.morale + 15);
    }
    u.abilityCd = 20;
    this.pushLog("Enemy radio: the Funker rallies his men.", "info");
  }

  /** Fresh allies for the next wave: 2 weak 2nd Platoon riflemen from the west edge. */
  private spawnWaveAllies(n: number) {
    const rng = Math.random;
    // Wave-clear men join a living NPC squad (Josh, 2026-11-12):
    // the smallest one, so squads fill back up instead of a new
    // pair wandering alone. When every squad is gone they form a
    // fresh one and the first man leads it.
    const living = new Map<number, number>();
    let maxSquad = -1;
    for (const u of this.units) {
      if (u.npcSquad === undefined) continue;
      maxSquad = Math.max(maxSquad, u.npcSquad);
      if (u.npc && u.alive) living.set(u.npcSquad, (living.get(u.npcSquad) ?? 0) + 1);
    }
    let squadIdx: number;
    if (living.size) {
      squadIdx = [...living.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0][0];
    } else {
      squadIdx = maxSquad + 1;
    }
    const fresh = living.size === 0;
    for (let i = 0; i < n; i++) {
      const py = 120 + (i * (MAP_H - 240)) / Math.max(1, n - 1) + rng() * 40;
      this.addNpc("rifleman", 90 + rng() * 80, py, this.nextId + i, rng(), true, squadIdx, fresh && i === 0);
    }
    this.pushLog(`2nd Platoon sends ${n} fresh men up the line.`, "info");
  }

  canReinforce(): boolean {
    return this.phase === "battle" && this.battleState === "active" && !this.retreating && this.reinforcements < MAX_REINFORCEMENTS && this.radioLive() && this.commanderLevel >= RADIO_CALL_LEVEL.reinforce;
  }

  /** The living squad radioman who makes the calls, or null. */
  private livingRadioman(): Unit | null {
    return this.units.find((u) => u.side === "allies" && !u.npc && u.alive && u.type === "radioman") ?? null;
  }

  /** Where the enemy is thickest: the living axis man with the most
   * living axis neighbours within 120. Null when nobody is left. */
  private densestEnemyCluster(): { x: number; y: number } | null {
    let best: Unit | null = null;
    let bestCount = 0;
    for (const u of this.units) {
      if (u.side !== "axis" || !u.alive) continue;
      let count = 0;
      for (const o of this.units) {
        if (o.side === "axis" && o.alive && dist(u.x, u.y, o.x, o.y) <= 120) count++;
      }
      if (count > bestCount) {
        bestCount = count;
        best = u;
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  /** Artillery barrage: 3 shells on the densest enemy cluster, 60s
   * cooldown. The shells fly like the enemy mortar's (2.4s flight,
   * staggered, red warning circle at the impact point) but they are
   * ours — side "allies", so they hurt the enemy, and kills credit
   * to the radioman, so they count for kill RP like any squad kill. */
  callArtillery(): boolean {
    if (this.phase !== "battle" || this.battleState !== "active") return false;
    if (!this.radioLive() || this.artyCd > 0 || this.commanderLevel < RADIO_CALL_LEVEL.artillery) return false;
    const target = this.densestEnemyCluster();
    const radio = this.livingRadioman();
    if (!target || !radio) return false;
    for (let i = 0; i < ARTY_SHELLS; i++) {
      this.projectiles.push({
        x: radio.x, y: radio.y, sx: radio.x, sy: radio.y,
        tx: target.x + (Math.random() - 0.5) * 80,
        ty: target.y + (Math.random() - 0.5) * 80,
        t: 0, dur: 2.4 + i * 0.8, side: "allies", dmg: ARTY_DMG, aoe: ARTY_AOE,
        kind: "grenade", sourceType: "mortar", killerId: radio.id, smokeT: 0,
      });
    }
    this.artyCd = ARTILLERY_CD;
    this.pushLog("Artillery on the way — danger close!", "wave");
    this.dirty = true;
    return true;
  }

  /** Supply drop: a field dressing for the worst-wounded squad man
   * (+50 HP, the medic's triage number), 45s cooldown. Spends nothing
   * when nobody is hurt. */
  callSupplyDrop(): boolean {
    if (this.phase !== "battle" || this.battleState !== "active") return false;
    if (!this.radioLive() || this.supplyCd > 0 || this.commanderLevel < RADIO_CALL_LEVEL.supply) return false;
    const radio = this.livingRadioman();
    if (!radio) return false;
    let best: Unit | null = null;
    let worst = 1;
    for (const a of this.units) {
      if (a.side !== "allies" || !a.alive || a.npc) continue;
      const pct = a.hp / a.maxHp;
      if (pct < 1 && pct < worst) {
        best = a;
        worst = pct;
      }
    }
    if (!best) {
      this.pushLog("Nobody needs supplies yet.", "info");
      return false;
    }
    const before = best.hp;
    best.hp = Math.min(best.maxHp, best.hp + SUPPLY_HEAL);
    radio.healed += best.hp - before;
    this.healFx(best.x, best.y);
    this.supplyCd = SUPPLY_CD;
    this.pushLog(`${radio.name} calls in a supply drop for ${best.name}.`, "info");
    this.dirty = true;
    return true;
  }

  /** Recon: a spotter flight marks the ground around the densest
   * enemy cluster as explored (300 radius), so the fog lifts there
   * and the player can see the enemy position, 30s cooldown. Explored
   * cells stay explored, so the reveal is permanent for that ground. */
  callRecon(): boolean {
    if (this.phase !== "battle" || this.battleState !== "active") return false;
    if (!this.radioLive() || this.reconCd > 0 || this.commanderLevel < RADIO_CALL_LEVEL.recon) return false;
    const target = this.densestEnemyCluster();
    if (!target) return false;
    const cr = Math.ceil(RECON_RADIUS / CELL);
    const cx = Math.floor(target.x / CELL);
    const cy = Math.floor(target.y / CELL);
    for (let gy = Math.max(0, cy - cr); gy <= Math.min(ROWS - 1, cy + cr); gy++) {
      for (let gx = Math.max(0, cx - cr); gx <= Math.min(COLS - 1, cx + cr); gx++) {
        const dx = (gx + 0.5) * CELL - target.x;
        const dy = (gy + 0.5) * CELL - target.y;
        if (dx * dx + dy * dy <= RECON_RADIUS * RECON_RADIUS) this.explored[gy * COLS + gx] = 1;
      }
    }
    this.reconCd = RECON_CD;
    this.pushLog("Recon flight reports the enemy position.", "info");
    this.dirty = true;
    return true;
  }

  /** Mortar strike: one shell on the densest enemy cluster, 25s
   * cooldown — the cheap, frequent strike next to the big artillery
   * barrage (3 shells, 60s). Same mortar shell, same warning circle,
   * kills credit to the radioman for kill RP. */
  callMortarStrike(): boolean {
    if (this.phase !== "battle" || this.battleState !== "active") return false;
    if (!this.radioLive() || this.mortarCd > 0 || this.commanderLevel < RADIO_CALL_LEVEL.mortar) return false;
    const target = this.densestEnemyCluster();
    const radio = this.livingRadioman();
    if (!target || !radio) return false;
    this.projectiles.push({
      x: radio.x, y: radio.y, sx: radio.x, sy: radio.y,
      tx: target.x + (Math.random() - 0.5) * 60,
      ty: target.y + (Math.random() - 0.5) * 60,
      t: 0, dur: 2.4, side: "allies", dmg: MORTAR_DMG, aoe: MORTAR_AOE,
      kind: "grenade", sourceType: "mortar", killerId: radio.id, smokeT: 0,
    });
    this.mortarCd = MORTAR_CD;
    this.pushLog("Mortar strike on the way!", "wave");
    this.dirty = true;
    return true;
  }

  /** Where the squad is: the average position of the living squad
   * men. The smoke screen drops here, covering the squad. */
  private squadCenter(): { x: number; y: number } | null {
    let x = 0;
    let y = 0;
    let n = 0;
    for (const u of this.units) {
      if (u.side !== "allies" || !u.alive || u.npc) continue;
      x += u.x;
      y += u.y;
      n++;
    }
    return n ? { x: x / n, y: y / n } : null;
  }

  /** True while the point sits inside a live smoke zone. */
  private inSmoke(x: number, y: number): boolean {
    for (const z of this.smokeZones) {
      if (dist(x, y, z.x, z.y) <= z.r) return true;
    }
    return false;
  }

  /** Smoke screen: a smoke cloud over the squad (150 radius, 20s),
   * 45s cooldown. Smoke blocks line of sight — the enemy cannot
   * shoot men inside it, and men inside it cannot shoot out — so it
   * is for moving and falling back, not for fighting from. */
  callSmokeScreen(): boolean {
    if (this.phase !== "battle" || this.battleState !== "active") return false;
    if (!this.radioLive() || this.smokeCd > 0 || this.commanderLevel < RADIO_CALL_LEVEL.smoke) return false;
    const center = this.squadCenter();
    if (!center) return false;
    this.smokeZones.push({ x: center.x, y: center.y, r: SMOKE_RADIUS, t: SMOKE_DURATION });
    this.smokeCd = SMOKE_CD;
    this.pushLog("Smoke screen up — move!", "info");
    this.dirty = true;
    return true;
  }

  /** Tank support: an M4 Sherman rolls in from the west edge, once
   * per battle. It is a vehicle (no morale, it never breaks), it
   * fights like a 2nd Platoon man with a 75mm gun, and it is not a
   * soldier — if it is destroyed it leaves no casualty and no
   * Memorial entry. */
  callTank(): boolean {
    if (this.phase !== "battle" || this.battleState !== "active") return false;
    if (!this.radioLive() || this.tankCalled || this.commanderLevel < RADIO_CALL_LEVEL.tank) return false;
    this.addNpc("tank", 90, roadYAt(90), 0, Math.random(), false);
    const tank = [...this.units].reverse().find((u) => u.type === "tank");
    if (tank) tank.name = "M4 Sherman";
    this.tankCalled = true;
    this.pushLog("Armor on the way — a Sherman is rolling in!", "wave");
    this.dirty = true;
    return true;
  }

  /** Requisitioned 2nd Platoon team enters from the allied edge, level with the squad. */
  spawnReinforcements(kind: Reinforcement) {
    if (!this.canReinforce()) return;
    this.reinforcements++;
    const mine = this.units.filter((u) => u.side === "allies" && u.alive && !u.npc);
    const cy = mine.length ? mine.reduce((t, u) => t + u.y, 0) / mine.length : MAP_H / 2;
    const types: UnitTypeId[] = kind === "rifle" ? ["rifleman", "rifleman", "rifleman"] : ["mg", "at"];
    types.forEach((t, i) => this.addNpc(t, 40 + i * 18, cy + (i - (types.length - 1) / 2) * 34, this.nextId + i, Math.random()));
    this.pushLog(
      kind === "rifle" ? "Radio: rifle squad from 2nd Platoon moving up." : "Radio: MG & bazooka team from 2nd Platoon moving up.",
      "wave"
    );
    this.dirty = true;
  }

  private addNpc(type: UnitTypeId, px: number, py: number, i: number, r: number, weak = false, squad?: number, squadLeader = false) {
    {
      const spec = UNIT_TYPES[type];
      const [cx, cy] = nearestOpen(this.blocked, Math.floor(Math.max(12, Math.min(MAP_W - 12, px)) / CELL), Math.floor(Math.max(12, Math.min(MAP_H - 12, py)) / CELL));
      const SURN = ["Reilly", "Haskins", "Moreau", "Kaplan", "Briggs", "Delgado", "Novak", "Pruitt", "Lindqvist", "O'Hara", "Tasker", "Wexler"];
      // NPC squads carry real ranks: the leader is a sergeant and
      // succession walks down them (see npcSquadLeaderOf). Lone
      // NPCs keep the old rotating junior ranks.
      const squadRank = squadLeader
        ? "Sgt."
        : ["Cpl.", "Pfc.", "Pvt.", "Pfc.", "Cpl.", "Pvt.", "Pfc."][i % 7];
      const rank = squad !== undefined ? squadRank : ["Pvt.", "Pfc.", "Cpl."][i % 3];
      // 2nd Platoon NPCs: buffed 2026-11-11 at Josh's pick, after Wave 3
      // made battles unwinnable — 75% damage (was 50%), 90% health
      // (was 70%), near-full speed and vision, faster fire. Still
      // weaker than a hired man, so they support the fight instead of
      // winning it alone. Paid reinforcements call addNpc without
      // `weak` and keep full stats.
      const hp = weak ? Math.round(spec.hp * 0.9) : spec.hp;
      this.units.push({
        id: this.nextId++, side: "allies", type, enemyType: null, soldierId: null,
        name: `${rank} ${SURN[i % SURN.length]}`,
        rank: squad !== undefined ? rank : "", level: 0, reaction: 0.6, x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2, facing: 0, homeX: cx * CELL + CELL / 2, homeY: cy * CELL + CELL / 2, patrolX: cx * CELL + CELL / 2, patrolY: cy * CELL + CELL / 2,
        npcSquad: squad, npcLeader: squad !== undefined ? squadLeader : undefined,
        hp, maxHp: hp, speed: spec.speed * (weak ? 0.95 : 0.9), range: spec.range, vision: spec.vision * (weak ? 0.9 : 1),
        dmg: spec.dmg * (weak ? 0.75 : 1), fireInterval: spec.fireInterval * (weak ? 1.3 : 1.1), spread: spec.spread * 1.15, bulletSpeed: spec.bulletSpeed,
        isStatic: false, vehicle: spec.vehicle ?? false, counterAttack: false, aggressive: false, orders: [], attackId: null, targetId: null, cooldown: r, suppression: 0, pinned: false,
        morale: 100, broken: false, lastHitT: 0, coward: false, fled: false, fleeT: 0, willFlee: false,
        abilityCd: 0, burst: 0, burstTimer: 0, burstTarget: null, kills: 0, alive: true, walk: 0,
        damageTaken: 0, healed: 0, heavyKills: 0, officerKills: 0, dmgMult: 1, healMult: 1,
        chase: [], repathT: r, npc: true, cover: null, coverT: 0,
        stuckT: 0, lastX: cx * CELL + CELL / 2, lastY: cy * CELL + CELL / 2, stuckFails: 0, coverSeekT: Math.random() * 2, coverBanT: 0, coverBanX: 0, coverBanY: 0, coverIdleT: 0, stuckDestX: 0, stuckDestY: 0, stuckDestD: 0, chaseBanT: 0,
      });
    }
  }

  /** Selected men run to the nearest cover facing the enemy. */
  takeCover() {
    if (this.phase !== "battle") return;
    this.takeManualControl();
    for (const u of this.units) {
      if (!u.alive || !this.selected.includes(u.id)) continue;
      // seekCover only orders to a cover spot the unit can actually
      // reach; the old bestCover+findPath could order it to a stand
      // point wedged against a wall, where it sat forever.
      this.seekCover(u, 340);
    }
    this.pushLog("Get down! Squad moving to cover.", "info");
  }

  /** Pick a squad formation; the selected men re-form on their current objective. */
  setFormation(f: Formation) {
    this.takeManualControl();
    this.formation = f;
    const squad = this.units.filter((u) => u.side === "allies" && u.alive && this.selected.includes(u.id));
    if (this.phase === "battle" && squad.length > 1) {
      const ends = squad.map((u) => (u.orders.length ? u.orders[u.orders.length - 1] : { x: u.x, y: u.y }));
      const tx = ends.reduce((t, p) => t + p.x, 0) / ends.length;
      const ty = ends.reduce((t, p) => t + p.y, 0) / ends.length;
      const foe = this.nearestAlly(squad[0]);
      const dir = foe ? Math.atan2(foe.y - ty, foe.x - tx) : 0;
      this.moveSquad(squad, tx, ty, false, dir);
      this.pushLog(`Squad — form ${f.toUpperCase()}.`, "info");
    }
    this.dirty = true;
  }

  /** Touch: next drag draws a selection box instead of scrolling the map. */
  setTouchBox(on: boolean) {
    this.touchBox = on;
    this.dirty = true;
  }

  // Slot offsets for the formation: forward = toward `dir`, slot 0 leads.
  private formationSlot(i: number, n: number, dir: number): { x: number; y: number } {
    let back = 0;
    let side = 0;
    const f = this.formation;
    if (f === "line") side = (i - (n - 1) / 2) * 34;
    else if (f === "column") back = i * 30;
    else if (f === "spread") {
      side = (i - (n - 1) / 2) * 62;
      back = (i % 2) * 36;
    } else {
      const k = Math.ceil(i / 2);
      back = k * 28;
      side = (i % 2 ? -1 : 1) * k * 30;
    }
    const fx = Math.cos(dir);
    const fy = Math.sin(dir);
    return { x: -fx * back - fy * side, y: -fy * back + fx * side };
  }

  private moveSquad(squad: Unit[], x: number, y: number, queue: boolean, dir: number) {
    squad.forEach((u, i) => {
      const off = this.formationSlot(i, squad.length, dir);
      const ox = Math.max(12, Math.min(MAP_W - 12, x + off.x));
      const oy = Math.max(12, Math.min(MAP_H - 12, y + off.y));
      u.attackId = null;
      const from = queue && u.orders.length ? u.orders[u.orders.length - 1] : { x: u.x, y: u.y };
      const path = findPath(this.blocked, from.x, from.y, ox, oy);
      if (queue) u.orders.push(...path);
      else u.orders = path;
    });
  }

  /** Twin-stick inputs from the touch overlay. A null vector
   * means that thumb is off the stick. */
  setTouchMove(v: { x: number; y: number } | null) {
    if (this.retreating) v = null; // break and run: the sticks are dead
    this.touchMove = v && (Math.abs(v.x) > 0.22 || Math.abs(v.y) > 0.22) ? v : null;
  }

  setTouchAim(v: { x: number; y: number } | null) {
    if (this.retreating) v = null;
    this.touchAimVec = v && (Math.abs(v.x) > 0.22 || Math.abs(v.y) > 0.22) ? v : null;
    if (!this.touchAimVec && this.touchAimTarget) {
      const L = this.leaderUnit();
      if (L) L.attackId = null;
      this.touchAimTarget = false;
      this.manualShot = null;
    }
  }

  /** On-screen D-pad: hold to scroll (-1..1 per axis). */
  setHoldPan(x: number, y: number) {
    this.holdPan = { x, y };
  }

  abilitySelected() {
    const lead = this.units.find((u) => this.selected.includes(u.id) && u.alive);
    if (lead) this.startAim(lead.id);
  }

  // Nearest cover spot (on the side facing the closest threat) within `radius`.
  // Scores by distance, with a bonus for cover that sits between the unit
  // and the threat — that is the cover that actually stops incoming fire
  // while the unit advances or holds, rather than cover behind it.
  // Ranked cover stand-points, best first. A stand point is the spot
  // on the threat side of a cover object, far enough out that the unit's
  // whole body fits. Covers are skipped when that spot is body-blocked
  // (the old check only looked at the single blocked cell under the
  // point, so a unit could be ordered to a spot wedged against a ruin
  // wall or crate and sit there forever) or when the spot was banned
  // after the stuck detector dropped a wedged order to it.
  private bestCovers(u: Unit, radius: number): Array<{ x: number; y: number }> {
    const threat = this.nearestAlly(u);
    const out: Array<{ x: number; y: number; q: number; score: number }> = [];
    for (const c of this.covers) {
      const d0 = dist(u.x, u.y, c.x, c.y);
      if (d0 > radius + c.r) continue;
      let sx = c.x;
      let sy = c.y;
      if (threat) {
        const a = Math.atan2(threat.y - c.y, threat.x - c.x);
        sx = c.x - Math.cos(a) * (c.r + UNIT_R + 3);
        sy = c.y - Math.sin(a) * (c.r + UNIT_R + 3);
      }
      // Full-body clearance, not just the cell under the point: ruin
      // walls, crates and wrecks are blockers too, and their cover
      // points sit right next to them.
      if (this.pointBlocked(sx, sy)) continue;
      if (this.elapsed < u.coverBanT && dist(sx, sy, u.coverBanX, u.coverBanY) < 100) continue;
      const d = dist(u.x, u.y, sx, sy);
      // Quality earns a distance budget, it does not override distance:
      // a trench (q 0.95) beats a sandbag (q 0.65) up to 90 units
      // farther away, and a ruin wall (q 0.8) up to 45 farther — but
      // a unit does not hike across the map for a trench when good
      // cover sits next to it. (A hard quality-first sort did exactly
      // that: an idle man who had just reached his ordered spot walked
      // all the way back to a trench 160 units away, past a ruin wall
      // 99 away.)
      let score = d - c.q * 300;
      // Threat-side bonus: cover roughly in the direction of the enemy
      // (dot product of unit->cover and unit->threat above 0) counts as
      // 60 units closer, so a slightly farther sandbag facing the enemy
      // beats a nearer one behind the unit.
      if (threat) {
        const dot = (sx - u.x) * (threat.x - u.x) + (sy - u.y) * (threat.y - u.y);
        if (dot > 0) score -= 60;
      }
      out.push({ x: sx, y: sy, q: c.q, score });
    }
    out.sort((a, b) => a.score - b.score);
    return out.map(({ x, y }) => ({ x, y }));
  }

  private bestCover(u: Unit, radius: number): { x: number; y: number } | null {
    return this.bestCovers(u, radius)[0] ?? null;
  }

  // Send a unit to the nearest cover spot and hold there. Returns false
  // when there is no reachable cover in range. Reachable is checked for
  // real: the path's final waypoint must land within 36 units of the
  // stand point. The old version returned true for any cover whose
  // centre was in range, even when findPath's fallback ended at the
  // closest reachable cell far from the cover — the unit "arrived",
  // was still not in cover, and re-ordered to the same spot every
  // 5 seconds forever. Candidates are tried in ranked order, so a
  // walled-off sandbag falls through to the next reachable one.
  // A unit already in cover, or already standing on the spot, is not
  // re-ordered at all.
  private seekCover(u: Unit, radius: number): boolean {
    if (u.cover) return false;
    for (const c of this.bestCovers(u, radius).slice(0, 6)) {
      if (dist(u.x, u.y, c.x, c.y) < 12) return false;
      const path = findPath(this.blocked, u.x, u.y, c.x, c.y);
      if (!path.length) continue;
      const end = path[path.length - 1];
      if (dist(end.x, end.y, c.x, c.y) > 36) continue;
      u.orders = path;
      u.chase = [];
      return true;
    }
    return false;
  }

  /** Dev/test probe: living allied positions + open-cell check. */
  debugAllies() {
    return this.units
      .filter((u) => u.side === "allies" && u.alive)
      .map((u) => ({ name: u.name, x: Math.round(u.x), y: Math.round(u.y), orders: u.orders.length, npc: u.npc, inCover: !!u.cover }));
  }

  selectUnit(id: number) {
    const u = this.unitById(id);
    if (!u?.alive) return;
    this.takeManualControl();
    this.selected = [id];
    this.aimUnitId = null;
    this.dirty = true;
  }

  // ---------------- input ----------------

  private toMap(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.view.ox) / this.view.s + this.cam.x,
      y: (clientY - rect.top - this.view.oy) / this.view.s + this.cam.y,
    };
  }

  private onContextMenu = (e: Event) => e.preventDefault();

  private onKey = (e: KeyboardEvent) => {
    if (this.phase === "over") return;
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
      e.preventDefault();
      this.keys.add(k);
      return;
    }
    if (k === " ") {
      e.preventDefault();
      if (this.phase === "briefing") return;
      this.togglePause();
      return;
    }
    // Selection works in the briefing too, so the squad can be picked
    // before BEGIN THE ASSAULT: the old code returned here for the whole
    // briefing, so 1-8, 0 and Esc did nothing until the battle started
    // and the controls looked dead. Orders (right-click, Q, C, F) still
    // need the battle to be running.
    if (k === "0") {
      this.selectAll();
      return;
    }
    if (this.phase === "battle" && (k === "1" || k === "2" || k === "3")) {
      this.setSquadOrder(k === "1" ? "attack" : k === "2" ? "defend" : "formup");
      return;
    }
    if (k >= "1" && k <= "8") {
      // With the squad split, 6 = Alpha and 7 = Bravo, so a team can
      // be picked without tapping the dock. Without a split, 6-8
      // still pick an individual man as before.
      if ((k === "6" || k === "7") && (this.teamA.length || this.teamB.length)) {
        this.selectTeam(k === "6" ? 0 : 1);
        return;
      }
      const idx = parseInt(k, 10) - 1;
      const allies = this.units.filter((u) => u.side === "allies" && !u.npc);
      if (allies[idx]) {
        this.takeManualControl();
        this.selected = allies[idx].alive ? [allies[idx].id] : [];
        // No centerOn: the battle camera is hard locked to the
        // team leader (Josh, 2026-11-12) and never jumps to
        // another man.
        this.aimUnitId = null;
        this.dirty = true;
      }
      return;
    }
    if (k === "escape") {
      if (this.aimUnitId) this.cancelAim();
      else this.selected = [];
      this.dirty = true;
      return;
    }
    if (this.phase === "briefing") return;
    if (k === "c") {
      this.takeCover();
      return;
    }
    if (k === "f") {
      const order: Formation[] = ["wedge", "line", "column", "spread"];
      this.setFormation(order[(order.indexOf(this.formation) + 1) % order.length]);
      return;
    }
    if (k === "q") {
      const lead = this.units.find((u) => this.selected.includes(u.id) && u.alive);
      if (lead) this.startAim(lead.id);
      return;
    }
    if (k === "escape") {
      if (this.aimUnitId) this.cancelAim();
      else this.selected = [];
      this.dirty = true;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
    if (e.key === " ") e.preventDefault();
  };

  private onPointerDown = (e: PointerEvent) => {
    // Selection works in the briefing; move/attack orders do not.
    // The old code returned for the whole briefing, so left-drag box
    // select and tap-select did nothing until the battle started.
    if (this.phase !== "battle" && this.phase !== "briefing") return;
    if (this.phase === "briefing" && (e.button === 2 || this.aimUnitId !== null)) return;
    const p = this.toMap(e.clientX, e.clientY);
    this.mouse = { x: p.x, y: p.y, inside: true };
    if (e.pointerType === "touch" && this.aimUnitId === null) {
      if (this.touchBox) {
        this.dragging = true;
        this.marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
        return;
      }
      this.touchPan = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y, moved: false, t0: performance.now() };
      return;
    }
    if (e.button === 2) {
      // Battle: right click is the leader's ability at that
      // point. Everywhere else it stays the classic move order.
      if (this.phase === "battle" && !this.autoBattle) {
        this.leaderAbilityAt(p.x, p.y);
        return;
      }
      this.issueOrder(p.x, p.y, e.shiftKey);
      return;
    }
    if (this.aimUnitId !== null) {
      const unit = this.unitById(this.aimUnitId);
      this.aimUnitId = null;
      if (unit) this.castGround(unit, p.x, p.y);
      this.dirty = true;
      return;
    }
    if (this.phase === "battle" && !this.autoBattle && e.pointerType !== "touch") {
      // Battle: left click is the leader's trigger. No marquee,
      // no per-man selection: the squad is the leader's now.
      this.leaderShootAt(p.x, p.y);
      return;
    }
    this.dragging = true;
    this.marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.touchPan) {
      const dx = e.clientX - this.touchPan.x;
      const dy = e.clientY - this.touchPan.y;
      if (!this.touchPan.moved && Math.hypot(dx, dy) > 10 && performance.now() - this.touchPan.t0 > 350) {
        // Press-and-hold, then drag: selection box.
        const s = this.toMap(this.touchPan.x, this.touchPan.y);
        const p = this.toMap(e.clientX, e.clientY);
        this.touchPan = null;
        this.dragging = true;
        this.marquee = { x0: s.x, y0: s.y, x1: p.x, y1: p.y };
        return;
      }
      if (Math.hypot(dx, dy) > 10) this.touchPan.moved = true;
      if (this.touchPan.moved && this.phase !== "battle") {
        // Drag pan exists outside battle only: in battle the
        // camera is hard locked to the leader (Josh, 2026-11-12).
        this.cam.x = this.touchPan.cx - dx / this.view.s;
        this.cam.y = this.touchPan.cy - dy / this.view.s;
        this.clampCam();
      }
      return;
    }
    const p = this.toMap(e.clientX, e.clientY);
    this.mouse = { x: p.x, y: p.y, inside: true };
    if (this.marquee) {
      this.marquee.x1 = p.x;
      this.marquee.y1 = p.y;
    }
  };

  private onPointerLeave = () => {
    this.mouse = { ...this.mouse, inside: false };
  };

  private onPointerUp = (e: PointerEvent) => {
    if (this.touchPan) {
      const tp = this.touchPan;
      this.touchPan = null;
      if (tp.moved) return;
      // Tap: on one of my men -> select him; anywhere else with men selected -> order.
      const p = this.toMap(e.clientX, e.clientY);
      if (this.phase === "battle" && !this.autoBattle) {
        // Tap to shoot stays as the sticks' backup.
        this.leaderShootAt(p.x, p.y);
        this.dirty = true;
        return;
      }
      const mine = this.units.find((u) => u.side === "allies" && u.alive && !u.npc && dist(p.x, p.y, u.x, u.y) < 26);
      if (mine) this.selected = this.selected.includes(mine.id) && this.selected.length === 1 ? [] : [mine.id];
      else if (this.selected.length && this.phase === "battle") this.issueOrder(p.x, p.y, false);
      this.dirty = true;
      return;
    }
    if (e.button === 2 || !this.marquee) {
      this.marquee = null;
      this.dragging = false;
      return;
    }
    const p = this.toMap(e.clientX, e.clientY);
    const w = Math.abs(p.x - this.marquee.x0);
    const h = Math.abs(p.y - this.marquee.y0);
    if (w < 8 && h < 8) {
      // Click-select: nearest living ally under the cursor.
      let best: Unit | null = null;
      let bestD = 24;
      for (const u of this.units) {
        if (u.side !== "allies" || !u.alive || u.npc) continue;
        const d = dist(p.x, p.y, u.x, u.y);
        if (d < bestD) {
          best = u;
          bestD = d;
        }
      }
      this.selected = best ? [best.id] : [];
      this.aimUnitId = null;
    } else {
      const x0 = Math.min(this.marquee.x0, p.x);
      const x1 = Math.max(this.marquee.x0, p.x);
      const y0 = Math.min(this.marquee.y0, p.y);
      const y1 = Math.max(this.marquee.y0, p.y);
      this.selected = this.units
        .filter((u) => u.side === "allies" && u.alive && !u.npc && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1)
        .map((u) => u.id);
      this.aimUnitId = null;
    }
    this.marquee = null;
    this.dragging = false;
    this.touchBox = false;
    this.dirty = true;
  };

  // ---------------- orders & abilities ----------------

  private issueOrder(x: number, y: number, queue: boolean) {
    const squad = this.units.filter((u) => u.side === "allies" && u.alive && this.selected.includes(u.id));
    if (squad.length === 0) return;
    this.takeManualControl();
    // Attack order if an enemy is under the cursor.
    let target: Unit | null = null;
    let bestD = 26;
    for (const e of this.units) {
      if (e.side !== "axis" || !e.alive) continue;
      const cell = this.cellAt(e.x, e.y);
      if (!this.visible[cell]) continue;
      const d = dist(x, y, e.x, e.y);
      if (d < bestD) {
        target = e;
        bestD = d;
      }
    }
    if (target) {
      for (const u of squad) {
        u.attackId = target.id;
        if (!queue) u.orders = [];
      }
      this.pushLog(`Fire concentration on ${ENEMY_TYPES[target.enemyType!].label}.`, "info");
    } else {
      const cx = squad.reduce((t, u) => t + u.x, 0) / squad.length;
      const cy = squad.reduce((t, u) => t + u.y, 0) / squad.length;
      this.moveSquad(squad, x, y, queue, Math.atan2(y - cy, x - cx));
    }
    this.dirty = true;
  }

  private castGround(u: Unit, x: number, y: number) {
    const spec = UNIT_TYPES[u.type].ability;
    if (u.type === "rifleman") {
      this.projectiles.push({
        x: u.x, y: u.y, sx: u.x, sy: u.y, tx: x, ty: y, t: 0,
        dur: Math.max(0.5, dist(u.x, u.y, x, y) / 380),
        side: "allies", dmg: 60, aoe: 70, kind: "grenade", sourceType: "grenade",
        killerId: u.id, smokeT: 0,
      });
      u.abilityCd = spec.cd;
      this.pushLog(`${u.name} frags the objective.`, "info");
    } else if (u.type === "mg") {
      u.burst = 16;
      u.burstTimer = 0;
      u.burstTarget = { x, y };
      u.facing = Math.atan2(y - u.y, x - u.x);
      u.abilityCd = spec.cd;
      this.pushLog(`${u.name} walks a barrage across the grid.`, "info");
    } else if (u.type === "engineer") {
      // Deploy Cover: a sandbag position where he aims, within
      // carrying distance. Real cover in every system that reads
      // covers and blockers, and it wears down and dies like any
      // other sandbag (destroyCover takes the blocker with it).
      const d0 = dist(u.x, u.y, x, y);
      const px = d0 > 220 ? u.x + ((x - u.x) / d0) * 220 : x;
      const py = d0 > 220 ? u.y + ((y - u.y) / d0) * 220 : y;
      if (this.blockers.some((b) => dist(px, py, b.x, b.y) < b.r + 14)) {
        this.pushLog(`${u.name}: no room to build there.`, "info");
        return;
      }
      // Cover-only, exactly like the terrain's own sandbags: the
      // shelter lives in the cover roll, and the position draws
      // and wears down like any other sandbag.
      this.covers.push({ x: px, y: py, r: 15, q: 0.65, q0: 0.65, kind: "sandbag", hp: 110, maxHp: 110, type: "light" });
      u.abilityCd = spec.cd;
      this.pushLog(`${u.name} throws up a sandbag position.`, "info");
    }
    this.dirty = true;
  }

  /** Engineers work the minefields (Josh, 2026-11-12). The
   * detector reveals every armed mine within 70 of a living
   * engineer. A revealed mine within 26 gets cleared after
   * ENGINEER_CLEAR_SECONDS of work: the engineer must hold
   * still over it (moving pauses the work, it does not reset
   * it) and he does not fire while his hands are in the dirt —
   * crossing a field is a slow, covered job, not a stroll. When
   * the field is quiet and he has no orders, he walks to the
   * nearest revealed mine within 130 and gets to work. A squad
   * with no engineer gets none of this: their men find mines
   * the old way. */
  private stepEngineers(dt: number) {
    if (!this.mines.length) return;
    for (const e of this.units) {
      if (e.side !== "allies" || e.type !== "engineer") continue;
      e.clearing = false;
      if (!e.alive || e.broken) continue;
      for (const m of this.mines) {
        if (m.armed && !m.revealed && dist(e.x, e.y, m.x, m.y) <= ENGINEER_DETECT_RANGE) {
          m.revealed = true;
        }
      }
      let work: (typeof this.mines)[number] | null = null;
      let workD = ENGINEER_CLEAR_RANGE;
      for (const m of this.mines) {
        if (!m.armed || !m.revealed) continue;
        const d = dist(e.x, e.y, m.x, m.y);
        if (d < workD) {
          work = m;
          workD = d;
        }
      }
      if (work) {
        e.clearing = true;
        if (e.movedT !== this.elapsed) {
          work.clearT = (work.clearT ?? 0) + dt;
          if (work.clearT >= ENGINEER_CLEAR_SECONDS) {
            work.armed = false;
            work.cleared = true;
            work.clearT = 0;
            this.pushLog(`${e.name} clears a mine.`, "info");
          }
        }
        continue;
      }
      if (!e.orders.length && !e.chase.length && !e.targetId) {
        let seek: (typeof this.mines)[number] | null = null;
        let seekD = ENGINEER_SEEK_RANGE;
        for (const m of this.mines) {
          if (!m.armed || !m.revealed) continue;
          const d = dist(e.x, e.y, m.x, m.y);
          if (d < seekD) {
            seek = m;
            seekD = d;
          }
        }
        if (seek) {
          const ang = Math.atan2(e.y - seek.y, e.x - seek.x);
          e.orders = findPath(this.blocked, e.x, e.y, seek.x + Math.cos(ang) * 18, seek.y + Math.sin(ang) * 18);
        }
      }
    }
  }

  /** A friendly medic within 120: morale recovers faster beside him. */
  private nearMedic(u: Unit): boolean {
    return this.units.some((a) => a.alive && a.side === u.side && a.id !== u.id && this.isMedic(a) && dist(u.x, u.y, a.x, a.y) <= 120);
  }

  /** A leader within 200: morale recovers faster beside him. Axis
   * follow a living officer; the Allies follow the highest-rank
   * living squad man (Sgt outranks Cpl outranks Pfc outranks Pvt).
   * If the leader is dead, the bonus is gone with him. */
  private nearLeader(u: Unit): boolean {
    if (u.side === "axis") {
      return this.units.some((a) => a.alive && a.side === "axis" && a.enemyType === "officer" && dist(u.x, u.y, a.x, a.y) <= 200);
    }
    let best = -1;
    let leader: Unit | null = null;
    for (const a of this.units) {
      if (a.side !== "allies" || !a.alive || a.npc) continue;
      const v = a.rank.startsWith("Sgt") ? 3 : a.rank.startsWith("Cpl") ? 2 : a.rank.startsWith("Pfc") ? 1 : 0;
      if (v > best) {
        best = v;
        leader = a;
      }
    }
    return !!leader && dist(u.x, u.y, leader.x, leader.y) <= 200;
  }

  /** A medic on either side: the player's medic (type "medic") or an
   * Axis Sanitaeter (enemyType "medic"). Both heal only their own side. */
  private isMedic(u: Unit): boolean {
    return (u.side === "allies" && u.type === "medic") || (u.side === "axis" && u.enemyType === "medic");
  }

  /** Worst-wounded living man of the unit's own side within maxD, or null. */
  private worstHurtAlly(u: Unit, maxD: number): Unit | null {
    let best: Unit | null = null;
    let worst = 1;
    for (const a of this.units) {
      if (a.side !== u.side || !a.alive || a.id === u.id) continue;
      const pct = a.hp / a.maxHp;
      if (pct < 1 && dist(u.x, u.y, a.x, a.y) <= maxD && pct < worst) {
        best = a;
        worst = pct;
      }
    }
    return best;
  }

  /** Triage patch-up, +50 HP to the worst-wounded man of the medic's
   * own side within 130, on a 10s cooldown. Axis medics use this on
   * their own every update; the player's medic uses castAuto (same
   * numbers, with the radio line) through Q or AUTO. */
  private medicTriage(u: Unit) {
    if (u.abilityCd > 0 || u.broken) return;
    const best = this.worstHurtAlly(u, 130);
    if (!best) return;
    const before = best.hp;
    best.hp = Math.min(best.maxHp, best.hp + 50 * u.healMult);
    u.healed += best.hp - before;
    this.healFx(best.x, best.y);
    u.abilityCd = 10;
    if (u.side === "allies") this.pushLog(`${u.name} patches up ${best.name}.`, "info");
    else this.pushLog("Enemy medic patches up a wounded man.", "info");
    this.dirty = true;
  }

  private castAuto(u: Unit) {
    const spec = UNIT_TYPES[u.type].ability;
    if (u.type === "medic") {
      let best: Unit | null = null;
      let worst = 1;
      for (const a of this.units) {
        if (a.side !== "allies" || !a.alive) continue;
        const pct = a.hp / a.maxHp;
        if (pct < 1 && dist(u.x, u.y, a.x, a.y) <= 130 && pct < worst) {
          best = a;
          worst = pct;
        }
      }
      if (!best) {
        this.pushLog(`${u.name}: nobody needs the morphine yet.`, "info");
        return;
      }
      const before = best.hp;
      best.hp = Math.min(best.maxHp, best.hp + 50 * u.healMult);
      u.healed += best.hp - before;
      this.healFx(best.x, best.y);
      u.abilityCd = spec.cd;
      this.pushLog(`${u.name} patches up ${best.name}.`, "info");
    } else if (u.type === "radioman") {
      // Rally Call: nearby men recover 15 morale. Only spends the
      // cooldown when somebody actually needs rallying.
      const low = this.units.filter(
        (a) => a.side === "allies" && a.alive && a.morale < 100 && dist(u.x, u.y, a.x, a.y) <= 150,
      );
      if (!low.length) {
        this.pushLog(`${u.name}: the squad is holding — nobody needs rallying.`, "info");
        return;
      }
      for (const a of low) {
        if (a.broken && a.willFlee) a.morale = 65; // steadies a fleeing man
        else a.morale = Math.min(100, a.morale + 15);
      }
      u.abilityCd = spec.cd;
      this.pushLog(`${u.name} rallies the squad on the radio.`, "info");
    } else if (u.type === "sniper") {
      const t = this.bestTarget(u, (a, b) => a.maxHp - b.maxHp);
      if (!t) {
        this.pushLog(`${u.name}: no shot — nothing in range.`, "info");
        return;
      }
      this.tracer(u.x, u.y, t.x, t.y, true);
      this.damage(t, 120, "sniper", u.id);
      u.abilityCd = spec.cd;
      this.pushLog(`Deadeye — ${ENEMY_TYPES[t.enemyType!].label} drops.`, "kill");
    } else if (u.type === "at") {
      const t = this.bestTarget(u, (a, b) => a.maxHp - b.maxHp);
      if (!t) {
        this.pushLog(`${u.name}: nothing in bazooka range.`, "info");
        return;
      }
      this.projectiles.push({
        x: u.x, y: u.y, sx: u.x, sy: u.y, tx: t.x, ty: t.y, t: 0,
        dur: dist(u.x, u.y, t.x, t.y) / 380,
        side: "allies", dmg: 80, aoe: 65, kind: "rocket", sourceType: "rocket",
        killerId: u.id, smokeT: 0,
      });
      u.abilityCd = spec.cd;
      this.pushLog(`${u.name} fires the tube.`, "info");
    } else if (u.type === "recon") {
      // Mark Target: he spots at vision range, far beyond his
      // carbine. The marked man shows through fog and takes
      // heavier fire; a mark laid from concealment sets an
      // ambush, and the first hit on him springs it.
      let best: Unit | null = null;
      let bestD = u.vision;
      for (const e of this.units) {
        if (e.side === u.side || !e.alive) continue;
        const d = dist(u.x, u.y, e.x, e.y);
        if (d < bestD && this.los(u, e)) {
          best = e;
          bestD = d;
        }
      }
      if (!best) {
        this.pushLog(`${u.name}: nothing in sight to mark.`, "info");
        return;
      }
      best.markedUntil = this.elapsed + 10;
      best.markedAmbush = this.inFoliage(u);
      u.abilityCd = spec.cd;
      this.pushLog(
        best.markedAmbush
          ? `${u.name} marks a target from the treeline. Ambush set.`
          : `${u.name} marks a target for the squad.`,
        "info",
      );
    }
    this.dirty = true;
  }

  private autoUseAbilities() {
    for (const u of this.units) {
      if (u.side !== "allies" || u.npc || !u.alive || u.abilityCd > 0 || u.broken) continue;
      // The team leader's ability is the player's to spend in a
      // manual battle. Under the AUTO test driver he casts like
      // everyone else, as he always has.
      if (!this.autoBattle && u.id === this.leaderId) continue;
      if (u.type === "medic") {
        const hurt = this.units.some(
          (a) => a.side === "allies" && a.alive && a.hp < a.maxHp && dist(u.x, u.y, a.x, a.y) <= 130,
        );
        if (hurt) this.castAuto(u);
      } else if (u.type === "sniper" || u.type === "at") {
        if (this.bestTarget(u, (a, b) => a.maxHp - b.maxHp)) this.castAuto(u);
      } else if (u.type === "radioman") {
        // AI rally is for the broken only: the morale system is
        // built for a wavering man to break at 20 and be steadied
        // back, and a radioman who tops up everyone under 70
        // would quietly abolish breaking altogether. A human
        // player can still spend the call early by hand.
        const brokenNear = this.units.some(
          (a) => a.side === "allies" && a.alive && a.broken && dist(u.x, u.y, a.x, a.y) <= 150,
        );
        if (brokenNear) this.castAuto(u);
      } else if (u.type === "recon") {
        const unmarked = this.units.some(
          (e) => e.side === "axis" && e.alive && dist(u.x, u.y, e.x, e.y) <= u.vision && !(e.markedUntil !== undefined && e.markedUntil > this.elapsed),
        );
        if (unmarked) this.castAuto(u);
      } else if (u.type === "engineer") {
        // Build where he stands when the enemy is close and he
        // has no real cover of his own yet.
        const threatened = this.units.some((e) => e.side === "axis" && e.alive && dist(u.x, u.y, e.x, e.y) <= u.range + 80);
        if (threatened && !u.cover) {
          this.castGround(u, u.x + Math.cos(u.facing) * 34, u.y + Math.sin(u.facing) * 34);
        }
      } else if (u.type === "rifleman" || u.type === "mg") {
        const t = this.autoTarget(u);
        if (t) this.castGround(u, t.x, t.y);
      }
    }
  }

  /** NPC allies use their class abilities on their own judgment
   * (Josh, 2026-11-12), the same triggers the player's followers
   * use: the sniper and AT man fire their specials at the biggest
   * target in reach, the recon marks, the MG walks a barrage,
   * the radioman rallies a broken squadmate, the medic casts
   * his triage. (His aura and ladder triage already ran.) */
  private npcUseAbilities() {
    for (const u of this.units) {
      if (u.side !== "allies" || !u.npc || !u.alive || u.abilityCd > 0 || u.broken) continue;
      if (u.type === "sniper" || u.type === "at") {
        if (this.bestTarget(u, (a, b) => a.maxHp - b.maxHp)) this.castAuto(u);
      } else if (u.type === "recon") {
        const unmarked = this.units.some(
          (e) => e.side === "axis" && e.alive && dist(u.x, u.y, e.x, e.y) <= u.vision && !(e.markedUntil !== undefined && e.markedUntil > this.elapsed),
        );
        if (unmarked) this.castAuto(u);
      } else if (u.type === "medic") {
        const hurt = this.units.some(
          (a) => a.side === "allies" && a.alive && a.hp < a.maxHp && dist(u.x, u.y, a.x, a.y) <= 130,
        );
        if (hurt) this.castAuto(u);
      } else if (u.type === "radioman") {
        const brokenNear = this.units.some(
          (a) => a.side === "allies" && a.alive && a.broken && dist(u.x, u.y, a.x, a.y) <= 150,
        );
        if (brokenNear) this.castAuto(u);
      } else if (u.type === "engineer") {
        const threatened = this.units.some((e) => e.side === "axis" && e.alive && dist(u.x, u.y, e.x, e.y) <= u.range + 80);
        if (threatened && !u.cover) {
          this.castGround(u, u.x + Math.cos(u.facing) * 34, u.y + Math.sin(u.facing) * 34);
        }
      } else if (u.type === "rifleman" || u.type === "mg") {
        const t = this.autoTarget(u);
        if (t) this.castGround(u, t.x, t.y);
      }
    }
  }

  private bestTarget(u: Unit, cmp: (a: Unit, b: Unit) => number): Unit | null {
    const inRange = this.units.filter(
      (e) => e.side === "axis" && e.alive && dist(u.x, u.y, e.x, e.y) <= this.effRange(u)
    );
    if (inRange.length === 0) return null;
    return inRange.reduce((a, b) => (cmp(a, b) >= 0 ? a : b));
  }

  /** A Recon of his own side within pairing distance, alive —
   * the man who feeds the sniper his targets. */
  reconPaired(u: Unit): boolean {
    return this.units.some(
      (a) => a.side === u.side && a.alive && a.id !== u.id && a.type === "recon" && dist(u.x, u.y, a.x, a.y) <= RECON_PAIR_DIST,
    );
  }

  /** The range this unit can actually engage at. A sniper (the
   * player's or an NPC's) reaches his full range only with a
   * Recon paired near him; alone he self-spots at solo range.
   * Everyone else fights at their listed range. (Enemy snipers
   * keep full range until the enemy fields spotters of its own:
   * the ranges pass owns that half of the rule.) */
  effRange(u: Unit): number {
    if (u.side === "allies" && u.type === "sniper" && !this.reconPaired(u)) {
      return Math.min(u.range, SNIPER_SOLO_RANGE);
    }
    return u.range;
  }

  /** A Recon concealed in foliage: in the green, and he has not
   * fired in the last few seconds to give himself away. The
   * enemy spots him at a fraction of the normal distance. His
   * own spotting is unaffected — that is the whole point of him. */
  reconHidden(u: Unit): boolean {
    if (u.side !== "allies" || u.type !== "recon" || !u.alive) return false;
    if (!this.inFoliage(u)) return false;
    return u.lastShotT === undefined || this.elapsed - u.lastShotT > RECON_REVEAL_SECONDS;
  }

  // ---------------- spawning ----------------

  private spawnAllies(squad: SquadInput[], rng: () => number, commanderBonus: number) {
    const n = squad.length;
    const gap = n > 6 ? 60 : 72;
    squad.forEach((s, i) => {
      const spec = UNIT_TYPES[s.type];
      const bonus = levelBonus(s.level, commanderBonus);
      const mb = medalBonus(s.medals);
      let sx = 80 + rng() * 60;
      let y = MAP_H / 2 + (i - (n - 1) / 2) * gap + (rng() * 20 - 10);
      if (this.variant === "airborne") {
        // Scattered drop: men land all over the western fields, far
        // from each other — but west of the bluff gun line (the
        // wave 1 statics hold x 700-1000). The old zone reached
        // x 1520 and dropped men inside the MG nests: AUTO lost
        // 6 of 6 in under 71 seconds with 0-1 kills (2026-11-12
        // balance pass). A drop zone of x 120-640 keeps the
        // scatter and the bocage, and lets the squad form up
        // before it hits the guns.
        sx = 120 + rng() * 520;
        y = 80 + rng() * (MAP_H - 160);
      } else if (this.variant === "beach") {
        sx = 150 + rng() * 40;
      }
      const [ocx, ocy] = nearestOpen(this.blocked, Math.floor(sx / CELL), Math.floor(y / CELL));
      sx = ocx * CELL + CELL / 2;
      y = ocy * CELL + CELL / 2;
      this.units.push({
        id: this.nextId++,
        side: "allies",
        type: s.type,
        enemyType: null,
        soldierId: s.id,
        coward: isCowardQuirk(s.quirk),
        fled: false,
        fleeT: 0,
        willFlee: false,
        name: s.name,
        rank: s.rank,
        level: s.level,
        reaction: Math.max(0.1, bonus.reaction + mb.reaction),
        x: sx,
        y,
        facing: 0,
        homeX: sx, homeY: y, patrolX: sx, patrolY: y,
        hp: spec.hp + mb.hp,
        maxHp: spec.hp + mb.hp,
        speed: spec.speed,
        range: spec.range,
        vision: spec.vision + mb.vision,
        dmg: spec.dmg,
        fireInterval: spec.fireInterval * bonus.fireMult * mb.fireMult,
        spread: spec.spread * bonus.spreadMult * mb.spreadMult,
        dmgMult: mb.dmgMult,
        healMult: mb.healMult,
        bulletSpeed: spec.bulletSpeed,
        isStatic: false,
        vehicle: false, counterAttack: false, aggressive: false,
        orders: [],
        attackId: null,
        targetId: null,
        cooldown: rng() * 0.5,
        suppression: 0,
        pinned: false,
        morale: 100, broken: false, lastHitT: 0,
        abilityCd: 0,
        burst: 0,
        burstTimer: 0,
        burstTarget: null,
        kills: 0,
        alive: true,
        walk: 0,
        damageTaken: 0,
        healed: 0,
        heavyKills: 0,
        officerKills: 0,
        chase: [],
        repathT: 0,
        npc: false,
        cover: null,
        coverT: 0,
        stuckT: 0, lastX: sx, lastY: y, stuckFails: 0, coverSeekT: Math.random() * 2, coverBanT: 0, coverBanX: 0, coverBanY: 0, coverIdleT: 0, stuckDestX: 0, stuckDestY: 0, stuckDestD: 0, chaseBanT: 0,
      });
    });
  }

  /** One enemy man, built exactly like a wave spawn. Wave spawns
   * and the radio call-in both go through here. */
  private spawnEnemyUnit(type: EnemyTypeId, x: number, y: number, rng: () => number, exact = false) {
    const def = ENEMY_TYPES[type];
    const isStatic = !!def.static;
    // exact: the caller placed the man deliberately (wave 1 in a
    // trench) — use the point as-is. The default snaps to the nearest
    // open cell centre, which would knock him off the trench line.
    const [px, py] = exact
      ? [x, y]
      : (() => {
          const [cx, cy] = nearestOpen(this.blocked, Math.floor(x / CELL), Math.floor(y / CELL));
          return [cx * CELL + CELL / 2, cy * CELL + CELL / 2];
        })();
    const u: Unit = {
          id: this.nextId++,
          side: "axis",
          type: "rifleman",
          enemyType: type,
          // The coward roll uses Math.random, NOT the wave's seeded rng:
          // the seeded sequence is fixed per mission, so a roll from it
          // would make cowardice a fixed fact of the mission (Silent
          // Chateau drew zero cowards in every battle) instead of a
          // chance that varies from one play to the next.
          coward: type === "volks" && Math.random() < this.cowardChance,
          fled: false,
          fleeT: 0,
          willFlee: false,
          soldierId: null,
          name: def.label,
          rank: "",
          level: 0,
          reaction: 0.6,
          x: px,
          y: py,
          facing: Math.PI,
          homeX: px, homeY: py, patrolX: px, patrolY: py,
          trenchHold: false,
          hp: def.hp,
          maxHp: def.hp,
          speed: def.speed,
          range: def.range,
          vision: def.vision,
          dmg: def.dmg,
          fireInterval: def.fireInterval,
          spread: def.spread,
          bulletSpeed: def.bulletSpeed,
          isStatic,
          vehicle: !!def.vehicle,
          counterAttack: false,
          aggressive: false,
          orders: [],
          attackId: null,
          targetId: null,
          cooldown: rng() * 1.2,
          suppression: 0,
          pinned: false,
          morale: 100, broken: false, lastHitT: 0,
          abilityCd: 0,
          burst: 0,
          burstTimer: 0,
          burstTarget: null,
          kills: 0,
          alive: true,
          walk: 0,
          damageTaken: 0,
          healed: 0,
          heavyKills: 0,
          officerKills: 0,
          dmgMult: 1,
          healMult: 1,
          chase: [],
          repathT: Math.random(),
          npc: false,
          cover: null,
          coverT: 0,
          stuckT: 0, lastX: px, lastY: py, stuckFails: 0, coverSeekT: Math.random() * 2, coverBanT: 0, coverBanX: 0, coverBanY: 0, coverIdleT: 0, stuckDestX: 0, stuckDestY: 0, stuckDestD: 0, chaseBanT: 0,
        };
    this.units.push(u);
    return u;
  }

  // The first trench line: the westernmost dug trench on the map,
  // read off the trench cover spots the terrain builder laid down.
  // On the vertical-trench maps that is one whole line (every spot
  // on it shares the minimum trench x); on the causeway the
  // trenches run parallel to the road, so the garrison takes the
  // western 600 units of both lines. Spots a unit cannot stand in
  // (a ruin or tree sitting on the trench) are dropped. The road
  // band already cleared any spots on the road.
  private firstTrenchSpots(): Array<{ x: number; y: number }> {
    const trench = this.covers.filter((c) => c.kind === "trench");
    if (!trench.length) return [];
    const minX = Math.min(...trench.map((c) => c.x));
    return trench
      .filter((c) => c.x <= minX + 600)
      .map((c) => ({ x: c.x, y: c.y }))
      .filter((s) => !this.pointBlocked(s.x + 8, s.y));
  }

  private spawnWave(index: number) {
    if (!this.mission) return;
    this.waveIndex = index;
    this.enemyRadioT = 25;
    this.enemyRadioCalled = false;
    const rng = mulberry32(hashStr(this.mission.id + ":wave:" + index));
    // Wave 1 garrisons IN the first trench line, not on open ground
    // near the beach: the mobile men stand in the dug trench (the
    // westernmost one), spread along the whole line. Each man stands
    // 8 units east of the trench floor so the trench sits on the
    // threat side and counts as his cover — a man standing exactly
    // on the spot gets nothing from it, because the directional
    // cover check needs the cover on the threat side. Static guns
    // hold the west positions — and on the beach landing itself the
    // defense sits in three lines: the MG nests at the grassline
    // where the beach meets the grass, the mortars at the shoreline,
    // and the overflow scattered east inland (see the shoreline
    // branch below). Waves 2 and 3 are AGGRESSIVE
    // reinforcements from the east: they charge on spawn instead of
    // camping and defending, so the fight comes to the player.
    const beach = index === 0;
    const shoreline = beach && this.mission.terrain === "dday" && this.variant !== "airborne";
    // Josh's beach layout: the first 6 MG42 nests sit at the
    // grassline, the first 2 mortars at the top of the beach;
    // any more than that scatter east inland as guns in depth.
    // Each line spreads in its own bands along the whole beach.
    const GRASS_MG42 = 6;
    const SHORE_MORTAR = 2;
    let grassStaticTotal = 0;
    let shoreStaticTotal = 0;
    if (shoreline) {
      let mg = 0;
      let mo = 0;
      for (const s of this.waves[index]) {
        if (!ENEMY_TYPES[s.type].static) continue;
        for (let i = 0; i < s.count; i++) {
          if (s.type === "mg42") {
            mg++;
            if (mg <= GRASS_MG42) grassStaticTotal++;
          } else if (s.type === "mortar") {
            mo++;
            if (mo <= SHORE_MORTAR) shoreStaticTotal++;
          } else {
            shoreStaticTotal++;
          }
        }
      }
    }
    let mgSeen = 0;
    let mortarSeen = 0;
    let grassCount = 0;
    let shoreCount = 0;
    const trenchSpots = beach ? this.firstTrenchSpots() : [];
    const mobileTotal = this.waves[index].reduce(
      (n, s) => n + (ENEMY_TYPES[s.type].static ? 0 : s.count),
      0,
    );
    const staticTotal = this.waves[index].reduce(
      (n, s) => n + (ENEMY_TYPES[s.type].static ? s.count : 0),
      0,
    );
    // Airborne is an ambush mission (Josh, 2026-11-12): no MG42
    // nests and no mortars in any wave. Wave 1 is the convoy and
    // its escort on the road; waves 2 and 3 are the reaction
    // force. The beach landing keeps every gun.
    let mobileCount = 0;
    let trenchCount = 0;
    let staticCount = 0;
    for (const spec of this.waves[index]) {
      const def = ENEMY_TYPES[spec.type];
      if (this.variant === "airborne" && (spec.type === "mg42" || spec.type === "mortar")) continue;
      for (let i = 0; i < spec.count; i++) {
        const isStatic = !!def.static;
        let x: number;
        let y: number;
        let trench = false;
        let convoy = false;
        if (isStatic) {
          let zone: "grass" | "shore" | "east" | null = null;
          if (shoreline) {
            if (spec.type === "mg42") {
              mgSeen++;
              zone = mgSeen > GRASS_MG42 ? "east" : "grass";
            } else if (spec.type === "mortar") {
              mortarSeen++;
              zone = mortarSeen > SHORE_MORTAR ? "east" : "shore";
            } else {
              zone = "shore";
            }
          }
          if (zone === "east") {
            // Scattered east inland: no line and no bands, just
            // guns in depth behind the beach defense.
            x = 1700 + rng() * 1500;
            y = 120 + rng() * (MAP_H - 240);
          } else if (zone === "grass") {
            // The grassline: the foot of the dune-grass ridge at
            // x 1000, where the sand and the shingle give way to
            // grass. The nests sit just west of the ridge with a
            // clear field of fire over the whole beach, spread in
            // bands along the line.
            x = 880 + rng() * 140;
            y =
              grassStaticTotal > 1
                ? 90 + ((grassCount + rng() * 0.7) * (MAP_H - 180)) / grassStaticTotal
                : MAP_H * (0.2 + rng() * 0.6);
            grassCount++;
          } else if (zone === "shore") {
            // Just behind the grassline: the mortars sit east of
            // the MG nests, around the pillbox line, and shell
            // over the ridge — indirect fire needs no line of
            // sight. They were first placed mid-sand at x 350-650
            // and in play they were invisible: a headless check
            // (2026-11-12, Josh's "I did not see mortar on the
            // beach") had both dead at 4 and 6 seconds, each
            // having fired one shell — the landing force is in
            // rifle range of mid-sand almost at once and focuses
            // the nearest enemy. A second try at the top of the
            // beach (x 690-830) only bought 9-10 seconds. Behind
            // the grassline they live until the line breaks, and
            // the whole sand fight (x 350+) is inside their 620
            // range.
            x = 960 + rng() * 160;
            y =
              shoreStaticTotal > 1
                ? 90 + ((shoreCount + rng() * 0.7) * (MAP_H - 180)) / shoreStaticTotal
                : MAP_H * (0.2 + rng() * 0.6);
            shoreCount++;
          } else {
            x = beach ? 700 + rng() * 300 : MAP_W * (0.6 + rng() * 0.25);
            // Wave 1 is the prepared defense: spread the static
            // nests along the line in bands, one nest per band, so
            // the MGs cover the whole defense instead of bunching at
            // one y. Waves 2 and 3 are reinforcements, so they keep
            // the old random y.
            y =
              beach && staticTotal > 1
                ? 90 + ((staticCount + rng() * 0.7) * (MAP_H - 180)) / staticTotal
                : MAP_H * (0.2 + rng() * 0.6);
          }
          staticCount++;
        } else if (this.variant === "airborne" && index === 0) {
          // The convoy's foot troops: a loose column flanking
          // the road in the east, marching with the vehicles
          // until contact (Josh's convoy: 2 tanks, 1 halftrack,
          // 20 foot — the top-up and the vehicles spawn below).
          x = 3380 + (mobileCount % 6) * 64 + rng() * 30;
          y = roadYAt(x) + (mobileCount % 2 === 0 ? -1 : 1) * (30 + (mobileCount % 3) * 18) + (rng() - 0.5) * 14;
          convoy = true;
        } else if (beach && trenchSpots.length) {
          // Spread along the line: man i takes spot i * spots /
          // total, so the garrison covers the whole trench instead
          // of bunching at one end.
          const spot = trenchSpots[Math.floor((trenchCount * trenchSpots.length) / mobileTotal)];
          x = spot.x + 8;
          y = spot.y;
          trench = true;
          trenchCount++;
        } else {
          x = beach ? 350 + rng() * 500 : MAP_W - 40 - rng() * 90;
          // Spread mobile spawns 26 units apart (wrapping down the edge)
          // instead of 8: with more enemies per wave the old spacing stacked
          // them on top of each other and they deadlocked on spawn.
          y = 90 + ((rng() * (MAP_H - 180) + mobileCount * 26) % (MAP_H - 180));
        }
        mobileCount++;
        const u = this.spawnEnemyUnit(spec.type, x, y, rng, trench);
        if (trench) u.trenchHold = true;
        if (convoy) u.convoy = true;
        // Waves 2 and 3 are aggressive: the mobile men charge on
        // spawn instead of camping. Statics stay put (they cannot
        // move), and the wave 1 garrison keeps holding its trench.
        if (index > 0 && !isStatic) u.aggressive = true;
      }
    }
    // The airborne convoy itself (Josh's spec, 2026-11-12,
    // replacing the 3 unarmed trucks): 2 panzers and 1 halftrack
    // on the road with 20 foot troops in the column. The wave's
    // specs bring the first foot (11 on Overlord: 6 volks, the
    // funker, the medic, 3 grenadiers); the column is topped up
    // to 20 here with more volks and grenadiers, then the
    // vehicles take their places — a panzer on point, the
    // halftrack in the middle, a panzer on rear guard. They roll
    // west until first contact, then the foot deploys to fight
    // and the vehicles halt and engage as gun platforms. The
    // wave is not cleared until the whole convoy is destroyed.
    if (this.variant === "airborne" && index === 0) {
      let foot = mobileCount;
      let extra = 0;
      while (foot < 20) {
        const type = extra % 3 === 2 ? "grenadier" : "volks";
        const x = 3380 + (foot % 6) * 64 + rng() * 30;
        const y = roadYAt(x) + (foot % 2 === 0 ? -1 : 1) * (30 + (foot % 3) * 18) + (rng() - 0.5) * 14;
        const u = this.spawnEnemyUnit(type, x, y, rng, false);
        u.convoy = true;
        foot++;
        extra++;
      }
      const point = this.spawnEnemyUnit("panzer", 3340, roadYAt(3340), rng, false);
      point.convoy = true;
      const half = this.spawnEnemyUnit("halftrack", 3580, roadYAt(3580), rng, false);
      half.convoy = true;
      const rear = this.spawnEnemyUnit("panzer", 3820, roadYAt(3820), rng, false);
      rear.convoy = true;
    }
    if (index > 0) this.pushLog(`Reinforcements — wave ${index + 1} coming through the trees!`, "wave");
    this.dirty = true;
  }

  // ---------------- simulation ----------------

  private unitById(id: number | null): Unit | null {
    if (id === null) return null;
    return this.units.find((u) => u.id === id) ?? null;
  }

  private alliesAlive(): number {
    return this.units.filter((u) => u.side === "allies" && u.alive && !u.npc).length;
  }

  private enemiesAlive(): number {
    return this.units.filter((u) => u.side === "axis" && u.alive).length;
  }

  private stepParticles(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  /** Advance the intro sequences. Boats: approach at 70/s to
   * the shoreline, ramp down (0.6s), then a man every 0.22s out
   * of the bow, wading to his landing spot. Drop: nothing moves
   * but the clock — a man is down when his dropStart + dropDur
   * passes. Either way the intro ends into normal battle, with
   * a 12s hard cap so a stuck walker can never soft-lock it. */
  private advanceIntro(dt: number) {
    this.introT += dt;
    // Spray, wake foam and landing dust live on the particle
    // system, which the main update does not reach while the
    // intro gate holds — step it here so effects move.
    this.stepParticles(dt);
    if (this.introKind === "boats") {
      let done = true;
      for (const b of this.boats) {
        if (b.x < 200) {
          b.x = Math.min(200, b.x + 70 * dt);
          // Wake foam churned up at the stern while she moves.
          b.wakeT += dt;
          while (b.wakeT >= 0.07) {
            b.wakeT -= 0.07;
            const side = this.particles.length % 2 === 0 ? -1 : 1;
            this.particles.push({
              x: b.x - 46, y: b.y + side * (8 + (this.particles.length % 5)),
              vx: -26 - (this.particles.length % 3) * 7, vy: side * 6,
              life: 0.55, max: 0.55, size: 2.6, kind: "foam",
            });
          }
          if (b.x >= 200) {
            // The bow grounds: a burst of spray at the ramp.
            for (let k = 0; k < 9; k++) {
              this.particles.push({
                x: b.x + 46 + (k % 3) * 3, y: b.y - 12 + k * 3,
                vx: 14 + (k % 4) * 6, vy: (k - 4) * 5,
                life: 0.5, max: 0.5, size: 2.8, kind: "foam",
              });
            }
          }
          done = false;
          continue;
        }
        b.timer += dt;
        if (b.timer > 0.6 && b.out < b.men.length) {
          b.releaseT += dt;
          while (b.releaseT >= 0.22 && b.out < b.men.length) {
            b.releaseT -= 0.22;
            const man = b.men[b.out];
            b.out++;
            man.embarked = false;
            man.x = b.x + 54;
            man.y = b.y + ((b.out % 3) - 1) * 9;
          }
        }
        if (b.out < b.men.length) done = false;
      }
      // Men ashore wade to their landing spots, kicking up spray
      // in the surf and dust once they are on the sand.
      for (const u of this.units) {
        if (u.side !== "allies" || u.embarked || u.landX === undefined) continue;
        if (dist(u.x, u.y, u.landX, u.landY ?? u.y) > 8) {
          this.moveToward(u, u.landX, u.landY ?? u.y, dt, 1.15);
          if ((u.id + Math.floor(this.introT * 12)) % 3 === 0) {
            this.particles.push({
              x: u.x - 2, y: u.y + 7,
              vx: -8, vy: 4,
              life: 0.32, max: 0.32, size: 2.2,
              kind: u.x < 262 ? "foam" : "dust",
            });
          }
          done = false;
        }
      }
      if (done || this.introT >= 12) {
        for (const u of this.units) {
          if (u.embarked) {
            u.embarked = false;
            u.x = u.landX ?? u.x;
            u.y = u.landY ?? u.y;
          }
        }
        this.introT = -1;
      }
    } else if (this.introKind === "drop") {
      // Boots on the ground: a puff of dust the moment each man
      // lands, exactly once.
      for (const u of this.units) {
        if (u.side !== "allies" || u.dropStart === undefined || u.landed) continue;
        if (this.introT >= u.dropStart + (u.dropDur ?? 1.3)) {
          u.landed = true;
          for (let k = 0; k < 5; k++) {
            this.particles.push({
              x: u.x + (k - 2) * 3, y: u.y + 7,
              vx: (k - 2) * 9, vy: 3 + (k % 2) * 3,
              life: 0.5, max: 0.5, size: 2.8, kind: "dust",
            });
          }
        }
      }
      if (this.introT >= this.dropEnd + 0.1 || this.introT >= 12) this.introT = -1;
    }
  }

  private update(dt: number) {
    if (this.phase !== "battle" || this.paused) return;
    // Full map is a paused look only (Josh, 2026-11-12): the
    // Esc menu opens it while the battle is paused, and the
    // moment the battle runs again the view snaps back to the
    // locked leader view. The one exception is a retreat in
    // progress: its full map is live and stays until the battle
    // files (setFitMap itself refuses the off switch there).
    if (this.fitWholeMap) this.setFitMap(false);
    // The intro runs first and alone: enemies frozen, no combat,
    // no replay frames — the battle starts when it ends.
    if (this.introT >= 0) {
      this.advanceIntro(dt);
      this.lockCamera();
      this.dirty = true;
      return;
    }
    this.elapsed += dt;
    this.replayT += dt;
    if (this.replayT >= 0.5) {
      this.replayT = 0;
      this.recordReplayFrame();
    }

    // Wave / win logic. Frozen during a fall back: the squad
    // is leaving, so clearing the field wins nothing and no
    // fresh wave pours in behind them.
    if (this.enemiesAlive() === 0 && !this.retreating) {
      if (this.waveIndex < this.waves.length - 1) {
        if (this.nextWaveT === 0) {
          this.nextWaveT = 4;
          this.pushLog("Enemy reinforcements inbound from the east.", "wave");
        }
        this.nextWaveT -= dt;
        if (this.nextWaveT <= 0) {
          this.nextWaveT = 0;
          this.spawnWaveAllies(2);
          this.spawnWave(this.waveIndex + 1);
        }
      } else if (this.battleState === "active") {
        this.battleState = "victory";
        this.phase = "over";
        this.pushLog("Area secured. VICTORY.", "win");
        this.dirty = true;
      }
    }
    // The withdrawal: a squad man who reaches the west edge is
    // out. When every roster man is out, dead, or deserted,
    // the battle files as a defeat — the same filing a wipe
    // takes, so kill RP is paid on the kills already made.
    if (this.retreating && this.battleState === "active") {
      for (const u of this.units) {
        if (u.side === "allies" && !u.npc && !u.vehicle && u.alive && u.x <= 46) this.extract(u);
      }
      const roster = this.units.filter((u) => u.side === "allies" && !u.npc && !u.vehicle);
      if (roster.length > 0 && roster.every((u) => u.extracted || !u.alive)) {
        this.battleState = "defeat";
        this.phase = "over";
        const out = roster.filter((u) => u.extracted).length;
        this.pushLog(`The squad is out — ${out} of ${roster.length} made it. Mission failed, but they live.`, "lose");
        this.dirty = true;
      }
    }

    // Enemy radio call-in: 25s into the wave, the Funker gets one
    // call-in of 2 more men — but only if he is still alive. Kill
    // him first and the wave gets no reinforcements.
    if (
      this.battleState === "active" &&
      this.enemiesAlive() > 0 &&
      !this.enemyRadioCalled &&
      this.enemyRadioT > 0
    ) {
      this.enemyRadioT -= dt;
      if (this.enemyRadioT <= 0) {
        this.enemyRadioCalled = true;
        if (this.enemyRadioLive()) this.spawnEnemyCallIn();
      }
    }
    // Random counter-attack: at a random 45-90s mark, 2 enemy men
    // charge the player's squad from the east edge, ignoring the
    // camp-and-defend rule. At most 2 per battle, so it stays a
    // surprise push and not a second wave.
    if (this.battleState === "active" && this.enemiesAlive() > 0 && this.counterAttacks < this.COUNTER_ATTACK_MAX) {
      this.counterAttackT -= dt;
      if (this.counterAttackT <= 0) {
        this.counterAttacks++;
        this.counterAttackT = 45 + Math.random() * 45;
        this.spawnCounterAttack();
      }
    }
    // Retreat flankers: a few seconds into a fall back, enemy
    // groups arrive off the north and south edges to cut the
    // squad off (Josh, 2026-11-12). Once, and only while the
    // battle is still being filed.
    if (
      this.retreating && !this.flankersSpawned && this.flankersAt > 0 &&
      this.elapsed >= this.flankersAt && this.phase === "battle"
    ) {
      this.flankersSpawned = true;
      this.spawnFlankers();
    }
    // Airborne convoy contact: the march ends the moment the
    // convoy sees the paratroopers, comes under fire, or the
    // paratroopers get close enough for a brush contact.
    if (!this.convoyContact && this.variant === "airborne") {
      for (const u of this.units) {
        if (!u.convoy || !u.alive) continue;
        if (u.hp < u.maxHp) {
          this.convoyContact = true;
          break;
        }
        const prey = this.nearestAlly(u);
        if (prey) {
          const pd = dist(u.x, u.y, prey.x, prey.y);
          if (pd <= 150 || (pd <= u.vision && this.los(u, prey))) {
            this.convoyContact = true;
            break;
          }
        }
      }
      if (this.convoyContact) {
        this.pushLog("Contact! The convoy halts and its escort deploys.", "wave");
        this.unloadHalftrack();
      }
    }
    // Radio support cooldowns tick down while the battle runs.
    this.artyCd = Math.max(0, this.artyCd - dt);
    this.supplyCd = Math.max(0, this.supplyCd - dt);
    this.reconCd = Math.max(0, this.reconCd - dt);
    this.mortarCd = Math.max(0, this.mortarCd - dt);
    this.smokeCd = Math.max(0, this.smokeCd - dt);
    for (let i = this.smokeZones.length - 1; i >= 0; i--) {
      this.smokeZones[i].t -= dt;
      if (this.smokeZones[i].t <= 0) this.smokeZones.splice(i, 1);
    }
    if (this.alliesAlive() === 0 && this.battleState === "active") {
      this.battleState = "defeat";
      this.phase = "over";
      this.pushLog("Squad wiped out. The line is silent.", "lose");
      this.dirty = true;
    }

    // Stalemate breaker (bug #2): "combat" is any HP change or any
    // death on either side. Healing also resets the clock, but only
    // while it is actually happening — a medic cannot heal forever,
    // and once HP stabilises the clock runs. After 60s with no combat,
    // unit with no orders to hunt its nearest enemy (statics are
    // targets, never movers). Re-issue every 5s while the stalemate
    // lasts, so the hunt tracks a moving prey; any HP loss or death
    // ends the episode and resets the clock.
    const hpTotal = this.units.reduce((t, u) => t + (u.alive ? u.hp : 0), 0);
    const aliveTotal = this.units.reduce((t, u) => t + (u.alive ? 1 : 0), 0);
    if (hpTotal !== this.stalemateHp || aliveTotal !== this.stalemateAlive) {
      this.stalemateHp = hpTotal;
      this.stalemateAlive = aliveTotal;
      this.stalemateT = 0;
      this.stalemateActive = false;
    } else {
      this.stalemateT += dt;
      if (this.stalemateT >= 60) {
        if (!this.stalemateActive) {
          this.pushLog("Stalemate — both sides advance on the last enemy.", "wave");
          this.stalemateActive = true;
        }
        // Re-hunt every 5s: the first trigger sets the clock to 55,
        // so this branch runs again 5s later while combat is still
        // absent, and re-paths idle units to a prey that may have moved.
        this.stalemateT = 55;
        for (const u of this.units) {
          // Hunt overrides cover-seek and chase orders: a unit busy
          // walking to a sandbag at the trigger instant would
          // otherwise miss the hunt entirely, and its squadmates
          // dying one by one would keep resetting the clock while it
          // sat in cover forever. A player's attack order (attackId)
          // is deliberate focus fire and is never overridden.
          if (!u.alive || u.isStatic || u.attackId !== null) continue;
          const prey = this.nearestAlly(u);
          if (!prey) continue;
          u.orders = findPath(this.blocked, u.x, u.y, prey.x, prey.y);
          u.chase = [];
          u.coverSeekT = 8;
        }
      }
    }

    // Abilities on their own judgment: once a second, each
    // follower and NPC ally uses his class ability — medic
    // heals, sniper / AT pick a target, rifleman frags and MG
    // barrages the nearest enemy in range, recon marks. This
    // driver used to run only under the old AUTO mode; when the
    // leader rework retired AUTO as a player mode it took the
    // followers' judgment with it (no button on their cards
    // either). Josh's class spec (2026-11-12) puts abilities on
    // AI logic for followers and NPCs, so the driver runs in
    // every live battle now. The leader's own ability stays on
    // the player's hand (Q / right click / button): both drivers
    // skip him (he is not a follower and not an NPC).
    {
      this.autoAbilityT -= dt;
      if (this.autoAbilityT <= 0) {
        this.autoAbilityT = 1;
        this.autoUseAbilities();
        this.npcUseAbilities();
      }
    }

    // Team leader succession: the leader is dead and the battle
    // is live, the next most experienced man has the squad.
    if (this.phase === "battle" && !this.retreating && this.leaderId !== null && !this.leaderUnit()) {
      const next = this.mostExperienced(this.units.filter((u) => u.side === "allies" && !u.npc && u.soldierId !== null && u.alive));
      if (next) {
        this.leaderId = next.id;
        this.selected = [next.id];
        this.manualShot = null;
        this.pushLog(`${next.name} has the squad now.`, "info");
        this.dirty = true;
      }
    }

    // WASD drives the leader. He moves where the player walks
    // him; his men follow on their own logic. A broken leader
    // runs on morale's rules, not the player's keys. A
    // retreating leader is not driven at all: retreat ends
    // player control (Josh, 2026-11-12).
    if (this.phase === "battle" && !this.autoBattle && !this.paused && !this.retreating) {
      const L = this.leaderUnit();
      if (L && !L.broken && !L.fled) {
        const k = this.keys;
        let dx = (k.has("d") ? 1 : 0) - (k.has("a") ? 1 : 0);
        let dy = (k.has("s") ? 1 : 0) - (k.has("w") ? 1 : 0);
        if (dx === 0 && dy === 0 && this.touchMove) {
          dx = this.touchMove.x;
          dy = this.touchMove.y;
        }
        if (dx !== 0 || dy !== 0) {
          const len = Math.hypot(dx, dy) || 1;
          L.orders = [];
          L.chase = [];
          this.moveToward(L, L.x + (dx / len) * 56, L.y + (dy / len) * 56, dt);
          // The camera does not follow here anymore: it is
          // hard locked to the leader at the end of update().
        }
      }
    }

    // The shoot stick: pushed in a direction, the leader fires
    // that way. An enemy near the aim line (within range and
    // sight) snaps as his target; otherwise he fires toward the
    // aim point. Release stops the fire (setTouchAim clears it).
    if (this.phase === "battle" && !this.autoBattle && !this.paused && !this.retreating && this.touchAimVec) {
      const L = this.leaderUnit();
      if (L && !L.broken && !L.fled) {
        const ang = Math.atan2(this.touchAimVec.y, this.touchAimVec.x);
        L.facing = ang;
        let best: Unit | null = null;
        let bestScore = Infinity;
        for (const e of this.units) {
          if (e.side !== "axis" || !e.alive) continue;
          const d = dist(L.x, L.y, e.x, e.y);
          if (d > L.range) continue;
          let da = Math.atan2(e.y - L.y, e.x - L.x) - ang;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          if (Math.abs(da) > 0.55) continue;
          if (!this.los(L, e)) continue;
          const score = Math.abs(da) * 300 + d;
          if (score < bestScore) { bestScore = score; best = e; }
        }
        if (best) {
          L.attackId = best.id;
          this.touchAimTarget = true;
          this.manualShot = null;
        } else {
          if (this.touchAimTarget) { L.attackId = null; this.touchAimTarget = false; }
          this.manualShot = {
            x: L.x + Math.cos(ang) * L.range * 0.85,
            y: L.y + Math.sin(ang) * L.range * 0.85,
            until: this.elapsed + 0.3,
          };
        }
      }
    }

    // Units.
    for (const u of this.units) {
      if (!u.alive) continue;
      u.suppression = Math.max(0, u.suppression - 9 * dt);
      if (u.suppression >= 55) u.pinned = true;
      else if (u.suppression <= 22) u.pinned = false;
      // Prone (Josh, 2026-11-12): past pinned, under a real
      // weight of fire, a footman drops flat and stays down
      // until the fire slackens. Vehicles and gun nests have
      // no belly to drop onto.
      if (!u.vehicle && !u.isStatic) {
        if (u.suppression >= 70) u.prone = true;
        else if (u.suppression < 30) u.prone = false;
      }
      u.abilityCd = Math.max(0, u.abilityCd - dt);

      // Morale: pinned men lose nerve fast, heavy suppression wears
      // it down. Out of fire for 5s it comes back, faster beside a
      // medic or a leader. Break at 20, rally at 45.
      if (u.pinned) this.moraleLoss(u, 2.5 * dt);
      else if (u.suppression >= 40) this.moraleLoss(u, 1.5 * dt);
      if (this.elapsed - u.lastHitT > 5 && u.suppression < 20) {
        // A fleeing man's nerve does not come back on its own:
        // only a medic or a leader nearby steadies him. A coward
        // who rolled "stay" falls back like a normal man.
        let rec = u.willFlee && u.broken ? 0 : 4;
        if (this.nearMedic(u)) rec += 4;
        if (this.nearLeader(u)) rec += 3;
        u.morale += rec * dt;
      }
      u.morale = Math.max(0, Math.min(100, u.morale));
      if (!u.broken && u.morale <= (u.coward ? 50 : 20)) {
        u.broken = true;
        // The flee is a roll, not a guarantee: any man who breaks
        // rolls a low chance to run for the edge, otherwise he falls
        // back like any other man. Cowards roll the bigger chance.
        // A fresh roll every break. NPCs never roll.
        u.willFlee = !u.npc && Math.random() < (u.coward ? this.fleeChance : this.fleeChanceNormal);
        this.pushLog(
          u.side === "allies"
            ? u.willFlee
              ? `${u.name} breaks and runs for the edge!`
              : `${u.name} breaks and falls back!`
            : u.willFlee
              ? `An enemy ${ENEMY_TYPES[u.enemyType!].label} breaks and runs!`
              : `An enemy ${ENEMY_TYPES[u.enemyType!].label} breaks and falls back!`,
          "death",
        );
      } else if (u.broken && u.morale >= (u.willFlee ? 65 : 45)) {
        u.broken = false;
        u.willFlee = false;
        u.fleeT = 0;
        this.pushLog(
          u.side === "allies"
            ? `${u.name} rallies and holds the line.`
            : `An enemy ${ENEMY_TYPES[u.enemyType!].label} rallies.`,
          "info",
        );
      }

      let target = this.unitById(u.targetId);
      if (target && !this.los(u, target)) target = null;
      if (!target || !target.alive) {
        target = u.id === this.leaderId && !this.autoBattle ? null : this.autoTarget(u);
        u.targetId = target ? target.id : null;
        // Response time: a fresh target costs a beat to acquire — veterans react faster.
        if (target) u.cooldown = Math.max(u.cooldown, u.reaction);
      }
      const attackOrder = this.unitById(u.attackId);
      if (attackOrder && !attackOrder.alive) {
        u.attackId = null;
      }

      const focus = attackOrder ?? target;
      const d = focus ? dist(u.x, u.y, focus.x, focus.y) : Infinity;

      // Movement decision: queued orders first; axis advance on their own; allies with
      // an attack order close in.
      // A broken man falls back: he runs from the nearest enemy and
      // does not fight until he rallies. Static guns cannot run, so
      // they hold in place and stop shooting.
      // A broken man whose flee roll landed runs for the nearest edge
      // of the map instead. If he reaches it while still broken, he
      // deserts — and if he is one of your troops, the round ends. A
      // rally call steadies him (morale to 65, rallies on the next
      // tick), and so does a medic or a leader nearby: the rally
      // check above clears broken before this runs.
      // Tactical fallback for wounded NPC allies (Josh, 2026-11-12):
      // at 35% health or less a 2nd Platoon man breaks off instead
      // of standing and dying in place — he pulls back west, to a
      // cover spot near the rear when there is one, and holds there
      // until the medic brings him back above 60%, then he rejoins.
      // All NPC allies, every mission. A broken man is morale's
      // business, not this rule's, so the trigger skips him.
      if (u.npc && u.side === "allies" && !u.isStatic && !u.vehicle) {
        if (!u.npcFallback && !u.broken && u.hp <= u.maxHp * NPC_FALLBACK_HP) {
          u.npcFallback = true;
          u.chase = [];
          const destX = Math.max(46, u.x - 300);
          let dx = destX;
          let dy = u.y;
          for (const c of this.bestCovers(u, 480)) {
            if (c.x < u.x - 60 && dist(c.x, c.y, destX, u.y) <= 180) {
              dx = c.x;
              dy = c.y;
              break;
            }
          }
          u.orders = findPath(this.blocked, u.x, u.y, dx, dy);
        } else if (u.npcFallback && u.hp > u.maxHp * NPC_REJOIN_HP) {
          u.npcFallback = false;
        }
      }
      let moving = false;
      if (u.broken && !u.isStatic) {
        if (u.willFlee) {
          const dxEdge = Math.min(u.x, MAP_W - u.x);
          const dyEdge = Math.min(u.y, MAP_H - u.y);
          const tx = dxEdge <= dyEdge ? (u.x < MAP_W / 2 ? 0 : MAP_W) : u.x;
          const ty = dxEdge <= dyEdge ? u.y : (u.y < MAP_H / 2 ? 0 : MAP_H);
          // Panic sprint: 1.5x speed, or he gets shot in the back on
          // the way out and the mechanic never shows up at all.
          moving = this.chaseTo(u, tx, ty, dt, 1.5);
          u.fleeT += dt;
          // He is gone once he is close to the edge (150), not only on
          // the line itself: from mid-map the run is long, and at 30
          // he was shot or rallied on the way out almost every time.
          // And only after 2s of flight, so a man who breaks on the
          // deployment line does not vanish before a rally call can
          // reach him.
          if (u.fleeT >= 2 && (dxEdge <= 150 || dyEdge <= 150)) {
            // Mid-retreat, a squad man bolting for the WEST edge
            // is doing what the fall back order says: he
            // extracts. Any other edge is still desertion.
            if (this.retreating && u.side === "allies" && !u.npc && tx === 0) this.extract(u);
            else this.desert(u);
          }
        } else {
          const foe = this.nearestAlly(u);
          if (foe) {
            const dx = u.x - foe.x;
            const dy = u.y - foe.y;
            const len = Math.hypot(dx, dy) || 1;
            moving = this.chaseTo(u, u.x + (dx / len) * 320, u.y + (dy / len) * 320, dt);
          }
        }
      } else if (this.retreating && u.side === "allies" && !u.npc) {
        // Break and run (Josh, 2026-11-12): retreat ends player
        // control, and every roster man, leader included, runs
        // for the west edge on his own — no formation, no
        // orders, no firing back. Footmen path around blockers
        // with chaseTo; the Sherman rolls west down the road
        // and never halts to trade fire. Pinned and prone
        // slowdowns still apply inside the movement. Reaching
        // x <= 46 extracts him (the update-loop check).
        if (u.vehicle) {
          const tx = Math.max(30, u.x - 160);
          this.moveToward(u, tx, roadYAt(tx), dt);
          moving = true;
        } else {
          moving = this.chaseTo(u, 24, Math.max(60, Math.min(MAP_H - 60, u.y)), dt);
        }
      } else if (u.orders.length > 0) {
        const o = u.orders[0];
        const od = dist(u.x, u.y, o.x, o.y);
        if (od < 8) u.orders.shift();
        else {
          this.moveToward(u, o.x, o.y, dt);
          moving = true;
        }
      } else if (u.vehicle && u.side === "allies") {
        // The Sherman follows the tank road west to east. It advances
        // along the road's centerline, steering toward the road ahead,
        // and stops to fire when an enemy is in range with line of
        // sight. It never chases off-road: the road is its route, and
        // the road is kept clear of obstacles, so it always has a
        // clear path. At the far east edge it holds and fires.
        const prey = this.nearestAlly(u);
        const inRange = prey && dist(u.x, u.y, prey.x, prey.y) <= this.effRange(u) * 0.9 && this.los(u, prey);
        if (inRange) {
          u.chase = []; // hold and fire from where it stands
        } else if (u.x < MAP_W - 120) {
          // Steer toward the road 120 units ahead, so it follows the
          // road's bends instead of cutting straight across them.
          const tx = Math.min(MAP_W - 60, u.x + 120);
          this.moveToward(u, tx, roadYAt(tx), dt);
          moving = true;
        } else {
          u.chase = []; // at the east edge: hold and fire
        }
      } else if (u.npc && u.npcFallback) {
        // Holding at the rear after a tactical fallback: his orders
        // brought him back, and he does not rejoin the fight until
        // he is healed — the fallback check above clears the flag
        // once he is back above 60% health.
        u.chase = [];
      } else if (u.convoy && (!this.convoyContact || u.vehicle)) {
        // The airborne convoy on the march: trucks and escort roll
        // west along the road at convoy speed, holding the route
        // and moving cautiously, until first contact. After
        // contact the escort leaves this branch for the AI below
        // and fights; the trucks stay here and halt for good.
        if (!this.convoyContact) {
          this.moveToward(u, u.x - 160, roadYAt(u.x - 160), dt, Math.min(1, CONVOY_SPEED / u.speed));
          moving = true;
        }
        u.chase = [];
      } else if ((u.side === "axis" || u.npc || (this.autoBattle && u.side === "allies" && !u.npc) || this.isFollower(u)) && !u.isStatic && u.enemyType !== "mortar") {
        // Auto Battle core: a player squad man with AUTO on fights the
        // same way as an NPC ally — chase the nearest enemy when out of
        // range or without line of sight, else hold and fire, seeking
        // cover in range. Manual squad men still hold until ordered.
        // A medic goes to his wounded first: chase the worst-hurt
        // own man within 400 instead of the prey, so he gets in aura
        // range and patches men up instead of standing in the open
        // trading fire he cannot win. Covers the Axis Sanitaeter, the
        // 2nd Platoon NPC medic, and the player's medic in AUTO.
        const prey = this.isMedic(u)
          ? (this.worstHurtAlly(u, 400) ?? this.nearestAlly(u))
          : this.nearestAlly(u);
        // Followers answer to the leader before the prey: the
        // squad order and the anchor can overrule the chase.
        let skipPrey = false;
        if (!this.autoBattle && this.isFollower(u)) {
          const fm = this.followerMove(u, prey, dt);
          if (fm !== null) {
            skipPrey = true;
            moving = fm;
          }
        }
        // NPC squad men answer to their own squad leader the same
        // way (2nd Platoon squads, 2026-11-12). The squad leader
        // himself gets null back and runs the normal logic.
        if (u.npc && u.npcSquad !== undefined) {
          const nm = this.npcAnchorMove(u, prey, dt);
          if (nm !== null) {
            skipPrey = true;
            moving = nm;
          }
        }
        if (prey && !skipPrey) {
          const pd = dist(u.x, u.y, prey.x, prey.y);
          // Camp and defend: an axis unit holds its ground until it
          // spots a player unit — within vision and with line of
          // sight. Until then it does not advance, so the defense
          // waits for the player instead of charging across the map.
          // A counter-attacker ignores the rule and charges, and so
          // does an aggressive Wave 2 or 3 man. Allies and AUTO squad
          // men are unaffected and still chase. A medic is exempt too:
          // its prey is a wounded man on its own side, not the player,
          // so it moves to heal regardless.
          const isEnemyPrey = prey.side !== u.side;
          const spotted = u.side !== "axis" || u.counterAttack || u.aggressive || !isEnemyPrey || (pd <= u.vision * (isEnemyPrey && this.reconHidden(prey) ? RECON_SPOT_FACTOR : 1) && this.los(u, prey));
          if (!spotted) {
            // Camping, but not frozen: patrol slowly around the
            // garrison home. A static gun or a vehicle never patrols.
            if (u.side === "axis" && !u.isStatic && !u.vehicle) {
              if (dist(u.x, u.y, u.patrolX, u.patrolY) < 24) {
                // A trench garrison man patrols along his trench line:
                // pick another spot on the first line within 150 of
                // home, so he stays dug in instead of wandering off
                // into the open. Anyone else patrols around home.
                let picked = false;
                if (u.trenchHold) {
                  const near = this.firstTrenchSpots().filter(
                    (s) => dist(s.x, s.y, u.homeX, u.homeY) <= 150,
                  );
                  if (near.length) {
                    const pick = near[Math.floor(Math.random() * near.length)];
                    u.patrolX = pick.x + 8;
                    u.patrolY = pick.y;
                    picked = true;
                  }
                }
                if (!picked) {
                  u.patrolX = Math.max(24, Math.min(MAP_W - 24, u.homeX + (Math.random() * 2 - 1) * 150));
                  u.patrolY = Math.max(24, Math.min(MAP_H - 24, u.homeY + (Math.random() * 2 - 1) * 150));
                }
              }
              this.moveToward(u, u.patrolX, u.patrolY, dt, 0.5);
              moving = true;
            } else {
              u.chase = []; // camping: hold position
            }
          } else if (pd > this.effRange(u) * 0.9 || !this.los(u, prey)) {
            moving = this.chaseTo(u, prey.x, prey.y, dt);
          } else {
            // In range with line of sight: the unit stops to fire, so
            // its chase path is stale — clear it. The old code left the
            // leftover waypoints in u.chase, so the unit looked stuck
            // with an order queued while it was just firing in place,
            // and when the prey moved off again it followed a stale
            // path back to where the enemy used to be.
            u.chase = [];
            // In range with line of sight the unit holds and fires
            // from where it stands — it does NOT go looking for
            // cover mid-firefight. The old branch re-issued a cover
            // order every 3s here and ping-ponged units between
            // covers so they never arrived. Cover-seeking now has
            // exactly one trigger, the pinned/idle branch below.
          }
        } else if (!skipPrey) {
          // No prey: hold position, and drop any stale chase path.
          u.chase = [];
        }
        // No prey: NPCs hold position instead of pushing east blind into
        // the next wave. The old push-east made 2nd Platoon meet Wave 1
        // in the middle and clear it alone while the player's squad
        // stood idle at the west edge.
      } else if (u.side === "allies" && attackOrder && u.id !== this.leaderId && (d > this.effRange(u) * 0.92 || !this.los(u, attackOrder))) {
        moving = this.chaseTo(u, attackOrder.x, attackOrder.y, dt);
      } else if (u.side === "allies" && attackOrder && u.id !== this.leaderId) {
        // In range with line of sight: firing, not chasing — clear the
        // stale chase path (same bug as the axis branch above).
        u.chase = [];
      }

      if (!moving && focus) u.facing = Math.atan2(focus.y - u.y, focus.x - u.x);

      // Stuck detection: a unit with a move order that makes almost no
      // progress for a full second is wedged — on a blocker corner, in a
      // head-on deadlock, or chasing an unreachable tile. Re-path to the
      // final destination, sidestep perpendicular to the way it was
      // heading, and after three failed attempts drop the order entirely
      // instead of freezing the unit (and the squad behind it) forever.
      // Units that are standing and firing are not stuck; only units
      // that were told to move are tracked here.
      u.coverSeekT = Math.max(0, u.coverSeekT - dt);
      if (moving && (u.orders.length > 0 || u.chase.length > 0)) {
        u.stuckT += dt;
        if (u.stuckT >= 1) {
          // Orders first; otherwise the last chase waypoint — a unit
          // chasing prey behind a wall wedges on the chase waypoint
          // itself, which the old code only checked by displacement.
          const finalDest = u.orders.length
            ? u.orders[u.orders.length - 1]
            : u.chase.length
              ? u.chase[u.chase.length - 1]
              : null;
          u.stuckT = 0;
          // No progress = not getting closer to the destination, not
          // just standing still. A unit shoved sideways by separation
          // or sliding along a wall can move a few units a second and
          // never get closer; the old displacement-only check reset
          // its fail counter on that sideways movement, so it wedged
          // for 10+ seconds while the detector thought it was fine.
          let noProgress: boolean;
          let madeProgress = false;
          if (finalDest) {
            const fd = dist(u.x, u.y, finalDest.x, finalDest.y);
            if (dist(finalDest.x, finalDest.y, u.stuckDestX, u.stuckDestY) > 24 || u.stuckDestD <= 0) {
              // New destination (a sidestep re-path lands on a different
              // closest-reachable cell): start tracking the distance,
              // but do NOT reset stuckFails — a re-path is not progress,
              // and resetting here let a wedged unit sidestep forever
              // with its fail counter stuck at 0/1, never reaching the
              // 3-fail drop. Only actually getting closer resets it.
              u.stuckDestX = finalDest.x;
              u.stuckDestY = finalDest.y;
              u.stuckDestD = fd;
              noProgress = false;
            } else {
              noProgress = fd >= u.stuckDestD - 5;
              if (!noProgress) {
                u.stuckDestD = fd;
                madeProgress = true;
              }
            }
          } else {
            const moved = dist(u.x, u.y, u.lastX, u.lastY);
            noProgress = moved < 4;
            if (!noProgress) madeProgress = true;
            u.stuckDestD = 0;
          }
          // Displacement this second, measured before lastX/lastY are
          // overwritten: a unit that moved under 1 unit is literally
          // stationary — moveToward could not take a single step.
          const disp = dist(u.x, u.y, u.lastX, u.lastY);
          u.lastX = u.x;
          u.lastY = u.y;
          if (noProgress) {
            u.stuckFails++;
            // A literally stationary unit is wedged, not just slow:
            // count it double, so a unit hugging a cover blocker drops
            // its order in ~3s instead of ~6s (each sidestep re-path
            // grants a grace second, and a wedged unit burned one per
            // sidestep). A pinned unit still moves ~20 units/s and a
            // unit sliding along a wall moves several, so neither is
            // accelerated.
            if (disp < 1) u.stuckFails++;
            // A fail means no progress this second; keep the tracked
            // distance so the next second is judged against the same
            // baseline instead of the (unchanged) current distance.
            u.stuckDestD = dist(u.x, u.y, finalDest ? finalDest.x : u.x, finalDest ? finalDest.y : u.y);
            if (u.orders.length) u.orders.shift();
            if (u.chase.length) u.chase.shift();
            if (u.stuckFails >= 3) {
              // Dropping the order is not enough on its own: the cover
              // block below runs in the same frame, and with no cooldown
              // it would immediately re-order the unit to the same
              // wedged cover spot, so the unit wedged, dropped, and
              // re-wedged forever. Ban that destination for 10s and
              // hold off cover-seeking for 8s so the unit can chase,
              // fire, or be re-ordered instead.
              if (finalDest) {
                u.coverBanX = finalDest.x;
                u.coverBanY = finalDest.y;
                u.coverBanT = this.elapsed + 10;
              }
              u.coverSeekT = 12;
              u.chaseBanT = this.elapsed + 5;
              u.orders = [];
              u.chase = [];
              u.attackId = null;
              u.stuckFails = 0;
              u.stuckDestD = 0;
            } else {
              // Sidestep: a waypoint 70 units off to one side of the
              // direction the unit was heading, on open ground. The
              // next frame the unit follows it as a normal order, then
              // re-paths to its real destination from the new spot.
              const toX = finalDest ? finalDest.x : u.x + Math.cos(u.facing) * 70;
              const toY = finalDest ? finalDest.y : u.y + Math.sin(u.facing) * 70;
              const ang = Math.atan2(toY - u.y, toX - u.x);
              const side = u.stuckFails % 2 === 0 ? 1 : -1;
              let sidestepped = false;
              for (const s of [side, -side]) {
                const sx = u.x + Math.cos(ang + (Math.PI / 2) * s) * 70;
                const sy = u.y + Math.sin(ang + (Math.PI / 2) * s) * 70;
                if (!this.pointBlocked(sx, sy) && this.canStepToward(u, sx, sy)) {
                  u.orders = [{ x: sx, y: sy }, ...(finalDest ? findPath(this.blocked, sx, sy, finalDest.x, finalDest.y) : [])];
                  u.stuckDestD = 0;
                  sidestepped = true;
                  break;
                }
              }
              if (!sidestepped) {
                // No way out sideways and no progress: drop the order
                // now (with the cover ban + cooldown below) instead of
                // sitting against the wall for two more seconds.
                if (finalDest) {
                  u.coverBanX = finalDest.x;
                  u.coverBanY = finalDest.y;
                  u.coverBanT = this.elapsed + 10;
                }
                u.coverSeekT = 12;
                u.chaseBanT = this.elapsed + 5;
                u.orders = [];
                u.chase = [];
                u.attackId = null;
                u.stuckFails = 0;
                u.stuckDestD = 0;
              } else if (finalDest && !u.orders.length) u.orders = findPath(this.blocked, u.x, u.y, finalDest.x, finalDest.y);
            }
          } else if (madeProgress) {
            u.stuckFails = 0;
          }
        }
      } else {
        u.stuckT = 0;
        u.lastX = u.x;
        u.lastY = u.y;
        if (u.orders.length === 0 && u.chase.length === 0) {
          u.stuckFails = 0;
          u.stuckDestD = 0;
        }
      }

      // In cover, no target in range/LOS: an NPC ally or enemy that sits
      // behind a wall with no line of sight for 4s repositions toward
      // its nearest enemy instead of camping there forever. Player
      // squad men are excluded on purpose — they hold where Josh put
      // them until he orders them. A trench garrison man is excluded
      // too: his trench IS his post, and he patrols it until he
      // spots a player unit (camp and defend). Without this, the
      // idle timer ordered him out of the trench after 4s to chase
      // the nearest enemy — the garrison abandoned its own trench
      // before the player ever got there. The chase branch above
      // already moves NPCs/axis when the prey is out of range or has
      // no LOS, but it never runs for a unit whose orders just
      // emptied while it was in cover with a target in range but
      // behind its own cover.
      if (!u.isStatic && !u.vehicle && !u.trenchHold && !u.npcFallback && u.cover && (u.npc || u.side === "axis" || (this.autoBattle && u.side === "allies" && !u.npc)) && u.orders.length === 0 && u.chase.length === 0 && !u.attackId) {
        const prey = this.nearestAlly(u);
        const hasLosTarget = focus && d <= this.effRange(u) && this.los(u, focus);
        if (prey && !hasLosTarget) {
          u.coverIdleT += dt;
          if (u.coverIdleT > 4) {
            u.coverIdleT = 0;
            u.orders = findPath(this.blocked, u.x, u.y, prey.x, prey.y);
            u.coverSeekT = 5;
          }
        } else {
          u.coverIdleT = 0;
        }
      } else {
        u.coverIdleT = 0;
      }

      // Cover — the ONE auto cover-seek rule: when a unit is pinned /
      // under fire, or idle with no order and no target in range, it
      // looks for the nearest cover on the threat side and moves there
      // instead of standing in open ground.
      // Player-controlled men are only pulled out of a live order when
      // pinned — an idle player squad, NPC allies and enemies seek cover
      // freely. Enemies only seek cover when pinned or idle with no prey
      // in sight; when they have a prey they advance or use the existing
      // in-range cover branch above, so they do not just camp.
      // A vehicle never seeks cover: the Sherman follows the road, and
      // a cover order would pull it off the road toward a sandbag.
      // The team leader never seeks cover either in a manual battle:
      // he is the player's own hands, and Josh puts him where he
      // wants him. An idle leader standing in the open used to walk
      // himself up to 280 units to the nearest cover spot, fighting
      // the player's positioning (and dragging the hard locked
      // camera with him). Followers keep their anchored version.
      // In the AUTO test driver there is no player, so the man
      // picked as leader still dives like everyone else.
      const isPlayerLeader = !this.autoBattle && this.leaderId === u.id;
      if (!u.isStatic && !u.cover && u.coverSeekT <= 0 && !u.vehicle && !u.npcFallback && !isPlayerLeader) {
        const underFire = u.pinned || u.suppression >= 35;
        const idle = u.orders.length === 0 && u.chase.length === 0 && !u.attackId && (!focus || d > u.range || !this.los(u, focus));
        const playerOrdered = u.side === "allies" && !u.npc && u.attackId !== null;
        if ((underFire && !playerOrdered) || (idle && u.side !== "axis") || (idle && u.side === "axis" && !this.nearestAlly(u))) {
          // A follower seeks cover at his post, not wherever the
          // hops take him: his slot is usually open ground, so an
          // unrestricted 280 seek every few seconds ratchets him
          // away from the leader. Pinned, he dives like anyone.
          const radius = this.isFollower(u) ? (underFire ? 220 : 90) : underFire ? 220 : 280;
          if (this.seekCover(u, radius)) u.coverSeekT = 5;
          else u.coverSeekT = 2;
        }
      }

      // Officer aura: axis near an officer shoot faster.
      let aura = 1;
      if (u.side === "axis") {
        for (const o of this.units) {
          if (o.side === "axis" && o.alive && o.enemyType === "officer" && dist(u.x, u.y, o.x, o.y) < 170) {
            aura = 0.75;
            break;
          }
        }
      }

      // Fire.
      u.cooldown -= dt;
      if (u.burst > 0 && u.burstTarget) {
        u.burstTimer -= dt;
        while (u.burstTimer <= 0 && u.burst > 0) {
          this.spawnBullet(
            u,
            u.burstTarget.x + (Math.random() - 0.5) * 90,
            u.burstTarget.y + (Math.random() - 0.5) * 90,
            0.35,
            5,
            26
          );
          u.burst--;
          u.burstTimer += 0.06;
        }
      } else if (u.enemyType === "mortar") {
        // Indirect fire: needs no line of sight, lobs a shell near the closest ally in range.
        const prey = this.nearestAlly(u);
        if (u.cooldown <= 0 && prey && dist(u.x, u.y, prey.x, prey.y) <= u.range) {
          u.cooldown = u.fireInterval;
          const tx = prey.x + (Math.random() - 0.5) * 110;
          const ty = prey.y + (Math.random() - 0.5) * 110;
          u.shootT = 0.35;
          this.projectiles.push({
            x: u.x, y: u.y, sx: u.x, sy: u.y, tx, ty, t: 0, dur: 2.4, side: "axis", dmg: u.dmg, aoe: 62,
            kind: "grenade", sourceType: "mortar", killerId: u.id, smokeT: 0,
          });
          // No visual warning any more (Josh, 2026-11-12): the
          // pulsing red circle at the impact point is gone for
          // enemy and radio shells alike. The only warning is the
          // whistle, played about a second before impact.
          this.pushLog("Incoming mortar!", "wave");
        }
      } else if (u.cooldown <= 0 && focus && d <= this.effRange(u) && (!u.pinned || u.cover) && !u.broken && !u.clearing && (!u.prone || (!moving && u.movedT !== this.elapsed)) && this.los(u, focus)) {
        // A pinned man in the open keeps his head down and cannot
        // fire. A pinned man IN COVER still shoots back, at a
        // slower rate: before this, rounds stopped by his cover
        // fed his suppression (0.7x) far faster than it decayed
        // (9/s), so a man in an indestructible 0.95 trench pinned
        // at 55 and never fired again, while 95% of frontal
        // rounds stopped at the wall — the trench locked both
        // ways and read as frozen (Josh's playtest, 2026-11-12).
        // A prone man fires only when he is still: crawling is
        // both hands and belly on the ground, no shooting on
        // the move (Josh, 2026-11-12).
        const interval = u.fireInterval * aura * (u.pinned ? 1.8 : 1) * (u.prone ? 1.4 : 1);
        u.cooldown = interval;
        this.fireAt(u, focus, moving);
      } else if (
        u.id === this.leaderId && !this.autoBattle && u.cooldown <= 0 && this.manualShot &&
        this.elapsed < this.manualShot.until && (!u.pinned || u.cover) && !u.broken && (!u.prone || (!moving && u.movedT !== this.elapsed))
      ) {
        // The player clicked open ground: the leader fires at
        // the point itself while the click is fresh. No target,
        // no auto-acquire; the rounds fly and hit what is there.
        const ms = this.manualShot;
        if (dist(u.x, u.y, ms.x, ms.y) <= u.range) {
          const interval = u.fireInterval * aura * (u.pinned ? 1.8 : 1) * (u.prone ? 1.4 : 1);
          u.cooldown = interval;
          u.facing = Math.atan2(ms.y - u.y, ms.x - u.x);
          this.spawnBullet(u, ms.x, ms.y, u.spread * (u.pinned ? 1.5 : 1), u.dmg * u.dmgMult, u.type === "mg" ? 20 : 14);
        }
      }

      // Medic passive aura — both sides. A medic mends his own
      // wounded men nearby (+3 HP/s) and steadies them (suppression
      // falls). Axis medics get the same aura as the player's medic.
      if (this.isMedic(u)) {
        for (const a of this.units) {
          if (a.side !== u.side || !a.alive || a.id === u.id) continue;
          if (dist(u.x, u.y, a.x, a.y) <= 90) {
            const before = a.hp;
            a.hp = Math.min(a.maxHp, a.hp + 3 * u.healMult * dt);
            u.healed += a.hp - before;
            a.suppression = Math.max(0, a.suppression - 5 * dt);
          }
        }
        // Axis medics and 2nd Platoon NPC medics triage on their
        // own; the player's medic is driven by Q or by AUTO
        // (autoUseAbilities -> castAuto).
        if (u.side === "axis" || u.npc) this.medicTriage(u);
      }

      // Funker rally — the enemy mirror of the radioman's Rally Call.
      if (this.isFunker(u)) this.funkerRally(u);
    }

    // Separation & collision.
    this.resolveCollisions();
    this.disperseNpcs(dt);

    // Bullets.
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const steps = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 10));
      let dead = false;
      for (let s = 0; s < steps && !dead; s++) {
        b.x += (b.vx * dt) / steps;
        b.y += (b.vy * dt) / steps;
        b.life -= dt / steps;
        if (b.life <= 0) {
          this.suppressArea(b.x, b.y, b.side, b.suppress * 0.5);
          dead = true;
          break;
        }
        for (const bl of this.blockers) {
          // A trench is dug in, not built up: rounds fly in and
          // out of it, and the cover roll does the protecting.
          // This sweep originally killed every bullet entering a
          // trench blocker's r 14 circle — a man seated inside
          // (the garrison stands 8 from the spot, inside the
          // circle) could never be hit from either side, and his
          // own rounds toward the enemy died in the wall. That
          // was the trench freeze Josh hit in play (2026-11-12).
          // buildBlockedGrid and resolveCollisions already skip
          // trenches for the same reason; the bullet sweep had
          // been missed.
          if (bl.kind === "trench") continue;
          // Foliage does not stop rounds either: they fly into
          // the green and the concealment roll at the target
          // (inFoliage) does the protecting, like the trench
          // cover roll does for a dug-in man.
          if (bl.kind === "tree" || bl.kind === "bush") continue;
          if (dist(b.x, b.y, bl.x, bl.y) < bl.r) {
            this.puff(b.x, b.y);
            dead = true;
            break;
          }
        }
        if (dead) break;
        for (const u of this.units) {
          if (!u.alive || u.side === b.side) continue;
          // Vehicles are big targets now (a tank's hull is 96
          // long): their hit circle matches the footprint
          // instead of a man's.
          if (dist(b.x, b.y, u.x, u.y) < (u.vehicle ? (u.enemyType === "panzer" || u.type === "tank" ? 21 : 18) : UNIT_R + 2)) {
            // Cover between shooter and target soaks the round — but
            // only cover on the shooter's side of the target, so a
            // flanking shot finds the open side. A stopped round
            // wears the cover down, and suppression still lands
            // (0.7x: sustained fire pins a man behind cover, but a
            // single stopped round does not — full strength pinned
            // whole squads in testing and AUTO lost 3 in a row).
            // Prone (Josh, 2026-11-12): a flat man is a
            // sliver of a target at range — up to 45% of hits
            // thwarted at 250+, fading linearly to none at 60,
            // because up close nobody misses a man on the
            // ground in front of them.
            if (!u.vehicle && u.prone) {
              const shotDist = dist(b.ox, b.oy, u.x, u.y);
              const proneChance = 0.45 * Math.max(0, Math.min(1, (shotDist - 60) / 190));
              if (Math.random() < proneChance) {
                this.puff(b.x, b.y);
                dead = true;
                break;
              }
            }
            // Foliage concealment (Josh, 2026-11-12): a man
            // standing in trees or bushes is a ghost target.
            // The shooters are firing blindly into the green,
            // and the leaves catch about a third of the rounds
            // that would have hit him — on top of the light
            // cover a tree gives through the roll below. Both
            // sides get it: it is the ground, not a perk.
            if (!u.vehicle && this.inFoliage(u) && Math.random() < 0.35) {
              this.particles.push({ x: b.x, y: b.y, vx: -b.vx * 0.1, vy: 6, life: 0.6, max: 0.6, size: 2.6, kind: "leaf" });
              this.particles.push({ x: b.x, y: b.y, vx: b.vx * 0.06, vy: 10, life: 0.7, max: 0.7, size: 2.2, kind: "leaf" });
              dead = true;
              break;
            }
            const c = this.coverBetween(b.ox, b.oy, u.x, u.y);
            if (c && Math.random() < c.q) {
              this.puff(b.x, b.y);
              this.damageCover(c, b.dmg);
              // Heavy cover (a trench, a building, a pillbox:
              // q 0.9+) earns the man behind it real shelter: a
              // stopped round rattles him at half the usual rate,
              // so a dug-in man can recover nerve between bursts
              // instead of pinning forever. Light cover keeps 0.7x.
              u.suppression = Math.min(100, u.suppression + b.suppress * (c.q >= 0.9 ? 0.35 : 0.7));
              dead = true;
              break;
            }
            this.damage(u, b.dmg, b.sourceType, b.killerId);
            this.bloodFx(b.x, b.y, b.vx, b.vy);
            this.suppressArea(b.x, b.y, b.side, b.suppress);
            dead = true;
            break;
          }
        }
      }
      if (dead) this.bullets.splice(i, 1);
    }

    // Projectiles.
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      p.smokeT -= dt;
      // The mortar whistle: about a second before a mortar shell
      // (enemy or radio) lands, once per shell. Sound only — the
      // red warning circles are gone (Josh, 2026-11-12).
      if (!p.whistled && p.sourceType === "mortar" && p.dur - p.t <= 1.0) {
        p.whistled = true;
        whistleSfx();
      }
      if (p.kind === "rocket" && p.smokeT <= 0) {
        p.smokeT = 0.03;
        const px = p.x + (p.tx - p.sx) * (p.t / p.dur);
        const py = p.y + (p.ty - p.sy) * (p.t / p.dur);
        this.particles.push({ x: px, y: py, vx: 0, vy: 0, life: 0.6, max: 0.6, size: 4, kind: "smoke" });
      }
      if (p.t >= p.dur) {
        const x = p.tx;
        const y = p.ty;
        this.explode(x, y, p.aoe, p.dmg, p.side, p.sourceType, p.killerId);
        this.projectiles.splice(i, 1);
      }
    }

    // Engineers and their mines (Josh, 2026-11-12): detection,
    // clearing, and walking to the next revealed mine.
    this.stepEngineers(dt);

    // Beach mines: a landing-force man who steps on one sets it
    // off. Axis men never trigger them — their own field, marked
    // lanes. One detonation per mine, ever.
    if (this.mines.length) {
      for (const m of this.mines) {
        if (!m.armed) continue;
        const stepped = this.units.some((u) => u.side === "allies" && u.alive && !u.vehicle && dist(m.x, m.y, u.x, u.y) <= 11);
        if (stepped) {
          m.armed = false;
          this.explode(m.x, m.y, 34, 55, "axis", "mine", null);
        }
      }
    }

    // Particles.
    this.stepParticles(dt);

    // Fog of war recompute, and the cover a unit is actually
    // behind. Directional: the cover must sit on the threat side of
    // the unit, so a man hugging a wall with the enemy behind him
    // gets nothing from it. One man per spot: light cover shelters
    // 1, heavy cover shelters 2 — a second man crowding the same
    // sandbag is out in the open. Units are processed in order, so
    // the closest man claims the spot first.
    this.fogT += dt;
    if (this.fogT >= 0.12) {
      this.fogT = 0;
      const taken = new Map<Cover, number>();
      for (const u of this.units) {
        if (!u.alive) {
          u.cover = null;
          continue;
        }
        u.cover = null;
        const threat = this.nearestAlly(u);
        if (!threat) continue;
        let best: Cover | null = null;
        for (const c of this.covers) {
          if (dist(u.x, u.y, c.x, c.y) > c.r + UNIT_R + 12) continue;
          if ((c.x - u.x) * (threat.x - u.x) + (c.y - u.y) * (threat.y - u.y) <= 0) continue;
          const cap = c.type === "heavy" ? 2 : 1;
          if ((taken.get(c) ?? 0) >= cap) continue;
          if (!best || c.q > best.q) best = c;
        }
        if (best) {
          u.cover = best;
          taken.set(best, (taken.get(best) ?? 0) + 1);
        }
      }
      this.recomputeFog();
    }

    // Supply crates: a squad man who walks up to one loots it for
    // extra RP. Squad men only — NPC allies and enemies never loot,
    // and a broken (fleeing) man is running, not looting.
    for (const c of this.crates) {
      if (c.looted) continue;
      const looter = this.units.find(
        (u) =>
          u.side === "allies" && !u.npc && u.alive && !u.broken &&
          (u.x - c.x) * (u.x - c.x) + (u.y - c.y) * (u.y - c.y) <= LOOT_RADIUS * LOOT_RADIUS,
      );
      if (looter) {
        c.looted = true;
        this.lootRp += CRATE_RP;
        this.pushLog(`${looter.name} looted a supply crate (+${CRATE_RP} RP).`, "info");
      }
    }

    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 18);
    this.stepDeaths(dt);
    for (const u of this.units) if (u.shootT && u.shootT > 0) u.shootT -= dt;
    // The camera settles last, on wherever the leader ended
    // the tick: hard lock, every tick (Josh, 2026-11-12).
    this.lockCamera();
  }

  private autoTarget(u: Unit): Unit | null {
    const range = this.effRange(u);
    let best: Unit | null = null;
    let bestD = range * 1.05;
    for (const e of this.units) {
      if (e.side === u.side || !e.alive) continue;
      const d = dist(u.x, u.y, e.x, e.y);
      // A hidden Recon is spotted at a fraction of the distance:
      // the searcher's reach against him shrinks, nobody else's.
      const cap = u.side === "axis" && this.reconHidden(e) ? range * RECON_SPOT_FACTOR : range * 1.05;
      if (d < bestD && d <= cap && this.los(u, e)) {
        // AT men pick armor over infantry when both are in reach.
        if (u.type === "at" && best && best.vehicle && !e.vehicle) continue;
        if (u.type === "at" && e.vehicle && best && !best.vehicle) {
          best = e;
          bestD = d;
          continue;
        }
        best = e;
        bestD = d;
      }
    }
    return best;
  }

  private los(a: Unit, b: Unit): boolean {
    // Smoke: a man inside a cloud cannot see out, and a man outside
    // cannot see in. Two men inside the same smoke can still see each
    // other, and two men outside it see normally.
    if (this.inSmoke(a.x, a.y) !== this.inSmoke(b.x, b.y)) return false;
    return lineClear(this.blocked, a.x, a.y, b.x, b.y);
  }

  // Follow an A* path toward a moving point, re-planning every ~1s.
  // Returns false (and clears the chase) while the unit is banned from
  // chasing after a stuck drop — otherwise it would re-chase the same
  // prey behind the same wall in the very next frame.
  private chaseTo(u: Unit, x: number, y: number, dt: number, speedMult = 1): boolean {
    if (this.elapsed < u.chaseBanT) {
      u.chase = [];
      return false;
    }
    u.repathT -= dt;
    if (u.repathT <= 0 || u.chase.length === 0) {
      u.chase = findPath(this.blocked, u.x, u.y, x, y);
      u.repathT = 1 + Math.random() * 0.4;
    }
    const wp = u.chase[0];
    if (!wp) return false;
    if (dist(u.x, u.y, wp.x, wp.y) < 10) u.chase.shift();
    this.moveToward(u, wp.x, wp.y, dt, speedMult);
    return true;
  }

  private nearestAlly(u: Unit): Unit | null {
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const a of this.units) {
      if (a.side === u.side || !a.alive) continue;
      const d = dist(u.x, u.y, a.x, a.y);
      if (d < bestD) {
        best = a;
        bestD = d;
      }
    }
    return best;
  }

  private pointBlocked(x: number, y: number): boolean {
    // Is a unit's body clear at (x, y)? Check the centre and the four
    // points a unit radius out, against the blocked grid.
    const pts: Array<[number, number]> = [
      [x, y],
      [x + UNIT_R, y],
      [x - UNIT_R, y],
      [x, y + UNIT_R],
      [x, y - UNIT_R],
    ];
    for (const [px, py] of pts) {
      const cx = Math.floor(px / CELL);
      const cy = Math.floor(py / CELL);
      if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return true;
      if (this.blocked[cy * COLS + cx]) return true;
    }
    return false;
  }

  // Can this unit take at least one step toward (x, y)? Same three
  // attempts moveToward makes (full step, X-only, Y-only), at 1x, 2x
  // and 4x step length. A unit standing exactly on a blocker's
  // circle-push boundary needs a 2+ unit step just to get its body
  // out of the blocked cell — a single 1.1-unit step in any direction
  // still leaves a radius point inside it, so a 1x-only check says
  // "no way out" for a unit that can walk away in a 4-unit step.
  private canStepToward(u: Unit, x: number, y: number): boolean {
    const d = dist(u.x, u.y, x, y);
    if (d < 1) return true;
    const base = u.speed * (u.pinned ? 0.35 : 1) * (1 / 60);
    for (const mult of [1, 2, 4]) {
      const step = base * mult;
      const dx = ((x - u.x) / d) * step;
      const dy = ((y - u.y) / d) * step;
      if (
        !this.pointBlocked(u.x + dx, u.y + dy) ||
        !this.pointBlocked(u.x + dx, u.y) ||
        !this.pointBlocked(u.x, u.y + dy)
      ) return true;
    }
    return false;
  }

  /** Is this footman standing in trees or bushes right now?
   * The trunk circle plus a step: inside the canopy's shade. */
  private inFoliage(u: Unit): boolean {
    for (const f of this.foliage) {
      if (dist(u.x, u.y, f.x, f.y) < f.r + 4) return true;
    }
    return false;
  }

  /** A man moving through foliage shakes it: the canopy gets
   * a rustle stamp (the draw shakes it while the stamp is
   * fresh) and a couple of leaves shake loose. */
  private rustle(u: Unit) {
    for (const f of this.foliage) {
      if (dist(u.x, u.y, f.x, f.y) >= f.r + 4) continue;
      if (this.elapsed - (f.rustleT ?? -9) < 0.18) continue;
      f.rustleT = this.elapsed;
      this.particles.push({
        x: f.x + (Math.random() - 0.5) * f.r, y: f.y - 2,
        vx: (Math.random() - 0.5) * 14, vy: 8 + Math.random() * 8,
        life: 0.7, max: 0.7, size: 2.6, kind: "leaf",
      });
      this.particles.push({
        x: f.x + (Math.random() - 0.5) * f.r, y: f.y + 3,
        vx: (Math.random() - 0.5) * 10, vy: 12,
        life: 0.6, max: 0.6, size: 2.2, kind: "leaf",
      });
    }
  }

  private moveToward(u: Unit, x: number, y: number, dt: number, speedMult = 1) {
    const d = dist(u.x, u.y, x, y);
    if (d < 1) return;
    const sx = u.x;
    const sy = u.y;
    let sp = u.speed * speedMult * (u.pinned ? 0.35 : 1) * (u.prone ? 0.45 : 1);
    // The beach obstacle belt: picking through the hedgehogs
    // slows the landing force and channels it into the lanes the
    // MGs cover (Josh's suggestion, 2026-11-12). Landing force
    // only — the defenders know their own belt.
    if (u.side === "allies" && !u.vehicle && this.hedgehogs.length) {
      for (const h of this.hedgehogs) {
        if (dist(u.x, u.y, h.x, h.y) < h.r + 26) {
          sp *= 0.55;
          break;
        }
      }
    }
    // Pushing through trees and bushes costs a little speed
    // for any footman, both sides: branches and brush, not a
    // wall. Vehicles do not push through at all (collision
    // still stops them), so they get no factor here.
    if (!u.vehicle && this.foliage.length) {
      for (const f of this.foliage) {
        if (dist(u.x, u.y, f.x, f.y) < f.r + 4) {
          sp *= 0.8;
          break;
        }
      }
    }
    const step = sp * dt;
    const dx = ((x - u.x) / d) * step;
    const dy = ((y - u.y) / d) * step;
    // Slide along obstacles instead of walking straight into them: the
    // old code moved the full diagonal step and let resolveCollisions
    // push the unit back out every frame, so a unit whose waypoint was
    // across a wall or around a corner made no net progress at all.
    // Try the full step, then X-only, then Y-only; if all are blocked,
    // stay put and let the stuck detector re-path or sidestep.
    if (!this.pointBlocked(u.x + dx, u.y + dy)) {
      u.x += dx;
      u.y += dy;
    } else if (!this.pointBlocked(u.x + dx, u.y)) {
      u.x += dx;
    } else if (!this.pointBlocked(u.x, u.y + dy)) {
      u.y += dy;
    } else {
      // Pocket escape: every step toward the waypoint is blocked — the
      // unit is wedged in a cover pocket (e.g. a sandbag stand-point
      // against a wall, where the only exit is not toward the target).
      // Probe the 8 compass directions and take the first steppable
      // one, so the unit can back out the way it came in instead of
      // freezing while the stuck detector drops and the stalemate
      // breaker re-issues the same order forever. Distances run out
      // to 24x the step (~28 units): a unit standing exactly on a
      // blocker's circle-push boundary needs ~23 units just to get its
      // body out of the blocked grid cell (the 5-point body check
      // reaches 9 units out, the cell is 24 wide), so a 4x probe says
      // "no way out" for a unit that can walk away — that is why
      // Kowalski and Pruitt sat in cover at x~382-398 for 70s while
      // the breaker re-ordered them every 5s and the stuck detector
      // dropped the order each time. Directions are tried away from
      // the waypoint first (back out the way it came in) so a long
      // step prefers open ground behind the unit over pushing through
      // the wall in front of it; only the destination is checked, not
      // the segment, because the unit starts inside the blocked
      // region and any segment check would reject the escape itself.
      // Only runs when the direct path is fully blocked, so normal
      // movement is untouched.
      const away = Math.atan2(u.y - y, u.x - x);
      let escaped = false;
      for (const mult of [1, 2, 4, 8, 16, 24]) {
        for (const off of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, (3 * Math.PI) / 4, -(3 * Math.PI) / 4, Math.PI]) {
          const a = away + off;
          const px = u.x + Math.cos(a) * step * mult;
          const py = u.y + Math.sin(a) * step * mult;
          if (!this.pointBlocked(px, py)) {
            u.x = px;
            u.y = py;
            u.facing = a;
            escaped = true;
            break;
          }
        }
        if (escaped) break;
      }
      if (!escaped) return;
    }
    u.facing = Math.atan2(y - u.y, x - u.x);
    u.walk += dt * 10;
    // He actually moved: stamp the tick, and if it was through
    // foliage, shake it.
    if (u.x !== sx || u.y !== sy) {
      u.movedT = this.elapsed;
      if (!u.vehicle) this.rustle(u);
    }
  }

  private resolveCollisions() {
    for (const u of this.units) {
      if (!u.alive || u.isStatic) continue;
      for (const b of this.blockers) {
        if (b.kind === "trench") continue; // a trench is a hole, not a wall: men stand in it
        if ((b.kind === "tree" || b.kind === "bush") && !u.vehicle) continue; // footmen push through foliage; vehicles still cannot
        const d = dist(u.x, u.y, b.x, b.y);
        const min = b.r + UNIT_R;
        if (d < min && d > 0.001) {
          u.x += ((u.x - b.x) / d) * (min - d);
          u.y += ((u.y - b.y) / d) * (min - d);
        }
      }
    }
    for (let i = 0; i < this.units.length; i++) {
      const a = this.units[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.units.length; j++) {
        const b = this.units[j];
        if (!b.alive) continue;
        const d = dist(a.x, a.y, b.x, b.y);
        const min = UNIT_R * 2;
        if (d < min && d > 0.001) {
          const push = (min - d) / 2;
          const nx = (a.x - b.x) / d;
          const ny = (a.y - b.y) / d;
          // Tangential nudge so two units meeting head-on slide past each
          // other instead of shoving straight back into each other's
          // path every frame and deadlocking in a corridor or gap.
          const side = (a.id % 2 === 0 ? 1 : -1) * 0.35;
          const tx = -ny * side;
          const ty = nx * side;
          if (!a.isStatic) {
            a.x += nx * push + tx * push;
            a.y += ny * push + ty * push;
          }
          if (!b.isStatic) {
            b.x -= nx * push + tx * push;
            b.y -= ny * push + ty * push;
          }
        }
      }
    }
    for (const u of this.units) {
      u.x = Math.max(10, Math.min(MAP_W - 10, u.x));
      u.y = Math.max(10, Math.min(MAP_H - 10, u.y));
    }
  }

  /** Josh's spread rule (2026-11-12): no more than 3 NPC allies
   * bundled in one spot. A 2nd Platoon man with 3 or more NPC
   * neighbours within 44 units is in a bundle of 4+, and he steps
   * away from the bundle's centre until it thins to 3. The
   * pairwise separation in resolveCollisions only stops men
   * standing on top of each other; this stops the platoon landing
   * and advancing as one clump and one target. Asked for on the
   * beach landing first, then confirmed for all NPC allies in
   * every mission. A man in cover counts toward a bundle but is
   * never moved himself: dispersion does not pull a man out of
   * his cover, and broken men are left out entirely. */
  private disperseNpcs(dt: number) {
    const R = 44;
    const men = this.units.filter((u) => u.side === "allies" && u.npc && u.alive && !u.broken);
    for (const u of men) {
      if (u.cover) continue;
      // A man in a formed NPC squad holds a formation slot around
      // his leader: the formation IS his spacing (slots sit 30-40
      // apart, inside this radius), so the safety net would fight
      // his anchor every tick. Squad men are exempt as movers;
      // they still count as neighbours for lone NPCs.
      if (u.npcSquad !== undefined) continue;
      let cx = 0;
      let cy = 0;
      let n = 0;
      for (const o of men) {
        if (o === u) continue;
        if (dist(u.x, u.y, o.x, o.y) <= R) {
          cx += o.x;
          cy += o.y;
          n++;
        }
      }
      if (n < 3) continue;
      cx /= n;
      cy /= n;
      let dx = u.x - cx;
      let dy = u.y - cy;
      let d = Math.hypot(dx, dy);
      if (d < 0.001) {
        // Dead centre of the bundle: pick a fixed direction by id
        // so the men do not all pick the same one.
        const ang = (u.id % 8) * (Math.PI / 4);
        dx = Math.cos(ang);
        dy = Math.sin(ang);
        d = 1;
      }
      const step = 46 * dt * (n - 1);
      u.x += (dx / d) * step;
      u.y += (dy / d) * step;
    }
  }

  private fireAt(u: Unit, target: Unit, moving: boolean) {
    const lead = moving ? 1.6 : u.pinned ? 1.5 : 1;
    this.spawnBullet(u, target.x, target.y, u.spread * lead, u.dmg * u.dmgMult, u.type === "mg" ? 20 : 14);
  }

  private spawnBullet(u: Unit, tx: number, ty: number, spread: number, dmg: number, suppress: number) {
    u.shootT = 0.16;
    u.lastShotT = this.elapsed;
    if (u.side === "allies" || this.visible[this.cellAt(u.x, u.y)]) sfx(u.type === "mg" || u.enemyType === "mg42" || u.enemyType === "grenadier" ? "mg" : "shot");
    const ang = Math.atan2(ty - u.y, tx - u.x) + (Math.random() - 0.5) * spread * 2;
    const mx = u.x + Math.cos(u.facing) * 14;
    const my = u.y + Math.sin(u.facing) * 14;
    this.bullets.push({
      ox: u.x,
      oy: u.y,
      x: mx,
      y: my,
      vx: Math.cos(ang) * u.bulletSpeed,
      vy: Math.sin(ang) * u.bulletSpeed,
      side: u.side,
      dmg,
      suppress,
      life: 1.2,
      sourceType: u.side === "allies" ? u.type : u.enemyType!,
      killerId: u.id,
      ally: u.side === "allies",
    });
    // Muzzle flash.
    for (let i = 0; i < 3; i++) {
      this.particles.push({
        x: mx,
        y: my,
        vx: Math.cos(ang) * 60 + (Math.random() - 0.5) * 40,
        vy: Math.sin(ang) * 60 + (Math.random() - 0.5) * 40,
        life: 0.06,
        max: 0.06,
        size: 2.5,
        kind: "muzzle",
      });
    }
  }

  /** Morale loss, doubled for a coward: his nerve goes twice as fast. */
  private moraleLoss(u: Unit, amount: number) {
    if (u.vehicle) return; // a tank has no nerve to lose
    u.morale = Math.max(0, u.morale - amount * (u.coward ? 2 : 1));
  }

  private damage(u: Unit, dmg: number, sourceType: string, killerId: number | null) {
    if (!u.alive) return;
    // A Recon's mark: the squad's fire on a marked man runs
    // heavier, and the first hit on an ambush mark springs it
    // hardest of all, once.
    if (u.markedUntil !== undefined && u.markedUntil > this.elapsed && killerId !== null) {
      const killer = this.unitById(killerId);
      if (killer && killer.side !== u.side) {
        if (u.markedAmbush) {
          dmg *= 1.6;
          u.markedAmbush = false;
        } else {
          dmg *= 1.3;
        }
      }
    }
    u.hp -= dmg;
    // Under fire: every hit shakes nerve, 0.3 morale per HP lost.
    // A rifle hit costs about 4, a sniper round about 12, a
    // panzerfaust about 17. No single hit breaks a fresh man.
    // (Tuned down from 0.4 on 2026-11-11: at 0.4 AUTO won only
    // 5 of 10 — breaks were deciding battles instead of flavouring
    // them. Same for the casualty shock and pinned drain below.)
    this.moraleLoss(u, dmg * 0.3);
    u.lastHitT = this.elapsed;
    if (u.side === "allies") u.damageTaken += Math.min(dmg, u.hp + dmg);
    if (u.hp <= 0) this.kill(u, sourceType, killerId);
  }

  private kill(u: Unit, sourceType: string, killerId: number | null) {
    u.alive = false;
    u.hp = 0;
    u.diedAt = this.elapsed;
    // A vehicle does not fall down like a man: it blows up and
    // stays as a burnt wreck (Josh, 2026-11-12). deathT 99
    // takes it straight out of the dying/corpse path.
    u.deathT = u.vehicle ? 99 : 0;
    if (u.vehicle) {
      this.vehicleBoom(u);
      this.wrecks.push({
        x: u.x,
        y: u.y,
        kind: u.side === "allies" ? "tank" : (u.enemyType ?? "panzer"),
        flip: Math.cos(u.facing) < 0,
        axis: u.side === "axis",
        t0: this.elapsed,
      });
    }
    // Casualty shock: men close by watch a friend die (-8 within
    // 250), the whole side feels it (-2). The shock also holds
    // recovery back for 5s, like being under fire — but only for
    // the men who saw it (within 250). The side-wide clock reset
    // meant that in a hot fight with a death every few seconds,
    // NO man on the side ever got 5 quiet seconds, so morale
    // never recovered at all: broken NPCs fell back and stayed
    // broken at the rear for the whole battle (Josh, 2026-11-12).
    for (const a of this.units) {
      if (!a.alive || a.side !== u.side || a.id === u.id) continue;
      const witnessed = dist(u.x, u.y, a.x, a.y) <= 250;
      this.moraleLoss(a, witnessed ? 8 : 2);
      if (witnessed) a.lastHitT = this.elapsed;
    }
    if (u.side === "allies" && !u.npc && !u.vehicle) sfx("death");
    if (!u.vehicle) this.corpseFx(u);
    if (u.side === "allies" && u.vehicle) {
      this.pushLog("The Sherman is knocked out — burning wreck.", "death");
    } else if (u.side === "allies" && u.npc) {
      this.pushLog(`${u.name} of 2nd Platoon is hit.`, "death");
    } else if (u.side === "allies") {
      this.fallen.push({
        soldierId: u.soldierId!,
        cause: CAUSES[sourceType] ?? "Killed in action",
        kills: u.kills,
        damageTaken: Math.round(u.damageTaken),
        healed: Math.round(u.healed),
        heavyKills: u.heavyKills,
        officerKills: u.officerKills,
      });
      this.selected = this.selected.filter((id) => id !== u.id);
      this.pushLog(`${u.name} is down. He isn't getting up.`, "death");
      if (u.type === "radioman" && !this.radioLive()) {
        this.pushLog("Radio is down — no more calls until you hire another radioman.", "death");
      }
    } else {
      const killer = this.unitById(killerId);
      if (killer && killer.side === "allies") {
        killer.kills++;
        if (u.enemyType === "mg42" || u.enemyType === "flak") killer.heavyKills++;
        if (u.enemyType === "officer") killer.officerKills++;
      }
      this.pushLog(
        u.vehicle ? `${ENEMY_TYPES[u.enemyType!].label} destroyed — burning wreck.` : `${ENEMY_TYPES[u.enemyType!].label} neutralized.`,
        "kill",
      );
      if (u.enemyType === "funk" && !this.enemyRadioLive()) {
        this.pushLog("Enemy radio is down — no more enemy call-ins.", "kill");
      }
    }
    this.dirty = true;
  }

  /** A coward who reaches the edge of the map while still broken
   * deserts: off the field, out of the battle, gone from the roster
   * when the report is filed — but never on the Memorial, he did not
   * die. If he is one of your troops, the round ends right here. */
  private desert(u: Unit) {
    if (!u.alive || u.fled) return;
    u.alive = false;
    u.fled = true;
    this.selected = this.selected.filter((id) => id !== u.id);
    if (u.side === "allies" && !u.npc && u.soldierId) {
      this.deserted.push({
        soldierId: u.soldierId,
        cause: "Broke and ran",
        kills: u.kills,
        damageTaken: Math.round(u.damageTaken),
        healed: Math.round(u.healed),
        heavyKills: u.heavyKills,
        officerKills: u.officerKills,
      });
      this.pushLog(`${u.name} broke and ran off the field. The squad's nerve is gone.`, "death");
      if (this.battleState === "active") {
        this.battleState = "defeat";
        this.phase = "over";
        this.pushLog("Mission failed — a man deserted under fire.", "lose");
      }
    } else {
      this.pushLog(`An enemy ${ENEMY_TYPES[u.enemyType!].label} broke and ran off the field.`, "kill");
    }
    this.dirty = true;
  }

  private suppressArea(x: number, y: number, side: "allies" | "axis", amount: number) {
    for (const u of this.units) {
      if (!u.alive || u.side === side) continue;
      const d = dist(x, y, u.x, u.y);
      if (d < 38) {
        u.suppression = Math.min(100, u.suppression + amount * (1 - d / 48) * (u.cover ? 0.6 : 1));
      }
    }
  }

  private explode(x: number, y: number, aoe: number, dmg: number, side: "allies" | "axis", sourceType: string, killerId: number | null) {
    for (const u of this.units) {
      if (!u.alive || u.side === side) continue;
      const d = dist(x, y, u.x, u.y);
      if (d < aoe) {
        this.damage(u, dmg * (1 - (d / aoe) * 0.6), sourceType, killerId);
        u.suppression = Math.min(100, u.suppression + 40);
      } else if (sourceType === "mortar" && d < aoe + NEAR_MISS_BAND && !u.vehicle) {
        // Near miss from a mortar shell: no wound, but the blast
        // rattles him — suppression up, morale down, and his
        // nerve needs the same quiet spell to recover as if he
        // had been hit. Bunching up under mortars is dangerous
        // even when the shells miss (Josh's suggestion, 2026-11-12).
        u.suppression = Math.min(100, u.suppression + 30);
        u.morale = Math.max(0, u.morale - 6);
        u.lastHitT = this.elapsed;
      }
    }
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 120;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.4,
        max: 0.9,
        size: 2 + Math.random() * 3,
        kind: i < 6 ? "spark" : "smoke",
      });
    }
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0.7, max: 0.7, size: aoe * 0.75, kind: "boom" });
    this.blastCover(x, y, aoe, dmg);
    if (this.tctx) {
      // Pixel crater: dark core with dithered scorch rim.
      const t = this.tctx;
      const r = aoe * 0.45;
      const n = Math.ceil(r / PX);
      for (let j = -n; j <= n; j++) {
        for (let i = -n; i <= n; i++) {
          const d = Math.hypot(i, j * 1.25) * PX;
          if (d > r) continue;
          if (d > r * 0.6 && (i + j) & 1) continue;
          t.fillStyle = d < r * 0.35 ? "rgba(12,11,8,0.7)" : "rgba(24,22,16,0.45)";
          t.fillRect(snap(x) + i * PX, snap(y) + j * PX, PX, PX);
        }
      }
    }
    if (!prefersReducedMotion && this.shakeK > 0) this.shake = Math.min(10 * this.shakeK, this.shake + 6 * this.shakeK);
    sfx("boom");
  }

  // Sandbags and crates soak blast damage, get less protective, then come apart.
  // Directional cover: the cover that actually stands between a
  // shooter and a target. The target must be hugging it, the cover
  // must sit on the target's side (not the shooter's), and the shot's
  // line must pass through the cover's circle. A flanking shooter on
  // the open side gets no cover at all — that is the flank.
  // Returns the best (highest q) cover on the line, or null.
  coverBetween(ox: number, oy: number, tx: number, ty: number): Cover | null {
    let best: Cover | null = null;
    for (const c of this.covers) {
      if (dist(tx, ty, c.x, c.y) > c.r + UNIT_R + 18) continue;
      if (dist(c.x, c.y, tx, ty) >= dist(c.x, c.y, ox, oy)) continue;
      // The cover must actually lie BETWEEN shooter and target:
      // nearer the shooter than the target is. Without this, a
      // man seated just inside his cover's circle (a trench
      // garrison man stands 8 east of the spot, inside its r 14)
      // kept the full 0.95 even against shots from directly
      // behind him — the circle extends a few units past him, so
      // the projection test alone found "cover" on a rear shot.
      // Flank fire now hits a dug-in man normally, exactly like
      // it does a man beside a sandbag (Josh, 2026-11-12).
      if (dist(ox, oy, c.x, c.y) >= dist(ox, oy, tx, ty)) continue;
      const dx = tx - ox;
      const dy = ty - oy;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      let t = ((c.x - ox) * dx + (c.y - oy) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      if (dist(ox + dx * t, oy + dy * t, c.x, c.y) > c.r) continue;
      if (!best || c.q > best.q) best = c;
    }
    return best;
  }

  // A round stopped by cover wears the cover down. Light cover
  // breaks after a few stopped rounds; heavy cover takes far more.
  // Indestructible cover (no hp: buildings, pillboxes) never wears.
  // q falls with hp, so a chewed-up sandbag stops fewer rounds.
  private damageCover(c: Cover, dmg: number) {
    if (c.hp === undefined || c.maxHp === undefined) return;
    c.hp -= dmg;
    if (c.hp <= 0) {
      this.destroyCover(c, "Shot to pieces — the cover is gone.");
      return;
    }
    c.q = (c.q0 ?? c.q) * (0.35 + 0.65 * (c.hp / c.maxHp));
    const t = this.tctx;
    if (t) paintWear(t, c);
  }

  private destroyCover(c: Cover, msg: string) {
    const i = this.covers.indexOf(c);
    if (i < 0) return;
    this.covers.splice(i, 1);
    for (const u of this.units) if (u.cover === c) u.cover = null;
    if (c.blocker) {
      const bi = this.blockers.indexOf(c.blocker);
      if (bi >= 0) this.blockers.splice(bi, 1);
      this.blocked = buildBlockedGrid(this.blockers);
    }
    const t = this.tctx;
    if (t) paintDebris(t, c);
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({ x: c.x, y: c.y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, life: 0.5, max: 0.5, size: 2.5, kind: "dust" });
    }
    if (this.elapsed - this.coverLogT > 4) {
      this.coverLogT = this.elapsed;
      this.pushLog(msg, "info");
    }
  }

  private blastCover(x: number, y: number, aoe: number, dmg: number) {
    let regrid = false;
    let destroyed = 0;
    for (let i = this.covers.length - 1; i >= 0; i--) {
      const c = this.covers[i];
      if (c.hp === undefined || c.maxHp === undefined) continue;
      const d = dist(x, y, c.x, c.y);
      if (d > aoe + c.r) continue;
      c.hp -= dmg * (1 - Math.min(1, d / (aoe + c.r)) * 0.7);
      const t = this.tctx;
      if (c.hp <= 0) {
        this.covers.splice(i, 1);
        destroyed++;
        for (const u of this.units) if (u.cover === c) u.cover = null;
        if (c.blocker) {
          const bi = this.blockers.indexOf(c.blocker);
          if (bi >= 0) this.blockers.splice(bi, 1);
          regrid = true;
        }
        if (t) paintDebris(t, c);
        for (let k = 0; k < 6; k++) {
          const a = Math.random() * Math.PI * 2;
          this.particles.push({ x: c.x, y: c.y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, life: 0.5, max: 0.5, size: 2.5, kind: "dust" });
        }
      } else {
        c.q = (c.q0 ?? c.q) * (0.35 + 0.65 * (c.hp / c.maxHp));
        if (t) paintWear(t, c);
      }
    }
    if (regrid) this.blocked = buildBlockedGrid(this.blockers);
    if (destroyed && this.elapsed - this.coverLogT > 4) {
      this.coverLogT = this.elapsed;
      this.pushLog("Blast tore through the cover — sandbags and crates gone.", "info");
    }
  }

  /** Dev/test probe: destructible cover still standing. */
  debugCover() {
    const d = this.covers.filter((c) => c.hp !== undefined);
    return { count: d.length, hp: Math.round(d.reduce((t, c) => t + (c.hp ?? 0), 0)), sample: d[0] ? { x: d[0].x, y: d[0].y } : null };
  }

  /** Dev/test probe: is the map cell at (x, y) explored? */
  exploredAt(x: number, y: number): boolean {
    return this.explored[this.cellAt(x, y)] === 1;
  }

  /** Dev/test probe: detonate a blast at a map point (no unit damage source). */
  debugBlast(x: number, y: number) {
    this.explode(x, y, 70, 90, "axis", "mortar", null);
  }

  // ---------------- fx helpers ----------------

  private bloodFx(x: number, y: number, vx: number, vy: number) {
    for (let i = 0; i < 5; i++) {
      this.particles.push({
        x, y,
        vx: vx * 0.08 + (Math.random() - 0.5) * 80,
        vy: vy * 0.08 + (Math.random() - 0.5) * 80,
        life: 0.3,
        max: 0.3,
        size: 1.5 + Math.random() * 2,
        kind: "blood",
      });
    }
  }

  private puff(x: number, y: number) {
    for (let i = 0; i < 4; i++) {
      this.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 50,
        vy: (Math.random() - 0.5) * 50,
        life: 0.35,
        max: 0.35,
        size: 2,
        kind: "dust",
      });
    }
  }

  private healFx(x: number, y: number) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.particles.push({
        x: x + Math.cos(a) * 10,
        y: y + Math.sin(a) * 10,
        vx: Math.cos(a) * 18,
        vy: Math.sin(a) * 18,
        life: 0.6,
        max: 0.6,
        size: 2,
        kind: "heal",
      });
    }
  }

  private tracer(x0: number, y0: number, x1: number, y1: number, ally: boolean) {
    this.particles.push({
      x: x0, y: y0, vx: (x1 - x0) * 12, vy: (y1 - y0) * 12,
      life: 0.09, max: 0.09, size: 1, kind: "spark",
    });
    this.bullets.push({
      ox: x0, oy: y0,
      x: x0, y: y0,
      vx: (x1 - x0) / 0.05,
      vy: (y1 - y0) / 0.05,
      side: ally ? "allies" : "axis",
      dmg: 0, suppress: 0, life: 0.05,
      sourceType: "sniper", killerId: null, ally,
    });
  }

  /** A vehicle going up: a fireball particle, sparks, smoke
   * and dust, a kick of screen shake and the boom — then the
   * wreck (drawn from this.wrecks) is what remains. */
  private vehicleBoom(u: Unit) {
    sfx("boom");
    this.shake = Math.min(12, this.shake + 6);
    this.particles.push({ x: u.x, y: u.y, vx: 0, vy: 0, life: 0.7, max: 0.7, size: 30, kind: "boom" });
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      this.particles.push({
        x: u.x, y: u.y,
        vx: Math.cos(a) * (30 + (k % 3) * 14), vy: Math.sin(a) * (30 + (k % 3) * 14),
        life: 0.45, max: 0.45, size: 2.4, kind: "spark",
      });
    }
    for (let k = 0; k < 6; k++) {
      this.particles.push({
        x: u.x + (k - 3) * 5, y: u.y + ((k % 3) - 1) * 5,
        vx: (k - 3) * 4, vy: -12 - (k % 3) * 5,
        life: 1.4, max: 1.4, size: 5, kind: "smoke",
      });
    }
    for (let k = 0; k < 4; k++) {
      this.particles.push({
        x: u.x + (k - 2) * 8, y: u.y + 8,
        vx: (k - 2) * 10, vy: 4,
        life: 0.6, max: 0.6, size: 3.4, kind: "dust",
      });
    }
  }

  private corpseFx(u: Unit) {
    const t = this.tctx;
    if (!t) return;
    // Permanent pixel blood pool soaked into the ground (the body itself is a corpse sprite).
    const bx = snap(u.x + (Math.cos(u.facing) < 0 ? 6 : -6));
    const by = snap(u.y + 6);
    for (let j = -2; j <= 2; j++) {
      for (let i = -4; i <= 4; i++) {
        if (Math.abs(i) / 4.5 + Math.abs(j) / 2.5 > 1 + Math.random() * 0.25) continue;
        t.fillStyle = (i + j) & 1 ? "rgba(86,18,16,0.8)" : "rgba(62,12,12,0.85)";
        t.fillRect(bx + i * PX, by + j * PX, PX, PX);
      }
    }
  }

  // Dying units play out their fall, then become a lasting corpse sprite.
  private stepDeaths(dt: number) {
    for (const u of this.units) {
      if (u.alive || u.deathT === undefined || u.deathT > 1) continue;
      if (u.vehicle) {
        u.deathT = 99; // a wreck, never a corpse
        continue;
      }
      u.deathT += dt;
      if (u.deathT >= 0.75) {
        u.deathT = 99;
        const look = lookOf(u);
        this.corpses.push({
          x: u.x,
          y: u.y,
          axis: u.side === "axis",
          img: sprite(look.pal, "dead", look.weapon, look.head, Math.cos(u.facing) < 0),
        });
      }
    }
  }

  private pushLog(text: string, kind: LogLine["kind"]) {
    this.log.push({ t: this.elapsed, text, kind });
    if (this.log.length > 40) this.log.shift();
    this.dirty = true;
  }

  // ---------------- fog ----------------

  private cellAt(x: number, y: number): number {
    const cx = Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL)));
    const cy = Math.max(0, Math.min(ROWS - 1, Math.floor(y / CELL)));
    return cy * COLS + cx;
  }

  private recomputeFog() {
    this.visible.fill(0);
    for (const u of this.units) {
      if (u.side !== "allies" || !u.alive) continue;
      const r = u.vision;
      const cx = Math.floor(u.x / CELL);
      const cy = Math.floor(u.y / CELL);
      const cr = Math.ceil(r / CELL);
      for (let gy = Math.max(0, cy - cr); gy <= Math.min(ROWS - 1, cy + cr); gy++) {
        for (let gx = Math.max(0, cx - cr); gx <= Math.min(COLS - 1, cx + cr); gx++) {
          const dx = (gx + 0.5) * CELL - u.x;
          const dy = (gy + 0.5) * CELL - u.y;
          if (dx * dx + dy * dy <= r * r) {
            this.visible[gy * COLS + gx] = 1;
            this.explored[gy * COLS + gx] = 1;
          }
        }
      }
    }
    // A Recon's marked man stays lit for the squad while the
    // mark lasts: his cell counts as seen, fog or no fog.
    for (const u of this.units) {
      if (u.side !== "axis" || !u.alive) continue;
      if (u.markedUntil !== undefined && u.markedUntil > this.elapsed) {
        const cell = this.cellAt(u.x, u.y);
        this.visible[cell] = 1;
        this.explored[cell] = 1;
      }
    }
    const f = this.fogCtx;
    if (!f) return;
    f.clearRect(0, 0, COLS, ROWS);
    // Unexplored: near-black. Explored-but-not-visible: dim. Visible: transparent.
    f.fillStyle = "#080A08";
    for (let gy = 0; gy < ROWS; gy++) {
      for (let gx = 0; gx < COLS; gx++) {
        if (!this.explored[gy * COLS + gx]) f.fillRect(gx, gy, 1, 1);
      }
    }
    f.fillStyle = "rgba(18,20,17,0.65)";
    for (let gy = 0; gy < ROWS; gy++) {
      for (let gx = 0; gx < COLS; gx++) {
        const i = gy * COLS + gx;
        if (this.explored[i] && !this.visible[i]) f.fillRect(gx, gy, 1, 1);
      }
    }
  }

  // ---------------- hud ----------------

  private emitHud() {
    if (!this.mission) return;
    const units: HudUnit[] = this.units
      .filter((u) => u.side === "allies" && !u.npc)
      .map((u) => ({
        id: u.id,
        soldierId: u.soldierId,
        name: u.name,
        rank: u.rank,
        level: u.level,
        type: u.type,
        hp: Math.ceil(u.hp),
        maxHp: u.maxHp,
        suppression: Math.round(u.suppression),
        pinned: u.pinned,
        morale: Math.round(u.morale),
        broken: u.broken,
        coward: u.coward,
        abilityCd: u.abilityCd,
        abilityCdMax: UNIT_TYPES[u.type].ability.cd,
        kills: u.kills,
        alive: u.alive,
        diedAt: u.diedAt ?? null,
        orders: u.orders.length,
      }));
    // Squad dock order (Josh, 2026-11-12): the living stay grouped
    // on the left in their normal order; a man who falls moves to
    // the far right, and the fallen collect there in the order
    // they fell. The sort is stable, so the living keep engine
    // order and equal death stamps keep theirs.
    units.sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      if (a.alive) return 0;
      return (a.diedAt ?? 0) - (b.diedAt ?? 0);
    });
    this.onHud({
      elapsed: this.elapsed,
      paused: this.paused,
      briefing: this.phase === "briefing",
      state: this.battleState === "active" && this.phase === "over" ? "defeat" : this.battleState,
      units,
      selectedIds: [...this.selected],
      teamA: this.teamIds(0),
      teamB: this.teamIds(1),
      enemiesAlive: this.enemiesAlive(),
      wave: this.waveIndex + 1,
      waves: this.waves.length,
      aimUnitId: this.aimUnitId,
      log: this.log.slice(-7),
      formation: this.formation,
      touchBox: this.touchBox,
      reinforcementsLeft: MAX_REINFORCEMENTS - this.reinforcements,
      radioLive: this.radioLive(),
      supportCd: {
        artillery: Math.max(0, Math.ceil(this.artyCd - 1e-6)),
        supply: Math.max(0, Math.ceil(this.supplyCd - 1e-6)),
        recon: Math.max(0, Math.ceil(this.reconCd - 1e-6)),
        mortar: Math.max(0, Math.ceil(this.mortarCd - 1e-6)),
        smoke: Math.max(0, Math.ceil(this.smokeCd - 1e-6)),
        tank: 0,
      },
      tankUsed: this.tankCalled,
      supportCost: {
        artillery: this.supportCost("artillery"),
        supply: this.supportCost("supply"),
        recon: this.supportCost("recon"),
        mortar: this.supportCost("mortar"),
        smoke: this.supportCost("smoke"),
        tank: this.supportCost("tank"),
      },
      reinforceCost: {
        rifle: this.reinforceCost("rifle"),
        heavy: this.reinforceCost("heavy"),
      },
      enemyRadioLive: this.enemyRadioLive(),
      autoBattle: this.autoBattle,
      leaderId: this.leaderId,
      squadOrder: this.squadOrder,
      retreating: this.retreating,
    });
  }

  // ---------------- render ----------------

  private loop = (ts: number) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (ts - this.last) / 1000);
    this.last = ts;
    // No free camera in battle (Josh, 2026-11-12): hold pan and
    // key pan only work outside the battle phase, where there
    // is no leader to lock to. In battle the camera is hard
    // locked (see lockCamera in update()).
    if (this.phase !== "battle" && (this.holdPan.x || this.holdPan.y)) {
      this.cam.x += this.holdPan.x * PAN_SPEED * dt;
      this.cam.y += this.holdPan.y * PAN_SPEED * dt;
      this.clampCam();
    }
    if (this.phase !== "battle" && this.keys.size) {
      const k = this.keys;
      const vx = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
      const vy = (k.has("s") || k.has("arrowdown") ? 1 : 0) - (k.has("w") || k.has("arrowup") ? 1 : 0);
      this.cam.x += vx * PAN_SPEED * dt;
      this.cam.y += vy * PAN_SPEED * dt;
      this.clampCam();
    }
    this.update(dt * this.speed);
    this.hudT += dt;
    if (this.hudT >= 0.15 || this.dirty) {
      this.hudT = 0;
      this.dirty = false;
      this.emitHud();
    }
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  private render() {
    const ctx = this.ctx;
    const { s, ox, oy } = this.view;
    const dpr = this.canvas.width / Math.max(1, this.canvas.getBoundingClientRect().width);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#080A08";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const shakeX = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    // Whole-pixel translation keeps every sprite pixel on the screen-pixel grid.
    ctx.setTransform(dpr * s, 0, 0, dpr * s, Math.round(dpr * (ox + shakeX - this.cam.x * s)), Math.round(dpr * (oy + shakeY - this.cam.y * s)));
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.cam.x, this.cam.y, this.viewW, this.viewH);
    ctx.clip();

    if (this.terrain) ctx.drawImage(this.terrain, 0, 0, this.terrain.width * PX, this.terrain.height * PX);

    this.drawCrates(ctx);
    this.drawMines(ctx);
    this.drawBoats(ctx);

    // Fallen bodies stay where they dropped.
    for (const c of this.corpses) {
      if (c.axis && !this.explored[this.cellAt(c.x, c.y)]) continue;
      ctx.drawImage(c.img, snap(c.x) - FEET_X * PX, snap(c.y + 9) - SPR_H * PX, c.img.width * PX, c.img.height * PX);
    }

    // Burnt vehicle wrecks stay where they blew up.
    this.drawWrecks(ctx);

    // Order lines for the selected squad.
    for (const u of this.units) {
      if (u.side !== "allies" || !u.alive || !this.selected.includes(u.id)) continue;
      if (u.orders.length > 0) {
        const o = u.orders[u.orders.length - 1];
        ctx.strokeStyle = "rgba(78,205,196,0.85)";
        ctx.setLineDash([9, 9]);
        ctx.lineWidth = PX;
        ctx.beginPath();
        ctx.moveTo(u.x, u.y);
        for (const wp of u.orders) ctx.lineTo(wp.x, wp.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(78,205,196,0.9)";
        ctx.beginPath();
        ctx.arc(o.x, o.y, 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (u.attackId !== null) {
        const t = this.unitById(u.attackId);
        if (t?.alive) {
          ctx.strokeStyle = "rgba(226,74,74,0.8)";
          ctx.setLineDash([6, 9]);
          ctx.lineWidth = PX;
          ctx.beginPath();
          ctx.moveTo(u.x, u.y);
          ctx.lineTo(t.x, t.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    // Aim mode indicator.
    if (this.aimUnitId !== null) {
      const u = this.unitById(this.aimUnitId);
      if (u) {
        ctx.strokeStyle = "rgba(229,169,60,0.9)";
        ctx.setLineDash([9, 9]);
        ctx.lineWidth = PX;
        ctx.beginPath();
        ctx.arc(u.x, u.y, u.range, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        if (this.mouse.inside) {
          ctx.strokeStyle = "rgba(229,169,60,1)";
          ctx.lineWidth = PX;
          ctx.beginPath();
          ctx.moveTo(this.mouse.x - 10, this.mouse.y);
          ctx.lineTo(this.mouse.x + 10, this.mouse.y);
          ctx.moveTo(this.mouse.x, this.mouse.y - 10);
          ctx.lineTo(this.mouse.x, this.mouse.y + 10);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(this.mouse.x, this.mouse.y, 5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // Smoke zones, under the units so the men inside stay visible.
    this.drawSmoke(ctx);

    // Units (and the dying), back to front so overlapping sprites read correctly.
    const drawList = this.units
      .filter((u) => (u.alive || (u.deathT !== undefined && u.deathT < 1)) && (u.side === "allies" || this.visible[this.cellAt(u.x, u.y)]))
      .sort((a, b) => a.y - b.y);
    for (const u of drawList) this.drawUnit(ctx, u);
    this.drawPlane(ctx);

    // Bullets: a hot pixel with a two-pixel fading trail.
    for (const b of this.bullets) {
      const sp = Math.hypot(b.vx, b.vy) || 1;
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = b.ally
          ? ["#FFF0B0", "rgba(255,217,125,0.75)", "rgba(229,169,60,0.4)"][k]
          : ["#FFD0B0", "rgba(255,122,92,0.75)", "rgba(200,80,60,0.4)"][k];
        ctx.fillRect(snap(b.x - (b.vx / sp) * k * PX * 1.5), snap(b.y - (b.vy / sp) * k * PX * 1.5), PX, PX);
      }
    }

    // Projectiles.
    for (const p of this.projectiles) {
      const k = p.t / p.dur;
      const x = p.x + (p.tx - p.sx) * k;
      const y = p.y + (p.ty - p.sy) * k;
      const arc = p.kind === "grenade" ? Math.sin(Math.PI * k) * (p.dur > 1 ? 60 : 18) : 0;
      // Ground shadow, then the round itself.
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(snap(x) - PX, snap(y), PX * 2, PX);
      ctx.fillStyle = "#121110";
      ctx.fillRect(snap(x) - PX, snap(y - arc) - PX, PX * 2, PX * 2);
      ctx.fillStyle = p.kind === "grenade" ? "#4E4E3C" : "#6A6450";
      ctx.fillRect(snap(x) - PX, snap(y - arc) - PX, PX, PX);
      if (p.kind === "rocket") {
        ctx.fillStyle = Math.random() < 0.5 ? "#FFD97D" : "#F2A03A";
        ctx.fillRect(snap(x - ((p.tx - p.sx) / (Math.hypot(p.tx - p.sx, p.ty - p.sy) || 1)) * 6), snap(y - ((p.ty - p.sy) / (Math.hypot(p.tx - p.sx, p.ty - p.sy) || 1)) * 6), PX, PX);
      }
    }

    // Rustling foliage: while a tree or bush's rustle stamp
    // is fresh, its canopy shakes — a few offset blobs in the
    // tree's own greens over the static drawing, so you can
    // see something is moving in there.
    for (const f of this.foliage) {
      if (f.rustleT === undefined || this.elapsed - f.rustleT > 0.35) continue;
      const j = Math.sin(this.elapsed * 42 + f.x * 0.7) * 2.4;
      const j2 = Math.cos(this.elapsed * 37 + f.y * 0.5) * 2;
      ctx.fillStyle = "rgba(45,82,34,0.85)";
      ctx.fillRect(snap(f.x - f.r + j), snap(f.y - f.r * 0.55 + j2), f.r * 1.15, f.r * 0.72);
      ctx.fillStyle = "rgba(63,106,40,0.8)";
      ctx.fillRect(snap(f.x - f.r * 0.4 - j), snap(f.y - f.r * 0.2 - j2), f.r * 0.9, f.r * 0.6);
      ctx.fillStyle = "rgba(31,58,24,0.85)";
      ctx.fillRect(snap(f.x + j2), snap(f.y + f.r * 0.25 + j), f.r * 0.8, f.r * 0.5);
    }

    // Particles.
    for (const p of this.particles) {
      const a = p.life / p.max;
      switch (p.kind) {
        case "muzzle":
          ctx.fillStyle = `rgba(255,233,160,${a})`;
          break;
        case "blood":
          ctx.fillStyle = `rgba(150,30,30,${a})`;
          break;
        case "dust":
          ctx.fillStyle = `rgba(120,110,90,${a * 0.7})`;
          break;
        case "foam":
          ctx.fillStyle = `rgba(226,238,234,${a * 0.85})`;
          break;
        case "leaf":
          ctx.fillStyle = `rgba(63,106,40,${a})`;
          break;
        case "smoke":
          ctx.fillStyle = `rgba(70,68,60,${a * 0.5})`;
          break;
        case "spark":
          ctx.fillStyle = `rgba(255,200,120,${a})`;
          break;
        case "heal":
          ctx.fillStyle = `rgba(94,184,114,${a})`;
          break;
        case "ring":
          continue;
        case "boom":
          drawBoom(ctx, p.x, p.y, p.size, 1 - a, PX);
          continue;
      }
      const sz = Math.max(PX, snap(p.size * 1.4));
      ctx.fillRect(snap(p.x) - sz / 2, snap(p.y) - sz / 2, sz, sz);
    }

    // Fog of war.
    if (this.fog) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.fog, 0, 0, COLS, ROWS, 0, 0, MAP_W, MAP_H);
      ctx.imageSmoothingEnabled = false;
    }

    // Vignette.
    const vcx = this.cam.x + this.viewW / 2;
    const vcy = this.cam.y + this.viewH / 2;
    const grad = ctx.createRadialGradient(vcx, vcy, this.viewH / 2.6, vcx, vcy, this.viewH / 0.9);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = grad;
    ctx.fillRect(this.cam.x, this.cam.y, this.viewW, this.viewH);

    // Marquee selection box.
    if (this.marquee) {
      const { x0, y0, x1, y1 } = this.marquee;
      ctx.strokeStyle = "rgba(78,205,196,0.95)";
      ctx.lineWidth = PX;
      ctx.setLineDash([9, 6]);
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(78,205,196,0.08)";
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    }
    ctx.restore();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // There are no objective tags and no mortar warnings any more:
    // no red diamonds / labels / off-screen arrows for the SS
    // officer, MG42, mortar or flak, and no pulsing red circle
    // under an incoming shell either (Josh, 2026-11-12: the red
    // indicators come out; a mortar round now lands with only its
    // whistle, about a second before impact, as warning).
  }

  /** Smoke zones: a grey cloud on the ground that blocks line of
   * sight. It fades as it runs out, and it is drawn under the units
   * so the men inside stay visible. */
  private drawSmoke(ctx: CanvasRenderingContext2D) {
    for (const z of this.smokeZones) {
      const x = snap(z.x);
      const y = snap(z.y);
      const alpha = Math.min(0.5, 0.2 + (z.t / SMOKE_DURATION) * 0.3);
      ctx.fillStyle = `rgba(200,200,190,${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, z.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(220,220,210,0.5)";
      ctx.lineWidth = PX;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(x, y, z.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /** The Higgins boats, top-down in the game's own palette:
   * a steel hull, a darker troop well with helmet dots for the
   * men still aboard, the bow ramp up while she runs in and
   * dropped once she grounds, and a foam wake astern while she
   * moves. */
  private drawBoats(ctx: CanvasRenderingContext2D) {
    for (const b of this.boats) {
      const fx = snap(b.x);
      const fy = snap(b.y);
      const grounded = b.x >= 200;
      if (!grounded) {
        // A real wake: two foam arms trailing in a V astern,
        // crawling outward as she runs in, plus the churn right
        // at the stern. Phased by the intro clock so it moves.
        const phase = (this.introT * 30 + b.y) % 9;
        ctx.fillStyle = "rgba(226,238,234,0.5)";
        for (let k = 0; k < 8; k++) {
          const t = k / 8;
          const back = 48 + t * 52 + phase;
          const spread = 8 + t * 30;
          const w = 9 - k;
          ctx.fillRect(fx - back, fy - spread, w, 3);
          ctx.fillRect(fx - back, fy + spread, w, 3);
        }
        ctx.fillStyle = "rgba(226,238,234,0.65)";
        ctx.fillRect(fx - 54 - phase / 2, fy - 10, 8, 4);
        ctx.fillRect(fx - 54 - phase / 2, fy + 6, 8, 4);
      }
      // The hull, properly sized against a man: 96 long, 38 wide.
      ctx.fillStyle = "#1D2226";
      ctx.fillRect(fx - 49, fy - 20, 98, 40);
      ctx.fillStyle = "#3A4148";
      ctx.fillRect(fx - 47, fy - 18, 94, 36);
      ctx.fillStyle = "#454F58";
      ctx.fillRect(fx - 47, fy - 18, 94, 4);
      // The troop well, with helmet dots for the men still aboard.
      ctx.fillStyle = "#23282D";
      ctx.fillRect(fx - 38, fy - 13, 64, 26);
      ctx.fillStyle = "#5C6E3E";
      const aboard = b.men.length - b.out;
      for (let i = 0; i < Math.min(aboard, 8); i++) {
        ctx.fillRect(fx - 32 + (i % 4) * 13, fy - 9 + Math.floor(i / 4) * 12, 8, 8);
      }
      // Coxswain's post and the stern deck.
      ctx.fillStyle = "#4A545E";
      ctx.fillRect(fx - 46, fy - 5, 7, 10);
      ctx.fillStyle = "#31383F";
      ctx.fillRect(fx - 47, fy - 18, 8, 36);
      // The bow ramp, and you can watch it drop: up it is a
      // 4-wide plate edge-on at the bow; over 0.6s it tips
      // forward and flattens onto the sand, growing to its full
      // 26-long footprint on the ground.
      const rampT = grounded ? Math.min(1, b.timer / 0.6) : 0;
      ctx.fillStyle = rampT >= 1 ? "#5A5342" : "#4A545E";
      ctx.fillRect(fx + 45, fy - 15, 4 + 22 * rampT, 30);
      if (rampT > 0 && rampT < 1) {
        ctx.fillStyle = "rgba(226,238,234,0.5)";
        ctx.fillRect(fx + 47 + 22 * rampT, fy - 13, 3, 26);
      }
      ctx.fillStyle = "#2A3036";
      ctx.fillRect(fx + 45, fy - 15, 4 + 22 * rampT, 3);
      ctx.fillRect(fx + 45, fy + 12, 4 + 22 * rampT, 3);
    }
    // Foam rings at the feet of men still wading ashore.
    if (this.introKind === "boats" && this.introT >= 0) {
      ctx.fillStyle = "rgba(226,238,234,0.55)";
      for (const u of this.units) {
        if (u.side !== "allies" || u.embarked || u.landX === undefined || !u.alive) continue;
        if (dist(u.x, u.y, u.landX, u.landY ?? u.y) <= 8) continue;
        const wob = Math.sin(this.introT * 10 + u.id * 1.7) * 2;
        ctx.fillRect(snap(u.x) - 7 + wob, snap(u.y) + 8, 5, 2);
        ctx.fillRect(snap(u.x) + 3 - wob, snap(u.y) + 9, 5, 2);
      }
    }
  }

  /** The C-47 on its drop run: a dark silhouette crossing west
   * to east over the drop zone while the sticks exit. One pass,
   * a soft shadow under her, gone when the last man is down. */
  private drawPlane(ctx: CanvasRenderingContext2D) {
    if (this.introKind !== "drop" || this.introT < 0) return;
    const px = snap(-80 + 314 * this.introT);
    const py = snap(240 + Math.sin(this.introT * 2.6) * 3);
    // Her shadow on the fields below, offset by her altitude.
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.fillRect(px - 78 + 22, py - 10 + 30, 168, 20);
    ctx.fillRect(px - 4 + 22, py - 52 + 30, 20, 104);
    // Wing first, under the fuselage: 118 of span, with the
    // black and white invasion stripes at the rear of it.
    ctx.fillStyle = "#33393B";
    ctx.fillRect(px - 2, py - 59, 20, 118);
    ctx.fillStyle = "#CFC8B0";
    ctx.fillRect(px - 2, py - 59, 7, 118);
    ctx.fillStyle = "#1E2122";
    ctx.fillRect(px - 2, py - 40, 7, 20);
    ctx.fillRect(px - 2, py - 6, 7, 20);
    ctx.fillRect(px - 2, py + 28, 7, 20);
    // Engines on the wing, propellers a blurred disc.
    for (const s of [-1, 1]) {
      ctx.fillStyle = "#2A2F31";
      ctx.fillRect(px - 8, py + s * 32 - 6, 34, 12);
      ctx.fillStyle = "rgba(205,210,205,0.20)";
      ctx.beginPath();
      ctx.arc(px + 24, py + s * 32, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#15181A";
      ctx.fillRect(px + 22, py + s * 32 - 2, 4, 4);
    }
    // Fuselage, 170 long, nose east.
    ctx.fillStyle = "#3A4042";
    ctx.fillRect(px - 85, py - 11, 170, 22);
    ctx.fillStyle = "#4A5152";
    ctx.fillRect(px - 85, py - 11, 170, 5);
    // Invasion stripes around the rear fuselage.
    ctx.fillStyle = "#CFC8B0";
    ctx.fillRect(px - 66, py - 11, 16, 22);
    ctx.fillStyle = "#1E2122";
    ctx.fillRect(px - 61, py - 11, 5, 22);
    ctx.fillRect(px - 53, py - 11, 4, 22);
    // Tailplane and fin.
    ctx.fillStyle = "#33393B";
    ctx.fillRect(px - 85, py - 23, 12, 46);
    ctx.fillStyle = "#2A2F31";
    ctx.fillRect(px - 88, py - 3, 8, 6);
    // Cockpit glass and the open jump door the men pour from.
    ctx.fillStyle = "#6A7A80";
    ctx.fillRect(px + 62, py - 7, 14, 14);
    ctx.fillStyle = "#141617";
    ctx.fillRect(px - 34, py - 4, 12, 8);
  }

  /** Burnt wrecks, in the game's palette gone to charcoal:
   * a scorch mark soaked into the ground, the hull blackened
   * and slumped, the turret askew on a tank, embers that fade
   * over the first seconds and a smoke wisp that thins as the
   * wreck cools. Axis wrecks hide in unexplored fog, like
   * corpses do. */
  private drawWrecks(ctx: CanvasRenderingContext2D) {
    for (const w of this.wrecks) {
      if (w.axis && !this.explored[this.cellAt(w.x, w.y)]) continue;
      const fx = snap(w.x);
      const fy = snap(w.y);
      const age = this.elapsed - w.t0;
      // Scorch, sized to the wreck (the footprints match the
      // live vehicles: tank 96, halftrack 76, truck 68 long).
      const scorchW = w.kind === "halftrack" ? 96 : w.kind === "truck" ? 90 : 118;
      const scorchH = w.kind === "halftrack" ? 46 : w.kind === "truck" ? 42 : 58;
      ctx.fillStyle = "rgba(12,10,8,0.55)";
      ctx.fillRect(fx - scorchW / 2, fy - scorchH / 2, scorchW, scorchH);
      ctx.fillStyle = "rgba(12,10,8,0.35)";
      ctx.fillRect(fx - scorchW / 2 - 7, fy - scorchH / 2 + 6, scorchW + 14, scorchH - 12);
      const char1 = "#1B1B15";
      const char2 = "#26241C";
      const char3 = "#12120D";
      if (w.kind === "halftrack") {
        ctx.fillStyle = char3;
        ctx.fillRect(fx - 38, fy - 15, 76, 7);
        ctx.fillRect(fx - 38, fy + 8, 76, 7);
        ctx.fillStyle = char1;
        ctx.fillRect(fx - 35, fy - 11, 70, 22);
        ctx.fillStyle = char3;
        const bayX = w.flip ? fx - 3 : fx - 32;
        ctx.fillRect(bayX, fy - 8, 29, 16);
        ctx.fillStyle = char2;
        ctx.fillRect(w.flip ? fx - 34 : fx + 22, fy - 10, 13, 20);
      } else if (w.kind === "truck") {
        ctx.fillStyle = char3;
        ctx.fillRect(fx - 34, fy - 13, 68, 6);
        ctx.fillRect(fx - 34, fy + 7, 68, 6);
        ctx.fillStyle = char1;
        ctx.fillRect(w.flip ? fx - 5 : fx - 33, fy - 10, 38, 20);
        ctx.fillStyle = char2;
        for (let r = 0; r < 3; r++) ctx.fillRect((w.flip ? fx - 5 : fx - 33) + 6 + r * 12, fy - 10, 3, 20);
        ctx.fillStyle = char3;
        ctx.fillRect(w.flip ? fx - 29 : fx + 5, fy - 9, 24, 18);
      } else {
        // Panzer or the player's Sherman: same charred shape.
        ctx.fillStyle = char3;
        ctx.fillRect(fx - 48, fy - 20, 96, 10);
        ctx.fillRect(fx - 48, fy + 10, 96, 10);
        ctx.fillStyle = char1;
        ctx.fillRect(fx - 43, fy - 13, 86, 26);
        // Turret knocked askew, hatch blown open, barrel drooped.
        ctx.fillStyle = char2;
        ctx.fillRect(fx - 10, fy - 22, 26, 13);
        ctx.fillStyle = char3;
        ctx.fillRect(fx - 5, fy - 22, 10, 6);
        ctx.fillRect(w.flip ? fx - 42 : fx + 14, fy - 12, 28, 3);
      }
      // Embers in the first seconds, then just heat shimmer smoke.
      if (age < 5) {
        const flick = Math.sin(this.elapsed * 11 + w.x) > -0.2;
        ctx.fillStyle = flick ? "#E2692E" : "#B34A1F";
        ctx.fillRect(fx - 6, fy - 3, 3, 3);
        ctx.fillRect(fx + 5, fy + 2, 2, 2);
        if (flick) {
          ctx.fillStyle = "#E5A93C";
          ctx.fillRect(fx - 1, fy - 6, 2, 2);
        }
      }
      if (age < 22) {
        const rise = (this.elapsed * 7 + w.x) % 12;
        ctx.fillStyle = `rgba(70,68,60,${0.34 * (1 - age / 22)})`;
        ctx.fillRect(fx - 3 - rise / 3, fy - 16 - rise, 6, 4);
        ctx.fillRect(fx + 2 - rise / 2, fy - 22 - rise * 1.4, 5, 3);
      }
    }
  }

  /** Beach mines, drawn as what they are: a small dark disc in
   * the sand with a pressure plate on top. Easy to miss at a
   * glance, which is the point — but they are on the map to be
   * seen by a careful eye, in explored ground only. A detonated
   * mine leaves nothing to draw but the crater. */
  private drawMines(ctx: CanvasRenderingContext2D) {
    for (const m of this.mines) {
      if (!m.armed) continue;
      if (!this.explored[this.cellAt(m.x, m.y)]) continue;
      const x = snap(m.x);
      const y = snap(m.y);
      ctx.fillStyle = "#211F19";
      ctx.beginPath();
      ctx.arc(x, y, 5 * PX, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3B382C";
      ctx.beginPath();
      ctx.arc(x, y, 3 * PX, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#57543F";
      ctx.fillRect(x - PX, y - PX, 2 * PX, 2 * PX);
      // An Engineer's find: red ring and a little marker flag,
      // so the squad can see the danger and route around it (or
      // watch him work it).
      if (m.revealed) {
        ctx.strokeStyle = "#E24A4A";
        ctx.lineWidth = PX;
        ctx.beginPath();
        ctx.arc(x, y, 7 * PX, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#8D9A83";
        ctx.fillRect(x + 5 * PX, y - 10 * PX, PX, 7 * PX);
        ctx.fillStyle = "#E24A4A";
        ctx.fillRect(x + 6 * PX, y - 10 * PX, 4 * PX, 3 * PX);
      }
    }
  }

  /** Supply crates, drawn so they read at a glance: a full crate
   * gets a gold glow, a gold border and the RP it holds written
   * above it; a looted one is a dark, empty, lidless box. Crates in
   * ground nobody has explored yet stay hidden, like corpses do. */
  private drawCrates(ctx: CanvasRenderingContext2D) {
    for (const c of this.crates) {
      if (!this.explored[this.cellAt(c.x, c.y)]) continue;
      const x = snap(c.x);
      const y = snap(c.y);
      ctx.save();
      if (c.looted) {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = "#4A3A22";
        ctx.fillRect(x - 13, y - 11, 26, 22);
        ctx.strokeStyle = "#2A2010";
        ctx.lineWidth = PX;
        ctx.strokeRect(x - 13, y - 11, 26, 22);
      } else {
        ctx.fillStyle = "rgba(229,169,60,0.18)";
        ctx.beginPath();
        ctx.arc(x, y, 26, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#8A6A2E";
        ctx.fillRect(x - 13, y - 11, 26, 22);
        ctx.strokeStyle = "#E5A93C";
        ctx.lineWidth = 2 * PX;
        ctx.strokeRect(x - 13, y - 11, 26, 22);
        ctx.strokeStyle = "#5A4218";
        ctx.lineWidth = PX;
        ctx.beginPath();
        ctx.moveTo(x - 13, y - 11);
        ctx.lineTo(x + 13, y + 11);
        ctx.moveTo(x + 13, y - 11);
        ctx.lineTo(x - 13, y + 11);
        ctx.stroke();
        ctx.fillStyle = "#E5A93C";
        ctx.font = `bold ${11 * PX}px monospace`;
        ctx.textAlign = "center";
        ctx.fillText(`+${CRATE_RP} RP`, x, y - 18);
      }
      ctx.restore();
    }
  }

  private drawUnit(ctx: CanvasRenderingContext2D, u: Unit) {
    // A deserter has left the field: nothing to draw, and no corpse.
    if (u.fled) return;
    // Still inside his Higgins boat: the boat sprite carries him.
    if (u.embarked) return;
    if (this.introKind === "drop" && this.introT >= 0 && u.side === "allies" && u.dropStart !== undefined) {
      if (this.introT < u.dropStart) return; // still inside the C-47
      if (this.introT < u.dropStart + (u.dropDur ?? 1.3)) {
        // Under canopy, with a life to it: the chute snaps open
        // over the first fifth of the fall, he drifts east and
        // sways under it, and he sinks from high over his spot
        // down to the ground, his shadow growing as he comes.
        // Drawn in the game's palette, no imported art.
        const dur = u.dropDur ?? 1.3;
        const fallT = Math.max(0, Math.min(1, (this.introT - u.dropStart) / dur));
        const open = Math.min(1, fallT / 0.2);
        const sway = Math.sin(fallT * 5.2 + u.dropStart * 9) * 5.5 * (1 - fallT * 0.45);
        const sink = 1 - fallT;
        const fx = snap(u.x + sway + fallT * 10);
        const fy = snap(u.y - 54 * sink * sink);
        // His shadow on the ground spot, swelling as he descends.
        ctx.fillStyle = `rgba(0,0,0,${0.10 + 0.18 * fallT})`;
        ctx.fillRect(snap(u.x) - 5 - 5 * fallT, snap(u.y) + 9, 10 + 10 * fallT, 3);
        // The man: helmet, body, legs together for the landing.
        ctx.fillStyle = "#4A5A2E";
        ctx.fillRect(fx - 2, fy - 2, 5, 8);
        ctx.fillStyle = "#3A4526";
        ctx.fillRect(fx - 3, fy - 6, 7, 4);
        ctx.fillStyle = "#2E3620";
        ctx.fillRect(fx - 2, fy + 6, 2, 4);
        ctx.fillRect(fx + 1, fy + 6, 2, 4);
        // Shroud lines fanning from the canopy rim to his shoulders.
        const r = 14 * open;
        ctx.strokeStyle = "rgba(230,225,205,0.85)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(fx - r, fy - 13);
        ctx.lineTo(fx - 1, fy - 3);
        ctx.moveTo(fx + r, fy - 13);
        ctx.lineTo(fx + 2, fy - 3);
        ctx.moveTo(fx, fy - 15);
        ctx.lineTo(fx, fy - 4);
        ctx.stroke();
        // The canopy: a round dome that breathes a little as it
        // settles, with its rim band.
        const breathe = 1 + Math.sin(fallT * 7 + u.dropStart * 5) * 0.04;
        ctx.fillStyle = "#CFC8B0";
        ctx.beginPath();
        ctx.arc(fx, fy - 12, Math.max(2, r * breathe), Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = "#B8B198";
        ctx.fillRect(fx - Math.max(2, r * breathe), fy - 13, Math.max(4, r * breathe * 2), 2);
        return;
      }
    }
    if (u.vehicle && u.enemyType === "truck") {
      // The convoy truck: cab at the front (the way it faces),
      // canvas-covered bed behind, wheels as dark blocks. No
      // turret, no gun — just a target on wheels, with the same
      // health bar the tanks get.
      const fx = snap(u.x);
      const fy = snap(u.y);
      const flip = Math.cos(u.facing) < 0;
      ctx.fillStyle = "#23231C";
      ctx.fillRect(fx - 34, fy - 13, 68, 6);
      ctx.fillRect(fx - 34, fy + 7, 68, 6);
      ctx.fillStyle = "#6E6450";
      const bedX = flip ? fx - 5 : fx - 33;
      ctx.fillRect(bedX, fy - 10, 38, 20);
      ctx.fillStyle = "#5D5342";
      for (let r = 0; r < 3; r++) ctx.fillRect(bedX + 6 + r * 12, fy - 10, 3, 20);
      ctx.fillStyle = "#4C4F45";
      const cabX = flip ? fx - 29 : fx + 5;
      ctx.fillRect(cabX, fy - 9, 24, 18);
      ctx.fillStyle = "#2E3238";
      ctx.fillRect(flip ? cabX + 2 : cabX + 17, fy - 6, 5, 12);
      const w = 54;
      const pct = Math.max(0, u.hp / u.maxHp);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(fx - w / 2, fy - 26, w, 4);
      ctx.fillStyle = pct > 0.5 ? "#5EB872" : pct > 0.25 ? "#E5A93C" : "#E24A4A";
      ctx.fillRect(fx - w / 2, fy - 26, w * pct, 4);
      return;
    }
    if (u.vehicle && u.enemyType === "halftrack") {
      // The Sd.Kfz. 251 halftrack, drawn like the tanks: track
      // bands with road wheels, a sloped nose at the front (the
      // way it faces), the open troop bay behind with bench
      // lines and the crew's helmets, and the mounted MG over
      // the bay's front edge. German gray-green, health bar
      // above like the tanks.
      const fx = snap(u.x);
      const fy = snap(u.y);
      const flip = Math.cos(u.facing) < 0;
      ctx.fillStyle = "#23231C";
      ctx.fillRect(fx - 38, fy - 15, 76, 7);
      ctx.fillRect(fx - 38, fy + 8, 76, 7);
      ctx.fillStyle = "#3B3B30";
      for (let rwx = -32; rwx <= 32; rwx += 11) {
        ctx.fillRect(fx + rwx, fy - 14, 6, 4);
        ctx.fillRect(fx + rwx, fy + 10, 6, 4);
      }
      // Hull.
      ctx.fillStyle = "#4C4F45";
      ctx.fillRect(fx - 35, fy - 11, 70, 22);
      // Sloped nose at the front.
      const noseX = flip ? fx - 35 : fx + 22;
      ctx.fillStyle = "#565A4C";
      ctx.fillRect(noseX, fy - 10, 13, 20);
      ctx.fillStyle = "#2E3238";
      ctx.fillRect(flip ? noseX + 2 : noseX + 8, fy - 7, 3, 14);
      // The open troop bay: darker floor, bench lines, helmets.
      const bayX = flip ? fx - 3 : fx - 32;
      ctx.fillStyle = "#33362E";
      ctx.fillRect(bayX, fy - 8, 29, 16);
      ctx.fillStyle = "#3E4238";
      ctx.fillRect(bayX + 3, fy - 8, 3, 16);
      ctx.fillRect(bayX + 23, fy - 8, 3, 16);
      ctx.fillStyle = "#3A4526";
      ctx.fillRect(bayX + 8, fy - 5, 6, 6);
      ctx.fillRect(bayX + 17, fy + 2, 6, 6);
      // The mounted MG at the bay's front edge.
      const mgX = flip ? fx - 9 : fx + 4;
      ctx.fillStyle = "#1E1E14";
      ctx.fillRect(mgX, fy - 2, 4, 4);
      ctx.fillRect(flip ? mgX - 11 : mgX + 4, fy - 1, 11, 2);
      const w = 58;
      const pct = Math.max(0, u.hp / u.maxHp);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(fx - w / 2, fy - 27, w, 4);
      ctx.fillStyle = pct > 0.5 ? "#5EB872" : pct > 0.25 ? "#E5A93C" : "#E24A4A";
      ctx.fillRect(fx - w / 2, fy - 27, w * pct, 4);
      return;
    }
    if (u.vehicle) {
      // A tank: hull, turret, barrel, tracks — a chunky pixel tank,
      // not a man. No pose and no morale bar, just a health bar above
      // it. Allied olive for the Sherman, German gray for the Panzer,
      // so the two are easy to tell apart at a glance.
      const fx = snap(u.x);
      const fy = snap(u.y);
      const flip = Math.cos(u.facing) < 0;
      const ally = u.side === "allies";
      // Track bands first, then the hull over them: 96 long,
      // twice a man's width on screen, 40 deep.
      ctx.fillStyle = "#1E1E14";
      ctx.fillRect(fx - 48, fy - 20, 96, 10);
      ctx.fillRect(fx - 48, fy + 10, 96, 10);
      ctx.fillStyle = "#2C2C20";
      for (let twx = -44; twx <= 44; twx += 11) {
        ctx.fillRect(fx + twx, fy - 19, 6, 7);
        ctx.fillRect(fx + twx, fy + 12, 6, 7);
      }
      ctx.fillStyle = ally ? "#4A5A2E" : "#565650";
      ctx.fillRect(fx - 43, fy - 13, 86, 26);
      ctx.fillStyle = ally ? "#5A6E3A" : "#6A6A66";
      ctx.fillRect(fx - 14, fy - 11, 28, 16);
      ctx.fillStyle = "#2E2E20";
      ctx.fillRect(flip ? fx - 44 : fx + 14, fy - 9, 30, 5);
      const w = 66;
      const pct = Math.max(0, u.hp / u.maxHp);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(fx - w / 2, fy - 31, w, 5);
      ctx.fillStyle = pct > 0.5 ? "#5EB872" : pct > 0.25 ? "#E5A93C" : "#E24A4A";
      ctx.fillRect(fx - w / 2, fy - 31, w * pct, 5);
      return;
    }
    const isAlly = u.side === "allies";
    const look = lookOf(u);
    const flip = Math.cos(u.facing) < 0;
    const moving = u.alive && u.prevWalk !== undefined && u.walk !== u.prevWalk;
    u.prevWalk = u.walk;

    // Pick the animation frame.
    let pose: Pose;
    if (!u.alive) {
      const t = u.deathT ?? 1;
      pose = t < 0.22 ? "hit" : t < 0.48 ? "kneel" : "dead";
    } else if (u.prone) {
      // Crawling: the legs scissor on the walk cycle (proneA /
      // proneB). Still — holding or firing — the flat pose.
      pose = moving ? (Math.floor(u.walk / 2.2) % 2 === 0 ? "proneA" : "proneB") : "prone";
    }
    else if ((u.shootT ?? 0) > 0) pose = u.cover || u.pinned || u.isStatic ? "crouch" : "shoot";
    else if (moving) {
      const f = Math.floor(u.walk / 1.6) % 4;
      pose = f === 0 ? "walkA" : f === 2 ? "walkB" : "stand";
    } else if (u.cover || u.pinned || u.isStatic) pose = "crouch";
    else pose = "stand";
    if (u.isStatic && pose === "shoot") pose = "crouch";

    const fx = snap(u.x);
    const feetY = snap(u.y + 9);
    const bob = moving && pose === "stand" ? -PX : 0;

    // Pixel shadow under the feet.
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    for (let i = -3; i <= 3; i++) ctx.fillRect(fx + i * PX, feetY - (Math.abs(i) === 3 ? PX : 0), PX, PX * (Math.abs(i) === 3 ? 1 : 2));

    // Sandbag ring around emplacements (vertical bag stack on the firing side).
    if (u.isStatic) {
      for (let k = -3; k <= 3; k++) {
        const bx = fx + (flip ? -1 : 1) * PX * (6 - Math.abs(k) * 0.5);
        const by = feetY - PX * 4 + k * PX * 2;
        ctx.fillStyle = "#1E1A12";
        ctx.fillRect(snap(bx) - PX, by - PX, PX * 4, PX * 3);
        ctx.fillStyle = k & 1 ? "#8A7A52" : "#7A6C48";
        ctx.fillRect(snap(bx), by, PX * 2, PX * 2);
        ctx.fillStyle = "#A08E62";
        ctx.fillRect(snap(bx), by, PX * 2, PX);
      }
    }

    // Selection: chunky pixel ring under the feet.
    if (u.alive && this.selected.includes(u.id)) {
      ctx.fillStyle = "#4ECDC4";
      for (let i = 0; i < 20; i++) {
        const ang = (i / 20) * Math.PI * 2;
        ctx.fillRect(snap(fx + Math.cos(ang) * 15), snap(feetY - PX + Math.sin(ang) * 7), PX, PX);
      }
    }
    if (u.alive && u.npc) {
      ctx.fillStyle = "rgba(160,180,210,0.7)";
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        ctx.fillRect(snap(fx + Math.cos(ang) * 13), snap(feetY - PX + Math.sin(ang) * 6), PX, PX);
      }
    }

    const img = sprite(look.pal, pose, look.weapon, look.head, flip);
    const ax = flip ? img.width - 1 - FEET_X : FEET_X;
    const top = feetY - SPR_H * PX + bob;
    ctx.drawImage(img, fx - ax * PX, top, img.width * PX, img.height * PX);

    // Radioman: dark backpack on the back, thin antenna rising above
    // the helmet with a tip dot, so he reads as the radio man.
    // The enemy Funker gets the same kit.
    if (this.isRadioman(u) && u.alive) {
      const backX = fx + (flip ? 4 : -4) * PX;
      ctx.fillStyle = "#2A3324";
      ctx.fillRect(backX - PX, top + 6 * PX, PX * 3, PX * 4);
      ctx.fillStyle = "#8D9A83";
      ctx.fillRect(backX, top - 4 * PX, PX, PX * 10);
      ctx.fillRect(backX - PX, top - 5 * PX, PX * 3, PX);
    }

    if (!u.alive) return;

    // Muzzle flash on the first frames of a shot.
    if ((u.shootT ?? 0) > 0.08 && look.weapon !== "mortar" && look.weapon !== "none") {
      const crouch = pose === "crouch" || pose === "prone";
      const reach = look.weapon === "sniper" ? 15 : look.weapon === "mg" ? 14 : look.weapon === "flak" ? 16 : look.weapon === "bazooka" ? 13 : 13;
      const wy = look.weapon === "bazooka" ? 4 + (crouch ? 0 : 1) : look.weapon === "flak" ? 6 : 6 + (crouch ? 3 : 0);
      const mx = fx + (flip ? -1 : 1) * (reach - FEET_X + (flip ? 1 : 0)) * PX - (flip ? PX : 0);
      const my = top + wy * PX;
      ctx.fillStyle = "#FFF6D8";
      ctx.fillRect(mx, my, PX, PX);
      ctx.fillStyle = "#FFD97D";
      ctx.fillRect(mx + (flip ? -PX : PX), my, PX, PX);
      ctx.fillRect(mx, my - PX, PX, PX);
      ctx.fillRect(mx, my + PX, PX, PX);
    }
    if (look.weapon === "mortar" && (u.shootT ?? 0) > 0.2) {
      ctx.fillStyle = "rgba(200,190,160,0.8)";
      ctx.fillRect(fx + (flip ? -5 : 5) * PX, top + 5 * PX, PX * 2, PX * 2);
    }

    const headY = top + (pose === "crouch" ? 3 * PX : 0);
    // Health bar: pixel segments above the head.
    if (u.hp < u.maxHp || isAlly) {
      const segs = 8;
      const pct = Math.max(0, u.hp / u.maxHp);
      const on = Math.ceil(pct * segs);
      const bx = fx - (segs / 2) * PX;
      const by = headY - PX * 2;
      ctx.fillStyle = "rgba(10,12,8,0.85)";
      ctx.fillRect(bx - PX, by - PX, (segs + 2) * PX, PX * 3);
      ctx.fillStyle = isAlly ? (pct > 0.5 ? "#5EB872" : pct > 0.2 ? "#E5A93C" : "#E24A4A") : "#E24A4A";
      ctx.fillRect(bx, by, on * PX, PX);
    }

    // Morale bar: one row below the health bar, in the BLUE
    // family on purpose (Josh, 2026-11-12) so it can never be
    // read as health: azure holds, royal blue wavers, violet is
    // close to breaking, deep indigo once broken (the BROKEN
    // label above him says the rest). Allies always show it; an
    // enemy shows it once his nerve starts to slip.
    if (u.morale < 100 || isAlly) {
      const msegs = 8;
      const mpct = Math.max(0, u.morale / 100);
      const mon = Math.ceil(mpct * msegs);
      const mbx = fx - (msegs / 2) * PX;
      const mby = headY + PX;
      ctx.fillStyle = "rgba(10,12,8,0.85)";
      ctx.fillRect(mbx - PX, mby - PX, (msegs + 2) * PX, PX * 3);
      ctx.fillStyle = u.broken ? "#3D348B" : mpct > 0.6 ? "#56B4E8" : mpct > 0.3 ? "#4A6FD4" : "#9B59D0";
      ctx.fillRect(mbx, mby, mon * PX, PX);
    }

    // In-cover marker: small pixel shield beside the head.
    if (u.cover && (isAlly || this.visible[this.cellAt(u.x, u.y)])) {
      const sx = fx - 7 * PX;
      const sy = headY + PX;
      ctx.fillStyle = "#0D0F0C";
      ctx.fillRect(sx - PX, sy - PX, PX * 5, PX * 5);
      ctx.fillStyle = u.cover.kind === "trench" ? "#7A5A2E" : u.cover.type === "heavy" ? "#E5A93C" : "#4ECDC4"; // brown = trench, gold = heavy cover, teal = light cover
      ctx.fillRect(sx, sy, PX * 3, PX * 2);
      ctx.fillRect(sx + PX, sy + PX * 2, PX, PX);
    }

    ctx.textAlign = "center";
    ctx.font = PIXEL_FONT;
    if (isAlly && this.selected.includes(u.id) && this.selected.length <= 3) {
      const name = u.name.split(" ").slice(-1)[0].toUpperCase();
      ctx.fillStyle = "#0D0F0C";
      ctx.fillText(name, fx + PX, headY - PX * 4 + PX);
      ctx.fillStyle = "#EAF0E2";
      ctx.fillText(name, fx, headY - PX * 4);
    }
    if (u.pinned) {
      ctx.fillStyle = "#0D0F0C";
      ctx.fillText("PINNED", fx + PX, headY - PX * (isAlly && this.selected.includes(u.id) ? 12 : 4) + PX);
      ctx.fillStyle = "#E24A4A";
      ctx.fillText("PINNED", fx, headY - PX * (isAlly && this.selected.includes(u.id) ? 12 : 4));
    }
    if (u.broken && !u.pinned) {
      ctx.fillStyle = "#0D0F0C";
      ctx.fillText("BROKEN", fx + PX, headY - PX * (isAlly && this.selected.includes(u.id) ? 12 : 4) + PX);
      ctx.fillStyle = "#E24A4A";
      ctx.fillText("BROKEN", fx, headY - PX * (isAlly && this.selected.includes(u.id) ? 12 : 4));
    }
    // A Recon's mark: a small amber diamond over the man's head,
    // visible while the mark lasts (he only draws at all when his
    // cell is seen, and the mark itself keeps his cell seen).
    if (u.side === "axis" && u.markedUntil !== undefined && u.markedUntil > this.elapsed) {
      ctx.fillStyle = "#E5A93C";
      ctx.beginPath();
      ctx.moveTo(fx, headY - PX * 9);
      ctx.lineTo(fx + PX * 2, headY - PX * 7);
      ctx.lineTo(fx, headY - PX * 5);
      ctx.lineTo(fx - PX * 2, headY - PX * 7);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// ---------------- terrain generation ----------------
// Every obstacle is drawn to read at a glance: hedgerow bushes, trees, buildings, steel
// hedgehogs. Hedgerows always leave walkable gaps (worn dirt), and A* routes through them.

type Ctx = CanvasRenderingContext2D;
let COVERS: Cover[] = []; // filled by buildTerrain's helpers
let OBJ_SEQ = 0; // object ids for blockers, reset per terrain build

// Scorch + torn burlap on a damaged piece of cover (painted into the terrain layer).
function paintWear(ctx: Ctx, c: Cover) {
  ctx.fillStyle = "rgba(20,16,10,0.35)";
  ctx.beginPath();
  ctx.arc(c.x + (Math.random() - 0.5) * c.r, c.y + (Math.random() - 0.5) * c.r, c.r * 0.55, 0, Math.PI * 2);
  ctx.fill();
}

// What's left once it's blown apart: spilled sand or splintered planks, no protection.
function paintDebris(ctx: Ctx, c: Cover) {
  ctx.fillStyle = "rgba(14,12,9,0.55)";
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, c.r + 6, c.r + 3, Math.random() * Math.PI, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = c.kind === "sandbag" ? "#7A6C4A" : "#5A4428";
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * (c.r + 6);
    if (c.kind === "sandbag") {
      ctx.beginPath();
      ctx.arc(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, 1.5 + Math.random() * 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.save();
      ctx.translate(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
      ctx.rotate(Math.random() * Math.PI);
      ctx.fillRect(-4, -1, 8, 2);
      ctx.restore();
    }
  }
}

function drawSandbags(ctx: Ctx, x: number, y: number, _ang: number, n = 5) {
  // Low cover: doesn't block movement, stops most rounds. Always stacked top-to-bottom.
  void _ang;
  const top = y - ((n - 1) / 2) * 12;
  for (let i = 0; i < n; i++) {
    const bx = x + (i % 2 ? 3 : -3);
    const by = top + i * 12;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(bx - 8 + 4, by - 6 + 4, 16, 12);
    ctx.fillStyle = "#2E2618";
    ctx.fillRect(bx - 9, by - 7, 18, 14);
    ctx.fillStyle = i % 2 ? "#8A7A52" : "#7E6F4A";
    ctx.fillRect(bx - 7, by - 5, 14, 10);
    ctx.fillStyle = "#A6946A";
    ctx.fillRect(bx - 7, by - 5, 14, 3);
    ctx.fillStyle = "#5E5236";
    ctx.fillRect(bx - 7, by + 3, 14, 2);
    ctx.fillRect(bx - 1, by - 5, 2, 10); // tied seam
    COVERS.push({ x: bx, y: by, r: 7, q: 0.65, q0: 0.65, kind: "sandbag", hp: 110, maxHp: 110, type: "light" });
  }
}

function drawRuin(ctx: Ctx, blockers: Blocker[], x: number, y: number, rng: () => number) {
  const obj = ++OBJ_SEQ;
  // Broken stone walls (block) with rubble around (cover).
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(x - 46, y - 40, 104, 92);
  ctx.fillStyle = "#4A4740";
  ctx.fillRect(x - 50, y - 44, 100, 88);
  const walls: Array<[number, number, number, number]> = [
    [x - 50, y - 44, 100, 10],
    [x - 50, y - 44, 10, 60],
    [x + 40, y - 10, 10, 54],
  ];
  for (const [wx, wy, ww, wh] of walls) {
    ctx.fillStyle = "#8C877A";
    ctx.strokeStyle = "#2A2824";
    ctx.lineWidth = 2;
    ctx.fillRect(wx, wy, ww, wh);
    ctx.strokeRect(wx, wy, ww, wh);
    const len = Math.max(ww, wh);
    for (let t = 6; t < len; t += 12) {
      const bx = ww > wh ? wx + t : wx + ww / 2;
      const by = ww > wh ? wy + wh / 2 : wy + t;
      blockers.push({ x: bx, y: by, r: 7, kind: "ruin", obj });
      COVERS.push({ x: bx, y: by, r: 7, q: 0.8, q0: 0.8, type: "heavy", hp: 400, maxHp: 400 });
    }
  }
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = i % 2 ? "#6E6A60" : "#57534A";
    ctx.fillRect(x - 40 + rng() * 80, y - 30 + rng() * 70, 5 + rng() * 6, 4 + rng() * 5);
  }
}

function drawTrench(ctx: Ctx, blockers: Blocker[], x0: number, y0: number, x1: number, y1: number, gaps: number[], rng: () => number) {
  const obj = ++OBJ_SEQ;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const dx = (x1 - x0) / len;
  const dy = (y1 - y0) / len;
  const px = -dy;
  const py = dx;
  const segs: Array<[number, number]> = [];
  let cur = 0;
  for (const g of [...gaps].sort((a, b) => a - b)) {
    const a = g * len - 60;
    const b = g * len + 60;
    if (a > cur) segs.push([cur, a]);
    cur = Math.max(cur, b);
  }
  if (cur < len) segs.push([cur, len]);
  for (const [a, b] of segs) {
    const ax = x0 + dx * a;
    const ay = y0 + dy * a;
    const bx = x0 + dx * b;
    const by = y0 + dy * b;
    ctx.strokeStyle = "#241A12";
    ctx.lineWidth = 30;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.strokeStyle = "#171008";
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    for (let t = a + 8; t < b; t += 36) {
      for (const s of [-1, 1]) {
        ctx.fillStyle = "#8A7A52";
        ctx.beginPath();
        ctx.arc(x0 + dx * t + px * 17 * s, y0 + dy * t + py * 17 * s, 6, 0, 7);
        ctx.fill();
      }
    }
    // Heavy cover along the trench floor, now the BEST cover in the
    // game: q 0.95 beats buildings and pillboxes (0.9), and with no
    // hp it never wears down under bullets or blasts. The blocker
    // entries exist only so the replay can draw the trench; they
    // never block movement (see buildBlockedGrid).
    for (let t = a + 10; t < b; t += 22) {
      const cx = x0 + dx * t;
      const cy = y0 + dy * t;
      blockers.push({ x: cx, y: cy, r: 14, kind: "trench", obj });
      COVERS.push({ x: cx, y: cy, r: 14, q: 0.95, q0: 0.95, type: "heavy", kind: "trench" });
    }
  }
}

function drawCrates(ctx: Ctx, blockers: Blocker[], x: number, y: number) {
  for (const [dx, dy] of [[0, 0], [16, 4], [6, 16]]) {
    ctx.fillStyle = "#6B5232";
    ctx.strokeStyle = "#2A1E10";
    ctx.lineWidth = 2;
    ctx.fillRect(x + dx - 7, y + dy - 7, 14, 14);
    ctx.strokeRect(x + dx - 7, y + dy - 7, 14, 14);
    ctx.beginPath();
    ctx.moveTo(x + dx - 7, y + dy - 7);
    ctx.lineTo(x + dx + 7, y + dy + 7);
    ctx.stroke();
    const b = { x: x + dx, y: y + dy, r: 8, kind: "crate" as const };
    blockers.push(b);
    COVERS.push({ x: x + dx, y: y + dy, r: 8, q: 0.55, q0: 0.55, kind: "crate", hp: 70, maxHp: 70, blocker: b, type: "light" });
  }
}

function drawWreck(ctx: Ctx, blockers: Blocker[], x: number, y: number, ang: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(-34, -18, 76, 44);
  ctx.fillStyle = "#3A3E30";
  ctx.strokeStyle = "#141610";
  ctx.lineWidth = 3;
  ctx.fillRect(-38, -22, 76, 44);
  ctx.strokeRect(-38, -22, 76, 44);
  ctx.fillStyle = "#2A2C22";
  ctx.fillRect(-38, -26, 76, 6);
  ctx.fillRect(-38, 20, 76, 6);
  ctx.fillStyle = "#4A4E3C";
  ctx.beginPath();
  ctx.arc(-4, 0, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(44, -6);
  ctx.stroke();
  ctx.fillStyle = "rgba(20,20,18,0.7)";
  ctx.beginPath();
  ctx.arc(10, 8, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const obj = ++OBJ_SEQ;
  for (const t of [-24, 0, 24]) {
    const bx = x + Math.cos(ang) * t;
    const by = y + Math.sin(ang) * t;
    blockers.push({ x: bx, y: by, r: 22, kind: "wreck", obj });
    COVERS.push({ x: bx, y: by, r: 22, q: 0.85, q0: 0.85, type: "heavy", hp: 500, maxHp: 500 });
  }
}

// Scatter a mixed cover field between x0..x1 — both sides use it.
function coverField(
  ctx: Ctx,
  blockers: Blocker[],
  rng: () => number,
  x0: number,
  x1: number,
  n: number,
  gate?: { check: (x: number, y: number, r: number) => boolean; add: (x: number, y: number, r: number) => void },
) {
  for (let i = 0; i < n; i++) {
    const x = x0 + rng() * (x1 - x0);
    const y = 90 + rng() * (MAP_H - 180);
    const r = rng();
    // The footprint of what this roll would place (a ruin is
    // 100 wide: its center can clear a blocker while its walls
    // land on it — the registry check uses the whole shape).
    const footprint = r < 0.35 ? 26 : r < 0.6 ? 62 : r < 0.82 ? 24 : 44;
    if (gate && !gate.check(x, y, footprint)) continue;
    // Do not scatter cover on top of an existing blocker: a wreck or
    // ruin landing against a building leaves a gap too narrow for a
    // unit to pass, and a unit ordered through it wedges in the pocket
    // instead of walking around. 60 units clear of a blocker's edge
    // leaves room for a man (18 across) to slip between the two.
    if (blockers.some((b) => Math.hypot(x - b.x, y - b.y) < b.r + 60)) continue;
    if (r < 0.35) drawSandbags(ctx, x, y, rng() * Math.PI, 4 + Math.floor(rng() * 3));
    else if (r < 0.6) drawRuin(ctx, blockers, x, y, rng);
    else if (r < 0.82) drawCrates(ctx, blockers, x, y);
    else drawWreck(ctx, blockers, x, y, rng() * Math.PI);
    if (gate) gate.add(x, y, footprint);
  }
}

function drawBush(ctx: Ctx, x: number, y: number, r: number, rng: () => number) {
  ctx.fillStyle = "rgba(8,12,6,0.55)";
  ctx.beginPath();
  ctx.ellipse(x + 4, y + 5, r, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2C4A1C";
  ctx.strokeStyle = "#0C1607";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  for (let k = 0; k < 4; k++) {
    ctx.fillStyle = k % 2 ? "#3F6A28" : "#4F7D32";
    ctx.beginPath();
    ctx.arc(x + (rng() - 0.5) * r, y + (rng() - 0.5) * r, r * (0.25 + rng() * 0.2), 0, Math.PI * 2);
    ctx.fill();
  }
}

function hedgerow(ctx: Ctx, blockers: Blocker[], x0: number, y0: number, x1: number, y1: number, gaps: number[], rng: () => number) {
  const obj = ++OBJ_SEQ;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const GAP = 120;
  for (let t = 0; t <= len; t += 30) {
    const f = t / len;
    if (gaps.some((g) => Math.abs(f * len - g * len) < GAP / 2)) continue;
    const x = x0 + (x1 - x0) * f + (rng() - 0.5) * 6;
    const y = y0 + (y1 - y0) * f + (rng() - 0.5) * 6;
    drawBush(ctx, x, y, 17, rng);
    blockers.push({ x, y, r: 16, kind: "hedgerow", obj });
    COVERS.push({ x, y, r: 16, q: 0.45, q0: 0.45, type: "light", hp: 120, maxHp: 120 });
  }
  // Worn dirt marks the gaps so the player sees where to go.
  for (const g of gaps) {
    ctx.fillStyle = "rgba(92,74,48,0.6)";
    ctx.beginPath();
    ctx.ellipse(x0 + (x1 - x0) * g, y0 + (y1 - y0) * g, 34, 26, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTree(ctx: Ctx, blockers: Blocker[], x: number, y: number, r: number, snow: boolean) {
  const obj = ++OBJ_SEQ;
  ctx.fillStyle = "rgba(6,10,6,0.55)";
  ctx.beginPath();
  ctx.ellipse(x + 6, y + 7, r, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = snow ? "#3B4A3A" : "#1F3A18";
  ctx.strokeStyle = "#0A1408";
  ctx.lineWidth = 2;
  for (const k of [1, 0.7, 0.4]) {
    ctx.beginPath();
    ctx.arc(x, y, r * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = snow ? "#C9D2CC" : "#2D5222";
  }
  blockers.push({ x, y, r: r * 0.75, kind: "tree", obj });
  COVERS.push({ x, y, r: r * 0.75, q: 0.6, q0: 0.6, type: "light", hp: 150, maxHp: 150 });
}

function drawBuilding(ctx: Ctx, blockers: Blocker[], x: number, y: number, w: number, h: number) {
  const obj = ++OBJ_SEQ;
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(x + 8, y + 8, w, h);
  ctx.fillStyle = "#5A3A2A";
  ctx.strokeStyle = "#1A0F08";
  ctx.lineWidth = 3;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "#6E4834";
  ctx.fillRect(x + 4, y + 4, w - 8, h / 2 - 4);
  ctx.strokeStyle = "#2A1A10";
  ctx.beginPath();
  ctx.moveTo(x, y + h / 2);
  ctx.lineTo(x + w, y + h / 2);
  ctx.stroke();
  // Cover the footprint with blocker circles.
  const r = Math.min(w, h) / 2;
  for (let bx = x + r; bx <= x + w - r + 1; bx += r) for (let by = y + r; by <= y + h - r + 1; by += r) {
    blockers.push({ x: bx, y: by, r: r * 1.05, kind: "building", obj });
    COVERS.push({ x: bx, y: by, r: r * 1.05, q: 0.9, q0: 0.9, type: "heavy" }); // stone walls: no hp, indestructible
  }
}

function drawHedgehog(ctx: Ctx, blockers: Blocker[], x: number, y: number) {
  const obj = ++OBJ_SEQ;
  ctx.strokeStyle = "#2A2A26";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x - 10, y - 10);
  ctx.lineTo(x + 10, y + 10);
  ctx.moveTo(x + 10, y - 10);
  ctx.lineTo(x - 10, y + 10);
  ctx.moveTo(x, y - 12);
  ctx.lineTo(x, y + 12);
  ctx.stroke();
  ctx.strokeStyle = "#6A6A60";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  blockers.push({ x, y, r: 11, kind: "hedgehog", obj });
}

function buildTerrain(kind: string, rng: () => number): { canvas: HTMLCanvasElement; blockers: Blocker[]; covers: Cover[] } {
  COVERS = [];
  OBJ_SEQ = 0;
  // Footprint registry for the no-overlap rule (Josh,
  // 2026-11-12): every placed object registers a circle; a new
  // object is only placed where its circle clears every
  // registered one by GAP, so objects sit apart with room for
  // a man to pass and nothing stacks or intersects. The total
  // amount of cover is unchanged: placements retry and shift
  // rather than thin out.
  const GAP = 12;
  const placed: Array<{ x: number; y: number; r: number }> = [];
  const clearOf = (x: number, y: number, r: number) =>
    placed.every((p) => Math.hypot(p.x - x, p.y - y) >= p.r + r + GAP);
  const register = (x: number, y: number, r: number) => {
    placed.push({ x, y, r });
  };
  const registerLine = (x0: number, y0: number, x1: number, y1: number, r: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(len / 40));
    for (let i = 0; i <= n; i++) register(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, r);
  };
  // Try a random spot in a band until one is clear.
  const scatterClear = (
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    r: number,
    tries = 10,
    reject?: (x: number, y: number) => boolean,
  ) => {
    for (let t = 0; t < tries; t++) {
      const x = x0 + rng() * (x1 - x0);
      const y = y0 + rng() * (y1 - y0);
      if (reject && reject(x, y)) continue;
      if (clearOf(x, y, r)) return { x, y };
    }
    return null;
  };
  const gate = { check: clearOf, add: register };
  const canvas = document.createElement("canvas");
  canvas.width = MAP_W;
  canvas.height = MAP_H;
  const ctx = canvas.getContext("2d")!;
  let blockers: Blocker[] = [];
  const snow = kind === "forest";

  ctx.fillStyle = snow ? "#3A4238" : "#2A3520";
  ctx.fillRect(0, 0, MAP_W, MAP_H);
  for (let i = 0; i < 500; i++) {
    const r = 20 + rng() * 80;
    ctx.fillStyle = rng() < 0.5 ? "rgba(24,32,18,0.3)" : snow ? "rgba(200,210,205,0.12)" : "rgba(70,80,46,0.22)";
    ctx.beginPath();
    ctx.ellipse(rng() * MAP_W, rng() * MAP_H, r, r * (0.5 + rng() * 0.5), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // The road matches the ground it runs on: a dirt road on dirt
  // ground, a sandy trail on sand ground. The beach is the sand map,
  // so its road is a light packed-sand trail with sand-coloured ruts;
  // every other map gets the worn brown dirt track with darker ruts.
  // Same pixel-art style as the rest of the map, no new look — the road
  // reads as dirt on dirt and sand on sand, not pavement. The ruts
  // follow the same bezier as the band, offset 10 units either side of
  // the centerline.
  const road = (y: number, fromX = 0) => {
    const sandy = kind === "beach";
    ctx.strokeStyle = sandy ? "#C9B184" : "#4A3E2C";
    ctx.lineWidth = 46;
    ctx.beginPath();
    ctx.moveTo(fromX, y);
    ctx.bezierCurveTo(MAP_W * 0.3, y - 90, MAP_W * 0.7, y + 90, MAP_W, y);
    ctx.stroke();
    // Two wheel ruts where wheels have packed the ground down.
    ctx.strokeStyle = sandy ? "#A68B5A" : "#33261A";
    ctx.lineWidth = 7;
    for (const off of [-10, 10]) {
      ctx.beginPath();
      ctx.moveTo(fromX, y + off);
      ctx.bezierCurveTo(MAP_W * 0.3, y - 90 + off, MAP_W * 0.7, y + 90 + off, MAP_W, y + off);
      ctx.stroke();
    }
  };
  const gapPick = (n: number) => Array.from({ length: n }, (_, i) => (i + 0.3 + rng() * 0.4) / n);
  // On the beach the road is a trail that starts at the waterline
  // (the sea fills x 0-260): no road on the water. Everywhere else
  // the road runs the full width. Both the branch call below and
  // the clear-band repaint at the end use this start.
  const roadStartX = kind === "beach" ? 260 : 0;

  if (kind === "beach") {
    // Sea, surf, sand, shingle, bluffs with draws, then the fields.
    ctx.fillStyle = "#1B3A46";
    ctx.fillRect(0, 0, 260, MAP_H);
    ctx.strokeStyle = "rgba(200,220,220,0.35)";
    ctx.lineWidth = 2;
    for (let y = 0; y < MAP_H; y += 26) {
      ctx.beginPath();
      ctx.moveTo(240 + rng() * 30, y);
      ctx.lineTo(260 + rng() * 20, y + 18);
      ctx.stroke();
    }
    ctx.fillStyle = "#8C7A55";
    ctx.fillRect(260, 0, 560, MAP_H);
    ctx.fillStyle = "#6E6450";
    ctx.fillRect(800, 0, 40, MAP_H); // shingle
    // The shingle bank: a long low wall of stones to hide behind.
    for (let y = 30; y < MAP_H; y += 26) COVERS.push({ x: 820, y, r: 14, q: 0.6, q0: 0.6, type: "light", hp: 150, maxHp: 150 });
    // The fixed defense lines register their footprints first,
    // so the random hedgehogs and scatter keep off them.
    for (const lx of [1000, 1700, 2500, 3300]) registerLine(lx, 0, lx, MAP_H, 22);
    for (const lx of [1400, 2600, 3400]) registerLine(lx, 80, lx, MAP_H - 80, 18);
    for (const py of [MAP_H * 0.32, MAP_H * 0.68]) register(1105, py, 32);
    for (let i = 0; i < 34; i++) {
      const spot = scatterClear(380, 760, 40, MAP_H - 40, 14);
      if (!spot) continue;
      register(spot.x, spot.y, 14);
      drawHedgehog(ctx, blockers, spot.x, spot.y);
      COVERS.push({ x: spot.x, y: spot.y, r: 11, q: 0.35, q0: 0.35, type: "light", hp: 80, maxHp: 80 });
    }
    coverField(ctx, blockers, rng, 1100, 3900, 20, gate);
    for (const y of [MAP_H * 0.2, MAP_H * 0.5, MAP_H * 0.8]) drawSandbags(ctx, 1950, y, 0, 6); // German trench line
    for (const y of [MAP_H * 0.2, MAP_H * 0.5, MAP_H * 0.8]) drawSandbags(ctx, 2750, y, 0, 6); // second trench line, eastern ground
    for (const y of [MAP_H * 0.2, MAP_H * 0.5, MAP_H * 0.8]) drawSandbags(ctx, 3550, y, 0, 6); // third trench line, new eastern ground
    // Dug trenches: one mid-field, one eastern, one on the new ground.
    drawTrench(ctx, blockers, 1400, 80, 1400, MAP_H - 80, [0.5], rng);
    drawTrench(ctx, blockers, 2600, 80, 2600, MAP_H - 80, [0.35, 0.7], rng);
    drawTrench(ctx, blockers, 3400, 80, 3400, MAP_H - 80, [0.35, 0.7], rng);
    // Bluffs: dune-grass ridge with three draws (the real Omaha exits).
    hedgerow(ctx, blockers, 1000, 0, 1000, MAP_H, [0.2, 0.5, 0.82], rng);
    hedgerow(ctx, blockers, 1700, 0, 1700, MAP_H, gapPick(2), rng);
    hedgerow(ctx, blockers, 2500, 0, 2500, MAP_H, gapPick(2), rng);
    hedgerow(ctx, blockers, 3300, 0, 3300, MAP_H, gapPick(2), rng);
    // The trail starts at the waterline: no road on the water.
    road(MAP_H / 2, roadStartX);
    // Concrete pillbox ruins on the bluff.
    for (const py of [MAP_H * 0.32, MAP_H * 0.68]) {
      ctx.fillStyle = "#6A6A62";
      ctx.strokeStyle = "#2A2A26";
      ctx.lineWidth = 3;
      ctx.fillRect(1080, py - 22, 50, 44);
      ctx.strokeRect(1080, py - 22, 50, 44);
      ctx.fillStyle = "#1A1A18";
      ctx.fillRect(1080, py - 4, 8, 8);
      blockers.push({ x: 1105, y: py, r: 26, kind: "pillbox", obj: ++OBJ_SEQ });
      COVERS.push({ x: 1105, y: py, r: 26, q: 0.9, q0: 0.9, type: "heavy" }); // concrete: no hp, indestructible
    }
  } else if (kind === "airborne" || kind === "bocage") {
    road(MAP_H / 2);
    for (const x of [620, 1120, 1620, 2050, 2600, 3400]) registerLine(x, 30, x, MAP_H - 30, 22);
    for (const y of [430, 920]) {
      for (const [a, b] of [[640, 1100], [1140, 1600], [1640, 2030], [2140, 2580], [2940, 3380]]) registerLine(a, y, b, y, 22);
    }
    for (const lx of [1400, 2400, 3400]) registerLine(lx, 60, lx, MAP_H - 60, 18);
    register(1760 + 80, 560 + 55, 97); // the church footprint
    for (const x of [620, 1120, 1620, 2050, 2600, 3400]) hedgerow(ctx, blockers, x, 30, x, MAP_H - 30, gapPick(3), rng);
    for (const y of [430, 920]) {
      for (const [a, b] of [[640, 1100], [1140, 1600], [1640, 2030], [2140, 2580], [2940, 3380]]) hedgerow(ctx, blockers, a, y, b, y, [0.5], rng);
    }
    for (let i = 0; i < 12; i++) {
      const r = 18 + rng() * 10;
      const spot = scatterClear(700, 3900, 60, MAP_H - 60, r);
      if (!spot) continue;
      register(spot.x, spot.y, r);
      drawTree(ctx, blockers, spot.x, spot.y, r, false);
    }
    drawBuilding(ctx, blockers, 1760, 560, 160, 110); // Norman church
    drawTrench(ctx, blockers, 1400, 60, 1400, MAP_H - 60, [0.5], rng);
    drawTrench(ctx, blockers, 2400, 60, 2400, MAP_H - 60, [0.3, 0.65], rng);
    drawTrench(ctx, blockers, 3400, 60, 3400, MAP_H - 60, [0.3, 0.65], rng);
    coverField(ctx, blockers, rng, 300, 3900, 24, gate);
    if (kind === "airborne") {
      ctx.fillStyle = "rgba(10,16,34,0.38)"; // night drop
      ctx.fillRect(0, 0, MAP_W, MAP_H);
    }
  } else if (kind === "town") {
    road(MAP_H / 2);
    // The trench lines and the west hedgerow are fixed: their
    // footprints register before any building or ruin is set.
    registerLine(400, 40, 400, MAP_H - 40, 22);
    for (const lx of [900, 2700, 3500]) registerLine(lx, 80, lx, MAP_H - 80, 18);
    for (let i = 0; i < 15; i++) {
      const w = 110 + rng() * 90;
      const h = 90 + rng() * 60;
      const bx = 520 + (i % 5) * 620 + rng() * 80;
      const by = 80 + Math.floor(i / 5) * 430 + rng() * 60;
      if (Math.abs(by + h / 2 - MAP_H / 2) < 110) continue; // keep the main street open
      // Shift the building within its plot until its footprint
      // clears everything placed so far (Josh: houses sat on
      // ruins, trenches, and each other). The grid is sparse,
      // a short search always finds a clear spot nearby.
      const R = Math.hypot(w, h) / 2;
      let px = bx;
      let py = by;
      for (const [ox, oy] of [[0, 0], [80, 0], [-80, 0], [160, 0], [-160, 0], [0, 80], [80, 80], [-80, 80], [0, -80], [160, 80], [-160, 80]] as Array<[number, number]>) {
        if (clearOf(bx + ox + w / 2, by + oy + h / 2, R)) {
          px = bx + ox;
          py = by + oy;
          break;
        }
      }
      register(px + w / 2, py + h / 2, R);
      drawBuilding(ctx, blockers, px, py, w, h);
    }
    hedgerow(ctx, blockers, 400, 40, 400, MAP_H - 40, gapPick(3), rng);
    // Trenches in the gaps between building columns; the gap at 0.5
    // lands on the main street, so the road stays open.
    drawTrench(ctx, blockers, 900, 80, 900, MAP_H - 80, [0.5], rng);
    drawTrench(ctx, blockers, 2700, 80, 2700, MAP_H - 80, [0.35, 0.7], rng);
    drawTrench(ctx, blockers, 3500, 80, 3500, MAP_H - 80, [0.35, 0.7], rng);
    for (let i = 0; i < 12; i++) {
      const rx0 = 650 + i * 280 + rng() * 60;
      const ry = MAP_H / 2 + (i % 2 ? -1 : 1) * (150 + rng() * 60);
      // Same rule for the ruins along the street: slide along
      // the lane (and a step off it if the lane is blocked)
      // until the footprint is clear.
      let rx = rx0;
      let ryy = ry;
      let found = false;
      for (const oy of [0, 90, -90]) {
        for (const ox of [0, 70, -70, 140, -140, 210, -210, 280, -280]) {
          if (clearOf(rx0 + ox, ry + oy, 62)) {
            rx = rx0 + ox;
            ryy = ry + oy;
            found = true;
            break;
          }
        }
        if (found) break;
      }
      register(rx, ryy, 62);
      drawRuin(ctx, blockers, rx, ryy, rng);
    }
    coverField(ctx, blockers, rng, 500, 3900, 12, gate);
  } else if (kind === "causeway") {
    ctx.fillStyle = "#16252A";
    ctx.fillRect(0, 0, MAP_W, MAP_H * 0.3);
    ctx.fillRect(0, MAP_H * 0.7, MAP_W, MAP_H * 0.3);
    road(MAP_H / 2);
    const bushObjA = ++OBJ_SEQ;
    const bushObjB = ++OBJ_SEQ;
    for (let x = 300; x < MAP_W; x += 44) {
      drawBush(ctx, x, MAP_H * 0.3, 15, rng); // reed banks along the flood
      blockers.push({ x, y: MAP_H * 0.3, r: 15, kind: "bush", obj: bushObjA });
      drawBush(ctx, x + 22, MAP_H * 0.7, 15, rng);
      blockers.push({ x: x + 22, y: MAP_H * 0.7, r: 15, kind: "bush", obj: bushObjB });
    }
    registerLine(800, MAP_H / 2 - 180, 3800, MAP_H / 2 - 180, 18);
    registerLine(800, MAP_H / 2 + 180, 3800, MAP_H / 2 + 180, 18);
    for (const [wx, wy] of [[1250, MAP_H * 0.47], [1850, MAP_H * 0.55], [2650, MAP_H * 0.5], [3450, MAP_H * 0.53]] as Array<[number, number]>) register(wx, wy, 44);
    for (let i = 0; i < 10; i++) {
      const spot = scatterClear(600, 3900, MAP_H * 0.38, MAP_H * 0.62, 16);
      if (!spot) continue;
      register(spot.x, spot.y, 16);
      drawTree(ctx, blockers, spot.x, spot.y, 16, false);
    }
    for (let i = 0; i < 14; i++) drawSandbags(ctx, 500 + i * 260, MAP_H * (0.42 + (i % 2) * 0.16), Math.PI / 2, 5);
    drawWreck(ctx, blockers, 1250, MAP_H * 0.47, 0.2);
    drawWreck(ctx, blockers, 1850, MAP_H * 0.55, -0.3);
    drawWreck(ctx, blockers, 2650, MAP_H * 0.5, 0.1);
    drawWreck(ctx, blockers, 3450, MAP_H * 0.53, -0.2);
    // Trenches parallel to the causeway road, inside the dry strip.
    drawTrench(ctx, blockers, 800, MAP_H / 2 - 180, 3800, MAP_H / 2 - 180, [0.5], rng);
    drawTrench(ctx, blockers, 800, MAP_H / 2 + 180, 3800, MAP_H / 2 + 180, [0.5], rng);
  } else if (kind === "forest") {
    road(MAP_H / 2);
    for (const lx of [1500, 2600, 3400]) registerLine(lx, 60, lx, MAP_H - 60, 18);
    for (const sx of [1900, 2700, 3500]) {
      register(sx, MAP_H / 2 - 120, 30);
      register(sx, MAP_H / 2 + 120, 30);
    }
    for (let i = 0; i < 110; i++) {
      const r = 16 + rng() * 12;
      const spot = scatterClear(320, MAP_W - 40, 0, MAP_H, r, 10, (_x, y) => Math.abs(y - MAP_H / 2) < 60);
      if (!spot) continue;
      register(spot.x, spot.y, r);
      drawTree(ctx, blockers, spot.x, spot.y, r, snow);
    }
    coverField(ctx, blockers, rng, 400, 3900, 15, gate);
    drawSandbags(ctx, 1900, MAP_H / 2 - 120, 0, 7); // bunker line
    drawSandbags(ctx, 1900, MAP_H / 2 + 120, 0, 7);
    drawSandbags(ctx, 2700, MAP_H / 2 - 120, 0, 7); // second bunker line, eastern ground
    drawSandbags(ctx, 2700, MAP_H / 2 + 120, 0, 7);
    drawSandbags(ctx, 3500, MAP_H / 2 - 120, 0, 7); // third bunker line, new eastern ground
    drawSandbags(ctx, 3500, MAP_H / 2 + 120, 0, 7);
    drawTrench(ctx, blockers, 1500, 60, 1500, MAP_H - 60, [0.5], rng);
    drawTrench(ctx, blockers, 2600, 60, 2600, MAP_H - 60, [0.3, 0.65], rng);
    drawTrench(ctx, blockers, 3400, 60, 3400, MAP_H - 60, [0.3, 0.65], rng);
  }

  // Craters (cosmetic, walkable).
  for (let i = 0; i < 16; i++) {
    const cx = 900 + rng() * (MAP_W - 950);
    const cy = rng() * MAP_H;
    const r = 12 + rng() * 18;
    ctx.fillStyle = "rgba(14,12,10,0.75)";
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.7, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // The tank road runs west to east and must be clear: no blocker or
  // cover may overlap the road surface, so the Sherman has a clear
  // path. A blocker overlaps the road when its circle reaches the
  // road's edge (centerline +- ROAD_HALF). Dropping just the circles
  // on the road leaves a gap in a hedgerow or a building's edge where
  // the road passes, which is the right look — the road cuts through.
  // The road is then repainted on top, so it reads as clear dirt
  // instead of a hedgerow or wall drawn across it.
  const onRoad = (x: number, y: number, r: number) => Math.abs(y - roadYAt(x)) < r + ROAD_HALF;
  blockers = blockers.filter((b) => !onRoad(b.x, b.y, b.r));
  COVERS = COVERS.filter((c) => !onRoad(c.x, c.y, c.r));
  road(MAP_H / 2, roadStartX);
  return { canvas, blockers, covers: COVERS };
}
