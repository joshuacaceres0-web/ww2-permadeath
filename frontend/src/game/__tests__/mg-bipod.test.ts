// @vitest-environment node
/**
 * The MG gunner's bipod (Josh, 2026-11-13): a prone MG gunner
 * has his gun deployed. He cannot move at all while he is down,
 * and in exchange the deployed gun reaches a quarter further
 * (320 to 400) and shoots tighter. Standing back up packs the
 * gun away: a gunner whose suppression has fallen off moves and
 * fights at his listed numbers again.
 */
import { describe, expect, it } from "vitest";

function stubBrowser() {
  const grad = { addColorStop: () => {} };
  const ctx = new Proxy({}, {
    get(_t, p) {
      if (p === "createLinearGradient" || p === "createRadialGradient") return () => grad;
      if (p === "measureText") return () => ({ width: 10 });
      if (p === "getImageData") return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (p === "createPattern") return () => ({});
      return typeof p === "string" ? () => {} : undefined;
    },
    set() { return true; },
  });
  const makeCanvas = () => ({ width: 0, height: 0, getContext: () => ctx, toDataURL: () => "", getBoundingClientRect: () => ({ width: 1600, height: 900, left: 0, top: 0 }), addEventListener: () => {}, removeEventListener: () => {}, style: {} });
  const store = new Map<string, string>();
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  g.window = globalThis;
  g.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
  g.document = { createElement: (tag: string) => (tag === "canvas" ? makeCanvas() : {}), fonts: { load: () => Promise.resolve([]) } };
  g.HTMLCanvasElement = function () {};
}
stubBrowser();
const loadEngine = async () => (await import("../engine")).GameEngine;

const FOREST = { id: "op_04", index: 3, code: "PERMAFROST", location: "test", objective: "test", difficulty: "EXTREME", reward: 1000, terrain: "forest", brief: "test", enemies: [{ type: "volks", wave: 1, count: 3 }] } as const;
const TOWN = { id: "op_02", index: 1, code: "CHATEAU", location: "test", objective: "test", difficulty: "HARD", reward: 800, terrain: "town", brief: "test", enemies: [{ type: "volks", wave: 1, count: 4 }] } as const;

type U = {
  id: number; side: string; npc: boolean; type: string; enemyType: string | null; alive: boolean;
  x: number; y: number; hp: number; maxHp: number; prone: boolean; suppression: number; aggressive: boolean;
};
type Engine = {
  setup: (m: unknown, s: unknown, b: number, v: string, cl?: number, leader?: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  setAutoBattle: (on: boolean) => void;
  effRange: (u: U) => number;
  deployedBipod: (u: U) => boolean;
  spawnEnemyUnit: (t: string, x: number, y: number, rng: () => number, trench?: boolean) => U;
  units: U[];
};

async function makeEngine(mission: unknown = FOREST) {
  const GameEngine = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const e = new GameEngine(canvas, () => {}) as unknown as Engine;
  const mk = (id: string, type: string, rank = "Pvt.") => ({ id, name: id, type, rank, level: 1, medals: [] });
  e.setup(mission as never, [mk("s-lead", "rifleman", "Sgt."), mk("s-mg", "mg")] as never, 0, "", 8, "s-lead");
  e.begin();
  e.setAutoBattle(true);
  const lead = e.units.find((u) => u.type === "rifleman" && !u.npc)!;
  lead.x = 120;
  lead.y = 120;
  return e;
}

describe("the MG bipod", () => {
  it("deployed reach is a quarter further; standing reach is the listed 320", async () => {
    const e = await makeEngine();
    const mg = e.units.find((u) => u.type === "mg")!;
    mg.prone = false;
    expect(e.deployedBipod(mg)).toBe(false);
    expect(e.effRange(mg)).toBe(320);
    mg.prone = true;
    expect(e.deployedBipod(mg)).toBe(true);
    expect(e.effRange(mg)).toBe(400);
    // Only the MG class deploys: a prone rifleman gains nothing.
    const lead = e.units.find((u) => u.type === "rifleman" && !u.npc)!;
    lead.prone = true;
    expect(e.deployedBipod(lead)).toBe(false);
    expect(e.effRange(lead)).toBe(240);
  });

  it("a deployed gunner does not move, and shoots a man his standing reach could not touch", async () => {
    const e = await makeEngine(TOWN);
    const { roadYAt } = await import("../engine");
    const mg = e.units.find((u) => u.type === "mg")!;
    // Both men on the town road: a guaranteed clear lane, no
    // foliage, no cover on the surface — the range is the only
    // variable. (A truck dummy was tried first and drove off
    // down the road mid-test; a man stays where he is put.)
    mg.x = 1500;
    mg.y = roadYAt(1500);
    // Prone but not pinned: suppression in the 30-54 band holds a
    // man prone without pinning him (pinned is 55+, prone holds
    // to 30), so the deployed gun can fire from the open. The
    // loop sustains the band, the way steady incoming fire
    // would; his barrage is held back so only belt fire counts.
    mg.prone = true;
    mg.suppression = 45;
    (mg as unknown as { abilityCd: number }).abilityCd = 999;
    // A target dummy at 390: beyond the standing 320, inside the
    // deployed 400. Pinned in place by the loop.
    const volks = e.spawnEnemyUnit("volks", 1890, roadYAt(1890), () => 0.5, false);
    const x0 = mg.x;
    const y0 = mg.y;
    for (let t = 0; t < 25; t++) {
      mg.suppression = 45;
      volks.x = 1890;
      volks.y = roadYAt(1890);
      volks.suppression = 0;
      volks.prone = false;
      e.update(0.1);
    }
    expect(mg.prone).toBe(true);
    expect(Math.hypot(mg.x - x0, mg.y - y0)).toBeLessThan(3);
    // He fired at a man 390 away — impossible at his standing
    // reach — the belt shows it, and the man took hits.
    expect((mg as unknown as { mag: number }).mag).toBeLessThanOrEqual(44);
    expect(volks.hp).toBeLessThan(60);
  }, 30000);

  it("the movement gate itself: chaseTo moves a standing gunner and refuses a deployed one", async () => {
    const e = await makeEngine();
    const mg = e.units.find((u) => u.type === "mg")!;
    mg.x = 1500;
    mg.y = 675;
    const eng = e as unknown as { chaseTo: (u: U, x: number, y: number, dt: number) => boolean };
    mg.prone = false;
    expect(eng.chaseTo(mg, 1900, 675, 0.5)).toBe(true);
    expect(mg.x).toBeGreaterThan(1500);
    const x1 = mg.x;
    mg.prone = true;
    expect(eng.chaseTo(mg, 1900, 675, 0.5)).toBe(false);
    expect(mg.x).toBe(x1);
  });
});
