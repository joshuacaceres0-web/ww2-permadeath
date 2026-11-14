// @vitest-environment node
// The map stretches further east: 3200 -> 4000 wide. Terrain, cover
// and enemy spawns fill the new ground on every terrain kind. No wave,
// RP or damage changes — the same missions, the same enemies, a longer
// battlefield.
import { describe, expect, it } from "vitest";
import { MAP_W, MAP_H } from "../engine";

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
    { type: "mg42", wave: 1, count: 1 },
    { type: "volks", wave: 2, count: 2 },
    { type: "grenadier", wave: 2, count: 1 },
  ],
} as const;

const SQUAD = [
  { id: "s1", name: "Boyd", rank: "Sgt", level: 1, type: "rifleman", hp: 100, kills: 0, medals: [] },
  { id: "s2", name: "Kowalski", rank: "Cpl", level: 1, type: "medic", hp: 100, kills: 0, medals: [] },
  { id: "s3", name: "Reyes", rank: "Pfc", level: 1, type: "mg", hp: 100, kills: 0, medals: [] },
  { id: "s4", name: "Novak", rank: "Pfc", level: 1, type: "sniper", hp: 100, kills: 0, medals: [] },
  { id: "s5", name: "Hale", rank: "Pvt", level: 1, type: "at", hp: 100, kills: 0, medals: [] },
] as never;

type U = Record<string, unknown> & {
  x: number; y: number; side: string; type: string; alive: boolean;
  trenchHold?: boolean;
};
type AnyEngine = Record<string, unknown> & {
  units: U[];
  blocked: Uint8Array;
  crates: Array<{ x: number; y: number }>;
  crateChance: number;
  update: (dt: number) => void;
};

const CELL = 24;
const COLS = Math.ceil(MAP_W / CELL);
const ROWS = Math.ceil(MAP_H / CELL);
// The new eastern ground: columns east of x = 3200.
const EAST_COL = Math.floor(3200 / CELL) + 1;

async function makeEngine(terrain: string, crateChance?: number) {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {});
  if (crateChance !== undefined) (engine as unknown as { crateChance: number }).crateChance = crateChance;
  engine.setup({ ...baseMission, terrain } as never, SQUAD as never, 0, "");
  engine.begin();
  return engine as unknown as AnyEngine;
}

function easternBlockedCount(e: AnyEngine): number {
  let n = 0;
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = EAST_COL; cx < COLS; cx++) {
      if (e.blocked[cy * COLS + cx]) n++;
    }
  }
  return n;
}

/** Cover OBJECTS east of x=3200 (blockers and cover spots).
 * The grid count above cannot see foliage: since the foliage
 * change (2026-11-12) trees and bushes no longer block the
 * pathing grid, and on the causeway they were the only
 * grid-blockers in the new ground — the cover is still there,
 * it just does not block movement anymore. */
function easternCoverCount(e: AnyEngine): number {
  let n = 0;
  for (const b of e.blockers as Array<{ x: number }>) if (b.x > 3200) n++;
  for (const c of e.covers as Array<{ x: number }>) if (c.x > 3200) n++;
  return n;
}

describe("map stretch: 3200 -> 4000 wide", () => {
  it("the map is 4000 wide and 1350 tall", () => {
    expect(MAP_W).toBe(4000);
    expect(MAP_H).toBe(1350);
  });

  it.each(["dday", "town", "causeway", "forest"])(
    "terrain %s fills the new eastern ground with cover",
    async (terrain) => {
      const e = await makeEngine(terrain);
      expect(
        easternBlockedCount(e) + easternCoverCount(e),
        `${terrain} must have cover on the new ground east of x=3200`,
      ).toBeGreaterThan(0);
    },
  );

  it.each(["dday", "town", "causeway", "forest"])(
    "terrain %s deploys its depth group on the new eastern ground from the start",
    async (terrain) => {
      const e = await makeEngine(terrain);
      // CONQUEST (Phase D): the second deployment group is not
      // a reinforcement wave any more — it is on the eastern
      // ground from the first minute.
      const east = e.units.filter((u) => u.side === "axis" && u.x > 3200);
      expect(east.length, `${terrain} must deploy its depth group east of x=3200 at the start`).toBeGreaterThan(0);
    },
  );

  it.each(["dday", "town", "causeway", "forest"])(
    "terrain %s garrisons its first group at the beach, in the west",
    async (terrain) => {
      const e = await makeEngine(terrain);
      const garrison = e.units.filter((u) => u.side === "axis" && u.alive && u.trenchHold);
      expect(garrison.length).toBeGreaterThan(0);
      for (const u of garrison) {
        // The garrison is in the first trench line: the western
        // trench sits at x 900-1500 depending on terrain.
        expect(u.x, `${terrain} garrison ${u.type} spawned at x=${Math.round(u.x)}, not at the beach`).toBeLessThan(1600);
      }
    },
  );

  it("loot crates can land on the new eastern ground", async () => {
    let eastern = 0;
    for (let i = 0; i < 30; i++) {
      const e = await makeEngine("town", 1);
      if (e.crates.some((c) => c.x > 3200)) eastern++;
    }
    // 30 deployments, 3 of 11 candidate spots are eastern: the chance
    // of never landing east is about 0.02%.
    expect(eastern).toBeGreaterThan(0);
  });
});
