// @vitest-environment node
// Radio call costs scale with the radioman's level: a rookie (level 0)
// pays the full base cost, a veteran (level 6) pays 30% less (5% per
// level). The backend charges the same price (same formula, same
// rounding), so the menu's number is the number the backend takes.
import { describe, expect, it } from "vitest";
import { radioCost, RADIO_SUPPORT_COST } from "../engine";

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

const man = (id: string, name: string, type: string, level = 1) => ({
  id, name, rank: "Pvt", level, type, hp: 100, kills: 0, medals: [],
});
const squadWithRadio = (radioLevel: number) => [
  man("s1", "Boyd", "rifleman"),
  man("s2", "Kowalski", "medic"),
  man("s3", "Reyes", "mg"),
  man("s4", "Novak", "sniper"),
  man("s5", "O'Neil", "radioman", radioLevel),
] as never;
const STANDARD = [
  man("s1", "Boyd", "rifleman"),
  man("s2", "Kowalski", "medic"),
  man("s3", "Reyes", "mg"),
  man("s4", "Novak", "sniper"),
  man("s5", "Hale", "at"),
] as never;

type U = Record<string, unknown> & {
  x: number; y: number; hp: number; morale: number; side: string; npc: boolean; type: string;
  name: string; level: number; id: number; kills: number;
};
type Hud = Record<string, unknown> & {
  supportCost: Record<string, number>;
  reinforceCost: { rifle: number; heavy: number };
};
type AnyEngine = Record<string, unknown> & {
  units: U[];
  update: (dt: number) => void;
  radiomanLevel: () => number;
  supportCost: (kind: string) => number;
  reinforceCost: (kind: string) => number;
  canSupport: (kind: string) => boolean;
  callArtillery: () => boolean;
  callSupplyDrop: () => boolean;
  emitHud: () => void;
};

async function makeEngine(squad: unknown, commanderLevel = 8) {
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

describe("radio call costs scale with the radioman's level", () => {
  it("base costs: supply 10, recon 10, mortar 20, smoke 15, artillery 30, tank 50", () => {
    expect(RADIO_SUPPORT_COST).toEqual({ supply: 10, recon: 10, mortar: 20, smoke: 15, artillery: 30, tank: 50 });
  });

  it("radioCost: 5% off per level, max 30% off at level 6", () => {
    expect(radioCost(30, 0)).toBe(30);
    expect(radioCost(30, 1)).toBe(29);
    expect(radioCost(30, 2)).toBe(27);
    expect(radioCost(30, 6)).toBe(21);
    expect(radioCost(50, 6)).toBe(35);
    expect(radioCost(10, 6)).toBe(7);
    expect(radioCost(15, 6)).toBe(11);
    expect(radioCost(25, 6)).toBe(18);
  });

  it("radiomanLevel is the highest level among the living deployed radiomen", async () => {
    const { e } = await makeEngine(squadWithRadio(3));
    expect(e.radiomanLevel()).toBe(3);
    const { e: e0 } = await makeEngine(squadWithRadio(0));
    expect(e0.radiomanLevel()).toBe(0);
    const { e: eNone } = await makeEngine(STANDARD);
    expect(eNone.radiomanLevel()).toBe(0);
    // Two radiomen: the higher level sets the price.
    const two = [
      man("s1", "Boyd", "rifleman"),
      man("s2", "Kowalski", "medic"),
      man("s3", "Reyes", "mg"),
      man("s4", "Novak", "sniper"),
      man("s5", "O'Neil", "radioman", 2),
      man("s6", "Voss", "radioman", 5),
    ] as never;
    const { e: e2 } = await makeEngine(two);
    expect(e2.radiomanLevel()).toBe(5);
  });

  it("supportCost follows the radioman's level, rookie pays full, veteran pays less", async () => {
    const { e } = await makeEngine(squadWithRadio(0));
    expect(e.supportCost("artillery")).toBe(30);
    expect(e.supportCost("tank")).toBe(50);
    expect(e.supportCost("supply")).toBe(10);
    const { e: eVet } = await makeEngine(squadWithRadio(6));
    expect(eVet.supportCost("artillery")).toBe(21);
    expect(eVet.supportCost("tank")).toBe(35);
    expect(eVet.supportCost("supply")).toBe(7);
  });

  it("reinforcement teams get the same discount", async () => {
    const { e } = await makeEngine(squadWithRadio(0));
    expect(e.reinforceCost("rifle")).toBe(15);
    expect(e.reinforceCost("heavy")).toBe(25);
    const { e: eVet } = await makeEngine(squadWithRadio(6));
    expect(eVet.reinforceCost("rifle")).toBe(11);
    expect(eVet.reinforceCost("heavy")).toBe(18);
  });

  it("canSupport is the gate check without firing: false on cooldown, locked, or radio down", async () => {
    const { e } = await makeEngine(squadWithRadio(1));
    expect(e.canSupport("artillery")).toBe(true);
    expect(e.callArtillery()).toBe(true);
    expect(e.canSupport("artillery")).toBe(false);
    const { e: eLow } = await makeEngine(squadWithRadio(1), 1);
    expect(eLow.canSupport("artillery")).toBe(false);
    expect(eLow.canSupport("supply")).toBe(false);
    const { e: eNone } = await makeEngine(STANDARD);
    expect(eNone.canSupport("artillery")).toBe(false);
    expect(eNone.canSupport("supply")).toBe(false);
  });

  it("the HUD reports the discounted costs", async () => {
    const { e, hud } = await makeEngine(squadWithRadio(6));
    expect(hud().supportCost).toEqual({ artillery: 21, supply: 7, recon: 7, mortar: 14, smoke: 11, tank: 35 });
    expect(hud().reinforceCost).toEqual({ rifle: 11, heavy: 18 });
    const { hud: hud0 } = await makeEngine(squadWithRadio(0));
    expect(hud0().supportCost).toEqual({ artillery: 30, supply: 10, recon: 10, mortar: 20, smoke: 15, tank: 50 });
    expect(hud0().reinforceCost).toEqual({ rifle: 15, heavy: 25 });
  });
});
