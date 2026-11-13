// @vitest-environment node
// Camera smooth follow (Josh, 2026-11-13): the hard one-frame
// snap to the leader read as clunk in play, worst on diagonals
// (W+D and friends). The lock itself is unchanged — the view
// is the leader's, no free camera — but the follow is damped,
// so per-tick camera steps land evenly instead of bunching
// into 3-unit jumps, and the leader stays effectively
// centered (a few units of lag at a full run, under one
// screen pixel). These tests drive every WASD direction,
// straight and diagonal, and pin the feel numerically:
// bounded lag while moving, no single-tick camera jump, and
// a clean settle onto the leader when he stops.
import { describe, it, expect } from "vitest";

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
  code: "CHATEAU",
  location: "test",
  objective: "test",
  difficulty: "HARD",
  reward: 400,
  terrain: "town",
  brief: "test",
  enemies: [
    { type: "volks", wave: 1, count: 2 },
    { type: "mg42", wave: 1, count: 1 },
  ],
} as const;

type U = {
  id: number; side: string; npc: boolean; alive: boolean;
  x: number; y: number;
};
type Engine = {
  setup: (m: unknown, s: unknown, b: number, v: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  units: U[];
  leaderId: number | null;
  keys: Set<string>;
  cam: { x: number; y: number };
  viewW: number;
  viewH: number;
};

async function makeEngine() {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {}) as unknown as Engine;
  engine.setup(TOWN as never, SQUAD as never, 0, "");
  engine.begin();
  // Park the enemy in the far corner: this suite measures the
  // camera, not combat — a point-blank nest would pin or break
  // the leader and his speed changes would swamp the numbers.
  for (const u of engine.units) if (u.side === "axis") { u.x = 100; u.y = 1300; }
  return engine;
}

const leaderOf = (e: Engine) => e.units.find((u) => u.id === e.leaderId)!;
const center = (e: Engine) => ({ x: e.cam.x + e.viewW / 2, y: e.cam.y + e.viewH / 2 });

const DIRECTIONS: Array<{ name: string; keys: string[] }> = [
  { name: "east (D)", keys: ["d"] },
  { name: "west (A)", keys: ["a"] },
  { name: "north (W)", keys: ["w"] },
  { name: "south (S)", keys: ["s"] },
  { name: "north-east (W+D)", keys: ["w", "d"] },
  { name: "north-west (W+A)", keys: ["w", "a"] },
  { name: "south-east (S+D)", keys: ["s", "d"] },
  { name: "south-west (S+A)", keys: ["s", "a"] },
];

describe("camera smooth follow", () => {
  for (const dir of DIRECTIONS) {
    it(`glides ${dir.name}: bounded lag, no jumps, settles centered`, async () => {
      const e = await makeEngine();
      // Warm-up with no keys: the battle-start snap/converge
      // happens here, before any measuring.
      for (let tick = 0; tick < 10; tick++) e.update(1 / 60);
      for (const k of dir.keys) e.keys.add(k);
      let prevCam = { ...e.cam };
      let maxOffset = 0;
      let maxStep = 0;
      let lagWindow = 0;
      for (let tick = 0; tick < 150; tick++) {
        e.update(1 / 60);
        const stepLen = Math.hypot(e.cam.x - prevCam.x, e.cam.y - prevCam.y);
        prevCam = { ...e.cam };
        if (tick < 15) continue; // the ease-in from a standing start
        const c = center(e);
        const L = leaderOf(e);
        const off = Math.hypot(c.x - L.x, c.y - L.y);
        maxOffset = Math.max(maxOffset, off);
        maxStep = Math.max(maxStep, stepLen);
        // The fullest lag seen during the moving stretch. A
        // window, not a point sample: if a building face ends
        // the walk early the moving phase still registers.
        if (tick >= 30 && tick <= 120) lagWindow = Math.max(lagWindow, off);
      }
      // Locked on him: never more than a few units off center.
      expect(maxOffset).toBeLessThan(8);
      // The damp is real: while he moves, the view rides
      // behind him by a visible-but-tiny lag. The old
      // one-frame snap sat at exactly 0 — this line is what
      // fails on the old code.
      expect(lagWindow).toBeGreaterThan(0.8);
      // No clunk: at 60 units/s the leader covers 1 unit a
      // tick, so a smooth camera never steps more than ~2.
      // The snap code stepped the full 3-unit pixel at once
      // whenever a threshold crossed, axes on different ticks.
      expect(maxStep).toBeLessThan(2);
      // Release: the view settles onto him, dead center.
      for (const k of dir.keys) e.keys.delete(k);
      for (let tick = 0; tick < 30; tick++) e.update(1 / 60);
      const c = center(e);
      const L = leaderOf(e);
      expect(Math.hypot(c.x - L.x, c.y - L.y)).toBeLessThan(2);
    }, 60000);
  }
});
