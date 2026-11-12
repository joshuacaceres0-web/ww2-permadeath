// @vitest-environment node
// Enemy tanks, random counter-attacks, and camp-and-defend enemy AI.
// The enemy holds its ground until it spots a player unit, then it
// engages. A counter-attack is a surprise push of 2 men who charge the
// player's squad, ignoring the camp rule. Same gritty 16-bit pixel art
// — the Panzer is German gray, the Sherman is Allied olive.
import { describe, expect, it } from "vitest";
import { ENEMY_TYPES } from "../data";
import { MAP_W } from "../engine";

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

const man = (id: string, name: string, type: string, level = 1) => ({
  id, name, rank: "Pvt", level, type, hp: 100, kills: 0, medals: [],
});
const SQUAD = [
  man("s1", "Boyd", "rifleman"),
  man("s2", "Kowalski", "medic"),
  man("s3", "Reyes", "mg"),
  man("s4", "Novak", "sniper"),
  man("s5", "O'Neil", "radioman"),
] as never;

type U = Record<string, unknown> & {
  x: number; y: number; hp: number; side: string; npc: boolean; type: string; enemyType: string | null;
  vehicle: boolean; alive: boolean; counterAttack: boolean; vision: number;
};
type AnyEngine = Record<string, unknown> & {
  units: U[];
  update: (dt: number) => void;
  enemiesAlive: () => number;
};

async function makeEngine(terrain = "town", commanderLevel = 8) {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {});
  engine.setup({ ...baseMission, terrain } as never, SQUAD as never, 0, "", commanderLevel);
  engine.begin();
  const e = engine as unknown as AnyEngine;
  (e as unknown as { fleeChance: number }).fleeChance = 0;
  (e as unknown as { fleeChanceNormal: number }).fleeChanceNormal = 0;
  // No counter-attacks unless a test forces the timer.
  (e as unknown as { counterAttackT: number }).counterAttackT = 9999;
  return e;
}

function step(e: AnyEngine, seconds: number) {
  for (let i = 0; i < seconds * 60; i++) e.update(1 / 60);
}

describe("enemy tanks", () => {
  it("the Panzer IV is a vehicle: 400 HP, 75mm cannon, no morale to break", () => {
    const pz = ENEMY_TYPES.panzer;
    expect(pz.label).toBe("Panzer IV Medium Tank");
    expect(pz.hp).toBe(400);
    expect(pz.vehicle).toBe(true);
    expect(pz.speed).toBe(30);
    expect(pz.range).toBe(300);
    expect(pz.threat).toBe("HIGH");
  });

  it("the engine spawns a Panzer as a living vehicle", async () => {
    const e = await makeEngine();
    const spawn = (e as unknown as {
      spawnEnemyUnit: (t: string, x: number, y: number, rng: () => number) => void;
    }).spawnEnemyUnit;
    spawn.call(e, "panzer", MAP_W - 100, 675, Math.random);
    const pz = e.units.find((u) => u.enemyType === "panzer");
    expect(pz).toBeDefined();
    expect(pz!.vehicle).toBe(true);
    expect(pz!.hp).toBe(400);
    expect(pz!.side).toBe("axis");
    expect(pz!.alive).toBe(true);
  });
});

describe("camp and defend", () => {
  it("enemies hold their ground until they spot a player unit", { timeout: 30000 }, async () => {
    const e = await makeEngine();
    const foes = () => e.units.filter((u) => u.side === "axis" && u.alive && !u.isStatic);
    const startX = foes().map((u) => u.x);
    expect(startX.length).toBeGreaterThan(0);
    expect(Math.min(...startX)).toBeGreaterThan(3600);
    step(e, 10);
    // Ten seconds in, the squad is still ~3800 units away (far beyond
    // the 240 vision), so the enemy has spotted nobody and has not
    // advanced: every living mobile enemy is still near the east edge.
    const after = foes();
    expect(after.length).toBeGreaterThan(0);
    for (const u of after) {
      expect(u.x, `enemy ${u.enemyType} advanced to ${Math.round(u.x)}`).toBeGreaterThan(3500);
    }
  });

  it("once a player unit is spotted, the enemy engages and advances", { timeout: 30000 }, async () => {
    const e = await makeEngine();
    // A fighting man, not a medic (a medic's prey is a wounded ally,
    // not the player) and not a static nest.
    const foe = e.units.find((u) => u.side === "axis" && u.alive && !u.isStatic && u.enemyType !== "medic")!;
    const startX = foe.x;
    const scout = e.units.find((u) => u.side === "allies" && u.alive && !u.npc)!;
    // Walk a squad man into the enemy's vision. Try a few spots around
    // the foe until one has a clear line of sight (a building or
    // hedgerow can sit between two points on the town map).
    const los = (e as unknown as { los: (a: U, b: U) => boolean }).los;
    const spots: Array<[number, number]> = [
      [foe.x - 200, foe.y],
      [foe.x - 200, foe.y - 120],
      [foe.x - 200, foe.y + 120],
      [foe.x, foe.y - 200],
      [foe.x, foe.y + 200],
    ];
    let placed = false;
    for (const [sx, sy] of spots) {
      scout.x = sx;
      scout.y = sy;
      if (los.call(e, foe, scout)) {
        placed = true;
        break;
      }
    }
    expect(placed).toBe(true);
    step(e, 5);
    // The enemy spotted the scout and advanced toward him to get in range.
    expect(foe.x).toBeLessThan(startX - 15);
  });
});

describe("random counter-attacks", () => {
  it("when the timer fires, 2 men charge in from the east edge", { timeout: 30000 }, async () => {
    const e = await makeEngine();
    const before = e.units.length;
    (e as unknown as { counterAttackT: number }).counterAttackT = 0.1;
    (e as unknown as { counterAttacks: number }).counterAttacks = 0;
    step(e, 2);
    const attackers = e.units.filter((u) => u.counterAttack);
    expect(attackers.length).toBe(2);
    expect(e.units.length).toBe(before + 2);
    expect(attackers.every((u) => u.side === "axis" && u.alive)).toBe(true);
    expect(Math.min(...attackers.map((u) => u.x))).toBeGreaterThan(3600);
    // The timer reset for the next one, and the count went up.
    expect((e as unknown as { counterAttacks: number }).counterAttacks).toBe(1);
    expect((e as unknown as { counterAttackT: number }).counterAttackT).toBeGreaterThan(40);
  });

  it("a counter-attacker charges west even though the rest camp", { timeout: 30000 }, async () => {
    const e = await makeEngine();
    (e as unknown as { counterAttackT: number }).counterAttackT = 0.1;
    (e as unknown as { counterAttacks: number }).counterAttacks = 0;
    step(e, 2);
    const attacker = e.units.find((u) => u.counterAttack)!;
    const startX = attacker.x;
    step(e, 5);
    // It is charging the player's squad, so it moved west.
    expect(attacker.x).toBeLessThan(startX - 100);
  });

  it("at most 2 counter-attacks per battle", { timeout: 30000 }, async () => {
    const e = await makeEngine();
    (e as unknown as { counterAttacks: number }).counterAttacks = 2;
    (e as unknown as { counterAttackT: number }).counterAttackT = 0.1;
    const before = e.units.length;
    step(e, 3);
    expect(e.units.filter((u) => u.counterAttack).length).toBe(0);
    expect(e.units.length).toBe(before);
  });
});
