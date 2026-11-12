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
const loadEngine = async () => {
  const mod = await import("../engine");
  return { GameEngine: mod.GameEngine };
};

const MISSION = {
  id: "op_02",
  code: "OPERATION SILENT CHATEAU",
  location: "Valognes Estate",
  objective: "test",
  difficulty: "HARD",
  reward: 400,
  terrain: "town",
  brief: "test",
  enemies: [
    { type: "grenadier", wave: 1, count: 3 },
    { type: "volks", wave: 1, count: 4 },
  ],
} as const;

const SQUAD = [
  { id: "s1", name: "Boyd", rank: "Sgt", level: 1, type: "rifleman", hp: 100, kills: 0, medals: [] },
  { id: "s2", name: "Kowalski", rank: "Cpl", level: 1, type: "medic", hp: 100, kills: 0, medals: [] },
  { id: "s3", name: "Reyes", rank: "Pfc", level: 1, type: "mg", hp: 100, kills: 0, medals: [] },
  { id: "s4", name: "Novak", rank: "Pfc", level: 1, type: "sniper", hp: 100, kills: 0, medals: [] },
  { id: "s5", name: "Hale", rank: "Pvt", level: 1, type: "at", hp: 100, kills: 0, medals: [] },
] as never;

describe("fireteam split", () => {
  it("splits 5 men into Alpha 3 / Bravo 2, selects each team alone, and merges back", async () => {
    const { GameEngine } = await loadEngine();
    const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
    let lastHud: { selectedIds: number[]; teamA: number[]; teamB: number[] } | null = null;
    const engine = new GameEngine(canvas, (h: unknown) => {
      lastHud = h as { selectedIds: number[]; teamA: number[]; teamB: number[] };
    });
    const anyEngine = engine as unknown as Record<string, unknown>;
    engine.setup(MISSION as never, SQUAD as never, 0, "");
    engine.begin();

    // Not split yet: both teams empty.
    (anyEngine as { emitHud: () => void }).emitHud();
    expect(lastHud!.teamA).toEqual([]);
    expect(lastHud!.teamB).toEqual([]);

    // Split: Alpha = first 3, Bravo = last 2, Alpha selected.
    (engine as unknown as { splitSquad: () => void }).splitSquad();
    (anyEngine as { emitHud: () => void }).emitHud();
    expect(lastHud!.teamA).toHaveLength(3);
    expect(lastHud!.teamB).toHaveLength(2);
    expect(lastHud!.selectedIds).toEqual(lastHud!.teamA);

    // Select Bravo alone, then Alpha alone.
    (engine as unknown as { selectTeam: (i: 0 | 1) => void }).selectTeam(1);
    (anyEngine as { emitHud: () => void }).emitHud();
    expect(lastHud!.selectedIds).toEqual(lastHud!.teamB);
    (engine as unknown as { selectTeam: (i: 0 | 1) => void }).selectTeam(0);
    (anyEngine as { emitHud: () => void }).emitHud();
    expect(lastHud!.selectedIds).toEqual(lastHud!.teamA);

    // Merge: teams cleared, everyone selected.
    (engine as unknown as { mergeSquads: () => void }).mergeSquads();
    (anyEngine as { emitHud: () => void }).emitHud();
    expect(lastHud!.teamA).toEqual([]);
    expect(lastHud!.teamB).toEqual([]);
    expect(lastHud!.selectedIds).toHaveLength(5);
  });

  it("full map fits the whole 4000x1350 map and restores the normal window", async () => {
    const { GameEngine } = await loadEngine();
    const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
    const engine = new GameEngine(canvas, () => {});
    const anyEngine = engine as unknown as Record<string, unknown>;
    engine.setup(MISSION as never, SQUAD as never, 0, "");
    engine.begin();

    expect((engine as unknown as { isFitMap: () => boolean }).isFitMap()).toBe(false);
    (engine as unknown as { setFitMap: (on: boolean) => void }).setFitMap(true);
    expect((engine as unknown as { isFitMap: () => boolean }).isFitMap()).toBe(true);
    expect(anyEngine.viewW).toBe(4000);
    expect(anyEngine.viewH).toBe(1350);
    expect((anyEngine.cam as { x: number; y: number }).x).toBe(0);
    expect((anyEngine.cam as { x: number; y: number }).y).toBe(0);
    (engine as unknown as { setFitMap: (on: boolean) => void }).setFitMap(false);
    expect((engine as unknown as { isFitMap: () => boolean }).isFitMap()).toBe(false);
    expect(anyEngine.viewW).toBeLessThanOrEqual(1600);
    expect(anyEngine.viewH).toBeLessThanOrEqual(900);
  });
});
