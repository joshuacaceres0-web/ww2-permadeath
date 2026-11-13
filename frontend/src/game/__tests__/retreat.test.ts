// @vitest-environment node
// Retreat rework (Josh, 2026-11-12: hard to retreat, not
// instant). Pressing retreat starts a fighting withdrawal: the
// squad falls back to the west edge under fire, men can be hit
// and lost on the way, only the men who reach the edge count
// as retreated, and when the squad is out (or gone) the battle
// files as a defeat — with the kills already made intact, so
// kill RP pays on them through the usual filing (the reward
// math itself is locked by the backend battle-reward tests).
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

const SQUAD = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 2, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
  { id: "s3", name: "James Baker", type: "rifleman", rank: "Pvt.", level: 1, medals: [] },
  { id: "s4", name: "Chester Pruitt", type: "medic", rank: "Pvt.", level: 1, medals: [] },
  { id: "s5", name: "Raymond Boyd", type: "mg", rank: "Pvt.", level: 1, medals: [] },
] as const;

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
  enemies: [
    { type: "volks", wave: 1, count: 2 },
    { type: "mg42", wave: 1, count: 1 },
  ],
} as const;

type U = {
  id: number; side: string; npc: boolean; alive: boolean; vehicle: boolean;
  x: number; y: number; hp: number; maxHp: number; kills: number;
  enemyType: string | null; extracted?: boolean;
  counterAttack?: boolean; aggressive?: boolean;
  orders: Array<{ x: number; y: number }>;
};
type Engine = {
  setup: (m: unknown, s: unknown, b: number, v: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  retreat: () => void;
  units: U[];
  phase: string;
  battleState: string;
  retreating: boolean;
  fallen: unknown[];
  damage: (u: U, dmg: number, st: string, killerId: number | null) => void;
};

async function makeEngine() {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {}) as unknown as Engine;
  engine.setup(TOWN as never, SQUAD as never, 0, "");
  return engine;
}

const squadOf = (e: Engine) => e.units.filter((u) => u.side === "allies" && !u.npc && !u.vehicle);

describe("retreat is a fighting withdrawal", () => {
  it("pressing retreat does not end the battle: it orders the fall back", async () => {
    const e = await makeEngine();
    e.begin();
    e.retreat();
    expect(e.retreating).toBe(true);
    expect(e.phase).toBe("battle");
    expect(e.battleState).toBe("active");
    for (const u of squadOf(e)) {
      expect(u.orders.length).toBeGreaterThan(0);
      const last = u.orders[u.orders.length - 1];
      expect(last.x).toBeLessThan(60);
    }
  });

  it("a man falling back through an MG's arc gets hit on the way out", async () => {
    const e = await makeEngine();
    e.begin();
    const mg = e.units.find((u) => u.enemyType === "mg42")!;
    const man = squadOf(e)[0];
    // The MG sits on his lane west; he starts just east of it.
    mg.x = 700;
    mg.y = 675;
    man.x = 790;
    man.y = 675;
    man.hp = man.maxHp;
    e.retreat();
    let hit = false;
    for (let s = 0; s < 60 * 20; s++) {
      e.update(1 / 60);
      if (!man.alive || man.hp < man.maxHp) hit = true;
      if (man.extracted) break;
    }
    expect(hit).toBe(true);
  }, 30000);

  it("reaching the edge extracts the squad and files a defeat, kills intact", async () => {
    const e = await makeEngine();
    e.begin();
    const men = squadOf(e);
    men[0].kills = 3; // kills made before the fall back
    for (const u of men) {
      u.x = 70;
    }
    e.retreat();
    for (let s = 0; s < 60 * 10 && e.phase === "battle"; s++) e.update(1 / 60);
    expect(e.phase).toBe("over");
    expect(e.battleState).toBe("defeat");
    expect(men.every((u) => u.extracted)).toBe(true);
    expect(e.fallen).toHaveLength(0);
    // The kill RP basis survived the withdrawal untouched.
    expect(men.reduce((n, u) => n + u.kills, 0)).toBe(3);
  });

  it("the battle waits for the last man: four out is not a filing while one is still in", async () => {
    const e = await makeEngine();
    e.begin();
    const men = squadOf(e);
    men.forEach((u, i) => {
      u.x = i < 4 ? 70 : 2000;
    });
    const last = men[4];
    e.retreat();
    for (let s = 0; s < 60 * 6; s++) e.update(1 / 60);
    expect(men.slice(0, 4).every((u) => u.extracted)).toBe(true);
    expect(e.phase).toBe("battle");
    expect(e.battleState).toBe("active");
    // He does not make it: the filing completes on his loss,
    // with the four who got out counted as retreated.
    e.damage(last, 9999, "mg42", null);
    for (let s = 0; s < 60 * 2 && e.phase === "battle"; s++) e.update(1 / 60);
    expect(e.phase).toBe("over");
    expect(e.battleState).toBe("defeat");
    expect(e.fallen).toHaveLength(1);
  });

  it("retreating brings enemy flankers in off the north and south edges (Josh, 2026-11-12)", async () => {
    const e = await makeEngine();
    e.begin();
    // Squad deep in the map, so the withdrawal is still under
    // way when the flankers are due.
    squadOf(e).forEach((u, i) => { u.x = 1500; u.y = 620 + i * 30; });
    const axisBefore = e.units.filter((u) => u.side === "axis").length;
    e.retreat();
    // Five seconds in: nobody new yet.
    for (let s = 0; s < 60 * 5; s++) e.update(1 / 60);
    expect(e.units.filter((u) => u.side === "axis").length).toBe(axisBefore);
    // Past the 6s mark: six flankers, three a side, off the
    // north and south edges, flagged to charge.
    for (let s = 0; s < 60 * 2; s++) e.update(1 / 60);
    const flankers = e.units.filter((u) => u.side === "axis" && u.counterAttack);
    expect(flankers).toHaveLength(6);
    expect(flankers.filter((u) => u.y < 200)).toHaveLength(3);
    expect(flankers.filter((u) => u.y > 1150)).toHaveLength(3);
    expect(flankers.every((u) => u.aggressive)).toBe(true);
    // And they move in on the squad: a north flanker's y grows
    // well off the edge as he cuts south toward the withdrawal.
    const north = flankers.find((u) => u.y < 200)!;
    const y0 = north.y;
    for (let s = 0; s < 60 * 4; s++) e.update(1 / 60);
    expect(north.y).toBeGreaterThan(y0 + 80);
  });

  it("no retreat, no flankers", async () => {
    const e = await makeEngine();
    e.begin();
    const axisBefore = e.units.filter((u) => u.side === "axis").length;
    for (let s = 0; s < 60 * 12; s++) e.update(1 / 60);
    expect(e.units.filter((u) => u.side === "axis").length).toBe(axisBefore);
    expect(e.units.some((u) => u.counterAttack)).toBe(false);
  });
});
