// @vitest-environment node
/**
 * Engineer (Josh, 2026-11-12): his detector reveals the mines
 * within 70 (red ring and flag on the field), and he clears a
 * revealed mine with four seconds of still, exposed work. A
 * squad without an engineer gets neither. His ability throws
 * up a real sandbag position. NPC squads field him too.
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

const BEACH = { id: "op_01", index: 0, code: "OPERATION OVERLORD", location: "test", objective: "test", difficulty: "MODERATE", reward: 250, terrain: "dday", brief: "test", enemies: [{ type: "volks", wave: 1, count: 3 }] } as const;
const mk = (id: string, type: string, rank = "Pvt.") => ({ id, name: id, type, rank, level: 1, medals: [] });

type Mine = { x: number; y: number; armed: boolean; revealed?: boolean; cleared?: boolean };
type U = { id: number; side: string; npc: boolean; type: string; alive: boolean; x: number; y: number; abilityCd: number; clearing?: boolean; cover: unknown };
type Engine = {
  setup: (m: unknown, s: unknown, b: number, v: string, cl?: number, leader?: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  castGround: (u: U, x: number, y: number) => void;
  units: U[];
  mines: Mine[];
  covers: Array<{ x: number; y: number; kind?: string; hp?: number }>;
  blockers: Array<{ x: number; y: number }>;
};

async function makeEngine(squad: unknown[]) {
  const GameEngine = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const e = new GameEngine(canvas, () => {}) as unknown as Engine & { introT: number };
  e.setup(BEACH as never, squad as never, 0, "beach", 8, "s-lead");
  e.begin();
  // Play through the landing intro with the whole force pinned
  // at the waterline: the engine freezes combat while the boats
  // come in, and an unpinned army would advance through the
  // minefield (x 320-780) and ruin the field for the test.
  for (let t = 0; t < 20 && e.introT >= 0; t += 0.25) {
    for (const u of e.units) {
      if (u.side === "axis") { u.x = 3950; u.y = 60; }
      else { u.x = 60 + (u.id % 6) * 9; u.y = 1180; }
    }
    e.update(0.25);
  }
  for (const u of e.units) if (u.side === "axis") { u.x = 3950; u.y = 60; }
  return e;
}

describe("engineer and the minefields", () => {
  it("the detector reveals mines near him, and only those", async () => {
    const e = await makeEngine([mk("s-lead", "rifleman", "Sgt."), mk("s-eng", "engineer")]);
    expect(e.mines.length).toBeGreaterThan(10);
    const eng = e.units.find((u) => u.type === "engineer" && !u.npc)!;
    const near = e.mines.find((m) => !m.revealed) ?? e.mines[0];
    eng.x = near.x + 40;
    eng.y = near.y;
    e.update(0.25);
    expect(near.revealed).toBe(true);
    const far = e.mines.find((m) => Math.hypot(m.x - eng.x, m.y - eng.y) > 400)!;
    expect(far.revealed).toBeFalsy();
  });

  it("four seconds of still work clears a revealed mine; he does not fire meanwhile", async () => {
    // The engineer leads this one: a leader never moves on his
    // own, so his feet stay exactly where the test puts them
    // (a follower's formation slot would drag him across the
    // pressure plate between pins).
    const GameEngine = await loadEngine();
    const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
    const e = new GameEngine(canvas, () => {}) as unknown as Engine & { introT: number };
    e.setup(BEACH as never, [mk("s-lead", "rifleman", "Sgt."), mk("s-eng", "engineer")] as never, 0, "beach", 8, "s-eng");
    e.begin();
    for (let t = 0; t < 20 && e.introT >= 0; t += 0.25) {
      for (const u of e.units) {
        if (u.side === "axis") { u.x = 3950; u.y = 60; }
        else { u.x = 60 + (u.id % 6) * 9; u.y = 1180; }
      }
      e.update(0.25);
    }
    const eng = e.units.find((u) => u.type === "engineer" && !u.npc)!;
    const mine = e.mines[0];
    // Stand him beside it: inside clearing reach (26), outside
    // the pressure plate (11).
    for (let t = 0; t < 2; t += 0.25) {
      eng.x = mine.x + 18;
      eng.y = mine.y;
      e.update(0.25);
    }
    expect(mine.revealed).toBe(true);
    expect(eng.clearing).toBe(true);
    expect(mine.armed).toBe(true); // not yet: the work takes time
    for (let t = 0; t < 6; t += 0.25) {
      eng.x = mine.x + 18;
      eng.y = mine.y;
      e.update(0.25);
    }
    expect(mine.cleared).toBe(true);
    expect(mine.armed).toBe(false);
  });

  it("a squad without an engineer neither reveals nor clears", async () => {
    const e = await makeEngine([mk("s-lead", "rifleman", "Sgt."), mk("s-rifle", "rifleman")]);
    const leader = e.units.find((u) => u.type === "rifleman" && !u.npc)!;
    const man = e.units.filter((u) => !u.npc)[1];
    const mine = e.mines[0];
    for (let t = 0; t < 6; t += 0.25) {
      leader.x = mine.x + 80;
      leader.y = mine.y;
      man.x = mine.x + 18;
      man.y = mine.y;
      e.update(0.25);
    }
    expect(mine.revealed).toBeFalsy();
    expect(mine.armed).toBe(true);
  });

  it("Deploy Cover throws up a real sandbag position", async () => {
    const e = await makeEngine([mk("s-lead", "rifleman", "Sgt."), mk("s-eng", "engineer")]);
    const eng = e.units.find((u) => u.type === "engineer" && !u.npc)!;
    eng.x = 1500;
    eng.y = 300;
    const coversBefore = e.covers.length;
    const blockersBefore = e.blockers.length;
    e.castGround(eng, eng.x + 60, eng.y);
    expect(e.covers.length).toBe(coversBefore + 1);
    // Cover-only, exactly like the terrain's own sandbags.
    expect(e.blockers.length).toBe(blockersBefore);
    const built = e.covers[e.covers.length - 1];
    expect(built.kind).toBe("sandbag");
    expect(built.hp).toBe(110);
    expect(Math.hypot(built.x - (eng.x + 60), built.y - eng.y)).toBeLessThan(2);
    expect(eng.abilityCd).toBeGreaterThan(0);
  });
});
