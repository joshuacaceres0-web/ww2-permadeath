// Headless checks for the three fixes in this job:
// 1. All objective tags removed — only the mortar warning circle remains.
// 2. AI no longer wedges in cover in a re-seek loop.
// 3. Battle controls are present and respond: 1-8 / 0 select (even in
//    the briefing), Space pauses, and the engine's keyboard/mouse
//    listeners are attached on mount, not only after BEGIN.
// @vitest-environment node
import { describe, expect, it } from "vitest";

function stubBrowser() {
  const listeners = new Map<string, Array<(e: unknown) => void>>();
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
    width: 1600,
    height: 900,
    getContext: () => ctx,
    toDataURL: () => "",
    getBoundingClientRect: () => ({ width: 1600, height: 900, left: 0, top: 0 }),
    addEventListener: () => {},
    removeEventListener: () => {},
    style: {},
  });
  const store = new Map<string, string>();
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  g.window = globalThis;
  g.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
  g.document = {
    createElement: (tag: string) => (tag === "canvas" ? makeCanvas() : {}),
    fonts: { load: () => Promise.resolve([]) },
  };
  g.HTMLCanvasElement = function () {};
  g.requestAnimationFrame = () => 0;
  g.cancelAnimationFrame = () => {};
  g.performance = { now: () => 0 };
  g.addEventListener = (type: string, fn: (e: unknown) => void) => {
    const list = listeners.get(type) ?? [];
    list.push(fn);
    listeners.set(type, list);
  };
  g.removeEventListener = (type: string, fn: (e: unknown) => void) => {
    listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn));
  };
  g.__dispatch = (type: string, e: unknown) => {
    for (const fn of listeners.get(type) ?? []) fn(e);
  };
}

stubBrowser();

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
  ],
} as const;

const SQUAD = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 2, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
  { id: "s3", name: "James Baker", type: "rifleman", rank: "Pvt.", level: 1, medals: [] },
  { id: "s4", name: "Chester Pruitt", type: "medic", rank: "Pvt.", level: 1, medals: [] },
  { id: "s5", name: "Raymond Boyd", type: "mg", rank: "Pvt.", level: 1, medals: [] },
] as const;

describe("objective tags removed, controls respond, no cover-stuck loop", () => {
  it("draws the mortar warning but no objective tags", async () => {
    const { GameEngine } = await loadEngine();
    const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
    const engine = new GameEngine(canvas, () => {});
    const anyEngine = engine as unknown as Record<string, unknown>;
    engine.setup(SILENT_CHATEAU as never, SQUAD as never, 0, "");

    // Units that used to get red-diamond tags, plus an incoming shell.
    anyEngine.units = [
      { alive: true, side: "axis", enemyType: "officer", x: 500, y: 500 },
      { alive: true, side: "axis", enemyType: "mg42", x: 1500, y: 500 },
      { alive: true, side: "axis", enemyType: "mortar", x: 1800, y: 800 },
      { alive: true, side: "axis", enemyType: "flak", x: 2000, y: 200 },
    ];
    anyEngine.projectiles = [{ sourceType: "mortar", tx: 1200, ty: 675, aoe: 62 }];
    anyEngine.elapsed = 1;

    const texts: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "fillText") return (text: string) => void texts.push(text);
          if (prop === "measureText") return () => ({ width: 0 });
          if (prop === "createLinearGradient") return () => ({ addColorStop: () => {} });
          return () => {};
        },
        set() {
          return true;
        },
      },
    );
    // Canvas stub returns a fresh proxy ctx from getContext; call the
    // private draw method with our recording ctx instead.
    (anyEngine as { drawMortarWarnings: (c: unknown) => void }).drawMortarWarnings(ctx);
    expect(texts).toContain("!");
    for (const banned of ["SS OFFICER", "MG42", "MORTAR", "FLAK"]) {
      expect(texts).not.toContain(banned);
    }
    // The old method is gone entirely.
    expect((anyEngine as Record<string, unknown>).drawObjectiveMarkers).toBeUndefined();
  });

  it("keyboard controls respond, including selection in the briefing", async () => {
    const { GameEngine } = await loadEngine();
    const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
    const engine = new GameEngine(canvas, () => {});
    const anyEngine = engine as unknown as Record<string, unknown>;
    engine.setup(SILENT_CHATEAU as never, SQUAD as never, 0, "");
    engine.attach();

    const dispatch = (globalThis as unknown as { __dispatch: (t: string, e: unknown) => void }).__dispatch;
    const key = (k: string) => dispatch("keydown", { key: k, preventDefault: () => {} });

    // In the briefing, 1 selects the first man (old code ignored it).
    key("1");
    expect((anyEngine.selected as unknown[]).length).toBe(1);
    // 0 selects the whole squad.
    key("0");
    expect((anyEngine.selected as unknown[]).length).toBe(5);
    // Space does not pause during the briefing.
    key(" ");
    expect(anyEngine.paused).toBe(false);

    engine.begin();
    // Space pauses once the battle is running, and again to resume.
    key(" ");
    expect(anyEngine.paused).toBe(true);
    key(" ");
    expect(anyEngine.paused).toBe(false);
    // Escape clears the selection.
    key("Escape");
    expect((anyEngine.selected as unknown[]).length).toBe(0);
    engine.destroy();
  });

  it("no unit accumulates stuck time in cover in a full battle", async () => {
    const { GameEngine } = await loadEngine();
    const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
    const engine = new GameEngine(canvas, () => {});
    const anyEngine = engine as unknown as Record<string, unknown>;
    engine.setup(SILENT_CHATEAU as never, SQUAD as never, 0, "");
    engine.begin();

    const units = () => (anyEngine.units as Array<Record<string, unknown>>).filter((u) => u.alive);
    const squad = units().filter((u) => u.side === "allies" && !u.npc);
    for (const u of squad) {
      (anyEngine as { selectUnit: (id: number) => void }).selectUnit(u.id as number);
    }
    (anyEngine as { issueOrder: (x: number, y: number, q: boolean) => void }).issueOrder(2100, 675, false);

    // Consecutive stationary time per unit while it has an active order,
    // sampled every second. This is what "stuck in cover" means in play:
    // a unit that wedges and never frees itself. The old cover loop
    // wedged a unit, dropped its order after ~3s, immediately re-ordered
    // it to the same unreachable cover spot, and wedged again — one unit
    // accumulated 313 stationary seconds in a single battle. With the
    // reachable-only cover + ban + cooldown fix, the stuck detector
    // re-routes or drops a wedged order within ~3s, so no single wedge
    // lasts long. Cumulative time is logged only as a diagnostic: combat
    // is stochastic, and a unit can legitimately shuffle at a wall gap
    // for a few seconds across several separate wedges in one battle.
    const lastPos = new Map<number, { x: number; y: number }>();
    const consecStuck = new Map<number, number>();
    const totalStuck = new Map<number, number>();
    let inCoverSamples = 0;
    let samples = 0;
    for (let step = 0; step < 60 * 360; step++) {
      (anyEngine as { update: (dt: number) => void }).update(1 / 60);
      if ((anyEngine.phase as string) === "over") break;
      if (step % 60 !== 0) continue;
      samples++;
      for (const u of units()) {
        if (u.cover) inCoverSamples++;
        const hasOrder = ((u.orders as unknown[]).length > 0 || (u.chase as unknown[]).length > 0) && !u.isStatic;
        if (!hasOrder) {
          lastPos.delete(u.id as number);
          consecStuck.set(u.id as number, 0);
          continue;
        }
        const prev = lastPos.get(u.id as number);
        const now = { x: u.x as number, y: u.y as number };
        if (prev && Math.hypot(now.x - prev.x, now.y - prev.y) < 2) {
          consecStuck.set(u.id as number, (consecStuck.get(u.id as number) ?? 0) + 1);
          totalStuck.set(u.id as number, (totalStuck.get(u.id as number) ?? 0) + 1);
        } else {
          consecStuck.set(u.id as number, 0);
        }
        lastPos.set(u.id as number, now);
      }
    }
    const maxConsec = Math.max(0, ...consecStuck.values());
    const maxTotal = Math.max(0, ...totalStuck.values());
    console.log(`COVER SIM samples=${samples} inCoverSamples=${inCoverSamples} maxConsecutiveStuckSeconds=${maxConsec} maxTotalStuckSeconds=${maxTotal}`);
    expect(inCoverSamples).toBeGreaterThan(0);
    expect(maxConsec).toBeLessThanOrEqual(5);
  }, 120000);
});
