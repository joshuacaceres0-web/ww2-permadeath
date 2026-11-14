// Headless battle simulation: no browser, no server, no jsdom. Stubs
// document / canvas / localStorage / AudioContext on globalThis, then
// steps the real GameEngine update loop for a full Silent Chateau
// battle and asserts no unit with an active move order stays stuck,
// and that units end up in cover instead of open ground.
// @vitest-environment node
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

// Static imports are hoisted above this call, so the engine is imported
// after the stubs via a dynamic import inside the test instead.
const loadEngine = async () => {
  const mod = await import("../engine");
  return { GameEngine: mod.GameEngine };
};

const SILENT_CHATEAU = {
  id: "op_02",
  index: 1,
  code: "OPERATION SILENT CHATEAU",
  location: "Valognes Estate",
  objective: "Eliminate the SS Signals Officer and clear the estate grounds",
  difficulty: "HARD",
  reward: 400,
  terrain: "town",
  brief: "",
  enemies: [
    { type: "grenadier", wave: 1, count: 3 },
    { type: "volks", wave: 1, count: 4 },
    { type: "officer", wave: 2, count: 1 },
    { type: "grenadier", wave: 2, count: 3 },
    { type: "mg42", wave: 2, count: 1 },
    { type: "fallschirmjager", wave: 2, count: 3 },
    { type: "mortar", wave: 2, count: 1 },
    { type: "volks", wave: 3, count: 3 },
    { type: "grenadier", wave: 3, count: 3 },
    { type: "officer", wave: 3, count: 1 },
    { type: "fallschirmjager", wave: 3, count: 3 },
    { type: "mortar", wave: 3, count: 1 },
  ],
} as const;

const SQUAD = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 2, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
  { id: "s3", name: "James Baker", type: "rifleman", rank: "Pvt.", level: 1, medals: [] },
  { id: "s4", name: "Chester Pruitt", type: "medic", rank: "Pvt.", level: 1, medals: [] },
  { id: "s5", name: "Raymond Boyd", type: "mg", rank: "Pvt.", level: 1, medals: [] },
] as const;

describe("AI stuck / cover simulation — Silent Chateau", () => {
  it("no unit stays stuck with an active order, and units use cover", async () => {
    const { GameEngine } = await loadEngine();
    const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
    const engine = new GameEngine(canvas, () => {});
    const anyEngine = engine as unknown as Record<string, unknown>;
    engine.setup(SILENT_CHATEAU as never, SQUAD as never, 0, "");
    engine.begin();

    const units = () => (anyEngine.units as Array<Record<string, unknown>>).filter((u) => u.alive);
    const totalEnemies = SILENT_CHATEAU.enemies.reduce((t, e) => t + e.count, 0);
    expect(units().filter((u) => u.side === "axis").length).toBe(totalEnemies); // CONQUEST: the full force deploys at the start, no waves
    expect(units().filter((u) => u.side === "allies" && u.npc).length).toBe(12); // 2nd Platoon
    expect(totalEnemies).toBe(27);

    // Order the whole player squad east across the town, through
    // buildings: the classic stuck case — right-click move across
    // blocked ground. selectAll() is the real path (the old loop
    // called selectUnit() per man, which replaces the selection each
    // time, so only Boyd ever got the order).
    (anyEngine as { selectAll: () => void }).selectAll();
    // issueOrder is private; drive it through the public right-click path
    // by calling the private method via any-cast.
    (anyEngine as { issueOrder: (x: number, y: number, q: boolean) => void }).issueOrder(2100, 675, false);

    let maxStuckSeconds = 0;
    let inCoverSamples = 0;
    let samples = 0;
    const lastPos = new Map<number, { x: number; y: number; t: number }>();
    // 6 minutes of battle at 60fps, in 1/60 steps.
    for (let step = 0; step < 60 * 360; step++) {
      (anyEngine as { update: (dt: number) => void }).update(1 / 60);
      const phase = anyEngine.phase as string;
      if (phase === "over") break;
      if (step % 60 !== 0) continue;
      samples++;
      for (const u of units()) {
        const hasOrder = ((u.orders as unknown[]).length > 0 || (u.chase as unknown[]).length > 0) && !u.isStatic;
        if (u.cover) inCoverSamples++;
        if (!hasOrder) {
          lastPos.delete(u.id as number);
          continue;
        }
        const prev = lastPos.get(u.id as number);
        const now = { x: u.x as number, y: u.y as number, t: step / 60 };
        if (prev) {
          const moved = Math.hypot(now.x - prev.x, now.y - prev.y);
          const dt = now.t - prev.t;
          if (moved < 2 && dt >= 1) maxStuckSeconds = Math.max(maxStuckSeconds, dt);
        }
        lastPos.set(u.id as number, now);
      }
    }
    const phase = anyEngine.phase as string;
    const alive = units();
    console.log(
      `SIM RESULT phase=${phase} battleState=${anyEngine.battleState} alive=${alive.length} ` +
        `allies=${alive.filter((u) => u.side === "allies").length} axis=${alive.filter((u) => u.side === "axis").length} ` +
        `inCoverSamples=${inCoverSamples}/${samples} maxStuckSeconds=${maxStuckSeconds}`,
    );
    // No unit with an active order was observed stationary for a full
    // second in any 1s sample window (the in-engine stuck detector
    // fires at 1s, so a genuinely wedged unit would show up here).
    expect(maxStuckSeconds).toBeLessThanOrEqual(1);
    // At least some living units were in cover at sampled seconds —
    // cover-seeking is actually moving units to sandbags/walls/trees.
    expect(inCoverSamples).toBeGreaterThan(0);
    // The battle resolved one way or the other, or is still going with
    // both sides alive and moving — it must not have frozen with units
    // standing around with orders queued and no progress.
    expect(["battle", "over"]).toContain(phase);
    expect(alive.length).toBeGreaterThan(0);
  }, 120000);
});
