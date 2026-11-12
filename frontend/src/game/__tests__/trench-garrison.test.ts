// @vitest-environment node
// Wave 1 garrisons IN the first trench line on the beach: the mobile
// men spawn in the dug trench (the westernmost one) and hold it,
// instead of on open ground near the beach. They patrol along the
// trench line, so they stay dug in instead of wandering off it.
import { describe, expect, it } from "vitest";

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

const baseMission = {
  id: "op_02",
  code: "OPERATION SILENT CHATEAU",
  location: "Valognes Estate",
  objective: "test",
  difficulty: "HARD",
  reward: 400,
  brief: "test",
  enemies: [
    { type: "grenadier", wave: 1, count: 3 },
    { type: "volks", wave: 1, count: 3 },
    { type: "medic", wave: 1, count: 1 },
    { type: "mg42", wave: 1, count: 3 },
    { type: "volks", wave: 2, count: 2 },
    { type: "grenadier", wave: 2, count: 1 },
  ],
} as const;

const man = (id: string, name: string, type: string, level = 1) => ({
  id, name, rank: "Pvt", level, type, hp: 100, kills: 0, medals: [],
});
const SQUAD = [
  man("s1", "Boyd", "rifleman"),
  man("s2", "Kowalski", "medic"),
  man("s3", "Reyes", "mg"),
  man("s4", "Novak", "sniper"),
  man("s5", "O'Neil", "radioman"),
] as never;

type U = Record<string, unknown> & {
  x: number; y: number; hp: number; side: string; npc: boolean; type: string; enemyType: string | null;
  vehicle: boolean; alive: boolean; isStatic: boolean; homeX: number; homeY: number;
  trenchHold?: boolean; cover: { kind?: string; q: number } | null;
};
type AnyEngine = Record<string, unknown> & {
  units: U[];
  update: (dt: number) => void;
  spawnWave: (i: number) => void;
  covers: Array<{ x: number; y: number; kind?: string; q: number }>;
};

async function makeEngine(terrain = "town", commanderLevel = 8) {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {});
  engine.setup({ ...baseMission, terrain } as never, SQUAD as never, 0, "", commanderLevel);
  engine.begin();
  const e = engine as unknown as AnyEngine;
  (e as unknown as { fleeChance: number }).fleeChance = 0;
  (e as unknown as { fleeChanceNormal: number }).fleeChanceNormal = 0;
  (e as unknown as { counterAttackT: number }).counterAttackT = 9999;
  return e;
}

function step(e: AnyEngine, seconds: number) {
  for (let i = 0; i < seconds * 60; i++) e.update(1 / 60);
}
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

function nearestTrench(e: AnyEngine, u: U) {
  let best = Infinity;
  for (const c of e.covers) {
    if (c.kind !== "trench") continue;
    best = Math.min(best, dist(u.x, u.y, c.x, c.y));
  }
  return best;
}

describe("wave 1 garrisons in the first trench line", () => {
  it.each(["dday", "town", "causeway", "forest"])(
    "terrain %s: wave 1 mobile men stand in the first trench, not on open ground",
    async (terrain) => {
      const e = await makeEngine(terrain);
      const mobile = e.units.filter((u) => u.side === "axis" && u.alive && !u.isStatic);
      expect(mobile.length).toBeGreaterThan(0);
      for (const u of mobile) {
        expect(u.trenchHold, `${terrain} wave 1 ${u.enemyType} is not a trench garrison man`).toBe(true);
        expect(
          nearestTrench(e, u),
          `${terrain} wave 1 ${u.enemyType} at (${Math.round(u.x)}, ${Math.round(u.y)}) is not in a trench`,
        ).toBeLessThan(40);
      }
      // In the western trench, not the eastern lines at x 2600/3400.
      expect(Math.max(...mobile.map((u) => u.x)), `${terrain} wave 1 in the wrong trench line`).toBeLessThan(1600);
      // Static guns stay on the bluffs, not in the trench.
      const statics = e.units.filter((u) => u.side === "axis" && u.alive && u.isStatic);
      expect(statics.length).toBeGreaterThan(0);
      for (const s of statics) {
        expect(s.x).toBeGreaterThanOrEqual(700);
        expect(s.x).toBeLessThan(1100);
        expect(s.trenchHold).toBeFalsy();
      }
    },
  );

  it("a wave 1 man in the trench has trench cover, the best cover in the game", { timeout: 30000 }, async () => {
    const e = await makeEngine("dday");
    step(e, 1);
    const foe = e.units.find((u) => u.side === "axis" && u.alive && !u.isStatic && u.enemyType === "volks")!;
    expect(foe.cover, "trench garrison man has no cover").not.toBeNull();
    expect(foe.cover!.kind).toBe("trench");
    expect(foe.cover!.q).toBe(0.95);
  });

  it("a trench garrison man patrols along the trench and stays dug in", { timeout: 30000 }, async () => {
    const e = await makeEngine();
    const foe = e.units.find((u) => u.side === "axis" && u.alive && !u.isStatic && u.enemyType !== "medic")!;
    const startX = foe.x;
    const startY = foe.y;
    step(e, 10);
    // He moved (patrolled), he is still alive, still near home, and
    // still in the trench — the patrol walks the line, it does not
    // wander off into the open.
    const moved = dist(foe.x, foe.y, startX, startY);
    expect(moved, "trench garrison man never moved — he is frozen").toBeGreaterThan(20);
    expect(dist(foe.x, foe.y, foe.homeX, foe.homeY), "patrol left the garrison").toBeLessThan(250);
    expect(
      nearestTrench(e, foe),
      `trench garrison man patrolled off his trench, now at (${Math.round(foe.x)}, ${Math.round(foe.y)})`,
    ).toBeLessThan(50);
  });
});
