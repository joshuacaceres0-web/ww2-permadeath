// @vitest-environment node
// Enemy radioman: every wave carries one Funker. While he lives he
// rallies nearby men over the radio, and 25s into the wave he calls
// in 2 more men, once per wave. Kill him first and the wave gets no
// call-in — the mirror of the squad radioman rule.
import { describe, expect, it } from "vitest";
import { ENEMY_TYPES } from "../data";

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
    { type: "funk", wave: 1, count: 1 },
    { type: "volks", wave: 1, count: 2 },
    { type: "funk", wave: 2, count: 1 },
    { type: "volks", wave: 2, count: 2 },
    { type: "mg42", wave: 3, count: 1 },
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
  id: number; x: number; y: number; hp: number; maxHp: number; morale: number; alive: boolean;
  side: string; npc: boolean; type: string; enemyType: string | null; abilityCd: number;
};
type Hud = Record<string, unknown> & { enemyRadioLive: boolean; log: Array<{ text: string }> };
type AnyEngine = Record<string, unknown> & {
  units: U[];
  update: (dt: number) => void;
  damage: (u: U, dmg: number, source: string, killer: number | null) => void;
  enemyRadioLive: () => boolean;
  emitHud: () => void;
};

async function makeEngine() {
  const { GameEngine } = await loadEngine();
  let hud: Hud | null = null;
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, (h: Hud) => {
    hud = h;
  });
  engine.setup(MISSION as never, SQUAD as never, 0, "");
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

function step(e: AnyEngine, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) e.update(1 / 60);
}

function park(e: AnyEngine) {
  // Freeze the fight so the radio timer is the only thing being
  // measured: nobody advances, nobody shoots.
  for (const u of e.units) {
    if (u.side === "allies") { u.x = 200; u.y = 600; }
    else { u.x = 2100; u.y = 600; (u as Record<string, unknown>).range = 0; }
    (u as Record<string, unknown>).speed = 0;
  }
}

function axisAlive(e: AnyEngine) {
  return e.units.filter((u) => u.side === "axis" && u.alive);
}

describe("enemy radioman", () => {
  it("the Funker is a real enemy type: fragile, pistol, LOW threat", () => {
    const spec = ENEMY_TYPES.funk;
    expect(spec).toBeDefined();
    expect(spec.label).toBe("Funker Radioman");
    expect(spec.hp).toBe(70);
    expect(spec.threat).toBe("LOW");
  });

  it("a living Funker calls in 2 more men 25s into the wave", async () => {
    const { e, hud } = await makeEngine();
    expect(axisAlive(e).length).toBe(3);
    park(e);
    step(e, 30);
    expect(axisAlive(e).length).toBe(5);
    const called = axisAlive(e).filter((u) => u.enemyType === "volks");
    expect(called.length).toBe(4); // the 2 from the wave plus the 2 called in
    expect(hud().log.map((l) => l.text).join(" ")).toMatch(/Enemy radio: two more men/);
  }, 30000); // 30s of sim is 1800 engine updates; slow under parallel load

  it("if the Funker dies first, no call-in comes", async () => {
    const { e, hud } = await makeEngine();
    park(e);
    const funker = axisAlive(e).find((u) => u.enemyType === "funk")!;
    e.damage(funker, 999, "rifle", null);
    expect(funker.alive).toBe(false);
    step(e, 30);
    expect(axisAlive(e).length).toBe(2);
    expect(hud().log.map((l) => l.text).join(" ")).not.toMatch(/two more men/);
    expect(hud().log.map((l) => l.text).join(" ")).toMatch(/Enemy radio is down/);
  }, 30000);

  it("only one call-in per wave", async () => {
    const { e } = await makeEngine();
    park(e);
    // 60s, not 90s: after 60s of no combat the stalemate breaker
    // starts hunting, and a breaker-driven fight could clear wave 1
    // and start wave 2 (with its own call-in) before the window ends.
    // 60s still proves the point: the timer fires once at 25s and
    // never re-arms within the wave.
    step(e, 60);
    // Count every axis man ever created, not just the living: the two
    // called-in men walk into the squad's guns and die, so the alive
    // count alone cannot prove no second call-in happened.
    const totalAxis = e.units.filter((u) => u.side === "axis").length;
    expect(totalAxis).toBe(5); // wave 1 (3) + one call-in (2), never 7
  }, 30000); // 60s of sim is 3600 engine updates; slow under parallel load

  it("the Funker rallies his men over the radio", async () => {
    const { e } = await makeEngine();
    const funker = axisAlive(e).find((u) => u.enemyType === "funk")!;
    const mate = axisAlive(e).find((u) => u.enemyType === "volks")!;
    funker.x = 2100; funker.y = 600; mate.x = 2110; mate.y = 600; mate.morale = 50;
    const rally = e as unknown as { funkerRally: (u: U) => void };
    rally.funkerRally(funker);
    expect(mate.morale).toBe(65);
    expect(funker.abilityCd).toBe(20);
  });

  it("the Funker does not spend his rally when nobody needs it", async () => {
    const { e } = await makeEngine();
    const funker = axisAlive(e).find((u) => u.enemyType === "funk")!;
    for (const u of e.units) if (u.side === "axis") u.morale = 100;
    const rally = e as unknown as { funkerRally: (u: U) => void };
    rally.funkerRally(funker);
    expect(funker.abilityCd).toBe(0);
  });

  it("the HUD shows the enemy radio going down with the Funker", async () => {
    const { e, hud } = await makeEngine();
    expect(e.enemyRadioLive()).toBe(true);
    expect(hud().enemyRadioLive).toBe(true);
    const funker = axisAlive(e).find((u) => u.enemyType === "funk")!;
    e.damage(funker, 999, "rifle", null);
    expect(e.enemyRadioLive()).toBe(false);
    expect(hud().enemyRadioLive).toBe(false);
  });
});
