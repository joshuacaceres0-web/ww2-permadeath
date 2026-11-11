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

interface Blocker {
  x: number;
  y: number;
  r: number;
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

function findPath(g: Uint8Array, sx: number, sy: number, tx: number, ty: number): Order[] {
  if (lineClear(g, sx, sy, tx, ty)) return [{ x: tx, y: ty }];
  const clampC = (v: number, m: number) => Math.max(0, Math.min(m - 1, v));
  const [scx, scy] = nearestOpen(g, clampC(Math.floor(sx / CELL), COLS), clampC(Math.floor(sy / CELL), ROWS));
  const [tcx, tcy] = nearestOpen(g, clampC(Math.floor(tx / CELL), COLS), clampC(Math.floor(ty / CELL), ROWS));
  const start = scy * COLS + scx;
  const goal = tcy * COLS + tcx;
  const gScore = new Float32Array(COLS * ROWS).fill(Infinity);
  const came = new Int32Array(COLS * ROWS).fill(-1);
  const closed = new Uint8Array(COLS * ROWS);
  const open: number[] = [start];
  const f = new Float32Array(COLS * ROWS).fill(Infinity);
  gScore[start] = 0;
  const h = (i: number) => Math.hypot((i % COLS) - tcx, Math.floor(i / COLS) - tcy);
  f[start] = h(start);
  let iter = 0;
  while (open.length && iter++ < 6000) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
    const cur = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
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
          open.push(ni);
        }
      }
  }
  if (came[goal] === -1 && goal !== start) return [{ x: tx, y: ty }];
  const cells: Order[] = [];
  for (let i = goal; i !== -1 && i !== start; i = came[i]) {
    cells.push({ x: (i % COLS) * CELL + CELL / 2, y: Math.floor(i / COLS) * CELL + CELL / 2 });
  }
  cells.reverse();
  if (!g[Math.floor(ty / CELL) * COLS + Math.floor(tx / CELL)]) cells[cells.length - 1] = { x: tx, y: ty };
  // String-pull: drop waypoints we can see past.
  const out: Order[] = [];
  let ax = sx;
  let ay = sy;
  for (let i = 0; i < cells.length; i++) {
    const next = cells[i + 1];
    if (next && lineClear(g, ax, ay, next.x, next.y)) continue;
    out.push(cells[i]);
    ax = cells[i].x;
    ay = cells[i].y;
  }
  return out.length ? out : [{ x: tx, y: ty }];
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
  private phase: "briefing" | "battle" | "over" = "briefing";
  private paused = false;
  private battleState: "active" | "victory" | "defeat" = "active";
  private shake = 0;

  private selected: number[] = [];
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
    this.aimUnitId = null;
    this.elapsed = 0;
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

    this.spawnAllies(squad, rng, commanderBonus);
    // 2nd Platoon: exactly 3 weak allies, so they support the fight but
    // can never clear a wave on their own — in the Emergent play test
    // Wave 1 was cleared entirely by them while the player's squad stood
    // idle and fired nothing. The real count was 2 + min(3, mission.index),
    // i.e. 2-5; the design decision here is a fixed 3, weak.
    this.spawnNpcAllies(3, rng);
    this.spawnWave(0);
    this.recomputeFog();
    this.resize();
    this.dirty = true;
    const allies = this.units.filter((u) => u.side === "allies");
    if (allies.length) this.centerOn(allies.reduce((t, u) => t + u.x, 0) / allies.length, allies.reduce((t, u) => t + u.y, 0) / allies.length);
    this.pushLog(`${mission.code} — assets in position. Awaiting your order.`, "info");
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

  selectAll() {
    this.selected = this.units.filter((u) => u.side === "allies" && u.alive && !u.npc).map((u) => u.id);
    this.dirty = true;
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
    for (let i = 0; i < n; i++) {
      this.addNpc("rifleman", 90 + rng() * 80, 120 + rng() * (MAP_H - 240), i, rng(), true);
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
      // Weak NPCs (2nd Platoon): half damage, 70% health, slower and
      // shorter vision, so they support the fight instead of winning it
      // alone. Paid reinforcements call addNpc without `weak` and keep
      // full stats.
      const hp = weak ? Math.round(spec.hp * 0.7) : spec.hp;
      this.units.push({
        id: this.nextId++, side: "allies", type, enemyType: null, soldierId: null,
        name: `${["Pvt.", "Pfc.", "Cpl."][i % 3]} ${SURN[i % SURN.length]}`,
        rank: "", level: 0, reaction: 0.6, x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2, facing: 0,
        hp, maxHp: hp, speed: spec.speed * (weak ? 0.85 : 0.9), range: spec.range, vision: spec.vision * (weak ? 0.8 : 1),
        dmg: spec.dmg * (weak ? 0.5 : 1), fireInterval: spec.fireInterval * (weak ? 1.6 : 1.1), spread: spec.spread * 1.15, bulletSpeed: spec.bulletSpeed,
        isStatic: false, orders: [], attackId: null, targetId: null, cooldown: r, suppression: 0, pinned: false,
        abilityCd: 0, burst: 0, burstTimer: 0, burstTarget: null, kills: 0, alive: true, walk: 0,
        damageTaken: 0, healed: 0, heavyKills: 0, officerKills: 0, dmgMult: 1, healMult: 1,
        chase: [], repathT: r, npc: true, cover: null, coverT: 0,
      });
    }
  }

  /** Selected men run to the nearest cover facing the enemy. */
  takeCover() {
    if (this.phase !== "battle") return;
    for (const u of this.units) {
      if (!u.alive || !this.selected.includes(u.id)) continue;
      const c = this.bestCover(u, 340);
      if (c) u.orders = findPath(this.blocked, u.x, u.y, c.x, c.y);
    }
    this.pushLog("Get down! Squad moving to cover.", "info");
  }

  /** Pick a squad formation; the selected men re-form on their current objective. */
  setFormation(f: Formation) {
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
  private bestCover(u: Unit, radius: number): { x: number; y: number } | null {
    const threat = this.nearestAlly(u);
    let best: { x: number; y: number } | null = null;
    let bestD = radius;
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
      if (this.blocked[Math.floor(sy / CELL) * COLS + Math.floor(sx / CELL)]) continue;
      const d = dist(u.x, u.y, sx, sy);
      if (d < bestD) {
        bestD = d;
        best = { x: sx, y: sy };
      }
    }
    return best;
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
    if (this.phase === "briefing") return;
    if (k >= "1" && k <= "8") {
      const idx = parseInt(k, 10) - 1;
      const allies = this.units.filter((u) => u.side === "allies" && !u.npc);
      if (allies[idx]) {
        this.selected = allies[idx].alive ? [allies[idx].id] : [];
        if (allies[idx].alive) this.centerOn(allies[idx].x, allies[idx].y);
        this.aimUnitId = null;
        this.dirty = true;
      }
      return;
    }
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
    if (this.phase !== "battle") return;
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
      else if (this.selected.length) this.issueOrder(p.x, p.y, false);
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
        const y = isStatic
          ? MAP_H * (0.2 + rng() * 0.6)
          : 90 + rng() * (MAP_H - 180) + mobileCount * 8;
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
      } else if ((u.side === "axis" || u.npc) && !u.isStatic && u.enemyType !== "mortar") {
        const prey = this.nearestAlly(u);
        if (prey) {
          const pd = dist(u.x, u.y, prey.x, prey.y);
          if (pd > u.range * 0.9 || !this.los(u, prey)) {
            this.chaseTo(u, prey.x, prey.y, dt);
            moving = true;
          } else if (!u.cover) {
            // In range: both sides look for nearby cover before trading fire.
            u.coverT -= dt;
            if (u.coverT <= 0) {
              u.coverT = 3;
              const c = this.bestCover(u, 130);
              if (c) u.orders = findPath(this.blocked, u.x, u.y, c.x, c.y);
            }
          }
        }
        // No prey: NPCs hold position instead of pushing east blind into
        // the next wave. The old push-east made 2nd Platoon meet Wave 1
        // in the middle and clear it alone while the player's squad
        // stood idle at the west edge.
      } else if (u.side === "allies" && attackOrder && (d > u.range * 0.92 || !this.los(u, attackOrder))) {
        this.chaseTo(u, attackOrder.x, attackOrder.y, dt);
        moving = true;
      }

      if (!moving && focus) u.facing = Math.atan2(focus.y - u.y, focus.x - u.x);

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
          // 2.4s flight time is the warning window — drawObjectiveMarkers
          // draws a pulsing red circle at the impact point for its whole flight.
          this.pushLog("Incoming mortar!", "wave");
        }
      } else if (u.cooldown <= 0 && focus && d <= u.range && !u.pinned && this.los(u, focus)) {
        const interval = u.fireInterval * aura;
        u.cooldown = interval;
        this.fireAt(u, focus, moving);
      }

      // Medic passive aura.
      if (u.side === "allies" && u.type === "medic") {
        for (const a of this.units) {
          if (a.side !== "allies" || !a.alive || a.id === u.id) continue;
          if (dist(u.x, u.y, a.x, a.y) <= 90) {
            const before = a.hp;
            a.hp = Math.min(a.maxHp, a.hp + 3 * u.healMult * dt);
            u.healed += a.hp - before;
            a.suppression = Math.max(0, a.suppression - 5 * dt);
          }
        }
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
            // Cover between shooter and target soaks the round.
            const c = u.cover;
            if (c && (c.x - u.x) * (b.ox - u.x) + (c.y - u.y) * (b.oy - u.y) > 0 && Math.random() < c.q) {
              this.puff(b.x, b.y);
              u.suppression = Math.min(100, u.suppression + b.suppress * 0.4);
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

    // Fog of war recompute.
    this.fogT += dt;
    if (this.fogT >= 0.12) {
      this.fogT = 0;
      for (const u of this.units) {
        if (!u.alive) continue;
        u.cover = null;
        for (const c of this.covers) {
          if (dist(u.x, u.y, c.x, c.y) <= c.r + UNIT_R + 12) {
            if (!u.cover || c.q > u.cover.q) u.cover = c;
          }
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
  private chaseTo(u: Unit, x: number, y: number, dt: number) {
    u.repathT -= dt;
    if (u.repathT <= 0 || u.chase.length === 0) {
      u.chase = findPath(this.blocked, u.x, u.y, x, y);
      u.repathT = 1 + Math.random() * 0.4;
    }
    const wp = u.chase[0];
    if (dist(u.x, u.y, wp.x, wp.y) < 10) u.chase.shift();
    this.moveToward(u, wp.x, wp.y, dt);
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

  private moveToward(u: Unit, x: number, y: number, dt: number) {
    const d = dist(u.x, u.y, x, y);
    if (d < 1) return;
    const sp = u.speed * (u.pinned ? 0.35 : 1);
    u.x += ((x - u.x) / d) * sp * dt;
    u.y += ((y - u.y) / d) * sp * dt;
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
          if (!a.isStatic) {
            a.x += nx * push;
            a.y += ny * push;
          }
          if (!b.isStatic) {
            b.x -= nx * push;
            b.y -= ny * push;
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
      enemiesAlive: this.enemiesAlive(),
      wave: this.waveIndex + 1,
      waves: this.waves.length,
      aimUnitId: this.aimUnitId,
      log: this.log.slice(-7),
      formation: this.formation,
      touchBox: this.touchBox,
      reinforcementsLeft: MAX_REINFORCEMENTS - this.reinforcements,
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
    // Objective markers and mortar warnings are drawn last, in screen
    // space, so the fog of war can never hide them — the MG42 and mortar
    // used to sit in the dark east side with nothing pointing at them.
    this.drawObjectiveMarkers(ctx);
  }

  /** Permanent objective markers for key enemies, plus a pulsing red
   * warning circle under every incoming mortar shell for its whole
   * 2.4s flight. Markers off-screen become edge arrows. */
  private drawObjectiveMarkers(ctx: CanvasRenderingContext2D) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / Math.max(1, rect.width);
    const { s, ox, oy } = this.view;
    const W = rect.width;
    const H = rect.height;
    const toScreen = (x: number, y: number) => ({
      x: ox + (x - this.cam.x) * s,
      y: oy + (y - this.cam.y) * s,
    });
    const onScreen = (p: { x: number; y: number }) => p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H;

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

    // Objective markers: SS officer, MG42 bunker, mortar team, flak gun.
    const targets = this.units.filter(
      (u) => u.alive && u.side === "axis" && u.enemyType && ["officer", "mg42", "mortar", "flak"].includes(u.enemyType)
    );
    for (const u of targets) {
      const sp = toScreen(u.x, u.y);
      const label = u.enemyType === "officer" ? "SS OFFICER" : u.enemyType === "mg42" ? "MG42" : u.enemyType === "mortar" ? "MORTAR" : "FLAK";
      if (onScreen(sp)) {
        const cx = sp.x * dpr;
        const cy = sp.y * dpr;
        const r = Math.max(8, 10 * dpr);
        ctx.fillStyle = "rgba(226,74,74,0.95)";
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r, cy);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#FFF0B0";
        ctx.font = `bold ${Math.max(10, 11 * dpr)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(label, cx, cy - r - 4 * dpr);
      } else {
        // Off-screen: clamp to the edge and point at it.
        const ex = Math.max(18, Math.min(W - 18, sp.x));
        const ey = Math.max(18, Math.min(H - 18, sp.y));
        const ang = Math.atan2(sp.y - ey, sp.x - ex);
        ctx.save();
        ctx.translate(ex * dpr, ey * dpr);
        ctx.rotate(ang);
        ctx.fillStyle = "rgba(226,74,74,0.95)";
        ctx.beginPath();
        ctx.moveTo(12 * dpr, 0);
        ctx.lineTo(-8 * dpr, -8 * dpr);
        ctx.lineTo(-8 * dpr, 8 * dpr);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = "rgba(255,240,176,0.95)";
        ctx.font = `bold ${Math.max(10, 11 * dpr)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(label, ex * dpr, (ey + 20) * dpr);
      }
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
      ctx.fillStyle = u.cover.q >= 0.6 ? "#4ECDC4" : "#2E8A84";
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
    COVERS.push({ x: bx, y: by, r: 7, q: 0.65, q0: 0.65, kind: "sandbag", hp: 110, maxHp: 110 });
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
      blockers.push({ x: bx, y: by, r: 7 });
      COVERS.push({ x: bx, y: by, r: 7, q: 0.8 });
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
    const b = { x: x + dx, y: y + dy, r: 8 };
    blockers.push(b);
    COVERS.push({ x: x + dx, y: y + dy, r: 8, q: 0.55, q0: 0.55, kind: "crate", hp: 70, maxHp: 70, blocker: b });
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
    blockers.push({ x: bx, y: by, r: 22 });
    COVERS.push({ x: bx, y: by, r: 22, q: 0.85 });
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
    blockers.push({ x, y, r: 16 });
    COVERS.push({ x, y, r: 16, q: 0.45 });
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
  blockers.push({ x, y, r: r * 0.75 });
  COVERS.push({ x, y, r: r * 0.75, q: 0.6 });
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
  for (let bx = x + r; bx <= x + w - r + 1; bx += r) for (let by = y + r; by <= y + h - r + 1; by += r) blockers.push({ x: bx, y: by, r: r * 1.05 });
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
  blockers.push({ x, y, r: 11 });
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
    for (let y = 30; y < MAP_H; y += 26) COVERS.push({ x: 820, y, r: 14, q: 0.6 });
    for (let i = 0; i < 34; i++) {
      const hx = 380 + rng() * 380;
      const hy = 40 + rng() * (MAP_H - 80);
      drawHedgehog(ctx, blockers, hx, hy);
      COVERS.push({ x: hx, y: hy, r: 11, q: 0.35 });
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
      blockers.push({ x: 1105, y: py, r: 26 });
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
      blockers.push({ x, y: MAP_H * 0.3, r: 15 });
      drawBush(ctx, x + 22, MAP_H * 0.7, 15, rng);
      blockers.push({ x: x + 22, y: MAP_H * 0.7, r: 15 });
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
