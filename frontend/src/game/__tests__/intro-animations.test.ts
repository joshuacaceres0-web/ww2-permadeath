// @vitest-environment node
// Intro animations (Josh, 2026-11-12; drawn in the game's own
// art, no imported images): the Overlord beach landing opens
// with Higgins boats — the squad in one, the 32 NPCs in sticks
// of 8 — running in from the water, ramps down at the shoreline,
// men out and wading to their landing spots; the airborne
// variant opens with the drop, every man under canopy on the
// C-47's west-to-east pass. While an intro runs the battle is
// frozen: no combat, no damage, no bullets. Then control passes.
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

type U = {
  side: string; npc: boolean; alive: boolean; x: number; y: number;
  hp: number; maxHp: number; embarked?: boolean; dropStart?: number;
};

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
  enemies: [{ type: "volks", wave: 1, count: 3 }],
} as const;

const TOWN = { ...OVERLORD, id: "op_02", terrain: "town" } as const;

type Engine = {
  setup: (m: unknown, s: unknown, b: number, v: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  units: U[];
  bullets: unknown[];
  boats: Array<{ men: unknown[] }>;
  introKind: string | null;
  introT: number;
  particles: Array<{ kind: string }>;
};

async function makeEngine(mission: unknown, variant: string) {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {}) as unknown as Engine;
  engine.setup(mission as never, SQUAD as never, 0, variant);
  return engine;
}

describe("intro animations", () => {
  it("beach: 5 boats carry everyone, the battle is frozen mid-landing, and all 37 men come ashore spread out", async () => {
    const e = await makeEngine(OVERLORD, "");
    expect(e.introKind).toBe("boats");
    expect(e.boats.length).toBe(5);
    const allies = e.units.filter((u) => u.side === "allies");
    expect(allies.length).toBe(37);
    expect(allies.every((u) => u.embarked)).toBe(true);
    e.begin();
    // A second in, the boats are running in and throwing a wake:
    // foam particles are in the water behind them.
    for (let s = 0; s < 60; s++) e.update(1 / 60);
    expect(e.particles.some((p) => p.kind === "foam")).toBe(true);
    // Two seconds in, the boats are still running in or unloading:
    // nobody has been shot at, because the battle has not started.
    for (let s = 0; s < 60; s++) e.update(1 / 60);
    expect(e.introT).toBeGreaterThanOrEqual(0);
    expect(e.bullets.length).toBe(0);
    expect(allies.every((u) => u.hp === u.maxHp)).toBe(true);
    // Run the landing out.
    for (let s = 0; s < 60 * 12 && e.introT >= 0; s++) e.update(1 / 60);
    expect(e.introT).toBe(-1);
    expect(allies.every((u) => !u.embarked)).toBe(true);
    for (const u of allies) expect(u.x).toBeGreaterThanOrEqual(255);
    const ys = allies.map((u) => u.y);
    expect(Math.min(...ys)).toBeLessThan(400);
    expect(Math.max(...ys)).toBeGreaterThan(900);
  });

  it("airborne: the drop runs on the clock, frozen, and ends with every man down", async () => {
    const e = await makeEngine(OVERLORD, "airborne");
    expect(e.introKind).toBe("drop");
    const allies = e.units.filter((u) => u.side === "allies");
    expect(allies.length).toBe(37);
    expect(allies.every((u) => u.dropStart !== undefined)).toBe(true);
    e.begin();
    for (let s = 0; s < 60 * 2; s++) e.update(1 / 60);
    expect(e.introT).toBeGreaterThanOrEqual(0);
    expect(e.bullets.length).toBe(0);
    expect(allies.every((u) => u.hp === u.maxHp)).toBe(true);
    // Run past the first landings: boots touching down puff dust.
    let sawDust = false;
    for (let s = 0; s < 60 * 8 && e.introT >= 0; s++) {
      e.update(1 / 60);
      if (e.particles.some((p) => p.kind === "dust")) sawDust = true;
    }
    expect(sawDust).toBe(true);
    expect(e.introT).toBe(-1);
  });

  it("other missions have no intro", async () => {
    const e = await makeEngine(TOWN, "");
    expect(e.introKind).toBeNull();
    e.begin();
    e.update(1 / 60);
    expect(e.introT).toBe(-1);
  });
});
