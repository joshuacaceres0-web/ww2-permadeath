// @vitest-environment node
/**
 * The halftrack's top MG (Josh, 2026-11-13): the Sd.Kfz. 251
 * already carried a mounted MG42 on a pivot; the hunt found
 * its fire left at the tanks' 42-unit muzzle, well past the
 * drawn barrel, and the gun itself was a dark line that read
 * as hull. The sprite now draws a manned top gun (gunner,
 * shield, long barrel) and its fire leaves at MUZZLE_LEN 24,
 * right at that barrel's tip. This pins the firing side: the
 * turret traverses onto a target off the hull's line, the gun
 * fires only once lined up, and every fresh round spawns at
 * the short top-gun muzzle, never at 42.
 */
import { describe, expect, it } from "vitest";
import { MUZZLE_LEN } from "../engine";

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
const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe("halftrack top MG", () => {
  it("traverses onto an off-line target and fires from the short muzzle", async () => {
    expect(MUZZLE_LEN.halftrack).toBe(24);
    expect(MUZZLE_LEN.panzer).toBe(42);
    const GameEngine = await loadEngine();
    const { roadYAt } = await import("../engine");
    const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
    const e = new GameEngine(canvas, () => {}) as Any;
    e.setup(TRICKLE, SQUAD5, 0, "", 8);
    e.fleeChance = 0;
    e.fleeChanceNormal = 0;
    e.begin();
    const ht = e.spawnEnemyUnit("halftrack", 1470, roadYAt(1470), () => 0.5, true);
    // One rifleman north-west of the halftrack, off its facing
    // line, inside its 260 range: the top gun must swing to him.
    const target = (e.units as Any[]).find((u) => u.soldierId === "s2");
    target.x = 1400;
    target.y = roadYAt(1400) - 190;
    const seen = new Set<unknown>();
    const spawnDists: number[] = [];
    let linedUpAt: number | null = null;
    let t = 0;
    for (let step = 0; step < 250; step++) {
      e.update(0.02);
      t = (step + 1) * 0.02;
      const bearing = Math.atan2(target.y - ht.y, target.x - ht.x);
      if (linedUpAt === null && angDiff(ht.turret, bearing) < 0.35) linedUpAt = t;
      for (const b of e.bullets as Any[]) {
        if (seen.has(b)) continue;
        seen.add(b);
        if (b.sourceType === "halftrack") {
          spawnDists.push(Math.hypot(b.x - ht.x, b.y - ht.y));
        }
      }
      if (e.phase === "over") break;
    }
    // The turret swung onto him (fire is gated on alignment,
    // so the rounds below already imply it; this pins it).
    expect(linedUpAt).not.toBeNull();
    // It fired, repeatedly, and every fresh round left from
    // the top gun's short muzzle: about 24 from the centre,
    // plus at most a tick of travel, never out at 42.
    expect(spawnDists.length).toBeGreaterThanOrEqual(3);
    for (const d of spawnDists) {
      expect(d).toBeGreaterThan(16);
      expect(d).toBeLessThan(40);
    }
  }, 120000);
});
