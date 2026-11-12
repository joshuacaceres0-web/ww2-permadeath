// @vitest-environment node
// Supply crates: 2 per map, 25 RP each. A squad man who walks up to
// one loots it; NPC allies and enemies never loot, and a broken
// (fleeing) man is running, not looting. A looted crate pays once.
// The loot RP reaches the backend through the battle report.
import { describe, expect, it } from "vitest";
import { CRATE_RP, LOOT_RADIUS } from "../data";

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
  { id: "s1", name: "Boyd", rank: "Sgt", level: 1, type: "rifleman", hp: 100, kills: 0, medals: [] },
  { id: "s2", name: "Kowalski", rank: "Cpl", level: 1, type: "medic", hp: 100, kills: 0, medals: [] },
  { id: "s3", name: "Reyes", rank: "Pfc", level: 1, type: "mg", hp: 100, kills: 0, medals: [] },
  { id: "s4", name: "Novak", rank: "Pfc", level: 1, type: "sniper", hp: 100, kills: 0, medals: [] },
  { id: "s5", name: "Hale", rank: "Pvt", level: 1, type: "at", hp: 100, kills: 0, medals: [] },
] as never;

function mission(terrain: string) {
  return {
    id: "op_test",
    code: "TEST",
    location: "Test",
    objective: "test",
    difficulty: "EASY",
    reward: 250,
    terrain,
    brief: "test",
    enemies: [
      { type: "volks", wave: 1, count: 3 },
      { type: "volks", wave: 2, count: 3 },
    ],
  } as never;
}

type U = Record<string, unknown> & {
  id: number; x: number; y: number; hp: number; alive: boolean; side: string;
  npc: boolean; broken: boolean; morale: number; soldierId: string | null; name: string;
};
type Crate = { x: number; y: number; looted: boolean };
type AnyEngine = Record<string, unknown> & {
  units: U[];
  crates: Crate[];
  blocked: Uint8Array;
  update: (dt: number) => void;
  emitHud: () => void;
  getReport: () => { lootRp: number };
};

async function makeEngine(terrain = "town", crateChance = 1) {
  const { GameEngine } = await loadEngine();
  let hud: unknown = null;
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, (h: unknown) => {
    hud = h;
  });
  // The crate roll happens in setup, so the chance has to be forced
  // before it. Default 1: every test battle has a crate unless the
  // test is about the roll itself.
  (engine as unknown as { crateChance: number }).crateChance = crateChance;
  engine.setup(mission(terrain), SQUAD, 0, "");
  engine.begin();
  const e = engine as unknown as AnyEngine;
  (e as unknown as { fleeChance: number }).fleeChance = 0;
  (e as unknown as { fleeChanceNormal: number }).fleeChanceNormal = 0;
  return { e, hud: () => hud as { log: Array<{ text: string }> } | null };
}

const CELL = 24;
const COLS = Math.ceil(3200 / CELL);

describe("supply crates", () => {
  it("crates are rare: at most one per battle, and the coin flip can leave none", async () => {
    const { e } = await makeEngine("town", 1);
    expect(e.crates.length).toBe(1);
    expect(e.crates[0].looted).toBe(false);
    const { e: eNone } = await makeEngine("town", 0);
    expect(eNone.crates.length).toBe(0);
  });

  it("every terrain kind gets one crate on open ground when the flip lands", async () => {
    for (const terrain of ["dday", "town", "causeway", "forest"]) {
      const { e } = await makeEngine(terrain, 1);
      expect(e.crates.length).toBe(1);
      for (const c of e.crates) {
        const cx = Math.floor(c.x / CELL);
        const cy = Math.floor(c.y / CELL);
        expect(e.blocked[cy * COLS + cx]).toBe(0);
      }
    }
  });

  it("a squad man who walks up loots the crate for 25 RP", async () => {
    const { e, hud } = await makeEngine();
    const man = e.units.find((u) => u.side === "allies" && !u.npc && u.soldierId === "s1")!;
    const crate = e.crates[0];
    man.x = crate.x + LOOT_RADIUS - 10;
    man.y = crate.y;
    e.update(1 / 60);
    expect(crate.looted).toBe(true);
    expect(e.getReport().lootRp).toBe(CRATE_RP);
    e.emitHud();
    expect(hud()?.log.some((l) => l.text.includes("looted a supply crate"))).toBe(true);
  });

  it("an NPC ally walking past does not loot", async () => {
    const { e } = await makeEngine();
    const npc = e.units.find((u) => u.side === "allies" && u.npc)!;
    const crate = e.crates[0];
    npc.x = crate.x;
    npc.y = crate.y;
    e.update(1 / 60);
    expect(crate.looted).toBe(false);
    expect(e.getReport().lootRp).toBe(0);
  });

  it("an enemy walking past does not loot", async () => {
    const { e } = await makeEngine();
    const foe = e.units.find((u) => u.side === "axis")!;
    const crate = e.crates[0];
    foe.x = crate.x;
    foe.y = crate.y;
    e.update(1 / 60);
    expect(crate.looted).toBe(false);
    expect(e.getReport().lootRp).toBe(0);
  });

  it("a broken man is running, not looting", async () => {
    const { e } = await makeEngine();
    const man = e.units.find((u) => u.side === "allies" && !u.npc && u.soldierId === "s1")!;
    const crate = e.crates[0];
    man.morale = 5;
    man.broken = true;
    man.x = crate.x;
    man.y = crate.y;
    e.update(1 / 60);
    expect(crate.looted).toBe(false);
    expect(e.getReport().lootRp).toBe(0);
  });

  it("a looted crate pays once, even when two men stand on it", async () => {
    const { e } = await makeEngine();
    const man1 = e.units.find((u) => u.soldierId === "s1")!;
    const man2 = e.units.find((u) => u.soldierId === "s2")!;
    const [c1] = e.crates;
    man1.x = c1.x;
    man1.y = c1.y;
    man2.x = c1.x;
    man2.y = c1.y;
    e.update(1 / 60);
    expect(c1.looted).toBe(true);
    expect(e.getReport().lootRp).toBe(CRATE_RP);
    e.update(1 / 60);
    expect(e.getReport().lootRp).toBe(CRATE_RP);
  });
});
