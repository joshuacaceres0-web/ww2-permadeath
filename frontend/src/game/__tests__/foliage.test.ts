// @vitest-environment node
// Foliage (Josh, 2026-11-12): trees and bushes are soft cover
// now. Footmen walk through them (a little slower), the
// canopy rustles while they do, and a man standing in the
// green is harder to hit — the leaves catch about a third of
// the rounds that would have found him, on top of the light
// cover a tree already gave. Vehicles still cannot pass.
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

const FOREST = {
  id: "op_04",
  index: 3,
  code: "PERMAFROST",
  location: "test",
  objective: "test",
  difficulty: "BRUTAL",
  reward: 1000,
  terrain: "forest",
  brief: "test",
  enemies: [{ type: "volks", wave: 1, count: 2 }],
} as const;

type U = {
  id: number; side: string; npc: boolean; alive: boolean; x: number; y: number;
  hp: number; maxHp: number; attackId: number | null; suppression: number;
  morale: number; pinned: boolean; enemyType: string | null;
};
type B = { x: number; y: number; r: number; kind?: string; rustleT?: number };
type Engine = {
  setup: (m: unknown, s: unknown, b: number, v: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  selectUnit: (id: number) => void;
  issueOrder: (x: number, y: number, q: boolean) => void;
  units: U[];
  blockers: B[];
  covers: Array<{ x: number; y: number; r: number }>;
  particles: Array<{ kind: string }>;
  inFoliage: (u: U) => boolean;
};

async function makeEngine() {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {}) as unknown as Engine;
  engine.setup(FOREST as never, SQUAD as never, 0, "");
  engine.begin();
  return engine;
}

/** A tree clear of the trench lines and the road. */
function pickTree(e: Engine): B {
  const trees = e.blockers.filter((b) => b.kind === "tree");
  const t = trees.find(
    (b) =>
      b.x > 500 &&
      b.x < 3400 &&
      Math.abs(b.x - 1500) > 130 &&
      Math.abs(b.x - 2600) > 130 &&
      Math.abs(b.x - 3400) > 130 &&
      Math.abs(b.y - 675) > 130,
  );
  if (!t) throw new Error("no suitable tree in the forest fixture");
  return t;
}

describe("foliage is soft cover", () => {
  it("a man walks straight through a tree, and the canopy rustles while he does", async () => {
    const e = await makeEngine();
    const tree = pickTree(e);
    const man = e.units.find((u) => u.side === "allies" && !u.npc)!;
    man.x = tree.x - 85;
    man.y = tree.y;
    e.selectUnit(man.id);
    e.issueOrder(tree.x + 85, tree.y, false);
    let minDist = Infinity;
    let leaves = 0;
    let rustled = false;
    for (let s = 0; s < 60 * 25; s++) {
      e.update(1 / 60);
      const d = Math.hypot(man.x - tree.x, man.y - tree.y);
      minDist = Math.min(minDist, d);
      if (d < tree.r + 6) {
        leaves += e.particles.filter((p) => p.kind === "leaf").length;
        if (tree.rustleT !== undefined) rustled = true;
      }
      if (man.x > tree.x + 60) break;
    }
    expect(minDist).toBeLessThan(tree.r); // he entered the canopy circle
    expect(man.x).toBeGreaterThan(tree.x + 40); // and came out the far side
    expect(rustled).toBe(true);
    expect(leaves).toBeGreaterThan(0);
  }, 30000);

  it("fire into foliage loses far more rounds than fire into the open", async () => {
    async function shotLoss(inTree: boolean): Promise<number> {
      const e = await makeEngine();
      const tree = pickTree(e);
      const shooter = e.units.find((u) => u.side === "allies" && !u.npc && u.id !== undefined && (u as unknown as { type: string }).type === "mg") ??
        e.units.filter((u) => u.side === "allies" && !u.npc)[4];
      const target = e.units.find((u) => u.side === "axis")!;
      // The target spot: in the tree, or in a clear patch with
      // no cover and no foliage anywhere near.
      let tx = tree.x;
      let ty = tree.y;
      if (!inTree) {
        outer: for (let cx = 700; cx < 3600; cx += 60) {
          for (let cy = 140; cy < 1250; cy += 60) {
            if (Math.abs(cy - 675) < 90) continue;
            const nearBlocker = e.blockers.some((b) => Math.hypot(b.x - cx, b.y - cy) < 70);
            const nearCover = e.covers.some((c) => Math.hypot(c.x - cx, c.y - cy) < 46);
            if (!nearBlocker && !nearCover) {
              tx = cx;
              ty = cy;
              break outer;
            }
          }
        }
      }
      target.x = tx;
      target.y = ty;
      target.hp = 1000;
      (target as unknown as { maxHp: number }).maxHp = 1000;
      (shooter as U).x = tx - 130;
      (shooter as U).y = ty;
      (shooter as U).hp = 5000;
      (shooter as unknown as { maxHp: number }).maxHp = 5000;
      (shooter as U).attackId = target.id;
      for (let s = 0; s < 60 * 14; s++) {
        target.x = tx;
        target.y = ty;
        target.suppression = 40;
        target.morale = 100;
        (shooter as U).x = tx - 130;
        (shooter as U).y = ty;
        (shooter as U).suppression = 0;
        (shooter as U).morale = 100;
        (shooter as U).pinned = false;
        e.update(1 / 60);
      }
      return 1000 - target.hp;
    }
    const open = await shotLoss(false);
    const green = await shotLoss(true);
    expect(open).toBeGreaterThan(20);
    expect(green).toBeGreaterThan(0); // rounds still get through: not a wall
    expect(green).toBeLessThan(open * 0.8);
  }, 60000);
});
