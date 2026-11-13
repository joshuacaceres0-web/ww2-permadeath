// @vitest-environment node
// Vehicle death (Josh, 2026-11-12): a destroyed vehicle blows
// up and stays on the field as a burnt wreck. It does NOT get
// the infantry treatment — no corpse sprite, no blood pool, no
// Memorial entry. Covers the convoy armour (panzer, halftrack)
// and the player's Sherman alike: one vehicle path in kill().
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

const SQUAD_WITH_RADIO = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 2, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
  { id: "s3", name: "James Baker", type: "rifleman", rank: "Pvt.", level: 1, medals: [] },
  { id: "s4", name: "Chester Pruitt", type: "medic", rank: "Pvt.", level: 1, medals: [] },
  { id: "s6", name: "Eddie Novak", type: "radioman", rank: "Pvt.", level: 1, medals: [] },
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
  enemies: [
    { type: "volks", wave: 1, count: 6 },
    { type: "grenadier", wave: 1, count: 3 },
  ],
} as const;

const TOWN = { ...OVERLORD, id: "op_02", terrain: "town" } as const;

type U = {
  id: number; side: string; npc: boolean; type: string; enemyType: string | null;
  vehicle: boolean; alive: boolean; x: number; y: number; kills: number;
};
type Engine = {
  setup: (m: unknown, s: unknown, b: number, v: string, lvl?: number) => void;
  begin: () => void;
  update: (dt: number) => void;
  callTank: () => boolean;
  radioLive: () => boolean;
  units: U[];
  wrecks: Array<{ x: number; y: number; kind: string; axis: boolean }>;
  corpses: Array<{ x: number; y: number }>;
  particles: Array<{ kind: string }>;
  fallen: unknown[];
  damage: (u: U, dmg: number, st: string, killerId: number | null) => void;
};

async function makeEngine(mission: unknown, squad: unknown, variant: string, level = 1) {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {}) as unknown as Engine;
  engine.setup(mission as never, squad as never, 0, variant, level);
  return engine;
}

describe("vehicle death leaves a wreck, not a body", () => {
  it("a destroyed halftrack blows up, wrecks, and leaves no corpse or casualty entry", async () => {
    const e = await makeEngine(OVERLORD, SQUAD, "airborne");
    const half = e.units.find((u) => u.enemyType === "halftrack")!;
    expect(half).toBeDefined();
    const killer = e.units.find((u) => u.side === "allies" && !u.npc)!;
    const killsBefore = killer.kills;
    e.damage(half, 9999, "at", killer.id);
    expect(half.alive).toBe(false);
    // The explosion happened and the wreck is on the field.
    expect(e.particles.some((p) => p.kind === "boom")).toBe(true);
    expect(e.wrecks).toHaveLength(1);
    expect(e.wrecks[0].kind).toBe("halftrack");
    expect(e.wrecks[0].axis).toBe(true);
    // The kill still counts for the man who made it.
    expect(killer.kills).toBe(killsBefore + 1);
    // No casualty filing for a vehicle, ever.
    expect(e.fallen).toHaveLength(0);
    // And after the dying window, no corpse at the wreck site.
    e.begin();
    for (let s = 0; s < 60 * 2; s++) e.update(1 / 60);
    expect(e.corpses.filter((c) => Math.hypot(c.x - half.x, c.y - half.y) < 30)).toHaveLength(0);
  });

  it("a destroyed panzer wrecks the same way", async () => {
    const e = await makeEngine(OVERLORD, SQUAD, "airborne");
    const pz = e.units.find((u) => u.enemyType === "panzer")!;
    e.damage(pz, 9999, "at", null);
    expect(e.wrecks).toHaveLength(1);
    expect(e.wrecks[0].kind).toBe("panzer");
  });

  it("the player's Sherman blows up and wrecks too, with no Memorial entry", async () => {
    const e = await makeEngine(TOWN, SQUAD_WITH_RADIO, "", 8);
    e.begin();
    expect(e.radioLive()).toBe(true);
    expect(e.callTank()).toBe(true);
    const tank = e.units.find((u) => u.type === "tank" && u.alive)!;
    expect(tank).toBeDefined();
    e.damage(tank, 99999, "panzer", null);
    expect(tank.alive).toBe(false);
    expect(e.wrecks).toHaveLength(1);
    expect(e.wrecks[0].kind).toBe("tank");
    expect(e.wrecks[0].axis).toBe(false);
    expect(e.fallen).toHaveLength(0);
    for (let s = 0; s < 60 * 2; s++) e.update(1 / 60);
    expect(e.corpses.filter((c) => Math.hypot(c.x - tank.x, c.y - tank.y) < 30)).toHaveLength(0);
  });
});
