// @vitest-environment node
// Airborne formation (Josh, 2026-11-13): the drop runs in as
// five C-47s in echelon, one per stick — the player's squad
// rides one plane, each 2nd Platoon squad rides its own. A
// man exits as HIS plane passes his x. While the formation
// runs in, the only fog reveal is the planes' own: a corridor
// explored under each flight path, and nothing from a man
// still under canopy; his vision opens when he lands.
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
  enemies: [{ type: "volks", wave: 1, count: 3 }],
} as const;

const CELL = 24;
const COLS = Math.ceil(4000 / CELL);

type U = {
  side: string; npc: boolean; npcSquad?: number; alive: boolean;
  x: number; y: number; vision: number;
  dropStart?: number; dropDur?: number; dropPlane?: number; landed?: boolean;
};
type Engine = {
  setup: (m: unknown, s: unknown, b: number, v: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  units: U[];
  introKind: string | null;
  introT: number;
  planes: Array<{ lane: number; trail: number }>;
  visible: Uint8Array;
  explored: Uint8Array;
};

/** Fog grid index for a world point (the grid recomputeFog fills). */
const cellOf = (x: number, y: number) => Math.floor(y / CELL) * COLS + Math.floor(x / CELL);

async function makeEngine() {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {}) as unknown as Engine;
  engine.setup(OVERLORD as never, SQUAD as never, 0, "airborne");
  return engine;
}

describe("airborne formation", () => {
  it("five C-47s in echelon, one stick each, exits keyed to his own plane", async () => {
    const e = await makeEngine();
    expect(e.introKind).toBe("drop");
    expect(e.planes.length).toBe(5);
    // Echelon: lead first, each plane trailing the last by 120.
    expect(e.planes.map((p) => p.trail)).toEqual([0, 120, 240, 360, 480]);
    // Lanes run north to south, at least 150 apart.
    for (let i = 1; i < 5; i++) expect(e.planes[i].lane - e.planes[i - 1].lane).toBeGreaterThanOrEqual(150);
    const allies = e.units.filter((u) => u.side === "allies");
    expect(allies.length).toBe(37);
    // A stick rides together: one plane per NPC squad, one for
    // the player's squad, five planes for five sticks.
    const planeOfStick = new Map<string, number>();
    for (const u of allies) {
      expect(u.dropPlane).toBeDefined();
      const stick = u.npc ? `npc-${u.npcSquad}` : "player";
      if (planeOfStick.has(stick)) expect(u.dropPlane).toBe(planeOfStick.get(stick));
      else planeOfStick.set(stick, u.dropPlane!);
      // He exits as his own plane passes his x.
      const trail = e.planes[u.dropPlane!].trail;
      expect(u.dropStart!).toBeCloseTo((u.x + 80 + trail) / 314, 6);
    }
    expect(new Set(planeOfStick.values()).size).toBe(5);
    // The echelon staggers the sticks in time: the trailing
    // plane's first exit comes after the lead plane's first.
    const exitsOf = (k: number) => allies.filter((u) => u.dropPlane === k).map((u) => u.dropStart!);
    expect(Math.min(...exitsOf(4))).toBeGreaterThan(Math.min(...exitsOf(0)));
  });

  it("fog during the run-in: plane corridors explored, canopy men reveal nothing, landed men see", async () => {
    const e = await makeEngine();
    const allies = e.units.filter((u) => u.side === "allies");
    const firstToLand = allies.reduce((a, b) => (a.dropStart! + a.dropDur! < b.dropStart! + b.dropDur! ? a : b));
    const lastToLand = allies.reduce((a, b) => (a.dropStart! + a.dropDur! > b.dropStart! + b.dropDur! ? a : b));
    e.begin();
    // Half a second in: nobody is down yet, so no man's own
    // vision has opened anywhere.
    for (let s = 0; s < 30; s++) e.update(1 / 60);
    expect(e.introT).toBeGreaterThan(0);
    expect(firstToLand.landed).toBeFalsy();
    expect(e.visible[cellOf(lastToLand.x, lastToLand.y)]).toBe(0);
    expect(e.visible[cellOf(firstToLand.x, firstToLand.y)]).toBe(0);
    // Run until the first man is down: his vision opens around
    // him, while a late man's ground is still dark to the squad.
    for (let s = 0; s < 60 * 6 && !firstToLand.landed; s++) e.update(1 / 60);
    expect(firstToLand.landed).toBe(true);
    expect(e.visible[cellOf(firstToLand.x, firstToLand.y)]).toBe(1);
    expect(lastToLand.landed).toBeFalsy();
    expect(e.visible[cellOf(lastToLand.x, lastToLand.y)]).toBe(0);
    // The lead plane's corridor: by 3.8s she has crossed
    // x=1050 on her lane. No man lands anywhere near there
    // (every landing spot is 490+ west of it, beyond even a
    // Recon's 460 vision), so only her flight path can have
    // explored it.
    const lead = e.planes[0];
    expect(allies.every((u) => Math.hypot(u.x - 1050, u.y - lead.lane) > 465)).toBe(true);
    for (let s = 0; s < 60 * 6 && e.introT >= 0 && e.introT < 3.8; s++) e.update(1 / 60);
    expect(e.introT).toBeGreaterThanOrEqual(3.8);
    expect(e.explored[cellOf(1050, lead.lane)]).toBe(1);
    // And the far east, where no plane has been and no man is,
    // stays unknown.
    expect(e.explored[cellOf(3900, 675)]).toBe(0);
    // The drop still ends with everyone down and the battle live.
    for (let s = 0; s < 60 * 12 && e.introT >= 0; s++) e.update(1 / 60);
    expect(e.introT).toBe(-1);
    expect(allies.every((u) => u.landed)).toBe(true);
  }, 60000);
});
