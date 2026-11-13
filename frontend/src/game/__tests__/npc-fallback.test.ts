// @vitest-environment node
// Tactical fallback for wounded NPC allies (Josh, 2026-11-12): at
// 35% health or less a 2nd Platoon man breaks off and pulls back
// west toward the rear instead of standing and dying in place,
// holds there while he is still badly hurt, and rejoins once he
// is healed above 60%. All NPC allies, every mission — this test
// runs on Silent Chateau (town), not the beach, on purpose.
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
  side: string; npc: boolean; type: string; alive: boolean;
  x: number; y: number; hp: number; maxHp: number; npcFallback?: boolean;
};

const SQUAD = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 2, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
  { id: "s3", name: "James Baker", type: "rifleman", rank: "Pvt.", level: 1, medals: [] },
  { id: "s4", name: "Chester Pruitt", type: "medic", rank: "Pvt.", level: 1, medals: [] },
  { id: "s5", name: "Raymond Boyd", type: "mg", rank: "Pvt.", level: 1, medals: [] },
] as const;

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

describe("NPC tactical fallback at low health", () => {
  it("a man at 30% health falls back west, holds, and rejoins when healed", async () => {
    const { GameEngine } = await loadEngine();
    const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
    const engine = new GameEngine(canvas, () => {}) as unknown as {
      setup: (m: unknown, s: unknown, b: number, v: string) => void;
      begin: () => void;
      update: (dt: number) => void;
      units: U[];
    };
    engine.setup(CHATEAU as never, SQUAD as never, 0, "");
    engine.begin();
    const man = engine.units.find((u) => u.side === "allies" && u.npc && u.type === "rifleman")!;
    const healthy = engine.units.filter((u) => u.side === "allies" && u.npc && u.type === "rifleman")[1];
    // Put him mid-map on the road, badly wounded.
    man.x = 900;
    man.y = 675;
    man.hp = man.maxHp * 0.3;
    engine.update(1 / 60);
    expect(man.npcFallback).toBe(true);
    expect(healthy.npcFallback).toBeFalsy();
    // Isolate the state machine from the battle: the garrison
    // camps the trench line at x 900, in range of the road,
    // and whether its fire pins the falling-back man mid-walk
    // is a coin flip that has nothing to do with the fallback
    // rule under test. Park the enemy far east, out of range.
    for (const u of engine.units) {
      if (u.side === "axis") {
        u.x = 3900;
        u.y = 200;
      }
    }
    // Three seconds of falling back: well west of where he stood.
    for (let step = 0; step < 60 * 3; step++) engine.update(1 / 60);
    expect(man.alive).toBe(true);
    expect(man.x).toBeLessThan(900 - 120);
    expect(man.npcFallback).toBe(true); // still hurt, still out of the line
    // The medic's work, simulated: healed past 60% and he rejoins.
    man.hp = man.maxHp;
    engine.update(1 / 60);
    engine.update(1 / 60);
    expect(man.npcFallback).toBe(false);
  });
});
