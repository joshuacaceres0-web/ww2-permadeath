// VANGUARD '44 battle engine — real-time top-down WW2 tactics with tactical pause,
// fog of war, suppression, waves, and permadeath reporting. Pure canvas + rAF.

import { CAUSES, ENEMY_TYPES, UNIT_TYPES, levelBonus, medalBonus } from "./data";
import type { EnemyTypeId, Mission, UnitTypeId } from "@/lib/types";
import { loadSettings, SHAKE_FACTOR } from "@/lib/settings";
import { setSfxMuted, setSfxVolume, sfx } from "./sfx";
import { FEET_X, SPR_H, drawBoom, pixelize, sprite, type Head, type Pose, type Weapon } from "./sprites";

export const MAP_W = 2400;
export const MAP_H = 1350;
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
    const weapon: Weapon = ({ rifleman: "rifle", medic: "none", mg: "mg", sniper: "sniper", at: "bazooka" } as const)[u.type];
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
    default: return { pal: "wehr", head: "stahl", weapon: "rifle" };
  }
}

export type Variant = "beach" | "airborne" | "";
export type Formation = "wedge" | "line" | "column" | "spread";
export type Reinforcement = "rifle" | "heavy";
export const MAX_REINFORCEMENTS = 3;

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
  orders: Order[];
  attackId: number | null;
  targetId: number | null;
  cooldown: number;
  suppression: number;
  pinned: boolean;
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
  kind?: "sandbag" | "crate";
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

export type BlockerKind = "tree" | "ruin" | "building" | "hedgerow" | "wreck" | "crate" | "hedgehog" | "pillbox" | "bush" | "obstacle";
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

export interface BattleReport {
  missionId: string;
  victory: boolean;
  durationSec: number;
  fallen: FallenReport[];
  survivors: SurvivorReport[];
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
}

export interface ReplayFrame {
  t: number;
  phase: string;
  battleState: string;
  wave: number;
  units: ReplayUnit[];
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
}

// ---------------- pathfinding (A* on the CELL grid, 8-way, LOS-smoothed) ----------------

function buildBlockedGrid(blockers: Blocker[]): Uint8Array {
  const g = new Uint8Array(COLS * ROWS);
  for (const b of blockers) {
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
  // 2400x1350 map in the canvas instead of the normal 1600x900
  // camera window, so no scrolling is needed to see it all.
  private fitWholeMap = false;
  private aimUnitId: number | null = null;
  private mouse = { x: 0, y: 0, inside: false };
  private marquee: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private dragging = false;

  private fallen: FallenReport[] = [];
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

  // ---------------- lifecycle ----------------

  setup(mission: Mission, squad: SquadInput[], commanderBonus = 0, variant: Variant = "") {
    this.variant = variant;
    this.mission = mission;
    this.units = [];
    this.bullets = [];
    this.projectiles = [];
    this.particles = [];
    this.fallen = [];
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
    if (!u || !u.alive || u.abilityCd > 0) return;
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

  canReinforce(): boolean {
    return this.phase === "battle" && this.battleState === "active" && this.reinforcements < MAX_REINFORCEMENTS;
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
        rank: "", level: 0, reaction: 0.6, x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2, facing: 0,
        hp, maxHp: hp, speed: spec.speed * (weak ? 0.95 : 0.9), range: spec.range, vision: spec.vision * (weak ? 0.9 : 1),
        dmg: spec.dmg * (weak ? 0.75 : 1), fireInterval: spec.fireInterval * (weak ? 1.3 : 1.1), spread: spec.spread * 1.15, bulletSpeed: spec.bulletSpeed,
        isStatic: false, orders: [], attackId: null, targetId: null, cooldown: r, suppression: 0, pinned: false,
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
    if (u.abilityCd > 0) return;
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
      if (u.side !== "allies" || u.npc || !u.alive || u.abilityCd > 0) continue;
      if (u.type === "medic") {
        const hurt = this.units.some(
          (a) => a.side === "allies" && a.alive && a.hp < a.maxHp && dist(u.x, u.y, a.x, a.y) <= 130,
        );
        if (hurt) this.castAuto(u);
      } else if (u.type === "sniper" || u.type === "at") {
        if (this.bestTarget(u, (a, b) => a.maxHp - b.maxHp)) this.castAuto(u);
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
        name: s.name,
        rank: s.rank,
        level: s.level,
        reaction: Math.max(0.1, bonus.reaction + mb.reaction),
        x: sx,
        y,
        facing: 0,
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
        orders: [],
        attackId: null,
        targetId: null,
        cooldown: rng() * 0.5,
        suppression: 0,
        pinned: false,
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

  private spawnWave(index: number) {
    if (!this.mission) return;
    this.waveIndex = index;
    const rng = mulberry32(hashStr(this.mission.id + ":wave:" + index));
    let mobileCount = 0;
    for (const spec of this.waves[index]) {
      const def = ENEMY_TYPES[spec.type];
      for (let i = 0; i < spec.count; i++) {
        const isStatic = !!def.static;
        const x = isStatic
          ? MAP_W * (0.6 + rng() * 0.25)
          : MAP_W - 40 - rng() * 90;
        // Spread mobile spawns 26 units apart (wrapping down the edge)
        // instead of 8: with more enemies per wave the old spacing stacked
        // them on top of each other and they deadlocked on spawn.
        const y = isStatic
          ? MAP_H * (0.2 + rng() * 0.6)
          : 90 + ((rng() * (MAP_H - 180) + mobileCount * 26) % (MAP_H - 180));
        mobileCount++;
        const [ecx, ecy] = nearestOpen(this.blocked, Math.floor(x / CELL), Math.floor(y / CELL));
        this.units.push({
          id: this.nextId++,
          side: "axis",
          type: "rifleman",
          enemyType: spec.type,
          soldierId: null,
          name: def.label,
          rank: "",
          level: 0,
          reaction: 0.6,
          x: ecx * CELL + CELL / 2,
          y: ecy * CELL + CELL / 2,
          facing: Math.PI,
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
          orders: [],
          attackId: null,
          targetId: null,
          cooldown: rng() * 1.2,
          suppression: 0,
          pinned: false,
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
          stuckT: 0, lastX: ecx * CELL + CELL / 2, lastY: ecy * CELL + CELL / 2, stuckFails: 0, coverSeekT: Math.random() * 2, coverBanT: 0, coverBanX: 0, coverBanY: 0, coverIdleT: 0, stuckDestX: 0, stuckDestY: 0, stuckDestD: 0, chaseBanT: 0,
        });
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
          this.spawnWave(this.waveIndex + 1);
        }
      } else if (this.battleState === "active") {
        this.battleState = "victory";
        this.phase = "over";
        this.pushLog("Area secured. VICTORY.", "win");
        this.dirty = true;
      }
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
      let moving = false;
      if (u.orders.length > 0) {
        const o = u.orders[0];
        const od = dist(u.x, u.y, o.x, o.y);
        if (od < 8) u.orders.shift();
        else {
          this.moveToward(u, o.x, o.y, dt);
          moving = true;
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
          if (pd > u.range * 0.9 || !this.los(u, prey)) {
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
      // them until he orders them. The chase branch above already moves
      // NPCs/axis when the prey is out of range or has no LOS, but it
      // never runs for a unit whose orders just emptied while it was
      // in cover with a target in range but behind its own cover.
      if (!u.isStatic && u.cover && (u.npc || u.side === "axis" || (this.autoBattle && u.side === "allies" && !u.npc)) && u.orders.length === 0 && u.chase.length === 0 && !u.attackId) {
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
      if (!u.isStatic && !u.cover && u.coverSeekT <= 0) {
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
      } else if (u.cooldown <= 0 && focus && d <= u.range && !u.pinned && this.los(u, focus)) {
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
    return lineClear(this.blocked, a.x, a.y, b.x, b.y);
  }

  // Follow an A* path toward a moving point, re-planning every ~1s.
  // Returns false (and clears the chase) while the unit is banned from
  // chasing after a stuck drop — otherwise it would re-chase the same
  // prey behind the same wall in the very next frame.
  private chaseTo(u: Unit, x: number, y: number, dt: number): boolean {
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
    this.moveToward(u, wp.x, wp.y, dt);
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

  private moveToward(u: Unit, x: number, y: number, dt: number) {
    const d = dist(u.x, u.y, x, y);
    if (d < 1) return;
    const sp = u.speed * (u.pinned ? 0.35 : 1);
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

  private damage(u: Unit, dmg: number, sourceType: string, killerId: number | null) {
    if (!u.alive) return;
    u.hp -= dmg;
    if (u.side === "allies") u.damageTaken += Math.min(dmg, u.hp + dmg);
    if (u.hp <= 0) this.kill(u, sourceType, killerId);
  }

  private kill(u: Unit, sourceType: string, killerId: number | null) {
    u.alive = false;
    u.hp = 0;
    u.deathT = 0;
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
    } else {
      const killer = this.unitById(killerId);
      if (killer && killer.side === "allies") {
        killer.kills++;
        if (u.enemyType === "mg42" || u.enemyType === "flak") killer.heavyKills++;
        if (u.enemyType === "officer") killer.officerKills++;
      }
      this.pushLog(`${ENEMY_TYPES[u.enemyType!].label} neutralized.`, "kill");
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

  /** Pulsing red warning circle under every incoming mortar shell for
   * its whole 2.4s flight. This is the only on-screen marker left:
   * no objective tags for any enemy — no red diamonds / labels /
   * off-screen arrows for the SS officer, MG42, mortar or flak. */
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

    // In-cover marker: small pixel shield beside the head.
    if (u.cover && (isAlly || this.visible[this.cellAt(u.x, u.y)])) {
      const sx = fx - 7 * PX;
      const sy = headY + PX;
      ctx.fillStyle = "#0D0F0C";
      ctx.fillRect(sx - PX, sy - PX, PX * 5, PX * 5);
      ctx.fillStyle = u.cover.type === "heavy" ? "#E5A93C" : "#4ECDC4"; // gold = heavy cover, teal = light cover
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
  const blockers: Blocker[] = [];
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
  const road = (y: number) => {
    ctx.strokeStyle = "#4A3E2C";
    ctx.lineWidth = 46;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(MAP_W * 0.3, y - 90, MAP_W * 0.7, y + 90, MAP_W, y);
    ctx.stroke();
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
    coverField(ctx, blockers, rng, 1100, 2300, 12);
    for (const y of [MAP_H * 0.2, MAP_H * 0.5, MAP_H * 0.8]) drawSandbags(ctx, 1950, y, 0, 6); // German trench line
    // Bluffs: dune-grass ridge with three draws (the real Omaha exits).
    hedgerow(ctx, blockers, 1000, 0, 1000, MAP_H, [0.2, 0.5, 0.82], rng);
    hedgerow(ctx, blockers, 1700, 0, 1700, MAP_H, gapPick(2), rng);
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
    for (const x of [620, 1120, 1620, 2050]) hedgerow(ctx, blockers, x, 30, x, MAP_H - 30, gapPick(3), rng);
    for (const y of [430, 920]) {
      for (const [a, b] of [[640, 1100], [1140, 1600], [1640, 2030]]) hedgerow(ctx, blockers, a, y, b, y, [0.5], rng);
    }
    for (let i = 0; i < 10; i++) drawTree(ctx, blockers, 700 + rng() * 1600, 60 + rng() * (MAP_H - 120), 18 + rng() * 10, false);
    drawBuilding(ctx, blockers, 1760, 560, 160, 110); // Norman church
    coverField(ctx, blockers, rng, 300, 2300, 16);
    if (kind === "airborne") {
      ctx.fillStyle = "rgba(10,16,34,0.38)"; // night drop
      ctx.fillRect(0, 0, MAP_W, MAP_H);
    }
  } else if (kind === "town") {
    road(MAP_H / 2);
    for (let i = 0; i < 12; i++) {
      const w = 110 + rng() * 90;
      const h = 90 + rng() * 60;
      const bx = 520 + (i % 4) * 460 + rng() * 80;
      const by = 80 + Math.floor(i / 4) * 430 + rng() * 60;
      if (Math.abs(by + h / 2 - MAP_H / 2) < 110) continue; // keep the main street open
      drawBuilding(ctx, blockers, bx, by, w, h);
    }
    hedgerow(ctx, blockers, 400, 40, 400, MAP_H - 40, gapPick(3), rng);
    for (let i = 0; i < 6; i++) drawRuin(ctx, blockers, 650 + i * 280 + rng() * 60, MAP_H / 2 + (i % 2 ? -1 : 1) * (150 + rng() * 60), rng);
    coverField(ctx, blockers, rng, 500, 2300, 8);
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
    for (let i = 0; i < 8; i++) drawTree(ctx, blockers, 600 + rng() * 1700, MAP_H * (0.38 + rng() * 0.24), 16, false);
    for (let i = 0; i < 7; i++) drawSandbags(ctx, 500 + i * 260, MAP_H * (0.42 + (i % 2) * 0.16), Math.PI / 2, 5);
    drawWreck(ctx, blockers, 1250, MAP_H * 0.47, 0.2);
    drawWreck(ctx, blockers, 1850, MAP_H * 0.55, -0.3);
  } else if (kind === "forest") {
    road(MAP_H / 2);
    for (let i = 0; i < 110; i++) {
      const tx = 320 + rng() * (MAP_W - 360);
      const ty = rng() * MAP_H;
      if (Math.abs(ty - MAP_H / 2) < 60) continue;
      drawTree(ctx, blockers, tx, ty, 16 + rng() * 12, snow);
    }
    coverField(ctx, blockers, rng, 400, 2300, 10);
    drawSandbags(ctx, 1900, MAP_H / 2 - 120, 0, 7); // bunker line
    drawSandbags(ctx, 1900, MAP_H / 2 + 120, 0, 7);
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
  return { canvas, blockers, covers: COVERS };
}
