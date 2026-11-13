// @vitest-environment node
// Tank armour, turrets and reversing (Josh, 2026-11-13):
// small arms spark off a tank and do nothing — only tank
// guns, anti-tank weapons and explosives get through. A
// halftrack's lighter plate halves small-arms damage. A
// tank's turret traverses at its own rate and the gun only
// fires when lined up, and footmen crowding a tank inside
// 70 make it reverse away at 40% speed.
import { describe, expect, it } from "vitest";
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
  x: number; y: number; hp: number; maxHp: number; side: string; npc: boolean; type: string;
  enemyType: string | null; vehicle: boolean; alive: boolean; turret: number;
};
type AnyEngine = Record<string, unknown> & {
  units: U[];
  update: (dt: number) => void;
  callTank: () => boolean;
};

async function makeEngine() {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {});
  engine.setup({ ...baseMission, terrain: "town" } as never, SQUAD as never, 0, "", 8);
  engine.begin();
  const e = engine as unknown as AnyEngine;
  (e as unknown as { fleeChance: number }).fleeChance = 0;
  (e as unknown as { fleeChanceNormal: number }).fleeChanceNormal = 0;
  (e as unknown as { counterAttackT: number }).counterAttackT = 9999;
  return e;
}

function step(e: AnyEngine, seconds: number) {
  for (let i = 0; i < seconds * 60; i++) e.update(1 / 60);
}

function spawn(e: AnyEngine, type: string, x: number, y: number): U {
  const fn = (e as unknown as {
    spawnEnemyUnit: (t: string, x: number, y: number, rng: () => number) => void;
  }).spawnEnemyUnit;
  fn.call(e, type, x, y, Math.random);
  return e.units.filter((u) => u.enemyType === type).pop()!;
}

function hurt(e: AnyEngine, u: U, dmg: number, sourceType: string) {
  const fn = (e as unknown as {
    damage: (u: U, dmg: number, s: string, k: null) => void;
  }).damage;
  fn.call(e, u, dmg, sourceType, null);
}

/** Park every allied unit but one far to the west, so a
 * spawned vehicle has exactly one man to care about. */
function isolate(e: AnyEngine, keep: U) {
  for (const u of e.units) {
    if (u.side === "allies" && u !== keep) { u.x = 70; u.y = 200; }
    if (u.side === "axis" && !u.vehicle) { u.x = MAP_W - 70; u.y = 200; }
  }
}

describe("tank armour", () => {
  it("small arms do nothing to a panzer, whatever the dose", async () => {
    const e = await makeEngine();
    const pz = spawn(e, "panzer", 2000, 675);
    hurt(e, pz, 60, "volks");
    hurt(e, pz, 60, "mg42");
    hurt(e, pz, 9999, "grenadier");
    hurt(e, pz, 40, "sniper");
    expect(pz.hp).toBe(400);
    expect(pz.alive).toBe(true);
  });

  it("tank guns, anti-tank weapons and explosives get through", async () => {
    const e = await makeEngine();
    const pz = spawn(e, "panzer", 2000, 675);
    hurt(e, pz, 60, "at");
    expect(pz.hp).toBe(340);
    hurt(e, pz, 60, "panzer");
    expect(pz.hp).toBe(280);
    hurt(e, pz, 60, "rocket");
    expect(pz.hp).toBe(220);
    hurt(e, pz, 60, "artillery");
    expect(pz.hp).toBe(160);
    hurt(e, pz, 60, "mortar");
    expect(pz.hp).toBe(100);
    hurt(e, pz, 60, "tank");
    expect(pz.hp).toBe(40);
    hurt(e, pz, 60, "mine");
    expect(pz.alive).toBe(false);
  });

  it("a halftrack's lighter plate halves small arms, no more", async () => {
    const e = await makeEngine();
    const half = spawn(e, "halftrack", 2000, 675);
    hurt(e, half, 51, "volks");
    expect(half.hp).toBe(195); // floor(51 / 2) = 25 through
    hurt(e, half, 7, "mg42");
    expect(half.hp).toBe(192); // floor(7 / 2) = 3 through
    hurt(e, half, 40, "tank");
    expect(half.hp).toBe(152); // a tank gun goes through whole
    hurt(e, half, 30, "rifleman");
    expect(half.hp).toBe(137);
  });

  it("the Sherman shrugs off rifles and fears the panzerfaust", async () => {
    const e = await makeEngine();
    expect(e.callTank()).toBe(true);
    const tank = e.units.find((u) => u.type === "tank")!;
    hurt(e, tank, 80, "grenadier");
    hurt(e, tank, 80, "mg42");
    expect(tank.hp).toBe(500);
    hurt(e, tank, 80, "panzerfaust");
    expect(tank.hp).toBe(420);
    hurt(e, tank, 80, "mortar");
    expect(tank.hp).toBe(340);
    hurt(e, tank, 80, "panzer");
    expect(tank.hp).toBe(260);
  });
});

describe("turrets and reversing", () => {
  it("a panzer cannot fire until its turret has traversed onto the target", { timeout: 30000 }, async () => {
    const e = await makeEngine();
    const pz = spawn(e, "panzer", 2000, 675);
    const man = e.units.find((u) => u.side === "allies" && !u.npc && u.type === "rifleman")!;
    isolate(e, man);
    man.x = 1850;
    man.y = 675;
    man.hp = 100000;
    man.maxHp = 100000;
    // Turret pointing east, target due west: a full swing.
    pz.turret = 0;
    step(e, 1.5);
    // Halfway through the swing the gun has not spoken, but
    // the turret is most of the way round (1.1 rad/s). The
    // remaining angle is measured the short way round: the
    // target sits a hair off due west, so the turret may
    // swing through -PI instead of +PI.
    expect(man.hp).toBe(100000);
    const want = Math.atan2(man.y - pz.y, man.x - pz.x);
    let remaining = (want - pz.turret) % (Math.PI * 2);
    if (remaining > Math.PI) remaining -= Math.PI * 2;
    if (remaining < -Math.PI) remaining += Math.PI * 2;
    expect(Math.abs(remaining)).toBeLessThan(1.9);
    step(e, 6);
    // Lined up, the 75mm speaks and the man feels it.
    expect(man.hp).toBeLessThan(100000);
    expect(pz.alive).toBe(true); // his rifle never scratched it
  });

  it("footmen crowding a panzer inside 70 make it reverse", { timeout: 30000 }, async () => {
    const e = await makeEngine();
    const pz = spawn(e, "panzer", 2000, 675);
    const man = e.units.find((u) => u.side === "allies" && !u.npc && u.type === "rifleman")!;
    isolate(e, man);
    man.x = 1950;
    man.y = 675;
    man.hp = 100000;
    man.maxHp = 100000;
    const before = Math.hypot(pz.x - man.x, pz.y - man.y);
    step(e, 2);
    const after = Math.hypot(pz.x - man.x, pz.y - man.y);
    expect(after).toBeGreaterThan(before + 10);
  });

  it("the Sherman backs down the road when footmen crowd it, and their fire sparks off", { timeout: 30000 }, async () => {
    const e = await makeEngine();
    expect(e.callTank()).toBe(true);
    const tank = e.units.find((u) => u.type === "tank")!;
    const volks = e.units.find((u) => u.side === "axis" && u.enemyType === "volks")!;
    for (const u of e.units) {
      if (u.side === "axis" && u !== volks) { u.x = MAP_W - 70; u.y = 200; }
      if (u.side === "allies" && u !== tank) { u.x = 70; u.y = 1150; }
    }
    volks.x = tank.x + 50;
    volks.y = tank.y;
    volks.hp = 100000;
    volks.maxHp = 100000;
    const startX = tank.x;
    step(e, 2);
    expect(tank.x).toBeLessThan(startX - 12);
    expect(tank.hp).toBe(500); // two seconds of point-blank rifle fire: nothing
  });
});
