// @vitest-environment node
// Map placement (Josh, 2026-11-12): ruins, houses, and other
// obstacles were overlapping each other. Every placed object
// now carries an object id and a footprint in a registry, and
// flexible placements (trees, hedgehogs, town buildings and
// ruins, scatter) retry or shift until clear — same objects,
// same counts, nothing stacked. Circles of the SAME object
// are supposed to touch (a wall is a row of circles); circles
// of DIFFERENT objects must not overlap.
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

const SQUAD = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 2, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
  { id: "s3", name: "James Baker", type: "rifleman", rank: "Pvt.", level: 1, medals: [] },
  { id: "s4", name: "Chester Pruitt", type: "medic", rank: "Pvt.", level: 1, medals: [] },
  { id: "s5", name: "Raymond Boyd", type: "mg", rank: "Pvt.", level: 1, medals: [] },
] as const;

const mission = (terrain: string) => ({
  id: `t_${terrain}`,
  index: 0,
  code: "TEST",
  location: "test",
  objective: "test",
  difficulty: "HARD",
  reward: 250,
  terrain,
  brief: "test",
  enemies: [{ type: "volks", wave: 1, count: 3 }],
});

type B = { x: number; y: number; r: number; kind?: string; obj?: number };
type Engine = {
  setup: (m: unknown, s: unknown, b: number, v: string) => void;
  blockers: B[];
};

async function blockersOf(terrain: string, variant = ""): Promise<B[]> {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {}) as unknown as Engine;
  engine.setup(mission(terrain) as never, SQUAD as never, 0, variant);
  return engine.blockers;
}

function crossOverlaps(blockers: B[], kinds: string[]): string[] {
  const bad: string[] = [];
  for (let i = 0; i < blockers.length; i++) {
    for (let j = i + 1; j < blockers.length; j++) {
      const a = blockers[i];
      const b = blockers[j];
      if (a.obj === undefined || b.obj === undefined || a.obj === b.obj) continue;
      if (!kinds.includes(a.kind ?? "") && !kinds.includes(b.kind ?? "")) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < a.r + b.r - 1.5) {
        bad.push(`${a.kind}@${a.obj} (${Math.round(a.x)},${Math.round(a.y)},r${a.r}) x ${b.kind}@${b.obj} (${Math.round(b.x)},${Math.round(b.y)},r${b.r}) d=${d.toFixed(1)}`);
      }
    }
  }
  return bad;
}

describe("map objects never overlap across objects", () => {
  it.each([
    ["dday", ""],
    ["dday", "airborne"],
    ["town", ""],
    ["causeway", ""],
    ["forest", ""],
  ])("terrain %s %s: no building or ruin overlaps another object", async (terrain, variant) => {
    const blockers = await blockersOf(terrain, variant);
    expect(crossOverlaps(blockers, ["building", "ruin"])).toEqual([]);
  });

  it.each([
    ["dday", ""],
    ["dday", "airborne"],
    ["town", ""],
    ["causeway", ""],
    ["forest", ""],
  ])("terrain %s %s: trees, hedgehogs, and wrecks never stack", async (terrain, variant) => {
    const blockers = await blockersOf(terrain, variant);
    expect(crossOverlaps(blockers, ["tree"])).toEqual([]);
    expect(crossOverlaps(blockers, ["hedgehog"])).toEqual([]);
    expect(crossOverlaps(blockers, ["wreck"])).toEqual([]);
  });

  it("cover density is kept: the objects are all still there", async () => {
    const town = await blockersOf("town");
    const buildingObjs = new Set(town.filter((b) => b.kind === "building").map((b) => b.obj));
    const ruinObjs = new Set(town.filter((b) => b.kind === "ruin").map((b) => b.obj));
    expect(buildingObjs.size).toBeGreaterThanOrEqual(9);
    expect(ruinObjs.size).toBeGreaterThanOrEqual(10);

    const forest = await blockersOf("forest");
    expect(forest.filter((b) => b.kind === "tree").length).toBeGreaterThanOrEqual(90);

    const beach = await blockersOf("dday");
    // 34 are placed; the pre-existing road filter then cuts any
    // that landed on the trail, as it always has.
    expect(beach.filter((b) => b.kind === "hedgehog").length).toBeGreaterThanOrEqual(32);

    const bocage = await blockersOf("dday", "airborne");
    // Note: the Norman church's single collision circle sits in
    // the road band and is cut by the pre-existing road filter,
    // as it was before this change — so bocage density is
    // asserted on its trees and hedgerows instead.
    expect(bocage.filter((b) => b.kind === "tree").length).toBeGreaterThanOrEqual(9);
    expect(bocage.filter((b) => b.kind === "hedgerow").length).toBeGreaterThanOrEqual(100);
  });
});
