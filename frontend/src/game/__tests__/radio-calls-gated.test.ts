// @vitest-environment node
// Radio calls, one per commander level (2nd Lt. to Maj. Gen., 8 ranks):
// Rally Call 1, reinforcements 2, supply drop 3, air recon 4, mortar
// strike 5, smoke screen 6, artillery 7, tank support 8. Every call
// needs a living radioman on top of its level.
import { describe, expect, it } from "vitest";
import { RADIO_CALL_LEVEL, MORTAR_CD, MORTAR_DMG, MORTAR_AOE, SMOKE_CD, SMOKE_RADIUS, SMOKE_DURATION } from "../engine";

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

const man = (id: string, name: string, type: string) => ({
  id, name, rank: "Pvt", level: 1, type, hp: 100, kills: 0, medals: [],
});
const WITH_RADIO = [
  man("s1", "Boyd", "rifleman"),
  man("s2", "Kowalski", "medic"),
  man("s3", "Reyes", "mg"),
  man("s4", "Novak", "sniper"),
  man("s5", "O'Neil", "radioman"),
] as never;
const STANDARD = [
  man("s1", "Boyd", "rifleman"),
  man("s2", "Kowalski", "medic"),
  man("s3", "Reyes", "mg"),
  man("s4", "Novak", "sniper"),
  man("s5", "Hale", "at"),
] as never;

type U = Record<string, unknown> & {
  x: number; y: number; hp: number; maxHp: number; morale: number; broken: boolean;
  suppression: number; lastHitT: number; side: string; npc: boolean; type: string;
  name: string; abilityCd: number; id: number; kills: number; vehicle: boolean;
};
type Hud = Record<string, unknown> & {
  radioLive: boolean;
  supportCd: { artillery: number; supply: number; recon: number; mortar: number; smoke: number; tank: number };
  tankUsed: boolean;
  log: Array<{ text: string }>;
};
type AnyEngine = Record<string, unknown> & {
  units: U[];
  update: (dt: number) => void;
  damage: (u: U, dmg: number, source: string, killer: number | null) => void;
  radioLive: () => boolean;
  canReinforce: () => boolean;
  spawnReinforcements: (kind: string) => void;
  reinforcements: number;
  callArtillery: () => boolean;
  callSupplyDrop: () => boolean;
  callRecon: () => boolean;
  callMortarStrike: () => boolean;
  callSmokeScreen: () => boolean;
  callTank: () => boolean;
  projectiles: Array<Record<string, unknown>>;
  smokeZones: Array<{ x: number; y: number; r: number; t: number }>;
  los: (a: U, b: U) => boolean;
  emitHud: () => void;
};

async function makeEngine(squad: unknown, commanderLevel = 1) {
  const { GameEngine } = await loadEngine();
  let hud: Hud | null = null;
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, (h: Hud) => {
    hud = h;
  });
  engine.setup(MISSION as never, squad as never, 0, "", commanderLevel);
  engine.begin();
  const e = engine as unknown as AnyEngine;
  (e as unknown as { fleeChance: number }).fleeChance = 0;
  (e as unknown as { fleeChanceNormal: number }).fleeChanceNormal = 0;
  return {
    e,
    hud: () => {
      e.emitHud();
      return hud as unknown as Hud;
    },
  };
}

function step(e: AnyEngine, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) e.update(1 / 60);
}

function park(e: AnyEngine) {
  for (const u of e.units) {
    if (u.side === "allies") { u.x = 200; u.y = 600; }
    else { u.x = 2100; u.y = 600; }
    (u as Record<string, unknown>).speed = 0;
    (u as Record<string, unknown>).range = 0;
  }
}

describe("radio calls gated by commander level", () => {
  it("one level per call, in order: rally 1, reinforce 2, supply 3, recon 4, mortar 5, smoke 6, artillery 7, tank 8", () => {
    expect(RADIO_CALL_LEVEL).toEqual({
      rally: 1, reinforce: 2, supply: 3, recon: 4, mortar: 5, smoke: 6, artillery: 7, tank: 8,
    });
  });

  it("level 1: Rally Call works, everything else is locked", async () => {
    const { e } = await makeEngine(WITH_RADIO, 1);
    park(e);
    const radio = e.units.find((u) => u.type === "radioman")!;
    const boyd = e.units.find((u) => u.name === "Boyd")!;
    boyd.morale = 50;
    (e as unknown as { castAuto: (u: U) => void }).castAuto(radio);
    expect(boyd.morale).toBeGreaterThan(50);
    expect(e.canReinforce()).toBe(false);
    expect(e.callSupplyDrop()).toBe(false);
    expect(e.callRecon()).toBe(false);
    expect(e.callMortarStrike()).toBe(false);
    expect(e.callSmokeScreen()).toBe(false);
    expect(e.callArtillery()).toBe(false);
    expect(e.callTank()).toBe(false);
  });

  it("each level unlocks its call and nothing above it", async () => {
    const checks: Array<[number, string, (e: AnyEngine) => boolean]> = [
      [2, "reinforce", (e) => e.canReinforce()],
      [3, "supply", (e) => { const b = e.units.find((u) => u.name === "Boyd")!; b.hp = 40; return e.callSupplyDrop(); }],
      [4, "recon", (e) => e.callRecon()],
      [5, "mortar", (e) => e.callMortarStrike()],
      [6, "smoke", (e) => e.callSmokeScreen()],
      [7, "artillery", (e) => e.callArtillery()],
      [8, "tank", (e) => e.callTank()],
    ];
    for (const [level, name, call] of checks) {
      const below = await makeEngine(WITH_RADIO, level - 1);
      park(below.e);
      expect(call(below.e), `${name} must be locked at level ${level - 1}`).toBe(false);
      const at = await makeEngine(WITH_RADIO, level);
      park(at.e);
      expect(call(at.e), `${name} must unlock at level ${level}`).toBe(true);
    }
  });

  it("mortar strike fires 1 shell, 25s cooldown, kills credit to the radioman", async () => {
    const { e, hud } = await makeEngine(WITH_RADIO, 5);
    park(e);
    const axis = e.units.filter((u) => u.side === "axis");
    const farSpots: Array<[number, number]> = [[2800, 1000], [2800, 200], [2800, 600], [2600, 1000], [2400, 1200]];
    axis.forEach((u, i) => {
      if (i < 3) { u.x = 2000 + i * 10; u.y = 600; u.hp = 10; }
      else { [u.x, u.y] = farSpots[(i - 3) % farSpots.length]; }
      (u as Record<string, unknown>).speed = 0;
      (u as Record<string, unknown>).range = 0;
    });
    const radio = e.units.find((u) => u.type === "radioman")!;
    expect(e.callMortarStrike()).toBe(true);
    expect(e.projectiles.length).toBe(1);
    expect(e.projectiles[0].dmg).toBe(MORTAR_DMG);
    expect(e.projectiles[0].aoe).toBe(MORTAR_AOE);
    expect(e.projectiles[0].killerId).toBe(radio.id);
    expect(hud().supportCd.mortar).toBe(MORTAR_CD);
    expect(e.callMortarStrike()).toBe(false);
    step(e, 5);
    expect(radio.kills).toBeGreaterThanOrEqual(1);
  });

  it("smoke blocks line of sight, then clears after 20s", async () => {
    const { e, hud } = await makeEngine(WITH_RADIO, 6);
    park(e);
    const ally = e.units.find((u) => u.side === "allies" && u.type === "rifleman")!;
    const enemy = e.units.find((u) => u.side === "axis")!;
    // The enemy stands just outside the smoke, due south of the squad
    // in the open deployment strip, so the line of sight is clear
    // before the smoke goes up.
    enemy.x = 200; enemy.y = 800;
    (enemy as Record<string, unknown>).speed = 0;
    (enemy as Record<string, unknown>).range = 0;
    // No smoke yet: clear sight across the open ground.
    expect(e.los(ally, enemy)).toBe(true);
    expect(e.callSmokeScreen()).toBe(true);
    expect(e.smokeZones.length).toBe(1);
    expect(e.smokeZones[0].r).toBe(SMOKE_RADIUS);
    expect(e.smokeZones[0].t).toBeCloseTo(SMOKE_DURATION, 5);
    expect(hud().supportCd.smoke).toBe(SMOKE_CD);
    // The ally stands in the smoke, the enemy outside: no sight either way.
    expect(e.los(ally, enemy)).toBe(false);
    expect(e.los(enemy, ally)).toBe(false);
    step(e, 21);
    expect(e.smokeZones.length).toBe(0);
    expect(e.los(ally, enemy)).toBe(true);
  });

  it("smoke needs the radio and level 6", async () => {
    const { e } = await makeEngine(STANDARD, 6);
    park(e);
    expect(e.callSmokeScreen()).toBe(false);
    const { e: e2 } = await makeEngine(WITH_RADIO, 5);
    park(e2);
    expect(e2.callSmokeScreen()).toBe(false);
  });

  it("tank support rolls in once per battle, has no morale, and is level 8 only", async () => {
    const { e, hud } = await makeEngine(WITH_RADIO, 8);
    park(e);
    expect(e.callTank()).toBe(true);
    expect(hud().tankUsed).toBe(true);
    const tank = e.units.find((u) => u.type === "tank")!;
    expect(tank.name).toBe("M4 Sherman");
    expect(tank.vehicle).toBe(true);
    expect(tank.hp).toBe(500);
    expect(tank.side).toBe("allies");
    expect(tank.npc).toBe(true);
    // A tank has no nerve to lose: heavy damage leaves morale at 100.
    e.damage(tank, 200, "rifle", null);
    expect(tank.hp).toBe(300);
    expect(tank.morale).toBe(100);
    expect(tank.broken).toBe(false);
    expect(e.callTank()).toBe(false);
    expect(e.units.filter((u) => u.type === "tank").length).toBe(1);
    const { e: e2 } = await makeEngine(WITH_RADIO, 7);
    park(e2);
    expect(e2.callTank()).toBe(false);
    const { e: e3 } = await makeEngine(STANDARD, 8);
    park(e3);
    expect(e3.callTank()).toBe(false);
  });
});
