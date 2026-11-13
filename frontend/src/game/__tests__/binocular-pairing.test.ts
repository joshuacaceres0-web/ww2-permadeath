// @vitest-environment node
/**
 * Binoculars are the Recon's signature (Josh, 2026-11-13):
 * Recon only, and they make him the sniper's eyes in fact.
 *  - the pairing leash: a sniper holds full range with a
 *    living Recon within 90 as before — and out to 220 when
 *    that Recon carries Binoculars. Beyond the glasses' reach
 *    he falls back to the 260 solo cap, exactly as without
 *    them. The enemy's spotter pairs get no such widening:
 *    no stores gear on that side, the mirror stays at 90.
 *  - pair work: while a Recon's mark lasts, the marked man
 *    is the sniper's priority target, ahead of a nearer
 *    unmarked man. Unmarked, he takes the nearest as always.
 */
import { describe, expect, it } from "vitest";
import { UNIT_TYPES } from "../data";
import { BINOCULAR_PAIR_DIST, ELITE_RECOGNITION_DIST, RECON_PAIR_DIST } from "../engine";

function stubBrowser() {
  const grad = { addColorStop: () => {} };
  const ctx = new Proxy({}, {
    get(_t, p) {
      if (p === "createLinearGradient" || p === "createRadialGradient") return () => grad;
      if (p === "measureText") return () => ({ width: 10 });
      if (p === "getImageData") return () => ({ data: new Uint8ClampedArray(4) });
      return () => {};
    },
    set: () => true,
  });
  const makeCanvas = () => ({
    width: 960, height: 540, style: {},
    getContext: () => ctx,
    addEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }),
  });
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
const QUIET = { id: "op_02", index: 1, code: "QUIET", location: "test", objective: "", difficulty: "HARD", reward: 400, terrain: "town", brief: "", enemies: [E("volks", 1, 1), E("volks", 2, 1), E("volks", 3, 1)] } as Any;

function man(id: string, type: string, extra: Record<string, unknown> = {}) {
  return { id, name: `Man ${id}`, type, rank: "Pvt.", level: 0, medals: [], ...extra } as Any;
}

async function build(squad: Any[]) {
  const GameEngine = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const e = new GameEngine(canvas, () => {}) as Any;
  e.setup(QUIET, squad, 0, "", 8);
  e.begin();
  return e;
}
const unitOf = (e: Any, id: string) => (e.units as Any[]).find((u) => u.soldierId === id);
// NPC squads field recons, MGs and snipers of their own; left
// in, one could pair a sniper under test or draw a
// Scharfschutze's eye, and the assertions would measure them
// instead. Tests that need a clean field clear them out.
const clearNpcs = (e: Any) => {
  for (const u of e.units as Any[]) if (u.npc) u.alive = false;
};

describe("binocular pairing", () => {
  it("the leash: 90 bare, 220 with the glasses, the cap beyond both", async () => {
    expect(BINOCULAR_PAIR_DIST).toBe(220);
    expect(RECON_PAIR_DIST).toBe(90);
    const full = UNIT_TYPES.sniper.range;
    const e = await build([
      man("snip", "sniper"),
      man("eyes", "recon", { equipment: ["binoculars"] }),
      man("bare", "recon"),
    ]);
    const snip = unitOf(e, "snip");
    const eyes = unitOf(e, "eyes");
    const bare = unitOf(e, "bare");
    clearNpcs(e);
    snip.x = 200; snip.y = 600;
    // Bare recon at 200: outside the old leash, cap applies.
    bare.x = 400; bare.y = 600;
    eyes.x = 3000; eyes.y = 100;
    expect(e.effRange(snip)).toBe(260);
    // Bare recon close: full range, the old rule untouched.
    bare.x = 280;
    expect(e.effRange(snip)).toBe(full);
    // Binocular recon at 200: the glasses hold the pair.
    bare.x = 3000; bare.y = 100;
    eyes.x = 400; eyes.y = 600;
    expect(e.effRange(snip)).toBe(full);
    // Beyond even the glasses: back to the cap.
    eyes.x = 430;
    expect(e.effRange(snip)).toBe(260);
  });

  it("the enemy mirror stays at the old leash", async () => {
    const e = await build([man("snip", "sniper")]);
    const snip = unitOf(e, "snip");
    snip.x = 3900; snip.y = 100;
    const scharf = e.spawnEnemyUnit("scharfschutze", 500, 600, () => 0.5, true);
    const spotter = e.spawnEnemyUnit("spotter", 700, 600, () => 0.5, true);
    expect(scharf).toBeDefined();
    expect(spotter).toBeDefined();
    expect(e.effRange(scharf)).toBe(260); // 200 apart: no pair
    spotter.x = 580;
    expect(e.effRange(scharf)).toBeGreaterThan(260); // 80 apart: paired
  });

  it("a marked man is the sniper's priority while the mark lasts", async () => {
    const e = await build([
      man("snip", "sniper"),
      man("eyes", "recon"),
    ]);
    const snip = unitOf(e, "snip");
    const eyes = unitOf(e, "eyes");
    clearNpcs(e);
    snip.x = 200; snip.y = 300;
    eyes.x = 260; eyes.y = 300;
    const near = e.spawnEnemyUnit("volks", 350, 300, () => 0.5, true);
    const far = e.spawnEnemyUnit("volks", 560, 300, () => 0.5, true);
    expect(e.autoTarget(snip)).toBe(near);
    far.markedUntil = e.elapsed + 10;
    expect(e.autoTarget(snip)).toBe(far);
    far.markedUntil = e.elapsed - 1;
    expect(e.autoTarget(snip)).toBe(near);
  });
});

describe("elite hunting", () => {

  it("paired: the sniper takes the elite at long range over a nearer regular", async () => {
    expect(ELITE_RECOGNITION_DIST).toBe(200);
    const e = await build([
      man("snip", "sniper"),
      man("eyes", "recon"),
    ]);
    const snip = unitOf(e, "snip");
    const eyes = unitOf(e, "eyes");
    clearNpcs(e);
    snip.x = 200; snip.y = 300;
    eyes.x = 260; eyes.y = 300;
    const regular = e.spawnEnemyUnit("volks", 350, 300, () => 0.5, true);
    const nest = e.spawnEnemyUnit("mg42", 620, 300, () => 0.5, true);
    expect(e.autoTarget(snip)).toBe(nest);
    expect(regular).toBeDefined();
  });

  it("solo: blind past recognition, reads him close, firing gives him away", async () => {
    const e = await build([man("snip", "sniper")]);
    const snip = unitOf(e, "snip");
    clearNpcs(e);
    snip.x = 200; snip.y = 300;
    const regular = e.spawnEnemyUnit("volks", 350, 300, () => 0.5, true);
    const nest = e.spawnEnemyUnit("mg42", 440, 300, () => 0.5, true);
    // 240 away: inside the solo cap, past recognition, unfired.
    expect(e.autoTarget(snip)).toBe(regular);
    // He fires: flash and report identify him for a window.
    nest.lastShotT = e.elapsed;
    expect(e.autoTarget(snip)).toBe(nest);
    nest.lastShotT = e.elapsed - 10;
    expect(e.autoTarget(snip)).toBe(regular);
    // Inside recognition distance his own eyes read the nest.
    nest.x = 380;
    expect(e.autoTarget(snip)).toBe(nest);
  });

  it("binoculars widen where the hunting works, bare eyes do not", async () => {
    const e = await build([
      man("snip", "sniper"),
      man("eyes", "recon", { equipment: ["binoculars"] }),
      man("bare", "recon"),
    ]);
    const snip = unitOf(e, "snip");
    const eyes = unitOf(e, "eyes");
    const bare = unitOf(e, "bare");
    clearNpcs(e);
    snip.x = 200; snip.y = 300;
    const regular = e.spawnEnemyUnit("volks", 350, 300, () => 0.5, true);
    const nest = e.spawnEnemyUnit("mg42", 620, 300, () => 0.5, true);
    // Glasses at 200: paired, the elite is his.
    eyes.x = 400; eyes.y = 300;
    bare.x = 3000; bare.y = 100;
    expect(e.autoTarget(snip)).toBe(nest);
    // A bare recon standing in the same spot pairs with nobody.
    eyes.x = 3000; eyes.y = 100;
    bare.x = 400; bare.y = 300;
    expect(e.autoTarget(snip)).toBe(regular);
  });

  it("the mirror: the Scharfschutze hunts the same way with his Beobachter", async () => {
    const e = await build([
      man("decoy", "sniper"),
      man("gunner", "mg"),
      man("rifle", "rifleman"),
    ]);
    const decoy = unitOf(e, "decoy");
    const gunner = unitOf(e, "gunner");
    const rifle = unitOf(e, "rifle");
    decoy.x = 3900; decoy.y = 100; // parked out of his reach
    gunner.x = 620; gunner.y = 300;
    rifle.x = 350; rifle.y = 300;
    clearNpcs(e);
    const scharf = e.spawnEnemyUnit("scharfschutze", 200, 300, () => 0.5, true);
    const spotter = e.spawnEnemyUnit("spotter", 3000, 100, () => 0.5, true);
    // Alone and capped, the MG is out of reach entirely:
    // he takes the rifleman in normal order.
    expect(e.autoTarget(scharf)).toBe(rifle);
    // His spotter beside him: the allied MG is identified
    // at full range and dies first.
    spotter.x = 260; spotter.y = 300;
    expect(e.autoTarget(scharf)).toBe(gunner);
  });
});
