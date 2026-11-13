// @vitest-environment node
// Beach obstacles (Josh's suggestion, 2026-11-12): the hedgehog
// belt and the mines have to matter. Picking through the steel
// slows the landing force (55% speed within a hedgehog's reach),
// and Tellermines in the sand (x 300-780, clear of the beach
// trail) go off under a landing-force man's feet — once each,
// and never under the defenders who laid them.
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
  return { GameEngine: mod.GameEngine, roadYAt: mod.roadYAt };
};

type U = {
  id: number; side: string; npc: boolean; enemyType: string | null; alive: boolean;
  x: number; y: number; hp: number; maxHp: number;
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
  enemies: [
    { type: "volks", wave: 1, count: 3 },
    { type: "mg42", wave: 1, count: 1 },
  ],
} as const;

async function makeEngine() {
  const { GameEngine, roadYAt } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {}) as unknown as {
    setup: (m: unknown, s: unknown, b: number, v: string) => void;
    begin: () => void;
    update: (dt: number) => void;
    selectUnit: (id: number) => void;
    issueOrder: (x: number, y: number, q: boolean) => void;
    units: U[];
    blockers: Array<{ x: number; y: number; r: number; kind: string }>;
    mines: Array<{ x: number; y: number; armed: boolean }>;
  };
  engine.setup(OVERLORD as never, SQUAD as never, 0, "");
  return { engine, roadYAt };
}

describe("beach obstacles", () => {
  it("lays a minefield in the sand, clear of the trail and the hedgehogs", async () => {
    const { engine, roadYAt } = await makeEngine();
    expect(engine.mines.length).toBeGreaterThanOrEqual(16);
    expect(engine.mines.length).toBeLessThanOrEqual(24);
    const hedgehogs = engine.blockers.filter((b) => b.kind === "hedgehog");
    expect(hedgehogs.length).toBeGreaterThan(0);
    for (const m of engine.mines) {
      expect(m.x).toBeGreaterThanOrEqual(300);
      expect(m.x).toBeLessThanOrEqual(780);
      expect(Math.abs(m.y - roadYAt(m.x))).toBeGreaterThanOrEqual(46);
      for (const h of hedgehogs) expect(Math.hypot(m.x - h.x, m.y - h.y)).toBeGreaterThanOrEqual(34);
      expect(m.armed).toBe(true);
    }
  });

  it("a mine goes off under a landing-force man, once, and never under a defender", async () => {
    const { engine } = await makeEngine();
    engine.begin();
    const [m1, m2] = engine.mines;
    const npc = engine.units.find((u) => u.side === "allies" && u.npc)!;
    const volks = engine.units.find((u) => u.enemyType === "volks")!;
    npc.x = m1.x; npc.y = m1.y;
    volks.x = m2.x; volks.y = m2.y;
    const hpBefore = npc.hp;
    engine.update(1 / 60);
    expect(m1.armed).toBe(false);
    expect(npc.hp).toBeLessThan(hpBefore);
    expect(m2.armed).toBe(true);
    // And it does not go off twice for the next man across.
    const npc2 = engine.units.filter((u) => u.side === "allies" && u.npc)[1];
    npc2.x = m1.x; npc2.y = m1.y;
    const hp2 = npc2.hp;
    engine.update(1 / 60);
    expect(npc2.hp).toBe(hp2);
  });

  it("a man picking through the hedgehogs moves slower than a man in the open", async () => {
    const { engine } = await makeEngine();
    engine.begin();
    const hedgehogs = engine.blockers.filter((b) => b.kind === "hedgehog");
    const h = hedgehogs[0];
    const [beltMan, openMan] = engine.units.filter((u) => u.side === "allies" && !u.npc);
    const move = (engine as unknown as { moveToward: (u: U, x: number, y: number, dt: number) => void }).moveToward.bind(engine);
    // Belt man starts just west of a hedgehog, inside its slow
    // reach, and walks east through the belt.
    beltMan.x = h.x - h.r - 8;
    beltMan.y = h.y;
    // Open man inland, far from every hedgehog: full speed.
    openMan.x = 1500;
    openMan.y = 675;
    for (const hh of hedgehogs) expect(Math.hypot(openMan.x - hh.x, openMan.y - hh.y)).toBeGreaterThan(200);
    const bx = beltMan.x;
    const by = beltMan.y;
    const ox = openMan.x;
    const oy = openMan.y;
    for (let step = 0; step < 60; step++) {
      move(beltMan, beltMan.x + 100, beltMan.y, 1 / 60);
      move(openMan, openMan.x + 100, openMan.y, 1 / 60);
    }
    const beltTravel = Math.hypot(beltMan.x - bx, beltMan.y - by);
    const openTravel = Math.hypot(openMan.x - ox, openMan.y - oy);
    expect(openTravel).toBeGreaterThan(30);
    expect(beltTravel).toBeLessThan(openTravel * 0.75);
  });
});
