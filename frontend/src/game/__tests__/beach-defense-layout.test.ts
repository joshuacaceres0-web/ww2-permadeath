// @vitest-environment node
// Josh's beach layout for Overlord, after a 5/5-alive AUTO win in
// 156s looked too easy: the wave 1 defense sits in two lines. The
// first 6 MG42 nests and the first 2 mortars are right on the sand
// at the shoreline (x 350-650, spread in bands along the beach);
// the remaining 3 MGs and 1 mortar scatter east inland (x 1700+)
// as guns in depth. The infantry still holds the first trench.
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

// The real backend op_01 wave 1 (backend/lib/missions.py).
const MISSION = {
  id: "op_01",
  code: "OPERATION OVERLORD",
  location: "Omaha Beach",
  objective: "test",
  difficulty: "HARD",
  reward: 250,
  terrain: "dday",
  brief: "test",
  enemies: [
    { type: "volks", wave: 1, count: 6 },
    { type: "funk", wave: 1, count: 1 },
    { type: "medic", wave: 1, count: 1 },
    { type: "grenadier", wave: 1, count: 3 },
    { type: "mg42", wave: 1, count: 9 },
    { type: "mortar", wave: 1, count: 3 },
    { type: "volks", wave: 2, count: 4 },
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
  x: number; y: number; side: string; enemyType: string | null;
  alive: boolean; isStatic: boolean;
};

async function makeEngine(variant = "") {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {});
  engine.setup(MISSION as never, SQUAD as never, 0, variant as never, 8);
  engine.begin();
  return engine as unknown as { units: U[] };
}

// Spawn snapping can shift a unit a few units off its placed point,
// so the shore/east split is judged with margin: shore x < 750,
// east x >= 1650, and nothing in between.
const isShore = (u: U) => u.x < 750;
const isEast = (u: U) => u.x >= 1650;

describe("Overlord beach layout: shoreline line + scattered east line", () => {
  it("fields 9 MG42 nests: 6 at the shoreline, 3 scattered east", async () => {
    const e = await makeEngine();
    const mgs = e.units.filter((u) => u.enemyType === "mg42");
    expect(mgs.length).toBe(9);
    const shore = mgs.filter(isShore);
    const east = mgs.filter(isEast);
    expect(shore.length).toBe(6);
    expect(east.length).toBe(3);
    expect(mgs.filter((u) => !isShore(u) && !isEast(u)).length).toBe(0);
    for (const mg of mgs) expect(mg.isStatic).toBe(true);
    // The shoreline line covers the whole beach, top to bottom.
    const ys = shore.map((u) => u.y);
    expect(Math.min(...ys)).toBeLessThan(300);
    expect(Math.max(...ys)).toBeGreaterThan(750);
  });

  it("fields 3 mortars: 2 at the shoreline with the MGs, 1 east", async () => {
    const e = await makeEngine();
    const mortars = e.units.filter((u) => u.enemyType === "mortar");
    expect(mortars.length).toBe(3);
    expect(mortars.filter(isShore).length).toBe(2);
    expect(mortars.filter(isEast).length).toBe(1);
    for (const m of mortars) expect(m.isStatic).toBe(true);
  });

  it("the airborne drop gets no shoreline line: its guns hold the bluffs", async () => {
    const e = await makeEngine("airborne");
    const mgs = e.units.filter((u) => u.enemyType === "mg42");
    expect(mgs.length).toBe(9);
    // No east scatter and nothing on the sand: every nest in the
    // old bluff band.
    expect(mgs.filter(isEast).length).toBe(0);
    for (const mg of mgs) {
      expect(mg.x).toBeGreaterThanOrEqual(650);
      expect(mg.x).toBeLessThan(1100);
    }
  });
});
