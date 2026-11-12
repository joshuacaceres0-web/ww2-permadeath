// VANGUARD '44 battle engine — real-time top-down WW2 tactics with tactical pause,
// fog of war, suppression, waves, and permadeath reporting. Pure canvas + rAF.

import { CAUSES, CRATE_CHANCE, CRATE_RP, ENEMY_TYPES, LOOT_RADIUS, UNIT_TYPES, isCowardQuirk, levelBonus, medalBonus } from "./data";
import type { EnemyTypeId, Mission, UnitTypeId } from "@/lib/types";
import { loadSettings, SHAKE_FACTOR } from "@/lib/settings";
import { setSfxMuted, setSfxVolume, sfx } from "./sfx";
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
const PAN_SPEED = 900;
const PX = 3; // world units per screen pixel — the whole battlefield renders as chunky pixel art
const MIN_SCALE = 0.7; // zoomed in so the chunky sprites read clearly
const PIXEL_FONT = "24px Silkscreen, monospace";
const snap = (v: number) => Math.round(v / PX) * PX;

interface Corpse {
  x: number;
  y: number;
  img: HTMLCanvasElement;
  axis: boolean;
}

// Sprite look for each unit: palette, headgear, weapon.
function lookOf(u: { side: "allies" | "axis"; type: UnitTypeId; enemyType: EnemyTypeId | null; npc: boolean }): { pal: string; head: Head; weapon: Weapon } {
  if (u.side === "allies") {
    const weapon: Weapon = ({ rifleman: "rifle", medic: "none", mg: "mg", sniper: "sniper", at: "bazooka", radioman: "rifle", tank: "none" } as const)[u.type];
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
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  kind: "muzzle" | "blood" | "dust" | "smoke" | "spark" | "heal" | "ring" | "boom";
}

export type BlockerKind = "tree" | "ruin" | "building" | "hedgerow" | "wreck" | "crate" | "hedgehog" | "pillbox" | "bush" | "trench" | "obstacle";
interface Blocker {
  x: number;
  y: number;
  r: number;
  kind?: BlockerKind;
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
  private corpses: Corpse[] = [];
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

  setup(mission: Mission, squad: SquadInput[], commanderBonus = 0, variant: Variant = "", commanderLevel = 1) {
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
    this.spawnAllies(squad, rng, commanderBonus);
    // 2nd Platoon: 12 weak allies, so they support the fight but can
    // never clear a wave on their own — in the Emergent play test
    // Wave 1 was cleared entirely by them while the player's squad stood
    // idle and fired nothing. The real count was 2 + min(3, mission.index),
    // i.e. 2-5; Josh picked 12 on 2026-11-11. Still weak, spread down
    // the western edge so they do not spawn stacked on each other.
    this.spawnNpcAllies(12, rng);
    this.spawnWave(0);
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
   * normal camera window. Re-runs resize so it takes effect at once. */
  setFitMap(on: boolean) {
    if (this.fitWholeMap === on) return;
    this.fitWholeMap = on;
    this.resize();
    this.dirty = true;
  }

  isFitMap() {
    return this.fitWholeMap;
  }

  retreat() {
    if (this.phase !== "battle" || this.battleState !== "active") return;
    this.battleState = "defeat";
    this.phase = "over";
    this.pushLog("Squad withdrew from the field. Mission failed.", "lose");
    this.dirty = true;
  }

  startAim(unitId: number) {
    if (this.phase !== "battle") return;
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

  private spawnNpcAllies(n: number, rng: () => number) {
    // Weak riflemen only: the old types list gave the NPCs an MG and an AT
    // gun at full damage, so they could win a wave on their own.
    // Spread down the western edge instead of clustering at one y, so
    // they do not spawn stacked and deadlock on each other.
    // The first man is 2nd Platoon's medic: one rifleman becomes the
    // medic, so the platoon is still 12 men and heals its own wounded
    // with the same aura and triage as every other medic.
    for (let i = 0; i < n; i++) {
      const py = 120 + (i * (MAP_H - 240)) / Math.max(1, n - 1) + rng() * 40;
      this.addNpc(i === 0 ? "medic" : "rifleman", 90 + rng() * 80, py, i, rng(), true);
    }
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

  /** The Funker's rally: nearby enemy men recover 15 morale over the
   * radio, on a 20s cooldown — the mirror of the squad radioman's
   * Rally Call. Only fires when somebody nearby actually needs it. */
  private funkerRally(u: Unit) {
    if (u.abilityCd > 0 || u.broken) return;
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
    for (let i = 0; i < n; i++) {
      const py = 120 + (i * (MAP_H - 240)) / Math.max(1, n - 1) + rng() * 40;
      this.addNpc("rifleman", 90 + rng() * 80, py, this.nextId + i, rng(), true);
    }
    this.pushLog(`2nd Platoon sends ${n} fresh men up the line.`, "info");
  }

  canReinforce(): boolean {
    return this.phase === "battle" && this.battleState === "active" && this.reinforcements < MAX_REINFORCEMENTS && this.radioLive() && this.commanderLevel >= RADIO_CALL_LEVEL.reinforce;
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

  private addNpc(type: UnitTypeId, px: number, py: number, i: number, r: number, weak = false) {
    {
      const spec = UNIT_TYPES[type];
      const [cx, cy] = nearestOpen(this.blocked, Math.floor(Math.max(12, Math.min(MAP_W - 12, px)) / CELL), Math.floor(Math.max(12, Math.min(MAP_H - 12, py)) / CELL));
      const SURN = ["Reilly", "Haskins", "Moreau", "Kaplan", "Briggs", "Delgado", "Novak", "Pruitt", "Lindqvist", "O'Hara", "Tasker", "Wexler"];
      // 2nd Platoon NPCs: buffed 2026-11-11 at Josh's pick, after Wave 3
      // made battles unwinnable — 75% damage (was 50%), 90% health
      // (was 70%), near-full speed and vision, faster fire. Still
      // weaker than a hired man, so they support the fight instead of
      // winning it alone. Paid reinforcements call addNpc without
      // `weak` and keep full stats.
      const hp = weak ? Math.round(spec.hp * 0.9) : spec.hp;
      this.units.push({
        id: this.nextId++, side: "allies", type, enemyType: null, soldierId: null,
        name: `${["Pvt.", "Pfc.", "Cpl."][i % 3]} ${SURN[i % SURN.length]}`,
        rank: "", level: 0, reaction: 0.6, x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2, facing: 0, homeX: cx * CELL + CELL / 2, homeY: cy * CELL + CELL / 2, patrolX: cx * CELL + CELL / 2, patrolY: cy * CELL + CELL / 2,
        hp, maxHp: hp, speed: spec.speed * (weak ? 0.95 : 0.9), range: spec.range, vision: spec.vision * (weak ? 0.9 : 1),
        dmg: spec.dmg * (weak ? 0.75 : 1), fireInterval: spec.fireInterval * (weak ? 1.3 : 1.1), spread: spec.spread * 1.15, bulletSpeed: spec.bulletSpeed,
        isStatic: false, vehicle: spec.vehicle ?? false, counterAttack: false, orders: [], attackId: null, targetId: null, cooldown: r, suppression: 0, pinned: false,
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
    const out: Array<{ x: number; y: number; score: number }> = [];
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
      // Threat-side bonus: cover roughly in the direction of the enemy
      // (dot product of unit->cover and unit->threat above 0) counts as
      // 60 units closer, so a slightly farther sandbag facing the enemy
      // beats a nearer one behind the unit.
      let score = d;
      if (threat) {
        const dot = (sx - u.x) * (threat.x - u.x) + (sy - u.y) * (threat.y - u.y);
        if (dot > 0) score -= 60;
      }
      out.push({ x: sx, y: sy, score });
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
        if (allies[idx].alive) this.centerOn(allies[idx].x, allies[idx].y);
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
      if (this.touchPan.moved) {
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
    }
    this.dirty = true;
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
    }
    this.dirty = true;
  }

  private autoUseAbilities() {
    for (const u of this.units) {
      if (u.side !== "allies" || u.npc || !u.alive || u.abilityCd > 0 || u.broken) continue;
      if (u.type === "medic") {
        const hurt = this.units.some(
          (a) => a.side === "allies" && a.alive && a.hp < a.maxHp && dist(u.x, u.y, a.x, a.y) <= 130,
        );
        if (hurt) this.castAuto(u);
      } else if (u.type === "sniper" || u.type === "at") {
        if (this.bestTarget(u, (a, b) => a.maxHp - b.maxHp)) this.castAuto(u);
      } else if (u.type === "radioman") {
        const wavering = this.units.some(
          (a) => a.side === "allies" && a.alive && a.morale < 70 && dist(u.x, u.y, a.x, a.y) <= 150,
        );
        if (wavering) this.castAuto(u);
      } else if (u.type === "rifleman" || u.type === "mg") {
        const t = this.autoTarget(u);
        if (t) this.castGround(u, t.x, t.y);
      }
    }
  }

  private bestTarget(u: Unit, cmp: (a: Unit, b: Unit) => number): Unit | null {
    const inRange = this.units.filter(
      (e) => e.side === "axis" && e.alive && dist(u.x, u.y, e.x, e.y) <= u.range
    );
    if (inRange.length === 0) return null;
    return inRange.reduce((a, b) => (cmp(a, b) >= 0 ? a : b));
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
        // Scattered drop: men land all over the western fields, far from each other.
        sx = 120 + rng() * MAP_W * 0.35;
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
        vehicle: false, counterAttack: false,
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
    // stay on the bluffs, as before. Waves 2 and 3 are
    // reinforcements from the east, as before.
    const beach = index === 0;
    const trenchSpots = beach ? this.firstTrenchSpots() : [];
    const mobileTotal = this.waves[index].reduce(
      (n, s) => n + (ENEMY_TYPES[s.type].static ? 0 : s.count),
      0,
    );
    const staticTotal = this.waves[index].reduce(
      (n, s) => n + (ENEMY_TYPES[s.type].static ? s.count : 0),
      0,
    );
    let mobileCount = 0;
    let trenchCount = 0;
    let staticCount = 0;
    for (const spec of this.waves[index]) {
      const def = ENEMY_TYPES[spec.type];
      for (let i = 0; i < spec.count; i++) {
        const isStatic = !!def.static;
        let x: number;
        let y: number;
        let trench = false;
        if (isStatic) {
          x = beach ? 700 + rng() * 300 : MAP_W * (0.6 + rng() * 0.25);
          // Wave 1 is the prepared beach defense: spread the static
          // nests along the line in bands, one nest per band, so the
          // MGs cover the whole beach instead of bunching at one y.
          // Waves 2 and 3 are reinforcements, so they keep the old
          // random y.
          y =
            beach && staticTotal > 1
              ? 90 + ((staticCount + rng() * 0.7) * (MAP_H - 180)) / staticTotal
              : MAP_H * (0.2 + rng() * 0.6);
          staticCount++;
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
      }
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

  private update(dt: number) {
    if (this.phase !== "battle" || this.paused) return;
    this.elapsed += dt;
    this.replayT += dt;
    if (this.replayT >= 0.5) {
      this.replayT = 0;
      this.recordReplayFrame();
    }

    // Wave / win logic.
    if (this.enemiesAlive() === 0) {
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

    // Auto Battle add-on 1: once a second, each squad man uses his
    // ability on his own — medic heals, sniper / AT pick a target,
    // rifleman frags and MG barrages the nearest enemy in range.
    // Guards run first so castAuto never spams "no shot" log lines.
    if (this.autoBattle) {
      this.autoAbilityT -= dt;
      if (this.autoAbilityT <= 0) {
        this.autoAbilityT = 1;
        this.autoUseAbilities();
      }
    }

    // Units.
    for (const u of this.units) {
      if (!u.alive) continue;
      u.suppression = Math.max(0, u.suppression - 9 * dt);
      if (u.suppression >= 55) u.pinned = true;
      else if (u.suppression <= 22) u.pinned = false;
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
        target = this.autoTarget(u);
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
          if (u.fleeT >= 2 && (dxEdge <= 150 || dyEdge <= 150)) this.desert(u);
        } else {
          const foe = this.nearestAlly(u);
          if (foe) {
            const dx = u.x - foe.x;
            const dy = u.y - foe.y;
            const len = Math.hypot(dx, dy) || 1;
            moving = this.chaseTo(u, u.x + (dx / len) * 320, u.y + (dy / len) * 320, dt);
          }
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
        const inRange = prey && dist(u.x, u.y, prey.x, prey.y) <= u.range * 0.9 && this.los(u, prey);
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
      } else if ((u.side === "axis" || u.npc || (this.autoBattle && u.side === "allies" && !u.npc)) && !u.isStatic && u.enemyType !== "mortar") {
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
        if (prey) {
          const pd = dist(u.x, u.y, prey.x, prey.y);
          // Camp and defend: an axis unit holds its ground until it
          // spots a player unit — within vision and with line of
          // sight. Until then it does not advance, so the defense
          // waits for the player instead of charging across the map.
          // A counter-attacker ignores the rule and charges. Allies
          // and AUTO squad men are unaffected and still chase. A
          // medic is exempt too: its prey is a wounded man on its own
          // side, not the player, so it moves to heal regardless.
          const isEnemyPrey = prey.side !== u.side;
          const spotted = u.side !== "axis" || u.counterAttack || !isEnemyPrey || (pd <= u.vision && this.los(u, prey));
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
          } else if (pd > u.range * 0.9 || !this.los(u, prey)) {
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
        } else {
          // No prey: hold position, and drop any stale chase path.
          u.chase = [];
        }
        // No prey: NPCs hold position instead of pushing east blind into
        // the next wave. The old push-east made 2nd Platoon meet Wave 1
        // in the middle and clear it alone while the player's squad
        // stood idle at the west edge.
      } else if (u.side === "allies" && attackOrder && (d > u.range * 0.92 || !this.los(u, attackOrder))) {
        moving = this.chaseTo(u, attackOrder.x, attackOrder.y, dt);
      } else if (u.side === "allies" && attackOrder) {
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
      if (!u.isStatic && !u.vehicle && !u.trenchHold && u.cover && (u.npc || u.side === "axis" || (this.autoBattle && u.side === "allies" && !u.npc)) && u.orders.length === 0 && u.chase.length === 0 && !u.attackId) {
        const prey = this.nearestAlly(u);
        const hasLosTarget = focus && d <= u.range && this.los(u, focus);
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
      if (!u.isStatic && !u.cover && u.coverSeekT <= 0 && !u.vehicle) {
        const underFire = u.pinned || u.suppression >= 35;
        const idle = u.orders.length === 0 && u.chase.length === 0 && !u.attackId && (!focus || d > u.range || !this.los(u, focus));
        const playerOrdered = u.side === "allies" && !u.npc && u.attackId !== null;
        if ((underFire && !playerOrdered) || (idle && u.side !== "axis") || (idle && u.side === "axis" && !this.nearestAlly(u))) {
          if (this.seekCover(u, underFire ? 220 : 280)) u.coverSeekT = 5;
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
          // Always warn: the old 40% roll meant most shells arrived with
          // no radio line at all, and there was no visible marker. The
          // 2.4s flight time is the warning window — drawMortarWarnings
          // draws a pulsing red circle at the impact point for its whole flight.
          this.pushLog("Incoming mortar!", "wave");
        }
      } else if (u.cooldown <= 0 && focus && d <= u.range && !u.pinned && !u.broken && this.los(u, focus)) {
        const interval = u.fireInterval * aura;
        u.cooldown = interval;
        this.fireAt(u, focus, moving);
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
          if (dist(b.x, b.y, bl.x, bl.y) < bl.r) {
            this.puff(b.x, b.y);
            dead = true;
            break;
          }
        }
        if (dead) break;
        for (const u of this.units) {
          if (!u.alive || u.side === b.side) continue;
          if (dist(b.x, b.y, u.x, u.y) < UNIT_R + 2) {
            // Cover between shooter and target soaks the round — but
            // only cover on the shooter's side of the target, so a
            // flanking shot finds the open side. A stopped round
            // wears the cover down, and suppression still lands
            // (0.7x: sustained fire pins a man behind cover, but a
            // single stopped round does not — full strength pinned
            // whole squads in testing and AUTO lost 3 in a row).
            const c = this.coverBetween(b.ox, b.oy, u.x, u.y);
            if (c && Math.random() < c.q) {
              this.puff(b.x, b.y);
              this.damageCover(c, b.dmg);
              u.suppression = Math.min(100, u.suppression + b.suppress * 0.7);
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

    // Particles.
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
  }

  private autoTarget(u: Unit): Unit | null {
    let best: Unit | null = null;
    let bestD = u.range * 1.05;
    for (const e of this.units) {
      if (e.side === u.side || !e.alive) continue;
      const d = dist(u.x, u.y, e.x, e.y);
      if (d < bestD && this.los(u, e)) {
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

  private moveToward(u: Unit, x: number, y: number, dt: number, speedMult = 1) {
    const d = dist(u.x, u.y, x, y);
    if (d < 1) return;
    const sp = u.speed * speedMult * (u.pinned ? 0.35 : 1);
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
  }

  private resolveCollisions() {
    for (const u of this.units) {
      if (!u.alive || u.isStatic) continue;
      for (const b of this.blockers) {
        if (b.kind === "trench") continue; // a trench is a hole, not a wall: men stand in it
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

  private fireAt(u: Unit, target: Unit, moving: boolean) {
    const lead = moving ? 1.6 : u.pinned ? 1.5 : 1;
    this.spawnBullet(u, target.x, target.y, u.spread * lead, u.dmg * u.dmgMult, u.type === "mg" ? 20 : 14);
  }

  private spawnBullet(u: Unit, tx: number, ty: number, spread: number, dmg: number, suppress: number) {
    u.shootT = 0.16;
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
    u.deathT = 0;
    // Casualty shock: men close by watch a friend die (-8 within
    // 250), the whole side feels it (-2). The shock also holds
    // recovery back for 5s, like being under fire.
    for (const a of this.units) {
      if (!a.alive || a.side !== u.side || a.id === u.id) continue;
      this.moraleLoss(a, dist(u.x, u.y, a.x, a.y) <= 250 ? 8 : 2);
      a.lastHitT = this.elapsed;
    }
    if (u.side === "allies" && !u.npc) sfx("death");
    this.corpseFx(u);
    if (u.side === "allies" && u.npc) {
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
      this.pushLog(`${ENEMY_TYPES[u.enemyType!].label} neutralized.`, "kill");
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
        orders: u.orders.length,
      }));
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
    });
  }

  // ---------------- render ----------------

  private loop = (ts: number) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (ts - this.last) / 1000);
    this.last = ts;
    if (this.holdPan.x || this.holdPan.y) {
      this.cam.x += this.holdPan.x * PAN_SPEED * dt;
      this.cam.y += this.holdPan.y * PAN_SPEED * dt;
      this.clampCam();
    }
    if (this.keys.size) {
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

    // Fallen bodies stay where they dropped.
    for (const c of this.corpses) {
      if (c.axis && !this.explored[this.cellAt(c.x, c.y)]) continue;
      ctx.drawImage(c.img, snap(c.x) - FEET_X * PX, snap(c.y + 9) - SPR_H * PX, c.img.width * PX, c.img.height * PX);
    }

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
    // Mortar warnings are drawn last, in screen space, so the fog of
    // war can never hide them. There are no objective tags any more:
    // no red diamonds / labels / off-screen arrows for the SS officer,
    // MG42, mortar or flak — only the mortar warning circle below,
    // which is a dodge warning, not a tag.
    this.drawMortarWarnings(ctx);
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

  /** Pulsing red warning circle under every incoming mortar shell for
   * its whole 2.4s flight. This is the only on-screen marker left:
   * no objective tags for any enemy — no red diamonds / labels /
   * off-screen arrows for the SS officer, MG42, mortar or flak. */
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

  private drawMortarWarnings(ctx: CanvasRenderingContext2D) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / Math.max(1, rect.width);
    const { s, ox, oy } = this.view;
    const toScreen = (x: number, y: number) => ({
      x: ox + (x - this.cam.x) * s,
      y: oy + (y - this.cam.y) * s,
    });

    // Mortar warning: pulsing red circle at the shell's impact point.
    for (const p of this.projectiles) {
      if (p.sourceType !== "mortar") continue;
      const sp = toScreen(p.tx, p.ty);
      const r = Math.max(10, p.aoe * s);
      const pulse = 0.55 + 0.35 * Math.sin(this.elapsed * 10);
      ctx.fillStyle = `rgba(226,74,74,${0.14 * pulse + 0.06})`;
      ctx.beginPath();
      ctx.arc(sp.x * dpr, sp.y * dpr, r * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(226,74,74,${pulse})`;
      ctx.lineWidth = Math.max(2, 2 * dpr);
      ctx.beginPath();
      ctx.arc(sp.x * dpr, sp.y * dpr, r * dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,120,120,${pulse})`;
      ctx.font = `bold ${Math.max(12, 13 * dpr)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("!", sp.x * dpr, sp.y * dpr + 4 * dpr);
    }
  }

  private drawUnit(ctx: CanvasRenderingContext2D, u: Unit) {
    // A deserter has left the field: nothing to draw, and no corpse.
    if (u.fled) return;
    if (u.vehicle) {
      // A tank: hull, turret, barrel, tracks — a chunky pixel tank,
      // not a man. No pose and no morale bar, just a health bar above
      // it. Allied olive for the Sherman, German gray for the Panzer,
      // so the two are easy to tell apart at a glance.
      const fx = snap(u.x);
      const fy = snap(u.y);
      const flip = Math.cos(u.facing) < 0;
      const ally = u.side === "allies";
      ctx.fillStyle = "#1E1E14";
      ctx.fillRect(fx - 18, fy - 6, 36, 12);
      ctx.fillStyle = ally ? "#4A5A2E" : "#565650";
      ctx.fillRect(fx - 15, fy - 9, 30, 10);
      ctx.fillStyle = ally ? "#5A6E3A" : "#6A6A66";
      ctx.fillRect(fx - 7, fy - 14, 14, 8);
      ctx.fillStyle = "#2E2E20";
      ctx.fillRect(flip ? fx - 23 : fx + 7, fy - 13, 16, 3);
      const w = 36;
      const pct = Math.max(0, u.hp / u.maxHp);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(fx - w / 2, fy - 22, w, 4);
      ctx.fillStyle = pct > 0.5 ? "#5EB872" : pct > 0.25 ? "#E5A93C" : "#E24A4A";
      ctx.fillRect(fx - w / 2, fy - 22, w * pct, 4);
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
    } else if ((u.shootT ?? 0) > 0) pose = u.cover || u.pinned || u.isStatic ? "crouch" : "shoot";
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
      const crouch = pose === "crouch";
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

    // Morale bar: one row below the health bar. Green holds, amber
    // wavers, red is about to break. Allies always show it; an enemy
    // shows it once his nerve starts to slip.
    if (u.morale < 100 || isAlly) {
      const msegs = 8;
      const mpct = Math.max(0, u.morale / 100);
      const mon = Math.ceil(mpct * msegs);
      const mbx = fx - (msegs / 2) * PX;
      const mby = headY + PX;
      ctx.fillStyle = "rgba(10,12,8,0.85)";
      ctx.fillRect(mbx - PX, mby - PX, (msegs + 2) * PX, PX * 3);
      ctx.fillStyle = u.broken ? "#E24A4A" : mpct > 0.6 ? "#7FB069" : mpct > 0.3 ? "#E5A93C" : "#E24A4A";
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
  }
}

// ---------------- terrain generation ----------------
// Every obstacle is drawn to read at a glance: hedgerow bushes, trees, buildings, steel
// hedgehogs. Hedgerows always leave walkable gaps (worn dirt), and A* routes through them.

type Ctx = CanvasRenderingContext2D;
let COVERS: Cover[] = []; // filled by buildTerrain's helpers

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
      blockers.push({ x: bx, y: by, r: 7, kind: "ruin" });
      COVERS.push({ x: bx, y: by, r: 7, q: 0.8, q0: 0.8, type: "heavy", hp: 400, maxHp: 400 });
    }
  }
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = i % 2 ? "#6E6A60" : "#57534A";
    ctx.fillRect(x - 40 + rng() * 80, y - 30 + rng() * 70, 5 + rng() * 6, 4 + rng() * 5);
  }
}

function drawTrench(ctx: Ctx, blockers: Blocker[], x0: number, y0: number, x1: number, y1: number, gaps: number[], rng: () => number) {
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
      blockers.push({ x: cx, y: cy, r: 14, kind: "trench" });
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
  for (const t of [-24, 0, 24]) {
    const bx = x + Math.cos(ang) * t;
    const by = y + Math.sin(ang) * t;
    blockers.push({ x: bx, y: by, r: 22, kind: "wreck" });
    COVERS.push({ x: bx, y: by, r: 22, q: 0.85, q0: 0.85, type: "heavy", hp: 500, maxHp: 500 });
  }
}

// Scatter a mixed cover field between x0..x1 — both sides use it.
function coverField(ctx: Ctx, blockers: Blocker[], rng: () => number, x0: number, x1: number, n: number) {
  for (let i = 0; i < n; i++) {
    const x = x0 + rng() * (x1 - x0);
    const y = 90 + rng() * (MAP_H - 180);
    const r = rng();
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
  const len = Math.hypot(x1 - x0, y1 - y0);
  const GAP = 120;
  for (let t = 0; t <= len; t += 30) {
    const f = t / len;
    if (gaps.some((g) => Math.abs(f * len - g * len) < GAP / 2)) continue;
    const x = x0 + (x1 - x0) * f + (rng() - 0.5) * 6;
    const y = y0 + (y1 - y0) * f + (rng() - 0.5) * 6;
    drawBush(ctx, x, y, 17, rng);
    blockers.push({ x, y, r: 16, kind: "hedgerow" });
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
  blockers.push({ x, y, r: r * 0.75, kind: "tree" });
  COVERS.push({ x, y, r: r * 0.75, q: 0.6, q0: 0.6, type: "light", hp: 150, maxHp: 150 });
}

function drawBuilding(ctx: Ctx, blockers: Blocker[], x: number, y: number, w: number, h: number) {
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
    blockers.push({ x: bx, y: by, r: r * 1.05, kind: "building" });
    COVERS.push({ x: bx, y: by, r: r * 1.05, q: 0.9, q0: 0.9, type: "heavy" }); // stone walls: no hp, indestructible
  }
}

function drawHedgehog(ctx: Ctx, blockers: Blocker[], x: number, y: number) {
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
  blockers.push({ x, y, r: 11, kind: "hedgehog" });
}

function buildTerrain(kind: string, rng: () => number): { canvas: HTMLCanvasElement; blockers: Blocker[]; covers: Cover[] } {
  COVERS = [];
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
  const road = (y: number) => {
    const sandy = kind === "beach";
    ctx.strokeStyle = sandy ? "#C9B184" : "#4A3E2C";
    ctx.lineWidth = 46;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(MAP_W * 0.3, y - 90, MAP_W * 0.7, y + 90, MAP_W, y);
    ctx.stroke();
    // Two wheel ruts where wheels have packed the ground down.
    ctx.strokeStyle = sandy ? "#A68B5A" : "#33261A";
    ctx.lineWidth = 7;
    for (const off of [-10, 10]) {
      ctx.beginPath();
      ctx.moveTo(0, y + off);
      ctx.bezierCurveTo(MAP_W * 0.3, y - 90 + off, MAP_W * 0.7, y + 90 + off, MAP_W, y + off);
      ctx.stroke();
    }
  };
  const gapPick = (n: number) => Array.from({ length: n }, (_, i) => (i + 0.3 + rng() * 0.4) / n);

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
    for (let i = 0; i < 34; i++) {
      const hx = 380 + rng() * 380;
      const hy = 40 + rng() * (MAP_H - 80);
      drawHedgehog(ctx, blockers, hx, hy);
      COVERS.push({ x: hx, y: hy, r: 11, q: 0.35, q0: 0.35, type: "light", hp: 80, maxHp: 80 });
    }
    coverField(ctx, blockers, rng, 1100, 3900, 20);
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
    road(MAP_H / 2);
    // Concrete pillbox ruins on the bluff.
    for (const py of [MAP_H * 0.32, MAP_H * 0.68]) {
      ctx.fillStyle = "#6A6A62";
      ctx.strokeStyle = "#2A2A26";
      ctx.lineWidth = 3;
      ctx.fillRect(1080, py - 22, 50, 44);
      ctx.strokeRect(1080, py - 22, 50, 44);
      ctx.fillStyle = "#1A1A18";
      ctx.fillRect(1080, py - 4, 8, 8);
      blockers.push({ x: 1105, y: py, r: 26, kind: "pillbox" });
      COVERS.push({ x: 1105, y: py, r: 26, q: 0.9, q0: 0.9, type: "heavy" }); // concrete: no hp, indestructible
    }
  } else if (kind === "airborne" || kind === "bocage") {
    road(MAP_H / 2);
    for (const x of [620, 1120, 1620, 2050, 2600, 3400]) hedgerow(ctx, blockers, x, 30, x, MAP_H - 30, gapPick(3), rng);
    for (const y of [430, 920]) {
      for (const [a, b] of [[640, 1100], [1140, 1600], [1640, 2030], [2140, 2580], [2940, 3380]]) hedgerow(ctx, blockers, a, y, b, y, [0.5], rng);
    }
    for (let i = 0; i < 12; i++) drawTree(ctx, blockers, 700 + rng() * 3200, 60 + rng() * (MAP_H - 120), 18 + rng() * 10, false);
    drawBuilding(ctx, blockers, 1760, 560, 160, 110); // Norman church
    drawTrench(ctx, blockers, 1400, 60, 1400, MAP_H - 60, [0.5], rng);
    drawTrench(ctx, blockers, 2400, 60, 2400, MAP_H - 60, [0.3, 0.65], rng);
    drawTrench(ctx, blockers, 3400, 60, 3400, MAP_H - 60, [0.3, 0.65], rng);
    coverField(ctx, blockers, rng, 300, 3900, 24);
    if (kind === "airborne") {
      ctx.fillStyle = "rgba(10,16,34,0.38)"; // night drop
      ctx.fillRect(0, 0, MAP_W, MAP_H);
    }
  } else if (kind === "town") {
    road(MAP_H / 2);
    for (let i = 0; i < 15; i++) {
      const w = 110 + rng() * 90;
      const h = 90 + rng() * 60;
      const bx = 520 + (i % 5) * 620 + rng() * 80;
      const by = 80 + Math.floor(i / 5) * 430 + rng() * 60;
      if (Math.abs(by + h / 2 - MAP_H / 2) < 110) continue; // keep the main street open
      drawBuilding(ctx, blockers, bx, by, w, h);
    }
    hedgerow(ctx, blockers, 400, 40, 400, MAP_H - 40, gapPick(3), rng);
    // Trenches in the gaps between building columns; the gap at 0.5
    // lands on the main street, so the road stays open.
    drawTrench(ctx, blockers, 900, 80, 900, MAP_H - 80, [0.5], rng);
    drawTrench(ctx, blockers, 2700, 80, 2700, MAP_H - 80, [0.35, 0.7], rng);
    drawTrench(ctx, blockers, 3500, 80, 3500, MAP_H - 80, [0.35, 0.7], rng);
    for (let i = 0; i < 12; i++) drawRuin(ctx, blockers, 650 + i * 280 + rng() * 60, MAP_H / 2 + (i % 2 ? -1 : 1) * (150 + rng() * 60), rng);
    coverField(ctx, blockers, rng, 500, 3900, 12);
  } else if (kind === "causeway") {
    ctx.fillStyle = "#16252A";
    ctx.fillRect(0, 0, MAP_W, MAP_H * 0.3);
    ctx.fillRect(0, MAP_H * 0.7, MAP_W, MAP_H * 0.3);
    road(MAP_H / 2);
    for (let x = 300; x < MAP_W; x += 44) {
      drawBush(ctx, x, MAP_H * 0.3, 15, rng); // reed banks along the flood
      blockers.push({ x, y: MAP_H * 0.3, r: 15, kind: "bush" });
      drawBush(ctx, x + 22, MAP_H * 0.7, 15, rng);
      blockers.push({ x: x + 22, y: MAP_H * 0.7, r: 15, kind: "bush" });
    }
    for (let i = 0; i < 10; i++) drawTree(ctx, blockers, 600 + rng() * 3300, MAP_H * (0.38 + rng() * 0.24), 16, false);
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
    for (let i = 0; i < 110; i++) {
      const tx = 320 + rng() * (MAP_W - 360);
      const ty = rng() * MAP_H;
      if (Math.abs(ty - MAP_H / 2) < 60) continue;
      drawTree(ctx, blockers, tx, ty, 16 + rng() * 12, snow);
    }
    coverField(ctx, blockers, rng, 400, 3900, 15);
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
  road(MAP_H / 2);
  return { canvas, blockers, covers: COVERS };
}
