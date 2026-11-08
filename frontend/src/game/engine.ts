// VANGUARD '44 battle engine — real-time top-down WW2 tactics with tactical pause,
// fog of war, suppression, waves, and permadeath reporting. Pure canvas + rAF.

import { CAUSES, ENEMY_TYPES, UNIT_TYPES } from "./data";
import type { EnemyTypeId, Mission, UnitTypeId } from "@/lib/types";

export const MAP_W = 1600;
export const MAP_H = 900;
const CELL = 24;
const COLS = Math.ceil(MAP_W / CELL);
const ROWS = Math.ceil(MAP_H / CELL);
const UNIT_R = 9;

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
}

interface Bullet {
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
  kind: "muzzle" | "blood" | "dust" | "smoke" | "spark" | "heal" | "ring";
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
}

export interface FallenReport {
  soldierId: string;
  cause: string;
  kills: number;
}

export interface SurvivorReport {
  soldierId: string;
  kills: number;
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
  }

  // ---------------- lifecycle ----------------

  setup(mission: Mission, squad: Array<{ id: string; name: string; type: UnitTypeId }>) {
    this.mission = mission;
    this.units = [];
    this.bullets = [];
    this.projectiles = [];
    this.particles = [];
    this.fallen = [];
    this.log = [];
    this.selected = [];
    this.aimUnitId = null;
    this.elapsed = 0;
    this.phase = "briefing";
    this.paused = false;
    this.battleState = "active";
    this.waveIndex = 0;
    this.nextWaveT = 0;

    // Group enemy specs into waves.
    const byWave = new Map<number, Array<{ type: EnemyTypeId; count: number }>>();
    for (const e of mission.enemies) {
      const list = byWave.get(e.wave) ?? [];
      list.push({ type: e.type, count: e.count });
      byWave.set(e.wave, list);
    }
    this.waves = [...byWave.keys()].sort((a, b) => a - b).map((k) => byWave.get(k)!);

    const rng = mulberry32(hashStr(mission.id));
    const built = buildTerrain(mission.terrain, rng);
    this.terrain = built.canvas;
    this.blockers = built.blockers;
    this.tctx = built.canvas.getContext("2d");

    this.fog = document.createElement("canvas");
    this.fog.width = COLS;
    this.fog.height = ROWS;
    this.fogCtx = this.fog.getContext("2d");
    this.visible = new Uint8Array(COLS * ROWS);
    this.explored = new Uint8Array(COLS * ROWS);

    this.spawnAllies(squad, rng);
    this.spawnWave(0);
    this.recomputeFog();
    this.resize();
    this.dirty = true;
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
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (rect.width === 0 || rect.height === 0) return;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    const s = Math.min(rect.width / MAP_W, rect.height / MAP_H);
    this.view = {
      s,
      ox: (rect.width - MAP_W * s) / 2,
      oy: (rect.height - MAP_H * s) / 2,
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
        .map((u) => ({ soldierId: u.soldierId!, kills: u.kills })),
    };
  }

  // ---------------- public controls ----------------

  togglePause() {
    if (this.phase !== "battle") return;
    this.paused = !this.paused;
    this.dirty = true;
  }

  selectAll() {
    this.selected = this.units.filter((u) => u.side === "allies" && u.alive).map((u) => u.id);
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
      x: (clientX - rect.left - this.view.ox) / this.view.s,
      y: (clientY - rect.top - this.view.oy) / this.view.s,
    };
  }

  private onContextMenu = (e: Event) => e.preventDefault();

  private onKey = (e: KeyboardEvent) => {
    if (this.phase === "over") return;
    const k = e.key.toLowerCase();
    if (k === " ") {
      e.preventDefault();
      if (this.phase === "briefing") return;
      this.togglePause();
      return;
    }
    if (this.phase === "briefing") return;
    if (k >= "1" && k <= "5") {
      const idx = parseInt(k, 10) - 1;
      const allies = this.units.filter((u) => u.side === "allies");
      if (allies[idx]) {
        this.selected = allies[idx].alive ? [allies[idx].id] : [];
        this.aimUnitId = null;
        this.dirty = true;
      }
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
    if (e.key === " ") e.preventDefault();
  };

  private onPointerDown = (e: PointerEvent) => {
    if (this.phase !== "battle") return;
    const p = this.toMap(e.clientX, e.clientY);
    this.mouse = { x: p.x, y: p.y, inside: true };
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
        if (u.side !== "allies" || !u.alive) continue;
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
        .filter((u) => u.side === "allies" && u.alive && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1)
        .map((u) => u.id);
      this.aimUnitId = null;
    }
    this.marquee = null;
    this.dragging = false;
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
      const OFFS = [
        [0, 0],
        [-30, -20],
        [-30, 20],
        [-60, 0],
        [0, -42],
      ];
      squad.forEach((u, i) => {
        const off = OFFS[i % OFFS.length];
        const ox = x + off[0];
        const oy = y + off[1];
        u.attackId = null;
        if (queue) u.orders.push({ x: ox, y: oy });
        else u.orders = [{ x: ox, y: oy }];
      });
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
      best.hp = Math.min(best.maxHp, best.hp + 50);
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

  private spawnAllies(squad: Array<{ id: string; name: string; type: UnitTypeId }>, rng: () => number) {
    const n = squad.length;
    squad.forEach((s, i) => {
      const spec = UNIT_TYPES[s.type];
      const y = MAP_H / 2 + (i - (n - 1) / 2) * 72 + (rng() * 20 - 10);
      this.units.push({
        id: this.nextId++,
        side: "allies",
        type: s.type,
        enemyType: null,
        soldierId: s.id,
        name: s.name,
        x: 80 + rng() * 60,
        y,
        facing: 0,
        hp: spec.hp,
        maxHp: spec.hp,
        speed: spec.speed,
        range: spec.range,
        vision: spec.vision,
        dmg: spec.dmg,
        fireInterval: spec.fireInterval,
        spread: spec.spread,
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
        this.units.push({
          id: this.nextId++,
          side: "axis",
          type: "rifleman",
          enemyType: spec.type,
          soldierId: null,
          name: def.label,
          x,
          y,
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
    return this.units.filter((u) => u.side === "allies" && u.alive).length;
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
      if (!target || !target.alive) {
        target = this.autoTarget(u);
        u.targetId = target ? target.id : null;
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
      } else if (u.side === "axis" && !u.isStatic) {
        const prey = this.nearestAlly(u);
        if (prey) {
          const pd = dist(u.x, u.y, prey.x, prey.y);
          if (pd > u.range * 0.9) {
            this.moveToward(u, prey.x, prey.y, dt);
            moving = true;
          }
        }
      } else if (u.side === "allies" && attackOrder && d > u.range * 0.92) {
        this.moveToward(u, attackOrder.x, attackOrder.y, dt);
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
      } else if (u.cooldown <= 0 && focus && d <= u.range && !u.pinned) {
        const interval = u.fireInterval * aura;
        u.cooldown = interval;
        this.fireAt(u, focus, moving);
      }

      // Medic passive aura.
      if (u.side === "allies" && u.type === "medic") {
        for (const a of this.units) {
          if (a.side !== "allies" || !a.alive || a.id === u.id) continue;
          if (dist(u.x, u.y, a.x, a.y) <= 90) {
            a.hp = Math.min(a.maxHp, a.hp + 3 * dt);
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
      this.recomputeFog();
    }

    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 18);
  }

  private autoTarget(u: Unit): Unit | null {
    let best: Unit | null = null;
    let bestD = u.range * 1.05;
    for (const e of this.units) {
      if (e.side === u.side || !e.alive) continue;
      const d = dist(u.x, u.y, e.x, e.y);
      if (d < bestD) {
        best = e;
        bestD = d;
      }
    }
    return best;
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
    this.spawnBullet(u, target.x, target.y, u.spread * lead, u.dmg, u.type === "mg" ? 20 : 14);
  }

  private spawnBullet(u: Unit, tx: number, ty: number, spread: number, dmg: number, suppress: number) {
    const ang = Math.atan2(ty - u.y, tx - u.x) + (Math.random() - 0.5) * spread * 2;
    const mx = u.x + Math.cos(u.facing) * 14;
    const my = u.y + Math.sin(u.facing) * 14;
    this.bullets.push({
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
    if (u.hp <= 0) this.kill(u, sourceType, killerId);
  }

  private kill(u: Unit, sourceType: string, killerId: number | null) {
    u.alive = false;
    u.hp = 0;
    this.corpseFx(u);
    if (u.side === "allies") {
      this.fallen.push({
        soldierId: u.soldierId!,
        cause: CAUSES[sourceType] ?? "Killed in action",
        kills: u.kills,
      });
      this.selected = this.selected.filter((id) => id !== u.id);
      this.pushLog(`${u.name} is down. He isn't getting up.`, "death");
    } else {
      const killer = this.unitById(killerId);
      if (killer && killer.side === "allies") killer.kills++;
      this.pushLog(`${ENEMY_TYPES[u.enemyType!].label} neutralized.`, "kill");
    }
    this.dirty = true;
  }

  private suppressArea(x: number, y: number, side: "allies" | "axis", amount: number) {
    for (const u of this.units) {
      if (!u.alive || u.side === side) continue;
      const d = dist(x, y, u.x, u.y);
      if (d < 38) {
        u.suppression = Math.min(100, u.suppression + amount * (1 - d / 48));
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
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0.35, max: 0.35, size: aoe, kind: "ring" });
    if (this.tctx) {
      this.tctx.fillStyle = "rgba(14,13,10,0.5)";
      this.tctx.beginPath();
      this.tctx.ellipse(x, y, aoe * 0.45, aoe * 0.35, Math.random() * Math.PI, 0, Math.PI * 2);
      this.tctx.fill();
    }
    if (!prefersReducedMotion) this.shake = Math.min(10, this.shake + 6);
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
    // Permanent blood stain + fallen silhouette etched into the terrain.
    t.fillStyle = "rgba(56,14,14,0.55)";
    t.beginPath();
    t.ellipse(u.x, u.y, 14, 10, Math.random() * Math.PI, 0, Math.PI * 2);
    t.fill();
    t.strokeStyle = u.side === "allies" ? "rgba(28,32,22,0.9)" : "rgba(40,36,28,0.9)";
    t.lineWidth = 3;
    t.beginPath();
    t.ellipse(u.x, u.y + 2, 7, 5, u.facing, 0, Math.PI * 2);
    t.stroke();
    t.beginPath();
    t.moveTo(u.x - 5, u.y - 6);
    t.lineTo(u.x + 7, u.y - 2);
    t.stroke();
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
      .filter((u) => u.side === "allies")
      .map((u) => ({
        id: u.id,
        soldierId: u.soldierId,
        name: u.name,
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
    });
  }

  // ---------------- render ----------------

  private loop = (ts: number) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (ts - this.last) / 1000);
    this.last = ts;
    this.update(dt);
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
    ctx.fillStyle = "#080A08";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const shakeX = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (ox + shakeX), dpr * (oy + shakeY));

    if (this.terrain) ctx.drawImage(this.terrain, 0, 0);

    // Order lines for the selected squad.
    for (const u of this.units) {
      if (u.side !== "allies" || !u.alive || !this.selected.includes(u.id)) continue;
      if (u.orders.length > 0) {
        const o = u.orders[0];
        ctx.strokeStyle = "rgba(78,205,196,0.85)";
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(u.x, u.y);
        ctx.lineTo(o.x, o.y);
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
          ctx.setLineDash([3, 4]);
          ctx.lineWidth = 1;
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
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(u.x, u.y, u.range, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        if (this.mouse.inside) {
          ctx.strokeStyle = "rgba(229,169,60,1)";
          ctx.lineWidth = 1.4;
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

    // Units.
    for (const u of this.units) {
      if (!u.alive) continue;
      if (u.side === "axis" && !this.visible[this.cellAt(u.x, u.y)]) continue;
      this.drawUnit(ctx, u);
    }

    // Bullets.
    for (const b of this.bullets) {
      ctx.strokeStyle = b.ally ? "rgba(255,217,125,0.9)" : "rgba(255,122,92,0.9)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02);
      ctx.stroke();
    }

    // Projectiles.
    for (const p of this.projectiles) {
      const k = p.t / p.dur;
      const x = p.x + (p.tx - p.sx) * k;
      const y = p.y + (p.ty - p.sy) * k;
      const arc = p.kind === "grenade" ? Math.sin(Math.PI * k) * 14 : 0;
      ctx.fillStyle = p.kind === "grenade" ? "#3A3A2E" : "#2E2A22";
      ctx.beginPath();
      ctx.arc(x, y - arc, p.kind === "grenade" ? 3 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      if (p.kind === "rocket") {
        ctx.fillStyle = "rgba(255,170,80,0.9)";
        ctx.beginPath();
        ctx.arc(x - (p.tx - p.sx) * 0.01, y + (p.ty - p.sy) * 0.01 + 3, 2, 0, Math.PI * 2);
        ctx.fill();
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
          ctx.strokeStyle = `rgba(229,169,60,${a})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1.2 - a), 0, Math.PI * 2);
          ctx.stroke();
          continue;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // Fog of war.
    if (this.fog) {
      ctx.drawImage(this.fog, 0, 0, COLS, ROWS, 0, 0, MAP_W, MAP_H);
    }

    // Vignette.
    const grad = ctx.createRadialGradient(MAP_W / 2, MAP_H / 2, MAP_H / 2.6, MAP_W / 2, MAP_H / 2, MAP_H / 0.9);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, MAP_W, MAP_H);

    // Marquee selection box.
    if (this.marquee) {
      const { x0, y0, x1, y1 } = this.marquee;
      ctx.strokeStyle = "rgba(78,205,196,0.95)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(78,205,196,0.08)";
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawUnit(ctx: CanvasRenderingContext2D, u: Unit) {
    const isAlly = u.side === "allies";
    // Shadow.
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(u.x, u.y + 6, 8, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Facing / weapon.
    ctx.strokeStyle = isAlly ? "#20261A" : "#2A2820";
    ctx.lineWidth = u.type === "sniper" ? 1.6 : u.type === "mg" || u.enemyType === "mg42" ? 3 : 2.2;
    ctx.beginPath();
    ctx.moveTo(u.x, u.y);
    ctx.lineTo(u.x + Math.cos(u.facing) * (u.type === "sniper" ? 18 : 13), u.y + Math.sin(u.facing) * (u.type === "sniper" ? 18 : 13));
    ctx.stroke();

    // Body.
    ctx.fillStyle = u.isStatic ? "#4A4A3C" : isAlly ? "#4E5D3C" : "#565040";
    ctx.strokeStyle = "#101208";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(u.x, u.y, u.isStatic ? 12 : UNIT_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Helmet.
    ctx.fillStyle = isAlly ? "#3B472C" : "#453F2E";
    ctx.beginPath();
    ctx.arc(u.x, u.y, u.isStatic ? 7 : 5.5, 0, Math.PI * 2);
    ctx.fill();

    // Type glyphs.
    if (isAlly && u.type === "medic") {
      ctx.fillStyle = "#E3E7DC";
      ctx.fillRect(u.x - 3.5, u.y - 1, 7, 2);
      ctx.fillRect(u.x - 1, u.y - 3.5, 2, 7);
    }
    if (u.enemyType === "officer") {
      ctx.fillStyle = "#C9A227";
      ctx.fillRect(u.x - 4, u.y - 1, 8, 2);
    }
    if (u.enemyType === "flak") {
      ctx.strokeStyle = "#1A1812";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(u.x, u.y);
      ctx.lineTo(u.x + Math.cos(u.facing) * 20, u.y + Math.sin(u.facing) * 20);
      ctx.stroke();
    }

    // Sandbag ring for statics.
    if (u.isStatic) {
      ctx.strokeStyle = "#6B5B3F";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(u.x, u.y, 17, Math.PI * 0.25, Math.PI * 1.75);
      ctx.stroke();
    }

    // Selection ring.
    if (this.selected.includes(u.id)) {
      ctx.strokeStyle = "#4ECDC4";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(u.x, u.y, 15, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Name tag for selected allies.
    if (isAlly && this.selected.includes(u.id)) {
      ctx.fillStyle = "rgba(234,240,226,0.9)";
      ctx.font = "9px 'IBM Plex Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText(u.name.split(" ").slice(-1)[0].toUpperCase(), u.x, u.y - 22);
    }

    // Health bar.
    if (u.hp < u.maxHp || isAlly) {
      const w = 22;
      const pct = Math.max(0, u.hp / u.maxHp);
      ctx.fillStyle = "rgba(10,12,8,0.8)";
      ctx.fillRect(u.x - w / 2, u.y + (u.isStatic ? 20 : 14), w, 3.5);
      ctx.fillStyle = isAlly ? "#5EB872" : "#E24A4A";
      ctx.fillRect(u.x - w / 2, u.y + (u.isStatic ? 20 : 14), w * pct, 3.5);
    }

    // Pinned marker.
    if (u.pinned) {
      ctx.fillStyle = "#E24A4A";
      ctx.font = "bold 9px 'IBM Plex Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("PINNED", u.x, u.y - (isAlly ? 30 : 26));
    }
  }
}

// ---------------- terrain generation ----------------

function buildTerrain(kind: string, rng: () => number): { canvas: HTMLCanvasElement; blockers: Blocker[] } {
  const canvas = document.createElement("canvas");
  canvas.width = MAP_W;
  canvas.height = MAP_H;
  const ctx = canvas.getContext("2d")!;
  const blockers: Blocker[] = [];

  // Base field.
  ctx.fillStyle = "#242C1D";
  ctx.fillRect(0, 0, MAP_W, MAP_H);
  for (let i = 0; i < 260; i++) {
    const x = rng() * MAP_W;
    const y = rng() * MAP_H;
    const r = 20 + rng() * 70;
    ctx.fillStyle = rng() < 0.5 ? "rgba(28,36,22,0.35)" : "rgba(60,66,42,0.22)";
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.5 + rng() * 0.5), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  const addBlocker = (x: number, y: number, r: number) => blockers.push({ x, y, r });

  // Dirt road west→east for every map (the axis of advance).
  ctx.strokeStyle = "#3B3428";
  ctx.lineWidth = 44;
  ctx.beginPath();
  ctx.moveTo(0, MAP_H / 2);
  ctx.bezierCurveTo(MAP_W * 0.3, MAP_H * 0.42, MAP_W * 0.7, MAP_H * 0.58, MAP_W, MAP_H / 2);
  ctx.stroke();

  if (kind === "bocage") {
    for (let i = 0; i < 6; i++) {
      const y = (MAP_H * (i + 0.6)) / 6 + (rng() * 60 - 30);
      ctx.strokeStyle = "#1E2A12";
      ctx.lineWidth = 22;
      ctx.beginPath();
      ctx.moveTo(MAP_W * 0.18, y);
      ctx.bezierCurveTo(MAP_W * 0.4, y + 40, MAP_W * 0.62, y - 40, MAP_W * 0.94, y + 10);
      ctx.stroke();
      for (let x = MAP_W * 0.18; x < MAP_W * 0.95; x += 34) {
        addBlocker(x + (rng() * 20 - 10), y + (rng() * 24 - 12), 15);
      }
    }
  } else if (kind === "town") {
    for (let i = 0; i < 7; i++) {
      const bx = MAP_W * (0.3 + rng() * 0.6);
      const by = MAP_H * (0.12 + rng() * 0.72);
      const w = 90 + rng() * 80;
      const h = 70 + rng() * 60;
      ctx.fillStyle = "#33261E";
      ctx.strokeStyle = "#171008";
      ctx.lineWidth = 3;
      ctx.fillRect(bx, by, w, h);
      ctx.strokeRect(bx, by, w, h);
      ctx.strokeStyle = "#4A382A";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx, by + h / 2);
      ctx.lineTo(bx + w, by + h / 2);
      ctx.stroke();
      addBlocker(bx + w / 2, by + h / 2, Math.max(w, h) / 2);
    }
  } else if (kind === "causeway") {
    // Flooded flats above and below the road.
    ctx.fillStyle = "#16211F";
    ctx.fillRect(0, 0, MAP_W, MAP_H * 0.3);
    ctx.fillRect(0, MAP_H * 0.72, MAP_W, MAP_H * 0.28);
    ctx.strokeStyle = "#22332F";
    ctx.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      const wy = rng() < 0.5 ? rng() * MAP_H * 0.28 : MAP_H * 0.74 + rng() * MAP_H * 0.24;
      const wx = rng() * MAP_W;
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.lineTo(wx + 24 + rng() * 30, wy);
      ctx.stroke();
    }
    for (let x = 0; x < MAP_W; x += 40) {
      addBlocker(x, MAP_H * 0.14, 26);
      addBlocker(x + 20, MAP_H * 0.86, 26);
    }
  } else if (kind === "forest") {
    for (let i = 0; i < 60; i++) {
      const tx = MAP_W * (0.22 + rng() * 0.75);
      const ty = rng() * MAP_H;
      const r = 12 + rng() * 12;
      ctx.fillStyle = "rgba(10,14,8,0.5)";
      ctx.beginPath();
      ctx.ellipse(tx + 4, ty + 5, r, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1C2B15";
      ctx.strokeStyle = "#0F180C";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(tx, ty, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      addBlocker(tx, ty, r * 0.8);
    }
  }

  // Craters and debris.
  for (let i = 0; i < 12; i++) {
    const cx = MAP_W * (0.25 + rng() * 0.7);
    const cy = rng() * MAP_H;
    const r = 12 + rng() * 20;
    ctx.fillStyle = "rgba(12,12,10,0.8)";
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.7, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(70,62,44,0.6)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  return { canvas, blockers };
}
