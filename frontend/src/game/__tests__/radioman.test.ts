// @vitest-environment node
// Radioman: he carries the radio, and radio support (reinforcements)
// only works while a squad radioman is alive. If he dies, the radio
// is down until you hire another one. His Rally Call lifts nearby
// morale over the radio.
import { describe, expect, it } from "vitest";
import { UNIT_TYPES } from "../data";

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
const TWO_RADIO = [
  man("s1", "Boyd", "rifleman"),
  man("s2", "Kowalski", "medic"),
  man("s3", "O'Neil", "radioman"),
  man("s4", "Dawson", "radioman"),
  man("s5", "Novak", "sniper"),
] as never;

type U = Record<string, unknown> & {
  x: number; y: number; hp: number; maxHp: number; morale: number; broken: boolean;
  suppression: number; lastHitT: number; side: string; npc: boolean; type: string;
  name: string; abilityCd: number;
};
type Hud = Record<string, unknown> & { radioLive: boolean; log: Array<{ text: string }> };
type AnyEngine = Record<string, unknown> & {
  units: U[];
  update: (dt: number) => void;
  damage: (u: U, dmg: number, source: string, killer: number | null) => void;
  radioLive: () => boolean;
  canReinforce: () => boolean;
  spawnReinforcements: (kind: string) => void;
  reinforcements: number;
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
  return {
    e,
    hud: () => {
      e.emitHud();
      return hud as unknown as Hud;
    },
  };
}

describe("radioman", () => {
  it("the radioman is a hireable role: 150 RP, radio blurb", () => {
    const spec = UNIT_TYPES.radioman;
    expect(spec).toBeDefined();
    expect(spec.cost).toBe(150);
    expect(spec.label).toBe("Radioman");
    expect(spec.blurb).toMatch(/No radioman, no reinforcements/);
    expect(spec.ability.name).toBe("Rally Call");
  });

  it("no radioman, no radio support", async () => {
    const { e, hud } = await makeEngine(STANDARD);
    expect(e.radioLive()).toBe(false);
    expect(e.canReinforce()).toBe(false);
    e.spawnReinforcements("rifle");
    expect(e.reinforcements).toBe(0);
    expect(hud().radioLive).toBe(false);
  });

  it("a radioman puts the radio up and reinforcements work", async () => {
    const { e, hud } = await makeEngine(WITH_RADIO);
    expect(e.radioLive()).toBe(true);
    expect(e.canReinforce()).toBe(true);
    e.spawnReinforcements("rifle");
    expect(e.reinforcements).toBe(1);
    expect(e.units.filter((u) => u.npc && u.side === "allies").length).toBeGreaterThanOrEqual(3);
    expect(hud().radioLive).toBe(true);
  });

  it("when the radioman dies the radio dies with him", async () => {
    const { e, hud } = await makeEngine(WITH_RADIO);
    const radio = e.units.find((u) => u.type === "radioman")!;
    e.damage(radio, 999, "rifle", null);
    expect(radio.alive).toBe(false);
    expect(e.radioLive()).toBe(false);
    expect(e.canReinforce()).toBe(false);
    expect(hud().log.map((l) => l.text).join(" ")).toMatch(/Radio is down/);
  });

  it("a second radioman keeps the net up after the first dies", async () => {
    const { e } = await makeEngine(TWO_RADIO);
    const radios = e.units.filter((u) => u.type === "radioman");
    expect(radios.length).toBe(2);
    e.damage(radios[0], 999, "rifle", null);
    expect(e.radioLive()).toBe(true);
    expect(e.canReinforce()).toBe(true);
    e.damage(radios[1], 999, "rifle", null);
    expect(e.radioLive()).toBe(false);
  });

  it("Rally Call lifts nearby morale over the radio", async () => {
    const { e } = await makeEngine(WITH_RADIO);
    const radio = e.units.find((u) => u.type === "radioman")!;
    const mate = e.units.find((u) => u.type === "rifleman")!;
    // Stand them together and shake the rifleman's nerve.
    radio.x = 200; radio.y = 600; mate.x = 210; mate.y = 600; mate.morale = 50;
    const cast = e as unknown as { castAuto: (u: U) => void };
    cast.castAuto(radio);
    expect(mate.morale).toBe(65);
    expect(radio.abilityCd).toBeGreaterThan(0);
  });

  it("Rally Call does not spend its cooldown when nobody needs rallying", async () => {
    const { e } = await makeEngine(WITH_RADIO);
    const radio = e.units.find((u) => u.type === "radioman")!;
    for (const u of e.units) if (u.side === "allies") u.morale = 100;
    const cast = e as unknown as { castAuto: (u: U) => void };
    cast.castAuto(radio);
    expect(radio.abilityCd).toBe(0);
  });
});
