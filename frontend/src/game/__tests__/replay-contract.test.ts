// @vitest-environment node
// Replay data contract: the debrief's WATCH REPLAY feeds
// engine.getReplay() straight into the ReplayViewer. If a
// battle records frames the viewer cannot read (missing
// fields, empty frames, a bad result string), the button
// looks dead. This test plays a real battle on the internal
// driver and checks the recorded replay against every field
// the viewer touches.
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
      set() { return true; },
    },
  );
  const makeCanvas = () => ({
    width: 0, height: 0,
    getContext: () => ctx,
    toDataURL: () => "",
    getBoundingClientRect: () => ({ width: 1600, height: 900, left: 0, top: 0 }),
    addEventListener: () => {}, removeEventListener: () => {}, style: {},
  });
  const store = new Map<string, string>();
  (globalThis as unknown as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  (globalThis as unknown as Record<string, unknown>).window = globalThis;
  (globalThis as unknown as Record<string, unknown>).matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
  (globalThis as unknown as Record<string, unknown>).document = {
    createElement: (tag: string) => (tag === "canvas" ? makeCanvas() : {}),
    fonts: { load: () => Promise.resolve([]) },
  };
  (globalThis as unknown as Record<string, unknown>).HTMLCanvasElement = function () {};
}
stubBrowser();

const SQUAD = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 2, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
  { id: "s3", name: "James Baker", type: "rifleman", rank: "Pvt.", level: 1, medals: [] },
  { id: "s4", name: "Chester Pruitt", type: "medic", rank: "Pvt.", level: 1, medals: [] },
  { id: "s5", name: "Raymond Boyd", type: "mg", rank: "Pvt.", level: 1, medals: [] },
] as const;
// Silent Chateau (town): decisive and quick under the driver.
const TOWN = {
  id: "op_02", index: 1, code: "CHATEAU", location: "test", objective: "test",
  difficulty: "HARD", reward: 400, terrain: "town", brief: "test",
  enemies: [
    { type: "volks", wave: 1, count: 6 },
    { type: "mg42", wave: 1, count: 2 },
    { type: "volks", wave: 2, count: 4 },
  ],
} as const;

type ReplayUnitLike = Record<string, unknown>;
type ReplayLike = {
  mission: string; mapW: number; mapH: number; durationSec: number; result: string;
  obstacles: Array<{ x: number; y: number; r: number; kind: string }>;
  frames: Array<{
    t: number; wave: number;
    crates: Array<{ x: number; y: number; looted: boolean }>;
    units: ReplayUnitLike[];
  }>;
} | null;

describe("replay data contract (engine -> ReplayViewer)", () => {
  it("a finished battle yields a replay the viewer can play end to end", async () => {
    const mod = await import("../engine");
    const canvas = (document as unknown as { createElement: (t: string) => unknown }).createElement("canvas");
    const e = new mod.GameEngine(canvas as never, () => {}) as unknown as {
      setup: (m: unknown, s: unknown, b: number, v: string) => void;
      begin: () => void;
      update: (dt: number) => void;
      setAutoBattle: (on: boolean) => void;
      getReplay: () => ReplayLike;
      phase: string;
      battleState: string;
    };
    e.setup(TOWN as never, SQUAD as never, 0, "");
    e.begin();
    e.setAutoBattle(true);
    const dt = 1 / 30;
    let guard = 0;
    while (e.phase !== "over" && guard < 30 * 600) {
      e.update(dt);
      guard++;
    }
    expect(e.phase).toBe("over");

    const replay = e.getReplay();
    expect(replay).not.toBeNull();
    const r = replay!;
    expect(r.mission).toBe("CHATEAU");
    expect(r.mapW).toBeGreaterThan(0);
    expect(r.mapH).toBeGreaterThan(0);
    expect(["victory", "defeat"]).toContain(r.result);
    // Enough frames to actually play.
    expect(r.frames.length).toBeGreaterThan(10);
    // Obstacles: the viewer merges and switches on kind.
    expect(r.obstacles.length).toBeGreaterThan(0);
    for (const o of r.obstacles) {
      expect(typeof o.kind).toBe("string");
      expect(Number.isFinite(o.x)).toBe(true);
      expect(Number.isFinite(o.y)).toBe(true);
      expect(Number.isFinite(o.r)).toBe(true);
    }
    // Frames: times never go backwards, and every unit carries
    // every field the viewer reads.
    let lastT = -1;
    for (const f of r.frames) {
      expect(f.t).toBeGreaterThanOrEqual(lastT);
      lastT = f.t;
      expect(Array.isArray(f.crates)).toBe(true);
      expect(f.units.length).toBeGreaterThan(0);
      for (const u of f.units) {
        expect(typeof u.id).toBe("number");
        expect(["allies", "axis"]).toContain(u.side);
        expect(typeof u.npc).toBe("boolean");
        expect(typeof u.name).toBe("string");
        expect(Number.isFinite(u.x)).toBe(true);
        expect(Number.isFinite(u.y)).toBe(true);
        expect(Number.isFinite(u.hp)).toBe(true);
        expect(Number.isFinite(u.maxHp)).toBe(true);
        expect(typeof u.alive).toBe("boolean");
        expect(Number.isFinite(u.kills)).toBe(true);
        expect(typeof u.cover).toBe("boolean");
        expect(u.coverType === null || typeof u.coverType === "string").toBe(true);
        expect(Number.isFinite(u.morale)).toBe(true);
        expect(typeof u.broken).toBe("boolean");
        expect(typeof u.medic).toBe("boolean");
        expect(typeof u.radio).toBe("boolean");
        expect(typeof u.fled).toBe("boolean");
      }
    }
    // The frame the viewer opens on has the whole field in it.
    expect(r.frames[0].units.length).toBeGreaterThanOrEqual(5);
  }, 180000);
});
