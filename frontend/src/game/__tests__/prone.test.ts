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
  orders: Array<{ x: number; y: number }>;
};
type Engine = {
  setup: (m: unknown, s: unknown, b: number, v: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  units: U[];
  covers: Array<{ x: number; y: number; r: number; q: number; kind?: string }>;
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

  it("a prone man fires only when he is still, never while crawling (Josh, 2026-11-12)", async () => {
    const e = await makeEngine();
    const shooter = e.units.filter((u) => u.side === "allies" && !u.npc)[0];
    const foes = e.units.filter((u) => u.side === "axis");
    const target = foes[0];
    for (const f of foes.slice(1)) f.alive = false;
    // Park everyone else far west: manual men hold, NPCs walk
    // east but stay out of range for the whole window.
    for (const a of e.units) {
      if (a.side === "allies" && a !== shooter) { a.x = 80; a.y = 200; }
    }
    // Seat the shooter in the x=900 trench line, target 150 east.
    const spot = e.covers
      .filter((c) => c.kind === "trench")
      .sort((a, b) => Math.abs(a.y - 675) - Math.abs(b.y - 675))[0];
    expect(spot).toBeTruthy();
    // West of the spot: the trench sits between him and the
    // target, which is what makes it his cover. (The axis
    // garrison seats at +8 because their threat is the west.)
    shooter.x = spot.x - 8;
    shooter.y = spot.y;
    shooter.hp = 5000;
    shooter.maxHp = 5000;
    target.x = spot.x + 158;
    target.y = spot.y;
    target.hp = 100000;
    target.maxHp = 100000;
    shooter.attackId = target.id;
    const hold = () => {
      shooter.suppression = 80; // stays prone (and pinned)
      shooter.morale = 100;
      target.x = spot.x + 158;
      target.y = spot.y;
      target.morale = 100;
      target.suppression = 0;
    };
    // Phase 1: crawl east under orders for 1.5s. He must move
    // and the target must not lose a single hit point.
    shooter.orders = [{ x: spot.x + 68, y: spot.y }];
    const startX = shooter.x;
    for (let s = 0; s < 90; s++) { hold(); e.update(1 / 60); }
    expect(shooter.prone).toBe(true);
    expect(shooter.x).toBeGreaterThan(startX + 8);
    expect(target.hp).toBe(100000);
    // Phase 2: back in the trench, orders cleared, still prone.
    // Now he shoots: the target bleeds within a few seconds.
    shooter.orders = [];
    shooter.x = spot.x - 8;
    shooter.y = spot.y;
    let bled = false;
    for (let s = 0; s < 60 * 6; s++) {
      hold();
      e.update(1 / 60);
      if (target.hp < 100000) { bled = true; break; }
    }
    expect(bled).toBe(true);
  }, 60000);
});
