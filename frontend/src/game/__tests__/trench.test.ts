// Trenches: dug heavy cover men can walk into and fight from, on
// every terrain kind, with a clear look on the map and in the replay.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mergeObstacles } from "../../components/game/ReplayViewer";

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

const baseMission = {
  id: "op_02",
  code: "OPERATION SILENT CHATEAU",
  location: "Valognes Estate",
  objective: "test",
  difficulty: "HARD",
  reward: 400,
  brief: "test",
  enemies: [
    { type: "grenadier", wave: 1, count: 3 },
    { type: "volks", wave: 1, count: 3 },
    { type: "medic", wave: 1, count: 1 },
    { type: "mg42", wave: 1, count: 1 },
  ],
} as const;

const SQUAD = [
  { id: "s1", name: "Boyd", rank: "Sgt", level: 1, type: "rifleman", hp: 100, kills: 0, medals: [] },
  { id: "s2", name: "Kowalski", rank: "Cpl", level: 1, type: "medic", hp: 100, kills: 0, medals: [] },
  { id: "s3", name: "Reyes", rank: "Pfc", level: 1, type: "mg", hp: 100, kills: 0, medals: [] },
  { id: "s4", name: "Novak", rank: "Pfc", level: 1, type: "sniper", hp: 100, kills: 0, medals: [] },
  { id: "s5", name: "Hale", rank: "Pvt", level: 1, type: "at", hp: 100, kills: 0, medals: [] },
] as never;

type U = Record<string, unknown> & {
  x: number; y: number; hp: number; maxHp: number; morale: number; broken: boolean;
  suppression: number; lastHitT: number; side: string; npc: boolean; type: string; id: number;
};
type AnyEngine = Record<string, unknown> & {
  covers: Array<Record<string, unknown>>;
  units: U[];
  update: (dt: number) => void;
};

async function makeEngine(terrain = "town") {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {});
  engine.setup({ ...baseMission, terrain } as never, SQUAD as never, 0, "");
  engine.begin();
  return engine as unknown as AnyEngine;
}

function step(e: AnyEngine, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) e.update(1 / 60);
}

describe("trenches", () => {
  it("every terrain kind builds trench cover: heavy, q 0.9, 400 hp", async () => {
    for (const terrain of ["beach", "bocage", "town", "causeway", "forest"]) {
      const e = await makeEngine(terrain);
      const trenches = e.covers.filter((c) => c.kind === "trench");
      expect(trenches.length).toBeGreaterThan(20);
      for (const t of trenches) {
        expect(t.type).toBe("heavy");
        expect(t.q).toBe(0.9);
        expect(t.hp).toBe(400);
      }
    }
  });

  it("a trench protects from the front and nothing from the flank", async () => {
    const e = await makeEngine("town");
    // Town trench line 1 runs vertically at x=900; take a real
    // trench cover on it, away from its gap at y=675.
    const trench = e.covers.find((c) => c.kind === "trench" && Math.abs((c.x as number) - 900) < 2 && Math.abs((c.y as number) - 400) < 30)!;
    expect(trench).toBeDefined();
    const between = e as unknown as { coverBetween: (ox: number, oy: number, tx: number, ty: number) => Record<string, unknown> | null };
    // Shooter east of the trench, target in it: protected by a trench
    // cover on the same line (a trench is a row of identical circles,
    // so any of them counts, not one specific circle).
    const front = between.coverBetween(1100, 400, 880, 400);
    expect(front).not.toBeNull();
    expect(front!.kind).toBe("trench");
    expect(Math.abs((front!.x as number) - 900)).toBeLessThan(2);
    // Shooter west, on the target's own side: flanked, no protection.
    expect(between.coverBetween(700, 400, 880, 400)).toBeNull();
  });

  it("a man can walk straight across a trench line", async () => {
    const e = await makeEngine("town");
    const man = e.units.find((x) => x.side === "allies" && !x.npc && x.type === "rifleman")!;
    man.x = 700;
    man.y = 400; // through the trench itself, not its gap at y=675
    (e as unknown as { selectUnit: (id: number) => void }).selectUnit(man.id);
    (e as unknown as { issueOrder: (x: number, y: number, q: boolean) => void }).issueOrder(1100, 400, false);
    step(e, 10);
    expect(man.x).toBeGreaterThan(900); // crossed the trench line at x=900
  });

  it("a trench wears down under sustained fire like a ruin wall", async () => {
    const e = await makeEngine("town");
    const trench = e.covers.find((c) => c.kind === "trench")!;
    const damage = e as unknown as { damageCover: (c: unknown, dmg: number) => void };
    damage.damageCover(trench, 100);
    expect(trench.hp).toBe(300);
    expect(trench.q as number).toBeLessThan(0.9);
    expect(e.covers).toContain(trench);
  });

  it("replays show trenches, merged into one long bar per segment", async () => {
    const e = await makeEngine("town");
    const replay = (e as unknown as { getReplay: () => { obstacles: Array<{ x: number; y: number; r: number; kind: string }> } | null }).getReplay();
    expect(replay).not.toBeNull();
    const trenchObs = replay!.obstacles.filter((o) => o.kind === "trench");
    expect(trenchObs.length).toBeGreaterThan(20);
    const merged = mergeObstacles(replay!.obstacles);
    const trenchClusters = merged.filter((o) => o.kind === "trench");
    expect(trenchClusters.length).toBeGreaterThan(0);
    expect(trenchClusters.length).toBeLessThan(trenchObs.length); // circles merged into bars
    expect(trenchClusters.reduce((n, o) => n + o.count, 0)).toBe(trenchObs.length); // nothing dropped
    // A merged trench bar is long in one direction, not a dot.
    expect(trenchClusters.some((o) => Math.max(o.w, o.h) > 200)).toBe(true);
  });
});
