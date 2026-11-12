// @vitest-environment node
// Wave-clear allies: when the squad clears a wave, 2 fresh weak
// 2nd Platoon riflemen walk in from the west edge to join the fight
// for the next wave. None on the final wave — that is a victory.
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
    { type: "grenadier", wave: 1, count: 2 },
    { type: "volks", wave: 1, count: 2 },
    { type: "volks", wave: 2, count: 2 },
    { type: "medic", wave: 2, count: 1 },
    { type: "mg42", wave: 3, count: 1 },
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
  id: number; x: number; y: number; hp: number; maxHp: number; alive: boolean;
  side: string; npc: boolean; type: string;
};
type Hud = Record<string, unknown> & { log: Array<{ text: string }> };
type AnyEngine = Record<string, unknown> & {
  units: U[];
  update: (dt: number) => void;
  damage: (u: U, dmg: number, source: string, killer: number | null) => void;
  battleState: string;
  emitHud: () => void;
};

async function makeEngine() {
  const { GameEngine } = await loadEngine();
  let hud: Hud | null = null;
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, (h: Hud) => {
    hud = h;
  });
  engine.setup(MISSION as never, SQUAD as never, 0, "");
  engine.begin();
  const e = engine as unknown as AnyEngine;
  return {
    e,
    hud: () => {
      e.emitHud();
      return hud as unknown as Hud;
    },
  };
}

function step(e: AnyEngine, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) e.update(1 / 60);
}

function npcs(e: AnyEngine) {
  return e.units.filter((u) => u.npc && u.side === "allies" && u.alive);
}

function clearWave(e: AnyEngine) {
  // Kill every living enemy, then step past the 4s next-wave countdown.
  for (const u of [...e.units]) {
    if (u.side === "axis" && u.alive) e.damage(u, 999, "rifle", null);
  }
  step(e, 5);
}

describe("wave-clear allies", () => {
  it("clearing wave 1 brings 2 fresh weak riflemen", async () => {
    const { e, hud } = await makeEngine();
    expect(npcs(e).length).toBe(12);
    const before = new Set(npcs(e).map((u) => u.id));
    clearWave(e);
    const fresh = npcs(e);
    expect(fresh.length).toBe(14);
    const added = fresh.filter((u) => !before.has(u.id));
    expect(added.length).toBe(2);
    for (const u of added) {
      expect(u.type).toBe("rifleman");
      expect(u.npc).toBe(true);
      expect(u.maxHp).toBe(108); // weak scaling: 90% of a rifleman's 120
      expect(u.hp).toBe(108);
    }
    expect(hud().log.map((l) => l.text).join(" ")).toMatch(/2 fresh men up the line/);
  });

  it("clearing wave 2 brings 2 more", async () => {
    const { e } = await makeEngine();
    clearWave(e);
    expect(npcs(e).length).toBe(14);
    clearWave(e);
    expect(npcs(e).length).toBe(16);
  });

  it("clearing the final wave brings nobody — that is a victory", async () => {
    const { e } = await makeEngine();
    clearWave(e);
    clearWave(e);
    expect(npcs(e).length).toBe(16);
    clearWave(e);
    expect(e.battleState).toBe("victory");
    expect(npcs(e).length).toBe(16);
  });

  it("the fresh allies join the fight and advance east", async () => {
    const { e } = await makeEngine();
    const before = new Set(npcs(e).map((u) => u.id));
    clearWave(e);
    const fresh = npcs(e).filter((u) => !before.has(u.id));
    expect(fresh.length).toBe(2);
    const startX = Math.max(...fresh.map((u) => u.x));
    expect(startX).toBeLessThan(250); // walked in from the west edge
    step(e, 10);
    const advanced = fresh.filter((u) => u.alive && u.x > 250);
    expect(advanced.length).toBeGreaterThanOrEqual(1);
  });
});
