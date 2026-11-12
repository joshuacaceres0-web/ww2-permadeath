// @vitest-environment node
// The road matches the ground it runs on: a sandy trail on sand ground
// (the beach), a dirt road on dirt ground (every other map). Same pixel
// art style, same clear path for the Sherman.
import { describe, expect, it } from "vitest";

type Stroke = { lineWidth: number; strokeStyle: string };
const strokes: Stroke[] = [];

function recordingCtx() {
  const state: Record<string, unknown> = { lineWidth: 1, strokeStyle: "#000000", fillStyle: "#000000" };
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "canvas") return {};
        if (prop === "measureText") return () => ({ width: 0 });
        if (prop === "getImageData") return () => ({ data: new Uint8ClampedArray(4) });
        if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createPattern")
          return () => ({ addColorStop: () => {} });
        if (prop === "stroke") {
          return () => {
            strokes.push({ lineWidth: state.lineWidth as number, strokeStyle: state.strokeStyle as string });
          };
        }
        if (prop in state) return state[prop as string];
        return () => {};
      },
      set(_t, prop, value) {
        state[prop as string] = value;
        return true;
      },
    },
  );
}

function stubBrowser() {
  const makeCanvas = () => ({
    width: 0,
    height: 0,
    getContext: () => recordingCtx(),
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
}

stubBrowser();

const baseMission = {
  id: "op_01",
  code: "OPERATION OVERLORD",
  location: "Omaha Beach",
  objective: "test",
  difficulty: "NORMAL",
  reward: 250,
  brief: "test",
  enemies: [{ type: "volks", wave: 1, count: 2 }],
} as const;
const man = (id: string, name: string, type: string, level = 1) => ({
  id, name, rank: "Pvt", level, type, hp: 100, kills: 0, medals: [],
});
const SQUAD = [man("s1", "Boyd", "rifleman")] as never;

async function buildTerrainStrokes(terrain: string) {
  strokes.length = 0;
  const { GameEngine } = await import("../engine");
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {});
  engine.setup({ ...baseMission, terrain } as never, SQUAD as never, 0, "", 1);
  return [...strokes];
}

describe("road matches the terrain", () => {
  it("the beach road is a sandy trail", async () => {
    const s = await buildTerrainStrokes("dday");
    expect(s.some((t) => t.lineWidth === 46 && t.strokeStyle === "#C9B184")).toBe(true);
    expect(s.some((t) => t.lineWidth === 7 && t.strokeStyle === "#A68B5A")).toBe(true);
    expect(s.some((t) => t.lineWidth === 46 && t.strokeStyle === "#4A3E2C")).toBe(false);
  });

  it("a dirt-ground map gets a dirt road", async () => {
    for (const terrain of ["town", "causeway", "forest"]) {
      const s = await buildTerrainStrokes(terrain);
      expect(s.some((t) => t.lineWidth === 46 && t.strokeStyle === "#4A3E2C")).toBe(true);
      expect(s.some((t) => t.lineWidth === 7 && t.strokeStyle === "#33261A")).toBe(true);
      expect(s.some((t) => t.lineWidth === 46 && t.strokeStyle === "#C9B184")).toBe(false);
    }
  });
});
