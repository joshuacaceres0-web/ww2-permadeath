// @vitest-environment node
// 2nd Platoon size by mission: the Overlord beach landing fields a
// full landing force of 32 NPC allies (Josh, 2026-11-12, to match
// the hardened beach defense), while the airborne drop and every
// other mission keep the 12 Josh picked on 2026-11-11. Either way
// the first man ashore is the platoon medic and the rest are
// riflemen, all weak NPC scaling.
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

type U = { side: string; npc: boolean; type: string; x: number; y: number };

const SQUAD = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 2, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
  { id: "s3", name: "James Baker", type: "rifleman", rank: "Pvt.", level: 1, medals: [] },
  { id: "s4", name: "Chester Pruitt", type: "medic", rank: "Pvt.", level: 1, medals: [] },
  { id: "s5", name: "Raymond Boyd", type: "mg", rank: "Pvt.", level: 1, medals: [] },
] as const;

const mission = (terrain: string) =>
  ({
    id: terrain === "dday" ? "op_01" : "op_02",
    index: terrain === "dday" ? 0 : 1,
    code: terrain === "dday" ? "OVERLORD" : "SILENT CHATEAU",
    location: "test",
    objective: "test",
    difficulty: "HARD",
    reward: 250,
    terrain,
    brief: "test",
    enemies: [
      { type: "volks", wave: 1, count: 3 },
      { type: "mg42", wave: 1, count: 1 },
    ],
  }) as const;

async function makeEngine(terrain: string, variant = "") {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {}) as unknown as {
    setup: (m: unknown, s: unknown, b: number, v: string) => void;
    units: U[];
  };
  engine.setup(mission(terrain) as never, SQUAD as never, 0, variant);
  return engine;
}

const npcs = (e: { units: U[] }) => e.units.filter((u) => u.side === "allies" && u.npc);

describe("2nd Platoon landing force", () => {
  it("Overlord beach landing: 32 NPCs ashore, 1 medic and 31 riflemen", async () => {
    const e = await makeEngine("dday");
    const men = npcs(e);
    expect(men).toHaveLength(32);
    expect(men.filter((u) => u.type === "medic")).toHaveLength(1);
    expect(men.filter((u) => u.type === "rifleman")).toHaveLength(31);
    // Spread down the whole western edge, not stacked at one y.
    const ys = men.map((u) => u.y);
    expect(Math.min(...ys)).toBeLessThan(400);
    expect(Math.max(...ys)).toBeGreaterThan(900);
  });

  it("other missions keep 12 NPCs", async () => {
    const e = await makeEngine("town");
    const men = npcs(e);
    expect(men).toHaveLength(12);
    expect(men.filter((u) => u.type === "medic")).toHaveLength(1);
    expect(men.filter((u) => u.type === "rifleman")).toHaveLength(11);
  });

  it("the airborne drop fields 32 NPCs too: same number as the beach landing", async () => {
    const e = await makeEngine("dday", "airborne");
    const men = npcs(e);
    expect(men).toHaveLength(32);
    expect(men.filter((u) => u.type === "medic")).toHaveLength(1);
    expect(men.filter((u) => u.type === "rifleman")).toHaveLength(31);
  });
});
