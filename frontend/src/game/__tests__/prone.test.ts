// @vitest-environment node
// Prone (Josh, 2026-11-12): a footman under a real weight of
// fire (suppression 70+) drops flat. A prone man is much
// harder to hit at range (up to 45% of hits thwarted at
// 250+), gets no protection up close (60 and in), crawls at
// 0.45x, and fires 1.4x slower. He stays down until the
// fire slackens (suppression under 30). Vehicles and gun
// nests never go prone.
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
  code: "SILENT CHATEAU",
  location: "test",
  objective: "test",
  difficulty: "HARD",
  reward: 400,
  terrain: "town",
  brief: "test",
  enemies: [{ type: "volks", wave: 1, count: 3 }],
} as const;

type U = {
  id: number; side: string; npc: boolean; alive: boolean; x: number; y: number;
  hp: number; maxHp: number; attackId: number | null; suppression: number;
  morale: number; pinned: boolean; prone?: boolean; isStatic?: boolean;
};
type Engine = {
  setup: (m: unknown, s: unknown, b: number, v: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  units: U[];
};

async function makeEngine() {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {}) as unknown as Engine;
  engine.setup(TOWN as never, SQUAD as never, 0, "");
  engine.begin();
  return engine;
}

describe("prone under heavy fire", () => {
  it("suppression 70+ drops a footman flat; under 30 he gets back up", async () => {
    const e = await makeEngine();
    const man = e.units.find((u) => u.side === "axis")!;
    man.suppression = 60; // pinned (55+ after the decay tick), not prone yet
    e.update(1 / 60);
    expect(man.pinned).toBe(true);
    expect(man.prone).toBeFalsy();
    man.suppression = 80;
    e.update(1 / 60);
    expect(man.prone).toBe(true);
    man.suppression = 50; // fire slackens a little: still down
    e.update(1 / 60);
    expect(man.prone).toBe(true);
    man.suppression = 10;
    e.update(1 / 60);
    expect(man.prone).toBe(false);
  });

  it("long-range fire loses far more rounds on a prone man; close-range fire does not", async () => {
    async function shotLoss(range: number, prone: boolean): Promise<number> {
      const e = await makeEngine();
      const shooter = e.units.filter((u) => u.side === "allies" && !u.npc)[4]; // the MG man
      const target = e.units.find((u) => u.side === "axis")!;
      const tx = 2000;
      const ty = 300;
      target.x = tx;
      target.y = ty;
      target.hp = 1000;
      target.maxHp = 1000;
      shooter.x = tx - range;
      shooter.y = ty;
      shooter.hp = 5000;
      shooter.maxHp = 5000;
      shooter.attackId = target.id;
      for (let s = 0; s < 60 * 20; s++) {
        target.x = tx;
        target.y = ty;
        // Hold the target's state: prone stays down at 80,
        // standing stays clean at 40.
        target.suppression = prone ? 80 : 40;
        target.morale = 100;
        shooter.x = tx - range;
        shooter.y = ty;
        shooter.suppression = 0;
        shooter.morale = 100;
        shooter.pinned = false;
        e.update(1 / 60);
      }
      expect(target.prone ?? false).toBe(prone);
      return 1000 - target.hp;
    }
    // The far pair is measured twice and averaged: the
    // absorb is a dice roll (43% at this range), and a single
    // 20-second window still swings a few percent either way.
    const standingFar = (await shotLoss(240, false)) + (await shotLoss(240, false));
    const proneFar = (await shotLoss(240, true)) + (await shotLoss(240, true));
    const standingClose = await shotLoss(50, false);
    const proneClose = await shotLoss(50, true);
    expect(standingFar).toBeGreaterThan(40);
    expect(proneFar).toBeGreaterThan(0);
    expect(proneFar).toBeLessThan(standingFar * 0.75);
    // Up close the flat man is not protected: losses within
    // noise of the standing man (both just get hit).
    expect(proneClose).toBeGreaterThan(standingClose * 0.7);
  }, 90000);
});
