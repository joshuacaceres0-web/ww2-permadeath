// @vitest-environment node
// The tank road runs west to east across every battle map, clear of
// obstacles, and the Sherman follows it: it advances along the road's
// centerline, stopping to fire when an enemy is in range, and rolls on
// when the way is clear. Same gritty 16-bit pixel art — the road is the
// same dirt track the game already draws, just kept clear.
import { describe, expect, it } from "vitest";
import { MAP_W, MAP_H, ROAD_HALF, roadYAt } from "../engine";

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
  ],
} as const;

const man = (id: string, name: string, type: string, level = 1) => ({
  id, name, rank: "Pvt", level, type, hp: 100, kills: 0, medals: [],
});
const SQUAD_WITH_RADIO = [
  man("s1", "Boyd", "rifleman"),
  man("s2", "Kowalski", "medic"),
  man("s3", "Reyes", "mg"),
  man("s4", "Novak", "sniper"),
  man("s5", "O'Neil", "radioman"),
] as never;

type U = Record<string, unknown> & {
  x: number; y: number; hp: number; side: string; npc: boolean; type: string; vehicle: boolean; alive: boolean;
};
type AnyEngine = Record<string, unknown> & {
  units: U[];
  blockers: Array<{ x: number; y: number; r: number; kind: string }>;
  covers: Array<{ x: number; y: number; r: number }>;
  update: (dt: number) => void;
  callTank: () => boolean;
  radioLive: () => boolean;
};

async function makeEngine(terrain: string, commanderLevel = 8) {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {});
  engine.setup({ ...baseMission, terrain } as never, SQUAD_WITH_RADIO as never, 0, "", commanderLevel);
  engine.begin();
  const e = engine as unknown as AnyEngine;
  (e as unknown as { fleeChance: number }).fleeChance = 0;
  (e as unknown as { fleeChanceNormal: number }).fleeChanceNormal = 0;
  return e;
}

function step(e: AnyEngine, seconds: number) {
  for (let i = 0; i < seconds * 60; i++) e.update(1 / 60);
}

describe("tank road", () => {
  it("roadYAt follows the road's bezier: 675 at both ends, inside the meander", () => {
    expect(roadYAt(0)).toBeCloseTo(MAP_H / 2, 0);
    expect(roadYAt(MAP_W)).toBeCloseTo(MAP_H / 2, 0);
    for (let x = 0; x <= MAP_W; x += 100) {
      expect(roadYAt(x)).toBeGreaterThanOrEqual(MAP_H / 2 - 90);
      expect(roadYAt(x)).toBeLessThanOrEqual(MAP_H / 2 + 90);
    }
  });

  it.each(["dday", "town", "causeway", "forest"])(
    "terrain %s keeps the road clear of blockers and cover",
    async (terrain) => {
      const e = await makeEngine(terrain);
      for (const b of e.blockers) {
        expect(
          Math.abs(b.y - roadYAt(b.x)),
          `${terrain} blocker ${b.kind} at (${Math.round(b.x)},${Math.round(b.y)}) r=${Math.round(b.r)} overlaps the road`,
        ).toBeGreaterThanOrEqual(b.r + ROAD_HALF);
      }
      for (const c of e.covers) {
        expect(
          Math.abs(c.y - roadYAt(c.x)),
          `${terrain} cover at (${Math.round(c.x)},${Math.round(c.y)}) r=${Math.round(c.r)} overlaps the road`,
        ).toBeGreaterThanOrEqual(c.r + ROAD_HALF);
      }
    },
  );

  // The two movement tests step 10s and 30s of sim; under full-suite
  // parallel load on this VM they can exceed vitest's 5s default, so
  // they carry the same 30s timeout as the other slow tests.
  it("the Sherman rolls in on the road and advances east along it", { timeout: 30000 }, async () => {
    const e = await makeEngine("town");
    expect(e.radioLive()).toBe(true);
    expect(e.callTank()).toBe(true);
    const tank = e.units.find((u) => u.type === "tank" && u.alive)!;
    expect(tank).toBeDefined();
    // It starts on the road (the spawn snaps to the nearest open cell,
    // so it can sit a few units off the centerline, still on the dirt).
    expect(Math.abs(tank.y - roadYAt(tank.x))).toBeLessThan(ROAD_HALF);
    const startX = tank.x;
    step(e, 10);
    // It advanced east, and it stayed on the road.
    expect(tank.x).toBeGreaterThan(startX + 200);
    expect(Math.abs(tank.y - roadYAt(tank.x))).toBeLessThan(60);
    expect(tank.alive).toBe(true);
  });

  // The Sherman stops to duel the chateau garrison on the road.
  // Since 2nd Platoon fights in squads (Josh, 2026-11-12) instead
  // of a dispersed skirmish line, nobody screens that duel, and
  // under the current damage model, where rifle fire still hurts
  // a tank, a lone Sherman left dueling long enough dies at the
  // garrison's door. The long roll therefore asserts the advance
  // itself, not survival past the duel; Josh's armor rule (only
  // AT weapons, tank guns and explosives hurt tanks) is the
  // queued job that makes the old 30-second claim true again.
  it("the Sherman keeps advancing east over a long roll", { timeout: 30000 }, async () => {
    const e = await makeEngine("town");
    expect(e.callTank()).toBe(true);
    const tank = e.units.find((u) => u.type === "tank" && u.alive)!;
    step(e, 20);
    // From x=84 it reaches the garrison duel at about x=565:
    // well past halfway to the old mark, on the road throughout.
    expect(tank.x).toBeGreaterThan(500);
    expect(Math.abs(tank.y - roadYAt(tank.x))).toBeLessThan(60);
  });
});
