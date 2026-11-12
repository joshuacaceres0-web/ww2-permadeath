// @vitest-environment node
// Tactical cover rework: directional protection, light vs heavy,
// one man per spot, and cover that wears down under fire.
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

const MISSION = {
  id: "op_02",
  code: "OPERATION SILENT CHATEAU",
  location: "Valognes Estate",
  objective: "test",
  difficulty: "HARD",
  reward: 400,
  terrain: "town",
  brief: "test",
  enemies: [
    { type: "grenadier", wave: 1, count: 3 },
    { type: "volks", wave: 1, count: 4 },
  ],
} as const;

const SQUAD = [
  { id: "s1", name: "Boyd", rank: "Sgt", level: 1, type: "rifleman", hp: 100, kills: 0, medals: [] },
  { id: "s2", name: "Kowalski", rank: "Cpl", level: 1, type: "medic", hp: 100, kills: 0, medals: [] },
  { id: "s3", name: "Reyes", rank: "Pfc", level: 1, type: "mg", hp: 100, kills: 0, medals: [] },
  { id: "s4", name: "Novak", rank: "Pfc", level: 1, type: "sniper", hp: 100, kills: 0, medals: [] },
  { id: "s5", name: "Hale", rank: "Pvt", level: 1, type: "at", hp: 100, kills: 0, medals: [] },
] as never;

type AnyEngine = Record<string, unknown> & {
  covers: Array<Record<string, unknown>>;
  units: Array<Record<string, unknown>>;
  update: (dt: number) => void;
};

async function makeEngine() {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {});
  engine.setup(MISSION as never, SQUAD as never, 0, "");
  engine.begin();
  return engine as unknown as AnyEngine;
}

function disarmEnemy(e: AnyEngine) {
  for (const u of e.units) {
    if (u.side === "axis") {
      (u as Record<string, unknown>).range = 0;
      u.x = 3000; // far east, off the cover spot
      u.y = 600;
      // Move the garrison home too, or the patrol walks them back.
      (u as Record<string, unknown>).homeX = 3000;
      (u as Record<string, unknown>).homeY = 600;
      (u as Record<string, unknown>).patrolX = 3000;
      (u as Record<string, unknown>).patrolY = 600;
    }
  }
}

describe("tactical cover", () => {
  it("coverBetween protects only from the shooter's side — a flanker gets nothing", async () => {
    const e = await makeEngine();
    const cover = { x: 520, y: 500, r: 7, q: 0.8, q0: 0.8, type: "heavy", hp: 400, maxHp: 400 };
    e.covers.push(cover);
    // Shooter east of the cover, target west of it: cover is between them.
    expect((e as unknown as { coverBetween: (ox: number, oy: number, tx: number, ty: number) => unknown }).coverBetween(700, 500, 500, 500)).toBe(cover);
    // Shooter west, on the target's own side: no protection (flanked).
    expect((e as unknown as { coverBetween: (ox: number, oy: number, tx: number, ty: number) => unknown }).coverBetween(300, 500, 500, 500)).toBeNull();
    // Shooter far off to the side: the shot does not pass through the cover.
    expect((e as unknown as { coverBetween: (ox: number, oy: number, tx: number, ty: number) => unknown }).coverBetween(700, 900, 500, 500)).toBeNull();
  });

  it("one man per light spot, two per heavy spot", async () => {
    const e = await makeEngine();
    disarmEnemy(e);
    const squad = e.units.filter((u) => u.side === "allies" && !u.npc);
    expect(squad.length).toBe(5);
    // Light sandbag at (600,600): two men hug it, threat is east.
    const light = { x: 600, y: 600, r: 10, q: 0.8, q0: 0.8, type: "light", hp: 110, maxHp: 110 };
    e.covers.push(light);
    squad[0].x = 585; squad[0].y = 600;
    squad[1].x = 590; squad[1].y = 600;
    // Move the other men far away so they cannot claim the spot.
    for (let i = 2; i < 5; i++) { squad[i].x = 100; squad[i].y = 100; }
    for (let i = 0; i < 10; i++) e.update(1 / 60);
    const holders = squad.filter((u) => u.cover === light);
    expect(holders).toHaveLength(1);

    // Heavy ruin wall: three men hug it, two get cover, one is exposed.
    const e2 = await makeEngine();
    disarmEnemy(e2);
    const squad2 = e2.units.filter((u) => u.side === "allies" && !u.npc);
    const heavy = { x: 600, y: 600, r: 10, q: 0.9, q0: 0.9, type: "heavy", hp: 400, maxHp: 400 };
    e2.covers.push(heavy);
    squad2[0].x = 585; squad2[0].y = 600;
    squad2[1].x = 590; squad2[1].y = 600;
    squad2[2].x = 588; squad2[2].y = 605;
    for (let i = 3; i < 5; i++) { squad2[i].x = 100; squad2[i].y = 100; }
    for (let i = 0; i < 10; i++) e2.update(1 / 60);
    const heavyHolders = squad2.filter((u) => u.cover === heavy);
    expect(heavyHolders).toHaveLength(2);
  });

  it("stopped rounds wear cover down until it breaks", async () => {
    const e = await makeEngine();
    const cover = { x: 520, y: 500, r: 7, q: 0.8, q0: 0.8, type: "light", hp: 10, maxHp: 10 };
    e.covers.push(cover);
    const damage = e as unknown as { damageCover: (c: unknown, dmg: number) => void };
    damage.damageCover(cover, 6);
    expect(cover.hp).toBe(4);
    expect((cover.q as number)).toBeLessThan(0.8); // chewed-up cover stops fewer rounds
    expect(e.covers).toContain(cover);
    damage.damageCover(cover, 6);
    expect(e.covers).not.toContain(cover); // broken and gone
  });

  it("terrain builds light and heavy cover, including buildings", async () => {
    const e = await makeEngine();
    const types = new Set(e.covers.map((c) => c.type));
    expect(types.has("light")).toBe(true);
    expect(types.has("heavy")).toBe(true);
    const heavy = e.covers.filter((c) => c.type === "heavy");
    expect(heavy.length).toBeGreaterThan(0);
    expect(heavy.some((c) => (c.q as number) >= 0.85)).toBe(true);
  });
});
