// @vitest-environment node
// Vehicle scale (Josh, 2026-11-12): tanks were drawn at 46
// wide while an infantry sprite is 48 — literally man-sized.
// Vehicles now have a proper footprint: tank 120 long,
// halftrack 92, truck 80 (bumped up again 2026-11-13), all
// wider than a man is tall on screen.
// Phase C (Josh, voice call 2026-11-13): bigger still, on his
// order — tanks, halftracks and trucks at 1.3x (tank 156
// long, halftrack 120, truck 104), the C-47s at 1.35x, and
// the Higgins boats at 1.5x (147 long), because the D-Day
// boats still read very small. The gameplay sizes scaled
// with the drawings (bullet hit circles, movement body,
// separation, blast-to-hull), and the honesty pins below
// lock drawn size against gameplay radius so the two can
// never silently drift apart again. This test renders real
// frames through a recording canvas context and measures
// the geometry that actually gets drawn.
import { describe, expect, it } from "vitest";

type Rect = { x: number; y: number; w: number; h: number };

function makeRecordingCanvas() {
  const rects: Rect[] = [];
  const images: Rect[] = [];
  const base: Record<string, unknown> = {
    fillRect: (x: number, y: number, w: number, h: number) => void rects.push({ x, y, w, h }),
    drawImage: (...args: unknown[]) => {
      // drawImage(img, x, y, w, h) — the 5-arg form units use.
      if (args.length >= 5) images.push({ x: args[1] as number, y: args[2] as number, w: args[3] as number, h: args[4] as number });
    },
    measureText: () => ({ width: 0 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createPattern: () => ({}),
  };
  const ctx = new Proxy(base, {
    get(t, prop) {
      if (prop === "canvas") return canvas;
      if (prop in t) return t[prop as string];
      return () => {};
    },
    set() {
      return true;
    },
  });
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: () => "",
    getBoundingClientRect: () => ({ width: 1600, height: 900, left: 0, top: 0 }),
    addEventListener: () => {},
    removeEventListener: () => {},
    style: {},
    rects,
    images,
  };
  return canvas;
}

function stubBrowser() {
  const store = new Map<string, string>();
  (globalThis as unknown as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  (globalThis as unknown as Record<string, unknown>).window = globalThis;
  (globalThis as unknown as Record<string, unknown>).requestAnimationFrame = () => 0;
  (globalThis as unknown as Record<string, unknown>).cancelAnimationFrame = () => {};
  (globalThis as unknown as Record<string, unknown>).matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  (globalThis as unknown as Record<string, unknown>).document = {
    createElement: (tag: string) => (tag === "canvas" ? makeRecordingCanvas() : {}),
    fonts: { load: () => Promise.resolve([]) },
  };
  (globalThis as unknown as Record<string, unknown>).HTMLCanvasElement = function () {};
}

stubBrowser();
const loadEngine = async () => {
  const mod = await import("../engine");
  return {
    GameEngine: mod.GameEngine,
    TANK_HIT_R: mod.TANK_HIT_R,
    VEHICLE_HIT_R: mod.VEHICLE_HIT_R,
    vehicleBodyRadius: mod.vehicleBodyRadius,
  };
};

const SQUAD = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 2, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
  { id: "s3", name: "James Baker", type: "rifleman", rank: "Pvt.", level: 1, medals: [] },
  { id: "s4", name: "Chester Pruitt", type: "medic", rank: "Pvt.", level: 1, medals: [] },
  { id: "s5", name: "Raymond Boyd", type: "mg", rank: "Pvt.", level: 1, medals: [] },
] as const;

const OVERLORD = {
  id: "op_01",
  index: 0,
  code: "OVERLORD",
  location: "test",
  objective: "test",
  difficulty: "HARD",
  reward: 250,
  terrain: "dday",
  brief: "test",
  enemies: [
    { type: "volks", wave: 1, count: 6 },
    { type: "grenadier", wave: 1, count: 3 },
  ],
} as const;

type U = { side: string; npc: boolean; alive: boolean; x: number; y: number; enemyType: string | null; vehicle: boolean };
type Engine = {
  setup: (m: unknown, s: unknown, b: number, v: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  render: () => void;
  units: U[];
  boats: { x: number; y: number }[];
};

function widestRectNear(rects: Rect[], x: number, y: number, within: number): number {
  let best = 0;
  for (const r of rects) {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    if (Math.hypot(cx - x, cy - y) <= within) best = Math.max(best, r.w);
  }
  return best;
}

/** The drawn footprint of whatever sits at (x, y): the
 * bounding box of its substantial rects — the size the
 * player actually sees. Small square marks (a loot crate,
 * a mine disc) are not hull and never count. */
function bboxNear(rects: Rect[], x: number, y: number, within: number): { len: number; dep: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (r.w < 20 || r.h < 5) continue;
    if (r.w <= 16 && r.h <= 16) continue;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    if (Math.hypot(cx - x, cy - y) > within) continue;
    minX = Math.min(minX, r.x);
    maxX = Math.max(maxX, r.x + r.w);
    minY = Math.min(minY, r.y);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { len: maxX - minX, dep: maxY - minY };
}

describe("vehicles draw bigger than infantry", () => {
  it("a panzer's drawn hull is far wider than a man's sprite; the halftrack sits between", async () => {
    const { GameEngine } = await loadEngine();
    const canvas = makeRecordingCanvas();
    const engine = new GameEngine(canvas as never, () => {}) as unknown as Engine;
    engine.setup(OVERLORD as never, SQUAD as never, 0, "airborne");
    engine.begin();
    // Play out the drop, then stage the armour on open
    // ground around the squad's leader: he is moved to mid
    // map first (his drop zone crowds the map's south edge,
    // where a teleported vehicle gets clamped back on top of
    // the other), and the two vehicles sit 320 apart so their
    // drawings never enter each other's measure.
    for (let s = 0; s < 60 * 6; s++) engine.update(1 / 60);
    const man = engine.units.find((u) => u.side === "allies" && !u.npc)!;
    const pz = engine.units.find((u) => u.enemyType === "panzer")!;
    const half = engine.units.find((u) => u.enemyType === "halftrack")!;
    man.x = 1500;
    man.y = 675;
    pz.x = man.x - 190;
    pz.y = man.y - 140;
    half.x = man.x - 190;
    half.y = man.y + 140;
    for (let s = 0; s < 45; s++) engine.update(1 / 60);
    canvas.rects.length = 0;
    canvas.images.length = 0;
    engine.render();

    // The man's sprite: a drawImage 48 wide (16 px at PX 3).
    const manW = Math.max(
      ...canvas.images
        .filter((im) => Math.hypot(im.x + im.w / 2 - man.x, im.y + im.h / 2 - man.y) < 40 && im.w >= 20 && im.w <= 80)
        .map((im) => im.w),
      0,
    );
    expect(manW).toBe(48);
    const tankW = widestRectNear(canvas.rects, pz.x, pz.y, 70);
    const halfW = widestRectNear(canvas.rects, half.x, half.y, 60);
    // Phase C sizes: tank hull 156 long, halftrack 120.
    expect(tankW).toBeGreaterThanOrEqual(150);
    expect(tankW).toBeGreaterThan(manW * 2.5);
    expect(halfW).toBeGreaterThanOrEqual(114);
    expect(halfW).toBeGreaterThan(manW * 1.9);
    expect(halfW).toBeLessThan(tankW);
  }, 30000);

  it("each vehicle's gameplay radii match its drawn size — what you see is what gets hit", async () => {
    const { GameEngine, TANK_HIT_R, VEHICLE_HIT_R, vehicleBodyRadius } = await loadEngine();
    const canvas = makeRecordingCanvas();
    const engine = new GameEngine(canvas as never, () => {}) as unknown as Engine;
    engine.setup(OVERLORD as never, SQUAD as never, 0, "airborne");
    engine.begin();
    for (let s = 0; s < 60 * 6; s++) engine.update(1 / 60);
    const man = engine.units.find((u) => u.side === "allies" && !u.npc)!;
    const pz = engine.units.find((u) => u.enemyType === "panzer")!;
    const half = engine.units.find((u) => u.enemyType === "halftrack")!;
    man.x = 1500;
    man.y = 675;
    pz.x = man.x - 190;
    pz.y = man.y - 140;
    half.x = man.x - 190;
    half.y = man.y + 140;
    for (let s = 0; s < 45; s++) engine.update(1 / 60);
    canvas.rects.length = 0;
    canvas.images.length = 0;
    engine.render();

    const tankBox = bboxNear(canvas.rects, pz.x, pz.y, 100);
    const halfBox = bboxNear(canvas.rects, half.x, half.y, 100);
    // The drawn footprints themselves, at Phase C sizes.
    expect(tankBox.len).toBeGreaterThanOrEqual(150);
    expect(tankBox.dep).toBeGreaterThanOrEqual(58);
    expect(halfBox.len).toBeGreaterThanOrEqual(114);
    expect(halfBox.dep).toBeGreaterThanOrEqual(48);
    // The bullet hit circle of a vehicle covers its hull
    // across the beam (at least half the drawn depth, so a
    // shot at the visible hull connects) and never exceeds
    // half the drawn length (no invisible hits past the bow
    // or stern).
    expect(TANK_HIT_R).toBeGreaterThanOrEqual(tankBox.dep / 2 - 2);
    expect(TANK_HIT_R).toBeLessThanOrEqual(tankBox.len / 2);
    expect(VEHICLE_HIT_R).toBeGreaterThanOrEqual(halfBox.dep / 2 - 2);
    expect(VEHICLE_HIT_R).toBeLessThanOrEqual(halfBox.len / 2);
    // The movement body is the hull's half-depth, within a
    // few units either way: a vehicle fits a gap its own
    // width and no narrower.
    expect(vehicleBodyRadius("panzer", "grenadier")).toBeGreaterThanOrEqual(tankBox.dep / 2 - 4);
    expect(vehicleBodyRadius("panzer", "grenadier")).toBeLessThanOrEqual(tankBox.dep / 2 + 2);
    expect(vehicleBodyRadius("halftrack", "grenadier")).toBeGreaterThanOrEqual(halfBox.dep / 2 - 4);
    expect(vehicleBodyRadius("halftrack", "grenadier")).toBeLessThanOrEqual(halfBox.dep / 2 + 2);
    // The truck, pinned at the constants (convoys are not on
    // the field at setup): drawn 104 long x 42 deep.
    expect(vehicleBodyRadius("truck", "grenadier")).toBeGreaterThanOrEqual(42 / 2 - 4);
    expect(vehicleBodyRadius("truck", "grenadier")).toBeLessThanOrEqual(42 / 2 + 2);
    expect(VEHICLE_HIT_R).toBeGreaterThanOrEqual(42 / 2 - 2);
  }, 30000);

  it("the Higgins boats draw at their Phase C size and ride clear of each other", async () => {
    const { GameEngine } = await loadEngine();
    const canvas = makeRecordingCanvas();
    const engine = new GameEngine(canvas as never, () => {}) as unknown as Engine;
    engine.setup(OVERLORD as never, SQUAD as never, 0, "beach");
    engine.begin();
    // Run the approach out: grounded boats draw no wake, so
    // the measured box is the hull itself.
    for (let s = 0; s < 60 * 4; s++) engine.update(1 / 60);
    expect(engine.boats.length).toBeGreaterThanOrEqual(2);
    canvas.rects.length = 0;
    canvas.images.length = 0;
    engine.render();
    const lead = engine.boats[0];
    const box = bboxNear(canvas.rects, lead.x, lead.y, 100);
    expect(box.len).toBeGreaterThanOrEqual(140);
    expect(box.dep).toBeGreaterThanOrEqual(55);
    // No two hulls overlap on the run in: the drawn depth is
    // 60, so neighbouring boats keep at least that much
    // water between their centres' lanes.
    for (let i = 0; i < engine.boats.length; i++) {
      for (let j = i + 1; j < engine.boats.length; j++) {
        expect(Math.abs(engine.boats[i].y - engine.boats[j].y)).toBeGreaterThanOrEqual(60);
      }
    }
  });
});
