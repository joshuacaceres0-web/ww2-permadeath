// @vitest-environment node
// Mortar effects (Josh, 2026-11-12): the red warning circles are
// gone, replaced by a whistle about a second before impact, and a
// near miss now rattles the men it did not wound — suppression
// and morale, no damage — so bunching up under mortars is
// dangerous even when the shells miss.
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
  side: string; npc: boolean; enemyType: string | null; alive: boolean;
  x: number; y: number; hp: number; maxHp: number;
  suppression: number; morale: number;
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
  code: "SILENT CHATEAU",
  location: "test",
  objective: "test",
  difficulty: "HARD",
  reward: 400,
  terrain: "town",
  brief: "test",
  enemies: [{ type: "mortar", wave: 1, count: 1 }],
} as const;

async function makeEngine() {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {}) as unknown as {
    setup: (m: unknown, s: unknown, b: number, v: string) => void;
    begin: () => void;
    update: (dt: number) => void;
    debugBlast: (x: number, y: number) => void;
    units: U[];
    projectiles: Array<{ sourceType: string; t: number; dur: number; whistled?: boolean }>;
  };
  engine.setup(TOWN as never, SQUAD as never, 0, "");
  engine.begin();
  return engine;
}

describe("mortar near miss and whistle", () => {
  it("a near miss rattles without wounding; a far miss does nothing; a hit still wounds", async () => {
    const e = await makeEngine();
    const [near, far, hit] = e.units.filter((u) => u.side === "allies" && !u.npc);
    near.x = 600; near.y = 675;
    far.x = 1200; far.y = 675;
    hit.x = 1800; hit.y = 675;
    e.debugBlast(690, 675); // 90 from near: inside the 70+45 near-miss band, outside the 70 damage radius
    e.debugBlast(1400, 675); // 200 from far: outside everything
    e.debugBlast(1840, 675); // 40 from hit: inside the damage radius
    expect(near.hp).toBe(near.maxHp);
    expect(near.suppression).toBeGreaterThanOrEqual(30);
    expect(near.morale).toBeLessThanOrEqual(94);
    expect(far.hp).toBe(far.maxHp);
    expect(far.suppression).toBe(0);
    expect(far.morale).toBe(100);
    expect(hit.hp).toBeLessThan(hit.maxHp);
  });

  it("a mortar shell in flight is marked whistled about a second before impact", async () => {
    const e = await makeEngine();
    const mortar = e.units.find((u) => u.enemyType === "mortar")!;
    const man = e.units.find((u) => u.side === "allies" && !u.npc)!;
    mortar.x = 700; mortar.y = 675;
    man.x = 400; man.y = 675;
    let sawWhistled = false;
    for (let step = 0; step < 60 * 8 && !sawWhistled; step++) {
      e.update(1 / 60);
      for (const p of e.projectiles) {
        if (p.sourceType === "mortar" && p.whistled && p.t < p.dur) sawWhistled = true;
      }
    }
    expect(sawWhistled).toBe(true);
  });
});
