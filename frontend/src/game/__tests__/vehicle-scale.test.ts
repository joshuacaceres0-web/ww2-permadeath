// @vitest-environment node
// Vehicle scale (Josh, 2026-11-12): tanks were drawn at 46
// wide while an infantry sprite is 48 — literally man-sized.
// Vehicles now have a proper footprint: tank 120 long,
// halftrack 92, truck 80 (bumped up again 2026-11-13), all
// wider than a man is tall on screen. This
// test renders real frames through a recording canvas context
// and measures the geometry that actually gets drawn.
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
  return { GameEngine: mod.GameEngine };
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

describe("vehicles draw bigger than infantry", () => {
  it("a panzer's drawn hull is far wider than a man's sprite; the halftrack sits between", async () => {
    const { GameEngine } = await loadEngine();
    const canvas = makeRecordingCanvas();
    const engine = new GameEngine(canvas as never, () => {}) as unknown as Engine;
    engine.setup(OVERLORD as never, SQUAD as never, 0, "airborne");
    engine.begin();
    // Play out the drop, then bring the armour into view of the squad.
    for (let s = 0; s < 60 * 6; s++) engine.update(1 / 60);
    const man = engine.units.find((u) => u.side === "allies" && !u.npc)!;
    const pz = engine.units.find((u) => u.enemyType === "panzer")!;
    const half = engine.units.find((u) => u.enemyType === "halftrack")!;
    pz.x = man.x + 130;
    pz.y = man.y;
    half.x = man.x + 130;
    half.y = man.y + 130;
    for (let s = 0; s < 30; s++) engine.update(1 / 60);
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
    expect(tankW).toBeGreaterThanOrEqual(110);
    expect(tankW).toBeGreaterThan(manW * 1.8);
    expect(halfW).toBeGreaterThanOrEqual(85);
    expect(halfW).toBeGreaterThan(manW * 1.4);
    expect(halfW).toBeLessThan(tankW);
  });
});
