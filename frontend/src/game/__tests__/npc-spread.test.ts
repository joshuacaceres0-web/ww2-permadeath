// @vitest-environment node
// Josh's spread rule (2026-11-12): no more than 3 NPC allies
// bundled in one spot. Six 2nd Platoon men are teleported into a
// tight blob; the dispersion step must break the bundle up as
// they advance, so no man keeps 3 or more of the blob within 44
// units of him. Asked for on the beach landing first, then
// confirmed for all NPC allies in every mission — so the same
// blob is tested on the beach and in a town.
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

type U = { side: string; npc: boolean; type: string; alive: boolean; x: number; y: number };

const SQUAD = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 2, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
  { id: "s3", name: "James Baker", type: "rifleman", rank: "Pvt.", level: 1, medals: [] },
  { id: "s4", name: "Chester Pruitt", type: "medic", rank: "Pvt.", level: 1, medals: [] },
  { id: "s5", name: "Raymond Boyd", type: "mg", rank: "Pvt.", level: 1, medals: [] },
] as const;

const OVERLORD = {
  id: "op_01",
  index: 0,
  code: "OVERLORD",
  location: "test",
  objective: "test",
  difficulty: "HARD",
  reward: 250,
  terrain: "dday",
  brief: "test",
  enemies: [
    { type: "volks", wave: 1, count: 3 },
    { type: "mg42", wave: 1, count: 1 },
  ],
} as const;

const CHATEAU = {
  id: "op_02",
  index: 1,
  code: "SILENT CHATEAU",
  location: "test",
  objective: "test",
  difficulty: "HARD",
  reward: 400,
  terrain: "town",
  brief: "test",
  enemies: [
    { type: "volks", wave: 1, count: 3 },
    { type: "mg42", wave: 1, count: 1 },
  ],
} as const;

async function blobDisperses(mission: typeof OVERLORD | typeof CHATEAU) {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {}) as unknown as {
    setup: (m: unknown, s: unknown, b: number, v: string) => void;
    begin: () => void;
    update: (dt: number) => void;
    units: U[];
    introT: number;
  };
  engine.setup(mission as never, SQUAD as never, 0, "");
  engine.begin();
  // On the beach the men are in Higgins boats at first; play the
  // landing out before forming the blob (a no-op elsewhere).
  for (let s = 0; s < 60 * 12 && engine.introT >= 0; s++) engine.update(1 / 60);
  const blob = engine.units.filter((u) => u.side === "allies" && u.npc && u.type === "rifleman").slice(0, 6);
  expect(blob).toHaveLength(6);
  // A tight 3x2 blob in the open, 8 units apart.
  blob.forEach((u, i) => {
    u.x = 300 + (i % 3) * 8;
    u.y = 670 + Math.floor(i / 3) * 8;
  });
  for (let step = 0; step < 60 * 4; step++) engine.update(1 / 60);
  const alive = blob.filter((u) => u.alive);
  expect(alive.length).toBeGreaterThanOrEqual(4);
  for (const u of alive) {
    const mates = alive.filter((o) => o !== u && Math.hypot(u.x - o.x, u.y - o.y) <= 44).length;
    expect(mates, `blob man at ${Math.round(u.x)},${Math.round(u.y)} still has ${mates} blob-mates within 44`).toBeLessThanOrEqual(2);
  }
  // And they really did spread, not just shuffle a few units.
  const xs = alive.map((u) => u.x);
  const ys = alive.map((u) => u.y);
  const extent = Math.max(...xs) - Math.min(...xs) + (Math.max(...ys) - Math.min(...ys));
  expect(extent).toBeGreaterThan(90);
}

describe("NPC spread rule", () => {
  it("a teleported bundle of 6 breaks up on the beach landing", async () => {
    await blobDisperses(OVERLORD);
  });

  it("the same bundle breaks up on a town mission: the rule is global", async () => {
    await blobDisperses(CHATEAU);
  });
});
