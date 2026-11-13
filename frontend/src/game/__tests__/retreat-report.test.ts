// @vitest-environment node
/**
 * Retreat report accounting (bug found in the 2026-11-13 hunt):
 * a man who reaches the west edge in a retreat is extracted —
 * alive on the roster by design — but extract() marks him
 * alive=false on the field, and getReport() used to build its
 * survivors list from alive men only. An escapee therefore
 * appeared in NO list in the filing: his kills earned no kill
 * RP (the backend pays 10 RP per squad kill from the fallen +
 * deserted + survivors lists) and none of his battle stats
 * were credited. This pins the fixed behaviour: every deployed
 * squad man is accounted for in exactly one list, and an
 * extracted man's kills ride in survivors.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const E = (type: string, wave: number, count: number) => ({ type, wave, count });
const TRICKLE = { id: "op_02", index: 1, code: "TRICKLE", location: "test", objective: "", difficulty: "HARD", reward: 400, terrain: "town", brief: "", enemies: [E("volks", 1, 1), E("volks", 2, 1), E("volks", 3, 1)] } as Any;
const SQUAD5 = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 2, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
  { id: "s3", name: "Samuel Novak", type: "radioman", rank: "Pvt.", level: 1, medals: [] },
  { id: "s4", name: "Chester Pruitt", type: "medic", rank: "Pvt.", level: 1, medals: [] },
  { id: "s5", name: "Raymond Boyd", type: "mg", rank: "Pvt.", level: 1, medals: [] },
] as const;

describe("retreat report accounting", () => {
  it("extracted men file as survivors with their kills", async () => {
    const GameEngine = await loadEngine();
    const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
    const e = new GameEngine(canvas, () => {}) as Any;
    e.setup(TRICKLE, SQUAD5, 0, "", 8);
    e.fleeChance = 0;
    e.fleeChanceNormal = 0;
    e.begin();
    // No 2nd Platoon in this test: the accounting is the squad's.
    e.units = e.units.filter((u: Any) => !u.npc);
    // Kowalski is credited with 3 kills before the fall back.
    e.units.find((u: Any) => u.soldierId === "s2").kills = 3;
    e.retreat();
    for (let step = 0; step < 1200 && e.phase !== "over"; step++) e.update(0.1);
    expect(e.phase).toBe("over");
    const rep = e.getReport();
    expect(rep.victory).toBe(false);
    // The whole squad started near the west edge and got out:
    // nobody fell, nobody deserted, and all five file.
    expect(rep.fallen).toHaveLength(0);
    expect(rep.deserted).toHaveLength(0);
    expect(rep.survivors).toHaveLength(5);
    const s2 = rep.survivors.find((s: Any) => s.soldierId === "s2");
    expect(s2?.kills).toBe(3);
    const accounted = rep.fallen.length + rep.deserted.length + rep.survivors.length;
    expect(accounted).toBe(5);
  }, 120000);
});
