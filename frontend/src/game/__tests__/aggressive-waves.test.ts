// @vitest-environment node
// Waves 2 and 3 are aggressive: the reinforcements charge on spawn
// instead of camping and defending like Wave 1. Wave 1 holds the
// trench; Waves 2 and 3 come at the player.
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
    width: 0, height: 0, getContext: () => ctx, toDataURL: () => "",
    getBoundingClientRect: () => ({ width: 1600, height: 900, left: 0, top: 0 }),
    addEventListener: () => {}, removeEventListener: () => {}, style: {},
  });
  const store = new Map<string, string>();
  (globalThis as unknown as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  (globalThis as unknown as Record<string, unknown>).window = globalThis;
  (globalThis as unknown as Record<string, unknown>).matchMedia = () => ({
    matches: false, addEventListener: () => {}, removeEventListener: () => {},
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
    { type: "volks", wave: 1, count: 3 },
    { type: "medic", wave: 1, count: 1 },
    { type: "mg42", wave: 1, count: 1 },
    { type: "volks", wave: 2, count: 2 },
    { type: "grenadier", wave: 2, count: 1 },
    { type: "volks", wave: 3, count: 2 },
    { type: "grenadier", wave: 3, count: 1 },
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
  aggressive?: boolean; trenchHold?: boolean;
};
type AnyEngine = Record<string, unknown> & {
  units: U[];
  update: (dt: number) => void;
  damage: (u: U, amount: number, kind: string, from: U | null) => void;
  battleState: string;
};

async function makeEngine(terrain = "town") {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {});
  engine.setup({ ...MISSION, terrain } as never, SQUAD as never, 0, "");
  engine.begin();
  return engine as unknown as AnyEngine;
}

function step(e: AnyEngine, seconds: number) {
  for (let i = 0; i < seconds * 60; i++) e.update(1 / 60);
}

function clearWave(e: AnyEngine) {
  // Kill every living enemy, then step past the 4s next-wave countdown.
  for (const u of [...e.units]) {
    if (u.side === "axis" && u.alive) e.damage(u, 999, "rifle", null);
  }
  step(e, 5);
}

function waveMen(e: AnyEngine) {
  return e.units.filter((u) => u.side === "axis" && u.alive && !u.isStatic && u.enemyType !== "medic");
}

describe("aggressive waves", () => {
  it("wave 1 men hold, wave 2 and 3 men are aggressive", async () => {
    const e = await makeEngine();
    // Wave 1: the trench garrison, not aggressive.
    for (const u of waveMen(e)) {
      expect(u.aggressive, "a wave 1 man must not be aggressive").toBeFalsy();
    }
    // Wave 2: reinforcements, aggressive.
    clearWave(e);
    const w2 = waveMen(e);
    expect(w2.length).toBe(3);
    for (const u of w2) {
      expect(u.aggressive, "a wave 2 man must be aggressive").toBe(true);
      expect(u.trenchHold, "a wave 2 man is not a trench man").toBeFalsy();
    }
    // Wave 3: aggressive too.
    clearWave(e);
    const w3 = waveMen(e);
    expect(w3.length).toBe(3);
    for (const u of w3) {
      expect(u.aggressive, "a wave 3 man must be aggressive").toBe(true);
    }
  });

  it("a wave 2 man charges west on spawn without ever spotting the player", { timeout: 30000 }, async () => {
    const e = await makeEngine();
    clearWave(e);
    const foe = waveMen(e)[0];
    const startX = foe.x;
    // The player's squad is ~3700 units west, far beyond vision, so
    // a camping man would only patrol around his home (within ~150).
    // An aggressive man charges west at full speed.
    step(e, 10);
    expect(foe.alive, "the charging man must still be alive").toBe(true);
    expect(foe.x, `wave 2 man started at x=${Math.round(startX)}, after 10s at x=${Math.round(foe.x)}`).toBeLessThan(startX - 200);
  });

  it("a wave 1 man still camps and patrols instead of charging", { timeout: 30000 }, async () => {
    const e = await makeEngine();
    const foe = waveMen(e)[0];
    const startX = foe.x;
    const startY = foe.y;
    step(e, 10);
    // He patrols around home (moves, but stays near it) — he does not
    // charge across the map toward a player he has never spotted.
    expect(Math.hypot(foe.x - foe.homeX, foe.y - foe.homeY), "a wave 1 man must stay near his garrison").toBeLessThan(250);
    expect(foe.x, "a wave 1 man must not charge west").toBeGreaterThan(startX - 200);
    expect(foe.alive).toBe(true);
  });
});
