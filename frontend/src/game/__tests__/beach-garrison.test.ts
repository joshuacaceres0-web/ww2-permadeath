// @vitest-environment node
// Wave 1 garrisons at the beach: it spawns in the western zone (the
// landing ground) and holds there, defending it, instead of spawning
// at the far east edge. Waves 2 and 3 are reinforcements from the east.
// And a camping enemy patrols around his garrison home instead of
// standing frozen forever — he moves, but he does not leave his post.
import { describe, expect, it } from "vitest";
import { MAP_W } from "../engine";

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
    { type: "mg42", wave: 1, count: 2 },
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
};
type AnyEngine = Record<string, unknown> & {
  units: U[];
  update: (dt: number) => void;
  spawnWave: (i: number) => void;
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

describe("wave 1 garrisons at the beach", () => {
  it.each(["dday", "town", "causeway", "forest"])(
    "terrain %s: wave 1 spawns in the west, wave 2 in the east",
    async (terrain) => {
      const e = await makeEngine(terrain);
      const wave1 = e.units.filter((u) => u.side === "axis" && u.alive);
      expect(wave1.length).toBeGreaterThan(0);
      // Wave 1 is in the first trench line now (see trench-garrison
      // test): the western trench sits at x 900-1500 depending on
      // terrain, still the west of a 4000-wide map.
      for (const u of wave1) {
        expect(u.x, `${terrain} wave 1 ${u.enemyType} at x=${Math.round(u.x)}`).toBeLessThan(1600);
      }
      e.spawnWave(1);
      const wave2 = e.units.filter((u) => u.side === "axis" && u.alive && u.x > 3200);
      expect(wave2.length, `${terrain} wave 2 must land east of x=3200`).toBeGreaterThan(0);
    },
  );

  it("wave 1 fields two MG42 nests spread along the beach defense", async () => {
    const e = await makeEngine("dday");
    const mgs = e.units.filter((u) => u.enemyType === "mg42");
    expect(mgs.length).toBe(2);
    // One nest in each half of the beach: top and bottom, a line of
    // nests covering the whole defense instead of bunching at one y.
    const ys = mgs.map((u) => u.y).sort((a, b) => a - b);
    expect(ys[0], `top nest at y=${Math.round(ys[0])}`).toBeLessThan(600);
    expect(ys[1], `bottom nest at y=${Math.round(ys[1])}`).toBeGreaterThan(600);
    for (const mg of mgs) {
      expect(mg.x, `MG42 at x=${Math.round(mg.x)}`).toBeGreaterThanOrEqual(700);
      expect(mg.x, `MG42 at x=${Math.round(mg.x)}`).toBeLessThan(1100);
      expect(mg.isStatic, "an MG42 nest must be a static gun").toBe(true);
    }
  });

  it("a static gun garrisons on the bluffs, ahead of the infantry", async () => {
    const e = await makeEngine("dday");
    const mg = e.units.find((u) => u.enemyType === "mg42");
    expect(mg).toBeDefined();
    expect(mg!.x).toBeGreaterThanOrEqual(700);
    expect(mg!.x).toBeLessThan(1100);
    // The infantry is in the first trench line at x 1400 on the
    // beach, not on open ground ahead of the gun.
    const infantry = e.units.filter((u) => u.side === "axis" && u.alive && !u.isStatic);
    expect(Math.max(...infantry.map((u) => u.x))).toBeLessThan(1600);
    expect(Math.min(...infantry.map((u) => u.x))).toBeGreaterThan(1300);
  });
});

describe("patrol: the defense moves, it does not freeze", () => {
  it("a camping enemy patrols around his home instead of standing still", { timeout: 30000 }, async () => {
    const e = await makeEngine();
    const foe = e.units.find((u) => u.side === "axis" && u.alive && !u.isStatic && u.enemyType !== "medic")!;
    const startX = foe.x;
    const startY = foe.y;
    step(e, 10);
    // He moved (patrolled), he is still alive and still near home.
    const moved = dist(foe.x, foe.y, startX, startY);
    expect(moved, "camping enemy never moved — he is frozen").toBeGreaterThan(20);
    expect(dist(foe.x, foe.y, foe.homeX, foe.homeY), "patrol left the garrison").toBeLessThan(250);
  });

  it("a patrolling enemy still engages the moment he spots a player", { timeout: 30000 }, async () => {
    const e = await makeEngine();
    const foe = e.units.find((u) => u.side === "axis" && u.alive && !u.isStatic && u.enemyType !== "medic")!;
    const startX = foe.x;
    const scout = e.units.find((u) => u.side === "allies" && u.alive && !u.npc)!;
    const los = (e as unknown as { los: (a: U, b: U) => boolean }).los;
    const spots: Array<[number, number]> = [
      [foe.x - 200, foe.y],
      [foe.x - 200, foe.y - 120],
      [foe.x - 200, foe.y + 120],
      [foe.x, foe.y - 200],
      [foe.x, foe.y + 200],
    ];
    let placed = false;
    for (const [sx, sy] of spots) {
      scout.x = sx;
      scout.y = sy;
      if (los.call(e, foe, scout)) {
        placed = true;
        break;
      }
    }
    expect(placed).toBe(true);
    // The scout is the bait, not a casualty: keep him alive through
    // the 5s so the foe keeps engaging instead of the MG nests on the
    // bluffs cutting him down and the foe reverting to trench patrol.
    scout.hp = 100000;
    step(e, 5);
    expect(foe.x).toBeLessThan(startX - 15);
  });

  it("a static gun never patrols", { timeout: 30000 }, async () => {
    const e = await makeEngine();
    const mg = e.units.find((u) => u.enemyType === "mg42")!;
    const startX = mg.x;
    const startY = mg.y;
    step(e, 10);
    expect(mg.x).toBe(startX);
    expect(mg.y).toBe(startY);
  });
});
