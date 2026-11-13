// @vitest-environment node
// Medics on both sides: the player's medic already heals, and each
// enemy wave now carries one Sanitaeter who heals his own wounded
// men with the same aura and triage patch-up.
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

type U = Record<string, unknown> & { x: number; y: number; hp: number; maxHp: number };
type AnyEngine = Record<string, unknown> & {
  units: U[];
  update: (dt: number) => void;
};

async function makeEngine() {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {});
  engine.setup(MISSION as never, SQUAD as never, 0, "");
  engine.begin();
  return engine as unknown as AnyEngine;
}

function disarmEnemy(e: AnyEngine) {
  for (const u of e.units) {
    if (u.side === "axis") (u as Record<string, unknown>).range = 0;
  }
}

function step(e: AnyEngine, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) e.update(1 / 60);
}

describe("medics on both sides", () => {
  it("an enemy medic spawns with the wave", async () => {
    const e = await makeEngine();
    const medics = e.units.filter((u) => u.side === "axis" && u.enemyType === "medic");
    expect(medics).toHaveLength(1);
    expect(medics[0].hp).toBe(80);
  });

  it("an enemy medic's aura mends a wounded man nearby", async () => {
    const e = await makeEngine();
    const medic = e.units.find((u) => u.side === "axis" && u.enemyType === "medic")!;
    const hurt = e.units.find((u) => u.side === "axis" && u.enemyType === "grenadier")!;
    medic.x = 1500; medic.y = 600;
    hurt.x = 1550; hurt.y = 600;
    hurt.hp = 20;
    (medic as Record<string, unknown>).abilityCd = 10; // triage on cooldown: aura only
    const healedBefore = (medic as Record<string, unknown>).healed as number;
    step(e, 5);
    expect(hurt.hp).toBeGreaterThan(20);
    expect((medic as Record<string, unknown>).healed as number).toBeGreaterThan(healedBefore);
  });

  it("an enemy medic triages the worst-wounded man for +50 HP", async () => {
    const e = await makeEngine();
    const medic = e.units.find((u) => u.side === "axis" && u.enemyType === "medic")!;
    const hurt = e.units.find((u) => u.side === "axis" && u.enemyType === "grenadier")!;
    medic.x = 1500; medic.y = 600;
    hurt.x = 1550; hurt.y = 600;
    hurt.hp = 20;
    (medic as Record<string, unknown>).abilityCd = 0;
    step(e, 1);
    expect(hurt.hp).toBeGreaterThanOrEqual(70); // 20 + 50 triage (plus a little aura)
    expect((medic as Record<string, unknown>).abilityCd as number).toBeGreaterThan(0);
  });

  it("an enemy medic moves toward a wounded man out of aura range", async () => {
    const e = await makeEngine();
    const medic = e.units.find((u) => u.side === "axis" && u.enemyType === "medic")!;
    const hurt = e.units.find((u) => u.side === "axis" && u.enemyType === "mg42")!; // static: will not move itself
    medic.x = 1800; medic.y = 600;
    hurt.x = 1500; hurt.y = 600;
    hurt.hp = 100; // 100/280, the worst hurt in the wave
    const startDist = Math.hypot(medic.x - hurt.x, medic.y - hurt.y);
    step(e, 8);
    const endDist = Math.hypot(medic.x - hurt.x, medic.y - hurt.y);
    expect(endDist).toBeLessThan(startDist - 50);
    expect(endDist).toBeLessThan(200);
  });

  it("2nd Platoon has 12 NPCs with a medic in each squad", async () => {
    const e = await makeEngine();
    const npcs = e.units.filter((u) => u.side === "allies" && u.npc);
    expect(npcs).toHaveLength(12);
    // Squads of 8 + 4 (Josh, 2026-11-12): each squad carries its
    // own medic, so the platoon fields two, not one.
    const medics = npcs.filter((u) => u.type === "medic");
    expect(medics).toHaveLength(2);
    expect(npcs.filter((u) => u.type === "rifleman")).toHaveLength(6);
  });

  it("a 2nd Platoon medic's aura mends a wounded NPC nearby", async () => {
    const e = await makeEngine();
    disarmEnemy(e);
    const medic = e.units.find((u) => u.side === "allies" && u.npc && u.type === "medic")!;
    const hurt = e.units.find((u) => u.side === "allies" && u.npc && u.type === "rifleman")!;
    medic.x = 300; medic.y = 600;
    hurt.x = 340; hurt.y = 600;
    hurt.hp = 20;
    (medic as Record<string, unknown>).abilityCd = 10; // triage on cooldown: aura only
    step(e, 5);
    expect(hurt.hp).toBeGreaterThan(20);
  });

  it("a 2nd Platoon medic triages a wounded NPC for +50 HP", async () => {
    const e = await makeEngine();
    disarmEnemy(e);
    const medic = e.units.find((u) => u.side === "allies" && u.npc && u.type === "medic")!;
    const hurt = e.units.find((u) => u.side === "allies" && u.npc && u.type === "rifleman")!;
    medic.x = 300; medic.y = 600;
    hurt.x = 340; hurt.y = 600;
    hurt.hp = 20;
    (medic as Record<string, unknown>).abilityCd = 0;
    step(e, 1);
    expect(hurt.hp).toBeGreaterThanOrEqual(70);
    expect((medic as Record<string, unknown>).abilityCd as number).toBeGreaterThan(0);
  });

  it("a 2nd Platoon medic moves toward a wounded NPC out of aura range", async () => {
    const e = await makeEngine();
    const medic = e.units.find((u) => u.side === "allies" && u.npc && u.type === "medic")!;
    const hurt = e.units.find((u) => u.side === "allies" && u.npc && u.type === "rifleman")!;
    medic.x = 200; medic.y = 600;
    hurt.x = 500; hurt.y = 600;
    hurt.hp = 20; // worst hurt in the platoon
    (hurt as Record<string, unknown>).speed = 0; // hold the patient still so the test measures the medic, not a footrace
    // Keep the other NPCs healthy so the medic aims at this man.
    for (const u of e.units) {
      if (u.side === "allies" && u.npc && u !== hurt && u !== medic) u.hp = u.maxHp;
    }
    const startDist = Math.hypot(medic.x - hurt.x, medic.y - hurt.y);
    step(e, 8);
    const endDist = Math.hypot(medic.x - hurt.x, medic.y - hurt.y);
    expect(endDist).toBeLessThan(startDist - 50);
  });

  it("the player's medic aura mends a wounded squad man", async () => {
    const e = await makeEngine();
    disarmEnemy(e);
    const medic = e.units.find((u) => u.side === "allies" && !u.npc && u.type === "medic")!;
    const hurt = e.units.find((u) => u.side === "allies" && !u.npc && u.type === "rifleman")!;
    medic.x = 300; medic.y = 600;
    hurt.x = 340; hurt.y = 600;
    hurt.hp = 40;
    step(e, 5);
    expect(hurt.hp).toBeGreaterThan(40);
  });
});
