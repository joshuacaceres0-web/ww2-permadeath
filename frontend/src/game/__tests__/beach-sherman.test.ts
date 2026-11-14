// @vitest-environment node
// Bug #25 (sweep #3, 2026-11-13): the called-in Sherman froze
// for whole battles on the beach road. Rolling east at (501,650)
// it met a hedgehog whose blocked grid cell reaches into the
// road at the Phase C hull radius (30): the direct step was
// refused, the perpendicular slide "succeeded" by ~0.01 units
// a tick (the target was almost dead ahead), and the pocket
// escape — the mechanism built for exactly this — never got a
// turn, because a slide had technically moved. No stuck
// detector watches the tank-road branch, so the tank sat at
// full health, out of range, from t~20s to the filing, in
// battle after battle. The fix: a vehicle's axis slide must
// actually close on its target, and a wedged vehicle probes
// toward its waypoint first in the pocket escape. This test
// drives the real Overlord composition in AUTO (seeded, the
// sweep's seed 101) and pins that the Sherman gets THROUGH
// the hedgehog belt and up the beach.
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

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SQUAD = [
  { id: "bs1", name: "Beach Lead", type: "rifleman", rank: "Sgt.", level: 3, medals: [], quirks: [] },
  { id: "bs2", name: "Beach Two", type: "rifleman", rank: "Cpl.", level: 2, medals: [], quirks: [] },
  { id: "bs3", name: "Beach Radio", type: "radioman", rank: "Cpl.", level: 2, medals: [], quirks: [] },
  { id: "bs4", name: "Beach Medic", type: "medic", rank: "Pfc.", level: 1, medals: [], quirks: [] },
  { id: "bs5", name: "Beach Gunner", type: "mg", rank: "Pfc.", level: 1, medals: [], quirks: [] },
  { id: "bs6", name: "Beach AT", type: "at", rank: "Pfc.", level: 1, medals: [], quirks: [] },
] as never;

type U = Record<string, unknown> & {
  type: string; alive: boolean; x: number; y: number; hp: number;
};
type E = Record<string, unknown> & {
  units: U[]; elapsed: number; battleState: string;
  update: (dt: number) => void; setAutoBattle: (b: boolean) => void;
  callTank: () => boolean; begin: () => void;
};

describe("bug #25 — the beach Sherman must not wedge on the road", () => {
  it("rolls through the hedgehog belt and up the beach in AUTO", { timeout: 180000 }, async () => {
    const realRandom = Math.random;
    Math.random = mulberry32(101);
    try {
      const { GameEngine } = await import("../engine");
      const { localRequest } = await import("../../lib/localBackend");
      const missions = await localRequest<unknown[]>("GET", "/missions");
      const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
      const engine = new GameEngine(canvas, () => {});
      const e = engine as unknown as E;
      (e as unknown as { setup: (...a: unknown[]) => void }).setup(missions[0] as never, SQUAD, 0, "" as never, 8, "bs1");
      e.begin();
      e.setAutoBattle(true);
      let tank: U | undefined;
      let called = false;
      // 200s of battle at the sweep's step: pre-fix the Sherman
      // is still sitting at x~501 when this loop ends.
      for (let i = 0; i < 800 && e.battleState === "active"; i++) {
        e.update(0.25);
        if (!called && e.elapsed >= 5) called = e.callTank();
        tank = e.units.find((u) => u.type === "tank");
        if (tank && tank.x > 900) break;
      }
      expect(called).toBe(true);
      expect(tank).toBeDefined();
      expect(tank!.alive).toBe(true);
      expect(
        tank!.x,
        `Sherman wedged at (${tank!.x.toFixed(0)},${tank!.y.toFixed(0)}) — bug #25`,
      ).toBeGreaterThan(900);
    } finally {
      Math.random = realRandom;
    }
  });
});
