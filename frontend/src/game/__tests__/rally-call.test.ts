// @vitest-environment node
// Rally Call from the radio panel (Josh, 2026-11-13): the
// panel's eighth call. The player orders the squad radioman
// to rally now instead of waiting for his own driver to pick
// the moment. Same man, same 150 ring, same 20s ability
// cooldown as the radioman's Rally Call ability, no RP cost.
// Nobody needing a rally means the call does not go out and
// the cooldown is not spent — the same rule the AI driver
// has always run on.
import { describe, it, expect } from "vitest";

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
  return { GameEngine: mod.GameEngine, HudSnapshot: undefined };
};

const TOWN = {
  id: "op_02",
  index: 1,
  code: "CHATEAU",
  location: "test",
  objective: "test",
  difficulty: "HARD",
  reward: 400,
  terrain: "town",
  brief: "test",
  enemies: [{ type: "volks", wave: 1, count: 2 }],
} as const;

const WITH_RADIO = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 3, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
  { id: "s3", name: "Eddie Voss", type: "radioman", rank: "Pvt.", level: 1, medals: [] },
] as const;

const NO_RADIO = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 3, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
] as const;

type U = {
  id: number; side: string; npc: boolean; alive: boolean; type?: string;
  x: number; y: number; morale: number; abilityCd: number;
  broken: boolean; willFlee: boolean;
};
type Engine = {
  setup: (m: unknown, s: unknown, b: number, v: string, cl?: number, leaderId?: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  units: U[];
  callRally: () => boolean;
  emitHud: () => void;
};

async function makeEngine(squad: unknown) {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  let lastHud: { supportCd: { rally: number } } | null = null;
  const engine = new GameEngine(canvas, (h: unknown) => { lastHud = h as { supportCd: { rally: number } }; }) as unknown as Engine;
  engine.setup(TOWN as never, squad as never, 0, "", 1);
  engine.begin();
  // Park the enemy far off: morale moves only when the test moves it.
  for (const u of engine.units) if (u.side === "axis") { u.x = 100; u.y = 1300; }
  return { e: engine, hud: () => { engine.emitHud(); return lastHud!; } };
}

describe("rally call from the radio panel", () => {
  it("rallies nearby men, spends the radioman cooldown, reports it on the HUD", async () => {
    const { e, hud } = await makeEngine(WITH_RADIO);
    const radio = e.units.find((u) => u.type === "radioman")!;
    const mate = e.units.find((u) => u.type === "rifleman" && u.id !== radio.id && !u.npc && u.alive && u.x !== undefined)!;
    const hurt = e.units.filter((u) => u.side === "allies" && !u.npc && u.id !== radio.id)[1] ?? mate;
    hurt.x = radio.x + 10;
    hurt.y = radio.y;
    hurt.morale = 50;
    expect(e.callRally()).toBe(true);
    expect(hurt.morale).toBe(65);
    expect(radio.abilityCd).toBe(20);
    expect(hud().supportCd.rally).toBe(20);
    // On cooldown the panel call refuses.
    hurt.morale = 40;
    expect(e.callRally()).toBe(false);
    expect(hurt.morale).toBe(40);
  });

  it("steadies a fleeing man at 65", async () => {
    const { e } = await makeEngine(WITH_RADIO);
    const radio = e.units.find((u) => u.type === "radioman")!;
    const runner = e.units.find((u) => u.side === "allies" && !u.npc && u.id !== radio.id)!;
    runner.x = radio.x + 10;
    runner.y = radio.y;
    runner.morale = 10;
    runner.broken = true;
    runner.willFlee = true;
    expect(e.callRally()).toBe(true);
    expect(runner.morale).toBe(65);
  });

  it("nobody needs rallying: no call, no cooldown spent", async () => {
    const { e } = await makeEngine(WITH_RADIO);
    const radio = e.units.find((u) => u.type === "radioman")!;
    for (const u of e.units) if (u.side === "allies") u.morale = 100;
    expect(e.callRally()).toBe(false);
    expect(radio.abilityCd).toBe(0);
  });

  it("no radioman, no rally", async () => {
    const { e } = await makeEngine(NO_RADIO);
    const mate = e.units.find((u) => u.side === "allies" && !u.npc)!;
    mate.morale = 50;
    expect(e.callRally()).toBe(false);
    expect(mate.morale).toBe(50);
  });
});
