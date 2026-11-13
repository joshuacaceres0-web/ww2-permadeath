// @vitest-environment node
/**
 * Squad dock order (Josh, 2026-11-12): in the battle squad list,
 * the living stay grouped on the left in their normal order; a man
 * who falls moves to the FAR RIGHT of the list, still shown as
 * fallen; a second death lands to the right of the first fallen.
 * The rule lives in the engine's HUD snapshot (emitHud), which is
 * what SquadDock renders.
 */
import { describe, expect, it } from "vitest";

function stubBrowser() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx: any = new Proxy(
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

const TOWN = {
  id: "op_test", index: 99, code: "TEST OP", name: "Test", location: "Test",
  terrain: "town", brief: "", reward: 500, enemies: [{ type: "volks", wave: 1, count: 3 }],
};

const SQUAD = [
  { id: "s-a", name: "Able", type: "rifleman", rank: "Sgt.", level: 3, medals: [], quirks: [] },
  { id: "s-b", name: "Baker", type: "rifleman", rank: "Pvt.", level: 0, medals: [], quirks: [] },
  { id: "s-c", name: "Charlie", type: "medic", rank: "Cpl.", level: 1, medals: [], quirks: [] },
  { id: "s-d", name: "Davis", type: "mg", rank: "Pfc.", level: 1, medals: [], quirks: [] },
  { id: "s-e", name: "Evans", type: "rifleman", rank: "Pvt.", level: 0, medals: [], quirks: [] },
];

type U = {
  id: number; side: string; npc: boolean; alive: boolean; x: number; y: number;
  hp: number; name: string; soldierId: string | null;
};
type Hud = { units: { name: string; alive: boolean; diedAt: number | null }[] };

async function makeEngine() {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const snaps: Hud[] = [];
  const engine = new GameEngine(canvas, (h: Hud) => snaps.push(h));
  (engine as unknown as { setup: (...a: unknown[]) => void }).setup(TOWN, SQUAD, 0, "", 1, "");
  return { engine: engine as unknown as {
    begin: () => void;
    update: (dt: number) => void;
    emitHud: () => void;
    units: U[];
    damage: (t: U, dmg: number, src: U) => void;
  }, snaps };
}

function step(e: { update: (dt: number) => void; emitHud: () => void }, seconds: number) {
  for (let t = 0; t < seconds; t += 0.1) e.update(0.1);
  // In the app the render loop emits the HUD; tests drive update()
  // directly, so emit by hand after each step.
  e.emitHud();
}

describe("squad dock order", () => {
  it("a mid-list death moves that card to the far right; a second death lands right of the first", async () => {
    const { engine: e, snaps } = await makeEngine();
    e.begin();
    // Nobody fights during the test: park the enemy far away.
    for (const u of e.units) if (u.side === "axis") { u.x = 3900; u.y = 100; }
    const foe = e.units.find((u) => u.side === "axis")!;
    const byName = (n: string) => e.units.find((u) => u.name === n)!;
    step(e, 0.3);
    const names = () => snaps[snaps.length - 1].units.map((u) => u.name);
    expect(names()).toEqual(["Able", "Baker", "Charlie", "Davis", "Evans"]);

    // Charlie (middle of the list) falls first.
    e.damage(byName("Charlie"), 9999, foe);
    step(e, 0.3);
    expect(names()).toEqual(["Able", "Baker", "Davis", "Evans", "Charlie"]);
    const charlie = snaps[snaps.length - 1].units[4];
    expect(charlie.alive).toBe(false);
    expect(charlie.diedAt).not.toBeNull();

    // Baker falls second: he goes to the right of Charlie, and
    // the living keep their order on the left.
    e.damage(byName("Baker"), 9999, foe);
    step(e, 0.3);
    expect(names()).toEqual(["Able", "Davis", "Evans", "Charlie", "Baker"]);
    const last = snaps[snaps.length - 1];
    expect(last.units[3].diedAt!).toBeLessThan(last.units[4].diedAt!);
    expect(last.units.slice(0, 3).every((u) => u.alive)).toBe(true);
  });
});
