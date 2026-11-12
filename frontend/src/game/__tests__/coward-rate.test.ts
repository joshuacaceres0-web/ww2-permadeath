// @vitest-environment node
// Coward rate guard: fleeing must stay rare. Four AUTO battles on
// Silent Chateau count how many enemy men actually desert (fled
// units). With 15% of volks cowards, expect 0-1 deserters per battle
// most of the time, never a rout every wave. The bound is generous
// on purpose — the point is to catch the mechanic going common,
// not to fail on one unlucky draw.
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
const loadEngine = async () => {
  const mod = await import("../engine");
  return { GameEngine: mod.GameEngine };
};

// Same Silent Chateau fixture the AUTO recorder uses.
const MISSION = {
  id: "op_02",
  code: "OPERATION SILENT CHATEAU",
  location: "Valognes Estate",
  objective: "",
  difficulty: "HARD",
  reward: 400,
  terrain: "town",
  brief: "",
  enemies: [
    { type: "grenadier", wave: 1, count: 3 },
    { type: "volks", wave: 1, count: 3 },
    { type: "medic", wave: 1, count: 1 },
    { type: "officer", wave: 2, count: 1 },
    { type: "grenadier", wave: 2, count: 2 },
    { type: "medic", wave: 2, count: 1 },
    { type: "mg42", wave: 2, count: 1 },
    { type: "fallschirmjager", wave: 2, count: 3 },
    { type: "mortar", wave: 2, count: 1 },
    { type: "volks", wave: 3, count: 2 },
    { type: "medic", wave: 3, count: 1 },
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

type AnyEngine = Record<string, unknown> & {
  setup: (m: unknown, s: unknown, b: number, v: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  setAutoBattle: (on: boolean) => void;
  battleState: string;
  units: Array<{ id: number; side: string; fled: boolean; broken: boolean; coward: boolean; enemyType: string | null; morale: number }>;
};

describe("coward rate", () => {
  it("desertion stays rare across 4 AUTO battles", async () => {
    const { GameEngine } = await loadEngine();
    const results: Array<{ result: string; seconds: number; deserters: number; broke: number; brokeCowards: number; cowards: number; cowardMinMorale: number }> = [];
    for (let run = 0; run < 4; run++) {
      const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
      const engine = new GameEngine(canvas, () => {}) as unknown as AnyEngine;
      engine.setup(MISSION as never, SQUAD as never, 0, "");
      engine.begin();
      engine.setAutoBattle(true);
      let t = 0;
      // Sample once a second: which enemy men broke at any point, how
      // many of them were cowards, how many cowards were on the field,
      // and the lowest morale any coward reached. Printed for tuning.
      const broke = new Set<number>();
      const brokeCowards = new Set<number>();
      const cowards = new Set<number>();
      let cowardMinMorale = 100;
      for (let step = 0; step < 60 * 300; step++) {
        engine.update(1 / 60);
        t += 1 / 60;
        if (step % 60 === 0) {
          for (const u of engine.units) {
            if (u.side === "axis" && u.coward) {
              cowards.add(u.id);
              if (u.alive) cowardMinMorale = Math.min(cowardMinMorale, u.morale);
            }
            if (u.side === "axis" && u.broken) {
              broke.add(u.id);
              if (u.coward) brokeCowards.add(u.id);
            }
          }
        }
        if (engine.battleState !== "active") break;
      }
      const deserters = engine.units.filter((u) => u.side === "axis" && u.fled).length;
      results.push({ result: engine.battleState, seconds: Math.round(t), deserters, broke: broke.size, brokeCowards: brokeCowards.size, cowards: cowards.size, cowardMinMorale: Math.round(cowardMinMorale) });
    }
    const total = results.reduce((n, r) => n + r.deserters, 0);
    const wins = results.filter((r) => r.result === "victory").length;
    console.log(
      `COWARD RATE: ${results.map((r) => `${r.result} ${r.seconds}s ${r.deserters} deserted (${r.broke} broke, ${r.brokeCowards} cowards, ${r.cowards} cowards present, lowest coward morale ${r.cowardMinMorale})`).join(" | ")} — total deserters ${total}/4 battles, wins ${wins}/4`,
    );
    // Rare means a deserter here and there, never a rout every wave:
    // at most 2 per battle on average.
    expect(total).toBeLessThanOrEqual(8);
  }, 300000);
});
