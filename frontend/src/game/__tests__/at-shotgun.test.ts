// @vitest-environment node
/**
 * The AT man's trench gun (Josh, 2026-11-13): the bazooka only
 * ever fires at vehicles. Infantry is the shotgun's work — up
 * close he works an M97 trench gun on its own five-shell tube
 * and its own reload, and two shots put a man down (32 a hit
 * against the 60 hp conscript every wave is built from). He
 * closes to shotgun reach on his own instead of standing off
 * rocketing men.
 */
import { describe, expect, it } from "vitest";

function stubBrowser() {
  const grad = { addColorStop: () => {} };
  const ctx = new Proxy({}, {
    get(_t, p) {
      if (p === "createLinearGradient" || p === "createRadialGradient") return () => grad;
      if (p === "measureText") return () => ({ width: 10 });
      if (p === "getImageData") return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (p === "createPattern") return () => ({});
      return typeof p === "string" ? () => {} : undefined;
    },
    set() { return true; },
  });
  const makeCanvas = () => ({ width: 0, height: 0, getContext: () => ctx, toDataURL: () => "", getBoundingClientRect: () => ({ width: 1600, height: 900, left: 0, top: 0 }), addEventListener: () => {}, removeEventListener: () => {}, style: {} });
  const store = new Map<string, string>();
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  g.window = globalThis;
  g.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
  g.document = { createElement: (tag: string) => (tag === "canvas" ? makeCanvas() : {}), fonts: { load: () => Promise.resolve([]) } };
  g.HTMLCanvasElement = function () {};
}
stubBrowser();
const loadEngine = async () => (await import("../engine")).GameEngine;

const FOREST = { id: "op_04", index: 3, code: "PERMAFROST", location: "test", objective: "test", difficulty: "EXTREME", reward: 1000, terrain: "forest", brief: "test", enemies: [{ type: "volks", wave: 1, count: 3 }] } as const;

type U = {
  id: number; side: string; npc: boolean; type: string; enemyType: string | null; alive: boolean;
  x: number; y: number; hp: number; maxHp: number; vehicle: boolean;
  mag: number; altMag: number; reloadT: number; altReloadT: number;
};
type Engine = {
  setup: (m: unknown, s: unknown, b: number, v: string, cl?: number, leader?: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  setAutoBattle: (on: boolean) => void;
  spawnEnemyUnit: (t: string, x: number, y: number, rng: () => number, trench?: boolean) => U;
  units: U[];
};

async function makeEngine() {
  const GameEngine = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const e = new GameEngine(canvas, () => {}) as unknown as Engine;
  const mk = (id: string, type: string, rank = "Pvt.") => ({ id, name: id, type, rank, level: 1, medals: [] });
  e.setup(FOREST as never, [mk("s-lead", "rifleman", "Sgt."), mk("s-at", "at")] as never, 0, "", 8, "s-lead");
  e.begin();
  e.setAutoBattle(true);
  // Park the leader far off so the AT man works alone.
  const lead = e.units.find((u) => u.type === "rifleman" && !u.npc)!;
  lead.x = 120;
  lead.y = 120;
  return e;
}
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("the AT man's trench gun", () => {
  it("the spec: a five-shell trench gun that two-shots a conscript", async () => {
    const { UNIT_TYPES, ENEMY_TYPES } = await import("../data");
    const s = UNIT_TYPES.at.sidearm!;
    expect(s).toBeTruthy();
    expect(s.name).toContain("Trench Gun");
    expect(s.magSize).toBe(5);
    expect(s.range).toBe(110);
    expect(s.dmg).toBeLessThan(ENEMY_TYPES.volks.hp);
    expect(s.dmg * 2).toBeGreaterThanOrEqual(ENEMY_TYPES.volks.hp);
    // The bazooka stays the primary, and the primary is his alone.
    expect(UNIT_TYPES.at.dmg).toBe(55);
    expect(UNIT_TYPES.rifleman.sidearm).toBeUndefined();
  });

  it("at infantry range he never rockets a man — he closes to shotgun reach", async () => {
    const e = await makeEngine();
    const at = e.units.find((u) => u.type === "at")!;
    at.x = 1500;
    at.y = 675;
    const volks = e.spawnEnemyUnit("volks", 1700, 675, () => 0.5, false);
    const before = dist(at, volks);
    for (let t = 0; t < 30; t++) e.update(0.1);
    // The bazooka stayed loaded and the shotgun stayed in reach's
    // far side at first — but he walked the gap down himself.
    expect(at.mag).toBe(1);
    expect(dist(at, volks)).toBeLessThan(before);
  }, 30000);

  it("up close he works the shotgun: two shots put the man down, bazooka untouched", async () => {
    const e = await makeEngine();
    const at = e.units.find((u) => u.type === "at")!;
    at.x = 1500;
    at.y = 675;
    const volks = e.spawnEnemyUnit("volks", 1580, 675, () => 0.5, false);
    for (let t = 0; t < 30 && volks.alive; t++) e.update(0.1);
    expect(volks.alive).toBe(false);
    expect(at.mag).toBe(1); // bazooka never fired
    expect(at.altMag).toBeLessThan(5); // the shotgun did the work
    expect(at.altMag).toBeGreaterThanOrEqual(2); // and it took at most three shells
  }, 30000);

  it("at a tank he fires the bazooka and never the shotgun", async () => {
    const e = await makeEngine();
    const at = e.units.find((u) => u.type === "at")!;
    at.x = 1500;
    at.y = 675;
    const pz = e.spawnEnemyUnit("panzer", 1700, 675, () => 0.5, false);
    for (let t = 0; t < 16; t++) e.update(0.1);
    expect(pz.hp).toBeLessThan(400);
    expect(at.mag).toBe(0); // the rocket went downrange and the tube is reloading
    expect(at.altMag).toBe(5); // shotgun never touched
  }, 30000);
});
