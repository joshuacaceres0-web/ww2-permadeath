// @vitest-environment node
// Radio support: a living radioman can call in more than reinforcements
// from the RADIO menu — artillery on the biggest enemy group, a supply
// drop for the worst-wounded man, and recon to lift the fog over the
// enemy. All three need the radio up, all three have a cooldown, and
// AUTO never calls them (player-called, like reinforcements).
import { describe, expect, it } from "vitest";
import { ARTILLERY_CD, SUPPLY_CD, RECON_CD, ARTY_SHELLS, ARTY_DMG, ARTY_AOE, SUPPLY_HEAL } from "../engine";

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
const STANDARD = [
  man("s1", "Boyd", "rifleman"),
  man("s2", "Kowalski", "medic"),
  man("s3", "Reyes", "mg"),
  man("s4", "Novak", "sniper"),
  man("s5", "Hale", "at"),
] as never;
const WITH_RADIO = [
  man("s1", "Boyd", "rifleman"),
  man("s2", "Kowalski", "medic"),
  man("s3", "Reyes", "mg"),
  man("s4", "Novak", "sniper"),
  man("s5", "O'Neil", "radioman"),
] as never;

type U = Record<string, unknown> & {
  x: number; y: number; hp: number; maxHp: number; morale: number; broken: boolean;
  suppression: number; lastHitT: number; side: string; npc: boolean; type: string;
  name: string; abilityCd: number; id: number; kills: number;
};
type Hud = Record<string, unknown> & {
  radioLive: boolean;
  supportCd: { artillery: number; supply: number; recon: number };
  log: Array<{ text: string }>;
};
type AnyEngine = Record<string, unknown> & {
  units: U[];
  update: (dt: number) => void;
  damage: (u: U, dmg: number, source: string, killer: number | null) => void;
  radioLive: () => boolean;
  callArtillery: () => boolean;
  callSupplyDrop: () => boolean;
  callRecon: () => boolean;
  projectiles: Array<Record<string, unknown>>;
  exploredAt: (x: number, y: number) => boolean;
  emitHud: () => void;
};

async function makeEngine(squad: unknown) {
  const { GameEngine } = await loadEngine();
  let hud: Hud | null = null;
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, (h: Hud) => {
    hud = h;
  });
  engine.setup(MISSION as never, squad as never, 0, "", 8);
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

/** Park everyone so the sim measures the support call alone: the squad
 * holds the west edge, the enemy holds still and cannot shoot. */
function park(e: AnyEngine) {
  for (const u of e.units) {
    if (u.side === "allies") { u.x = 200; u.y = 600; }
    else { u.x = 2100; u.y = 600; }
    (u as Record<string, unknown>).speed = 0;
    (u as Record<string, unknown>).range = 0;
  }
}

/** Three weak enemies in a tight cluster (the artillery target) and
 * the rest far away, all disarmed and still. */
function clusterEnemies(e: AnyEngine) {
  const axis = e.units.filter((u) => u.side === "axis");
  const farSpots: Array<[number, number]> = [[2800, 1000], [2800, 200], [2800, 600], [2600, 1000], [2400, 1200]];
  axis.forEach((u, i) => {
    if (i < 3) {
      u.x = 2000 + i * 10; u.y = 600 + (i % 2) * 10; u.hp = 10;
    } else {
      [u.x, u.y] = farSpots[(i - 3) % farSpots.length];
    }
    (u as Record<string, unknown>).speed = 0;
    (u as Record<string, unknown>).range = 0;
  });
  for (const u of e.units) {
    if (u.side === "allies") { u.x = 200; u.y = 600; (u as Record<string, unknown>).speed = 0; }
  }
}

describe("radio support", () => {
  it("artillery fires 3 shells on the densest cluster, then cools down 60s", async () => {
    const { e, hud } = await makeEngine(WITH_RADIO);
    park(e);
    clusterEnemies(e);
    expect(e.callArtillery()).toBe(true);
    expect(e.projectiles.length).toBe(ARTY_SHELLS);
    const radio = e.units.find((u) => u.type === "radioman")!;
    for (const p of e.projectiles) {
      expect(p.side).toBe("allies");
      expect(p.sourceType).toBe("mortar");
      expect(p.dmg).toBe(ARTY_DMG);
      expect(p.aoe).toBe(ARTY_AOE);
      expect(p.killerId).toBe(radio.id);
    }
    expect((e.projectiles[0].dur as number)).toBeCloseTo(2.4, 5);
    expect((e.projectiles[2].dur as number)).toBeCloseTo(4.0, 5);
    expect(hud().supportCd.artillery).toBe(ARTILLERY_CD);
    // Cooling down: a second call fires nothing.
    expect(e.callArtillery()).toBe(false);
    expect(e.projectiles.length).toBe(ARTY_SHELLS);
    step(e, 10);
    expect(hud().supportCd.artillery).toBeLessThanOrEqual(50);
    expect(hud().supportCd.artillery).toBeGreaterThan(0);
    step(e, 55);
    expect(hud().supportCd.artillery).toBe(0);
    expect(e.callArtillery()).toBe(true);
  }, 30000);

  it("artillery kills credit to the radioman (kill RP)", async () => {
    const { e } = await makeEngine(WITH_RADIO);
    park(e);
    clusterEnemies(e);
    const radio = e.units.find((u) => u.type === "radioman")!;
    expect(e.callArtillery()).toBe(true);
    step(e, 5);
    const dead = e.units.filter((u) => u.side === "axis" && !u.alive);
    expect(dead.length).toBeGreaterThanOrEqual(3);
    expect(radio.kills).toBeGreaterThanOrEqual(3);
  });

  it("no radioman, no artillery — and a dead radioman ends it too", async () => {
    const { e } = await makeEngine(STANDARD);
    park(e);
    expect(e.callArtillery()).toBe(false);
    expect(e.projectiles.length).toBe(0);
    const { e: e2 } = await makeEngine(WITH_RADIO);
    park(e2);
    const radio = e2.units.find((u) => u.type === "radioman")!;
    e2.damage(radio, 999, "rifle", null);
    expect(e2.radioLive()).toBe(false);
    expect(e2.callArtillery()).toBe(false);
    expect(e2.projectiles.length).toBe(0);
  });

  it("supply drop heals the worst-wounded man +50, 45s cooldown", async () => {
    const { e, hud } = await makeEngine(WITH_RADIO);
    park(e);
    const boyd = e.units.find((u) => u.name === "Boyd")!;
    boyd.hp = 40;
    expect(e.callSupplyDrop()).toBe(true);
    expect(boyd.hp).toBe(40 + SUPPLY_HEAL);
    expect(hud().supportCd.supply).toBe(SUPPLY_CD);
    expect(e.callSupplyDrop()).toBe(false);
    expect(boyd.hp).toBe(40 + SUPPLY_HEAL);
    step(e, 45);
    expect(hud().supportCd.supply).toBe(0);
  }, 30000);

  it("supply drop spends nothing when nobody is hurt, and needs the radio", async () => {
    const { e, hud } = await makeEngine(WITH_RADIO);
    park(e);
    expect(e.callSupplyDrop()).toBe(false);
    expect(hud().supportCd.supply).toBe(0);
    const { e: e2 } = await makeEngine(STANDARD);
    park(e2);
    const boyd = e2.units.find((u) => u.name === "Boyd")!;
    boyd.hp = 40;
    expect(e2.callSupplyDrop()).toBe(false);
    expect(boyd.hp).toBe(40);
  });

  it("recon lifts the fog over the enemy cluster, 30s cooldown", async () => {
    const { e, hud } = await makeEngine(WITH_RADIO);
    park(e);
    clusterEnemies(e);
    expect(e.exploredAt(2000, 600)).toBe(false);
    expect(e.exploredAt(2800, 1200)).toBe(false);
    expect(e.callRecon()).toBe(true);
    expect(e.exploredAt(2000, 600)).toBe(true);
    expect(e.exploredAt(2800, 1200)).toBe(false);
    expect(hud().supportCd.recon).toBe(RECON_CD);
    expect(e.callRecon()).toBe(false);
    step(e, 30);
    expect(hud().supportCd.recon).toBe(0);
  }, 30000);

  it("recon needs the radio", async () => {
    const { e } = await makeEngine(STANDARD);
    park(e);
    expect(e.callRecon()).toBe(false);
  });

  it("the HUD reports all six cooldowns", async () => {
    const { e, hud } = await makeEngine(WITH_RADIO);
    park(e);
    expect(hud().supportCd).toEqual({ artillery: 0, supply: 0, recon: 0, mortar: 0, smoke: 0, tank: 0 });
    e.callArtillery();
    expect(hud().supportCd.artillery).toBe(ARTILLERY_CD);
    expect(hud().supportCd.supply).toBe(0);
    expect(hud().supportCd.recon).toBe(0);
  });
});
