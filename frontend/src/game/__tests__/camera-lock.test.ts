// @vitest-environment node
// Camera hard lock (Josh, 2026-11-12): the battle view is
// centered on the player-controlled team leader at all times.
// No free scroll, no edge pan, no focus jumps to other men.
// When leadership passes on, the lock snaps to the successor.
// Full map survives only while the battle is paused; the
// moment it runs, the view is back on the leader.
import { describe, it, expect } from "vitest";

function stubBrowser() {
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "canvas") return {};
        if (prop === "measureText") return () => ({ width: 0 });
        if (prop === "getImageData") return () => ({ data: new Uint8ClampedArray(4) });
        if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createPattern")
          return () => ({ addColorStop: () => {} });
        return () => {};
      },
      set() {
        return true;
      },
    },
  );
  const makeCanvas = () => ({
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: () => "",
    getBoundingClientRect: () => ({ width: 1600, height: 900, left: 0, top: 0 }),
    addEventListener: () => {},
    removeEventListener: () => {},
    style: {},
  });
  const store = new Map<string, string>();
  (globalThis as unknown as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  (globalThis as unknown as Record<string, unknown>).window = globalThis;
  (globalThis as unknown as Record<string, unknown>).matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  (globalThis as unknown as Record<string, unknown>).document = {
    createElement: (tag: string) => (tag === "canvas" ? makeCanvas() : {}),
    fonts: { load: () => Promise.resolve([]) },
  };
  (globalThis as unknown as Record<string, unknown>).HTMLCanvasElement = function () {};
}

stubBrowser();

const loadEngine = async () => {
  const mod = await import("../engine");
  return { GameEngine: mod.GameEngine };
};

const SQUAD = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 2, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
  { id: "s3", name: "James Baker", type: "rifleman", rank: "Pvt.", level: 1, medals: [] },
  { id: "s4", name: "Chester Pruitt", type: "medic", rank: "Pvt.", level: 1, medals: [] },
  { id: "s5", name: "Raymond Boyd", type: "mg", rank: "Pvt.", level: 1, medals: [] },
] as const;

const TOWN = {
  id: "op_02",
  index: 1,
  code: "CHATEAU",
  location: "test",
  objective: "test",
  difficulty: "HARD",
  reward: 400,
  terrain: "town",
  brief: "test",
  enemies: [
    { type: "volks", wave: 1, count: 2 },
    { type: "mg42", wave: 1, count: 1 },
  ],
} as const;

type U = {
  id: number; side: string; npc: boolean; alive: boolean;
  x: number; y: number; extracted?: boolean;
};
type Engine = {
  setup: (m: unknown, s: unknown, b: number, v: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  retreat: () => void;
  units: U[];
  phase: string;
  leaderId: number | null;
  keys: Set<string>;
  cam: { x: number; y: number };
  viewW: number;
  viewH: number;
  focusUnit: (id: number) => void;
  setFitMap: (on: boolean) => void;
  isFitMap: () => boolean;
  damage: (u: U, dmg: number, st: string, killerId: number | null) => void;
};

async function makeEngine() {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {}) as unknown as Engine;
  engine.setup(TOWN as never, SQUAD as never, 0, "");
  return engine;
}

const center = (e: Engine) => ({ x: e.cam.x + e.viewW / 2, y: e.cam.y + e.viewH / 2 });
const leaderOf = (e: Engine) => e.units.find((u) => u.id === e.leaderId)!;
const step = (e: Engine, seconds: number) => {
  for (let s = 0; s < Math.round(seconds * 60); s++) e.update(1 / 60);
};

describe("camera hard lock on the team leader", () => {
  it("stays centered on the leader while he walks, and at the far east edge past the old clamp", async () => {
    const e = await makeEngine();
    e.begin();
    // Continuous walk east: after every half second the view
    // center is the leader, not a drift toward him.
    e.keys.add("d");
    for (let chunk = 0; chunk < 16; chunk++) {
      step(e, 0.5);
      const L = leaderOf(e);
      const c = center(e);
      expect(Math.abs(c.x - L.x)).toBeLessThan(2);
      expect(Math.abs(c.y - L.y)).toBeLessThan(2);
    }
    e.keys.delete("d");
    expect(leaderOf(e).x).toBeGreaterThan(300);
    // Park the enemy in the far corner: the stage checks below
    // teleport the leader across the map, including onto the
    // east edge where the wave spawns — a point-blank nest
    // would break him and he would run, which is morale
    // working, not the camera failing.
    for (const u of e.units) if (u.side === "axis") { u.x = 100; u.y = 1300; }
    // Teleport stages across the map, including past where the
    // old clamp used to pin the view (center capped at 3200):
    // a true hard lock centers him anyway. Stages sit on the
    // road (roadYAt), the one band guaranteed clear of
    // blockers — teleporting into a building would rightly
    // get him shoved out by collision resolution.
    const { roadYAt } = await import("../engine");
    for (const x of [1500, 2500, 3900]) {
      const L = leaderOf(e);
      L.x = x;
      L.y = roadYAt(x);
      step(e, 0.25);
      const c = center(e);
      expect(Math.abs(c.x - L.x)).toBeLessThan(2);
      expect(Math.abs(c.y - L.y)).toBeLessThan(2);
      expect(Math.abs(c.x - x)).toBeLessThan(2);
    }
  });

  it("focus jumps and a live full map cannot break the lock", async () => {
    const e = await makeEngine();
    e.begin();
    step(e, 0.5);
    const other = e.units.find((u) => u.side === "allies" && !u.npc && u.id !== e.leaderId)!;
    e.focusUnit(other.id);
    step(e, 0.25);
    let c = center(e);
    expect(Math.abs(c.x - leaderOf(e).x)).toBeLessThan(2);
    // Full map while the battle runs: the next tick snaps back.
    e.setFitMap(true);
    expect(e.isFitMap()).toBe(true);
    step(e, 0.25);
    expect(e.isFitMap()).toBe(false);
    c = center(e);
    expect(Math.abs(c.x - leaderOf(e).x)).toBeLessThan(2);
    expect(Math.abs(c.y - leaderOf(e).y)).toBeLessThan(2);
  });

  it("a leader death re-locks onto the successor", async () => {
    const e = await makeEngine();
    e.begin();
    step(e, 0.5);
    const first = leaderOf(e);
    const successor = e.units
      .filter((u) => u.side === "allies" && !u.npc && u.id !== first.id)
      .sort((a, b) => b.id - a.id)[0];
    // Spread the men so the successor is somewhere distinct.
    successor.x = first.x + 700;
    successor.y = first.y + 200;
    e.damage(first, 99999, "mg42", null);
    step(e, 0.5);
    expect(e.leaderId).not.toBe(first.id);
    const L = leaderOf(e);
    const c = center(e);
    expect(Math.abs(c.x - L.x)).toBeLessThan(2);
    expect(Math.abs(c.y - L.y)).toBeLessThan(2);
  });

  it("retreat keeps the camera on the running leader, then on the group when he is gone", async () => {
    const e = await makeEngine();
    e.begin();
    const men = e.units.filter((u) => u.side === "allies" && !u.npc);
    men.forEach((u, i) => { u.x = 1500; u.y = 600 + i * 30; });
    e.retreat();
    step(e, 2);
    let c = center(e);
    expect(Math.abs(c.x - leaderOf(e).x)).toBeLessThan(2);
    // The leader goes down mid-retreat: no succession under a
    // retreat, so the camera watches the middle of the men
    // still running.
    e.damage(leaderOf(e), 99999, "mg42", null);
    step(e, 0.5);
    const alive = men.filter((u) => u.alive);
    expect(alive.length).toBeGreaterThan(0);
    const gx = alive.reduce((s, u) => s + u.x, 0) / alive.length;
    const gy = alive.reduce((s, u) => s + u.y, 0) / alive.length;
    c = center(e);
    expect(Math.abs(c.x - gx)).toBeLessThan(3);
    expect(Math.abs(c.y - gy)).toBeLessThan(3);
  });
});
