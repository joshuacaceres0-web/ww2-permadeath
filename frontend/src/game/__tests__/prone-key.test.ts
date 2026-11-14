// @vitest-environment node
// C is the desktop prone key (Josh, WW2 chat 2026-11-13),
// wired to the same leader prone toggle as the touch PRONE
// button and the Phase B X key: still = latch prone / stand,
// moving = dolphin dive landing prone with the hold.
// C used to be Take Cover — that order moved to G, it did
// not vanish — and X stays wired to the same toggle.
// The same file pins the dive cooldown (Josh, 2026-11-13):
// 3.0s from the landing; inside it a moving press only drops
// the man prone in place, and past it he dives again.
import { describe, expect, it } from "vitest";

function stubBrowser() {
  const listeners = new Map<string, Array<(e: unknown) => void>>();
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
    width: 1600,
    height: 900,
    getContext: () => ctx,
    toDataURL: () => "",
    getBoundingClientRect: () => ({ width: 1600, height: 900, left: 0, top: 0 }),
    addEventListener: () => {},
    removeEventListener: () => {},
    style: {},
  });
  const store = new Map<string, string>();
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  g.window = globalThis;
  g.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
  g.document = {
    createElement: (tag: string) => (tag === "canvas" ? makeCanvas() : {}),
    fonts: { load: () => Promise.resolve([]) },
  };
  g.HTMLCanvasElement = function () {};
  g.requestAnimationFrame = () => 0;
  g.cancelAnimationFrame = () => {};
  g.performance = { now: () => 0 };
  g.addEventListener = (type: string, fn: (e: unknown) => void) => {
    const list = listeners.get(type) ?? [];
    list.push(fn);
    listeners.set(type, list);
  };
  g.removeEventListener = (type: string, fn: (e: unknown) => void) => {
    listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn));
  };
  g.__dispatch = (type: string, e: unknown) => {
    for (const fn of listeners.get(type) ?? []) fn(e);
  };
}

stubBrowser();

type U = {
  id: number; side: string; alive: boolean; x: number; y: number;
  hp: number; maxHp: number; prone: boolean; suppression: number;
  leapT?: number; leapKind?: string; proneLatch?: boolean; proneHoldUntil?: number;
  diveReadyAt?: number;
};

type Engine = {
  setup: (m: unknown, s: unknown, b: number, v?: string, cl?: number, lp?: string) => void;
  begin: () => void;
  attach: () => void;
  destroy: () => void;
  update: (dt: number) => void;
  units: U[];
  leaderUnit: () => U | null;
  elapsed: number;
  takeCover: () => void;
};

const TOWN = {
  id: "op_02", index: 1, code: "SILENT CHATEAU", location: "test", objective: "test",
  difficulty: "MEDIUM", reward: 200, terrain: "town", brief: "test",
  enemies: [{ type: "grenadier", wave: 1, count: 1 }],
};

const SQUAD = [
  { id: "s-a", name: "Able", type: "rifleman", rank: "Pvt.", level: 0, medals: [], quirks: [] },
  { id: "s-b", name: "Baker", type: "rifleman", rank: "Sgt.", level: 3, medals: [], quirks: [] },
  { id: "s-c", name: "Charlie", type: "medic", rank: "Cpl.", level: 1, medals: [], quirks: [] },
];

async function makeEngine() {
  const { GameEngine } = await import("../engine");
  const canvas = (document as unknown as { createElement: (t: string) => unknown }).createElement("canvas");
  const e = new GameEngine(canvas as never, () => {}) as unknown as Engine;
  e.setup(TOWN, SQUAD, 0, "", 1, "");
  e.begin();
  e.attach();
  // Park the lone enemy far away with a mountain of HP so
  // the battle cannot end mid-test (same trick as phase-b).
  for (const u of e.units) if (u.side === "axis") {
    u.x = 3900; u.y = 675;
    u.hp = 100000; u.maxHp = 100000;
  }
  return e;
}

const dispatch = (globalThis as unknown as { __dispatch: (t: string, e: unknown) => void }).__dispatch;
const keydown = (k: string) => dispatch("keydown", { key: k, preventDefault: () => {} });
const keyup = (k: string) => dispatch("keyup", { key: k, preventDefault: () => {} });

describe("the C prone key (Josh, 2026-11-13)", () => {
  it("C pressed standing still: prone and latched; C again stands him up", async () => {
    const e = await makeEngine();
    try {
      const lead = e.leaderUnit()!;
      lead.suppression = 0;
      keydown("c");
      expect(lead.prone).toBe(true);
      expect(lead.proneLatch).toBe(true);
      // The latch holds him down against the auto stand-up rule.
      for (let t = 0; t < 2; t += 0.1) e.update(0.1);
      expect(lead.prone).toBe(true);
      keydown("c");
      expect(lead.prone).toBe(false);
      expect(lead.proneLatch).toBe(false);
    } finally {
      e.destroy();
    }
  }, 30000);

  it("C pressed while moving: a dolphin dive forward, landing prone with latch and hold", async () => {
    const e = await makeEngine();
    try {
      const lead = e.leaderUnit()!;
      lead.x = 500; lead.y = 675;
      lead.suppression = 0;
      const x0 = lead.x;
      keydown("d"); // running east, through the real key handler
      e.update(0.1);
      expect(lead.x).toBeGreaterThan(x0);
      keydown("c");
      expect(lead.leapKind).toBe("dive");
      for (let t = 0; t < 0.5; t += 0.05) e.update(0.05);
      keyup("d");
      expect(lead.leapT ?? 0).toBe(0);
      expect(lead.x).toBeGreaterThan(x0 + 30); // the leap carried him forward
      expect(lead.prone).toBe(true);
      expect(lead.proneLatch).toBe(true);
      expect((lead.proneHoldUntil ?? 0)).toBeGreaterThan(e.elapsed);
      for (let t = 0; t < 1; t += 0.1) e.update(0.1);
      expect(lead.prone).toBe(true);
    } finally {
      e.destroy();
    }
  }, 30000);

  it("the dive cooldown: a moving press inside it drops him prone in place; past it, he dives again", async () => {
    const e = await makeEngine();
    try {
      const lead = e.leaderUnit()!;
      lead.x = 500; lead.y = 675;
      lead.suppression = 0;
      // First dive, through the real keys.
      keydown("d");
      e.update(0.1);
      keydown("c");
      expect(lead.leapKind).toBe("dive");
      for (let t = 0; t < 0.5; t += 0.05) e.update(0.05);
      keyup("d");
      expect(lead.leapT ?? 0).toBe(0);
      expect(lead.prone).toBe(true);
      // The cooldown runs 3s from the landing.
      expect((lead.diveReadyAt ?? 0)).toBeGreaterThan(e.elapsed + 2.5);
      // Stand him up — the toggle itself is never cooled down…
      keydown("c");
      expect(lead.prone).toBe(false);
      // …run again and press inside the cooldown: no leap.
      keydown("d");
      e.update(0.1);
      const xBefore = lead.x;
      keydown("c");
      expect(lead.leapT ?? 0).toBe(0);
      expect(lead.leapKind).toBeUndefined();
      expect(lead.x).toBe(xBefore); // his position did not jump forward
      expect(lead.prone).toBe(true); // he dropped prone in place…
      expect(lead.proneLatch).toBe(true); // …latched, as a still press does
      keyup("d");
      // Past the cooldown, the same moving press dives again.
      for (let t = 0; t < 3.5; t += 0.1) e.update(0.1);
      keydown("c"); // stand (latched prone → up)
      expect(lead.prone).toBe(false);
      keydown("d");
      e.update(0.1);
      keydown("c");
      expect(lead.leapKind).toBe("dive");
      keyup("d");
    } finally {
      e.destroy();
    }
  }, 30000);

  it("the clash resolution: C no longer takes cover, G does, and X still toggles prone", async () => {
    const e = await makeEngine();
    try {
      const lead = e.leaderUnit()!;
      lead.suppression = 0;
      let coverCalls = 0;
      e.takeCover = () => { coverCalls++; };
      keydown("c");
      expect(coverCalls).toBe(0); // C is prone now, not cover
      expect(lead.prone).toBe(true);
      keydown("g");
      expect(coverCalls).toBe(1); // the cover order lives on G
      keydown("x");
      expect(lead.prone).toBe(false); // X, the Phase B key, still works
    } finally {
      e.destroy();
    }
  }, 30000);
});
