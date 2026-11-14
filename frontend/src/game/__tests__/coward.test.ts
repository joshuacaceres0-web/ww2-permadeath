// @vitest-environment node
// Cowards: when a coward's morale breaks he runs for the nearest edge
// of the map instead of falling back, and if he reaches it while
// still broken he deserts. Volkssturm conscripts are cowards by type;
// a squad man is a coward by his quirk ("Skittish", "Jumpy"). A
// deserting squad man ends the round as a defeat, and he is gone from
// the roster when the report is filed — but never on the Memorial.
// Rallying him back to 45 morale before he reaches the edge saves him.
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

// Same squad, but Boyd is Skittish: a coward by quirk.
const SQUAD_COWARD = [
  { id: "s1", name: "Boyd", rank: "Sgt", level: 1, type: "rifleman", hp: 100, kills: 0, medals: [], quirk: "Skittish" },
  { id: "s2", name: "Kowalski", rank: "Cpl", level: 1, type: "medic", hp: 100, kills: 0, medals: [] },
  { id: "s3", name: "Reyes", rank: "Pfc", level: 1, type: "mg", hp: 100, kills: 0, medals: [] },
  { id: "s4", name: "Novak", rank: "Pfc", level: 1, type: "sniper", hp: 100, kills: 0, medals: [] },
  { id: "s5", name: "Hale", rank: "Pvt", level: 1, type: "at", hp: 100, kills: 0, medals: [] },
] as never;

type U = Record<string, unknown> & {
  id: number; x: number; y: number; hp: number; maxHp: number; morale: number; alive: boolean;
  side: string; npc: boolean; type: string; enemyType: string | null; abilityCd: number;
  coward: boolean; fled: boolean; broken: boolean; soldierId: string | null; name: string;
};
type Hud = Record<string, unknown> & {
  state: string; log: Array<{ text: string }>;
  units: Array<{ soldierId: string | null; coward: boolean }>;
};
type AnyEngine = Record<string, unknown> & {
  units: U[];
  update: (dt: number) => void;
  damage: (u: U, dmg: number, source: string, killer: number | null) => void;
  enemiesAlive: () => number;
  alliesAlive: () => number;
  emitHud: () => void;
  getReport: () => { victory: boolean; fallen: Array<{ soldierId: string }>; deserted: Array<{ soldierId: string }> };
};

async function makeEngine(squad: unknown = SQUAD) {
  const { GameEngine } = await loadEngine();
  let hud: Hud | null = null;
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, (h: Hud) => {
    hud = h;
  });
  engine.setup(MISSION as never, squad as never, 0, "");
  engine.begin();
  const e = engine as unknown as AnyEngine;
  // Deterministic by default: no flee roll unless a test opts in.
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

/** Break a man and keep his morale pinned low, as sustained fire would. */
function breakAndHold(e: AnyEngine, u: U, seconds: number) {
  u.morale = 5;
  const steps = Math.round(seconds * 2);
  for (let i = 0; i < steps; i++) {
    u.morale = 5;
    step(e, 0.5);
    if (!u.alive) break;
  }
}

describe("cowards", () => {
  it("cowards are rare: 25% of volks, and no other enemy type", async () => {
    const { e } = await makeEngine();
    // The roll uses Math.random (the wave rng is seeded per mission,
    // so a roll from it would make cowardice a fixed fact of the
    // mission), so the test drives the chance directly instead of
    // trying to control the dice.
    expect((e as unknown as { cowardChance: number }).cowardChance).toBe(0.25);
    const spawn = (e as unknown as { spawnEnemyUnit: (t: string, x: number, y: number, r: () => number) => void }).spawnEnemyUnit.bind(e);
    (e as unknown as { cowardChance: number }).cowardChance = 1;
    let before = e.units.length;
    spawn("volks", 3000, 600, () => 0.5);
    expect(e.units[before].coward).toBe(true);
    before = e.units.length;
    spawn("grenadier", 3000, 600, () => 0);
    expect(e.units[before].coward).toBe(false);
    (e as unknown as { cowardChance: number }).cowardChance = 0;
    before = e.units.length;
    spawn("volks", 3000, 600, () => 0);
    expect(e.units[before].coward).toBe(false);
  });

  it("the quirk decides it for a squad man: Skittish is a coward, the rest are not", async () => {
    const { e, hud } = await makeEngine(SQUAD_COWARD);
    const boyd = e.units.find((u) => u.soldierId === "s1")!;
    expect(boyd.coward).toBe(true);
    expect(e.units.filter((u) => u.side === "allies" && u.coward).length).toBe(1);
    expect(hud().units.find((u) => u.soldierId === "s1")!.coward).toBe(true);
  });

  it("a broken volks runs for the edge and deserts, and the enemy loses a gun", async () => {
    const { e, hud } = await makeEngine();
    (e as unknown as { fleeChance: number }).fleeChance = 1; // the roll always lands
    const volks = e.units.find((u) => u.side === "axis" && u.enemyType === "volks")!;
    volks.coward = true; // the test decides: this one is a coward
    volks.x = 600; volks.y = 100; // near the north edge: he flees north, away from the squad
    const startX = volks.x;
    const startY = volks.y;
    // CONQUEST: the fixture's full force (6 across all three
    // groups) is on the field from the start, not just group 1.
    expect(e.enemiesAlive()).toBe(6);
    breakAndHold(e, volks, 8);
    expect(volks.alive).toBe(false);
    expect(volks.fled).toBe(true);
    // He ran for the nearest edge (not always east — he spawns at the
    // beach now, so it may be north, south or west): he moved.
    expect(Math.hypot(volks.x - startX, volks.y - startY)).toBeGreaterThan(0);
    expect(e.enemiesAlive()).toBe(5);
    expect(hud().log.map((l) => l.text).join(" ")).toMatch(/broke and ran off the field/);
    expect((e as unknown as { fallen: Array<{ soldierId: string }> }).fallen.length).toBe(0);
  });

  it("a squad coward who flees ends the round as a defeat, and he is deserted, not fallen", async () => {
    const { e, hud } = await makeEngine(SQUAD_COWARD);
    (e as unknown as { fleeChance: number }).fleeChance = 1; // the roll always lands
    const boyd = e.units.find((u) => u.soldierId === "s1")!;
    breakAndHold(e, boyd, 8);
    expect(boyd.alive).toBe(false);
    expect(boyd.fled).toBe(true);
    expect(hud().state).toBe("defeat");
    expect(hud().log.map((l) => l.text).join(" ")).toMatch(/Mission failed — a man deserted under fire/);
    const report = e.getReport();
    expect(report.victory).toBe(false);
    expect(report.deserted.map((d) => d.soldierId)).toEqual(["s1"]);
    expect(report.fallen.length).toBe(0);
  });

  it("a non-coward volks who breaks falls back and rallies, never deserts", async () => {
    const { e, hud } = await makeEngine();
    const volks = e.units.find((u) => u.side === "axis" && u.enemyType === "volks")!;
    volks.coward = false;
    volks.morale = 5;
    step(e, 30);
    expect(volks.alive).toBe(true);
    expect(volks.fled).toBe(false);
    expect(volks.broken).toBe(false);
    expect(hud().state).toBe("active");
  }, 30000);

  it("a radioman's Rally Call steadies a fleeing coward before the edge", async () => {
    // Boyd (Skittish) breaks and runs; the radioman next to him in
    // the squad is close enough for a Rally Call.
    const squad = [
      { id: "s1", name: "Boyd", rank: "Sgt", level: 1, type: "rifleman", hp: 100, kills: 0, medals: [], quirk: "Skittish" },
      { id: "s2", name: "Davis", rank: "Cpl", level: 1, type: "radioman", hp: 100, kills: 0, medals: [] },
      { id: "s3", name: "Reyes", rank: "Pfc", level: 1, type: "mg", hp: 100, kills: 0, medals: [] },
      { id: "s4", name: "Novak", rank: "Pfc", level: 1, type: "sniper", hp: 100, kills: 0, medals: [] },
      { id: "s5", name: "Hale", rank: "Pvt", level: 1, type: "at", hp: 100, kills: 0, medals: [] },
    ] as never;
    const { e, hud } = await makeEngine(squad);
    (e as unknown as { fleeChance: number }).fleeChance = 1; // the roll always lands
    const boyd = e.units.find((u) => u.soldierId === "s1")!;
    const radio = e.units.find((u) => u.soldierId === "s2")!;
    boyd.morale = 5;
    step(e, 0.5); // he breaks and starts running
    expect(boyd.broken).toBe(true);
    const cast = e as unknown as { castAuto: (u: U) => void };
    cast.castAuto(radio);
    expect(boyd.morale).toBe(65); // steadied to the coward rally line
    step(e, 5);
    expect(boyd.broken).toBe(false);
    expect(boyd.alive).toBe(true);
    expect(boyd.fled).toBe(false);
    expect(hud().state).toBe("active");
    expect(e.getReport().deserted.length).toBe(0);
  });

  it("the roll can say stay: a coward who breaks with fleeChance 0 falls back and rallies, never deserts", async () => {
    const { e, hud } = await makeEngine(SQUAD_COWARD);
    (e as unknown as { fleeChance: number }).fleeChance = 0; // the roll never lands
    const boyd = e.units.find((u) => u.soldierId === "s1")!;
    expect(boyd.coward).toBe(true);
    boyd.morale = 5;
    step(e, 20);
    expect(boyd.fled).toBe(false);
    expect(boyd.alive).toBe(true);
    expect(boyd.broken).toBe(false); // rallied at 45, the normal line
    expect(hud().state).not.toBe("defeat");
    expect(e.getReport().deserted).toEqual([]);
  }, 30000);

  it("a non-coward who breaks falls back and rallies, never deserts", async () => {
    const { e, hud } = await makeEngine();
    const boyd = e.units.find((u) => u.soldierId === "s1")!;
    boyd.morale = 5;
    step(e, 30); // he breaks, falls back, and recovers on his own
    expect(boyd.alive).toBe(true);
    expect(boyd.fled).toBe(false);
    expect(boyd.broken).toBe(false);
    expect(hud().state).toBe("active");
    expect(e.getReport().deserted.length).toBe(0);
  }, 30000);

  it("a coward killed while fleeing counts as killed, not a deserter, and the round goes on", async () => {
    const { e } = await makeEngine(SQUAD_COWARD);
    (e as unknown as { fleeChance: number }).fleeChance = 1; // the roll always lands
    const boyd = e.units.find((u) => u.soldierId === "s1")!;
    boyd.morale = 5;
    step(e, 0.5);
    expect(boyd.broken).toBe(true);
    e.damage(boyd, 999, "rifle", null);
    expect(boyd.alive).toBe(false);
    expect(boyd.fled).toBe(false);
    expect((e as unknown as { fallen: Array<{ soldierId: string }> }).fallen.map((f) => f.soldierId)).toEqual(["s1"]);
    expect(e.getReport().deserted.length).toBe(0);
    expect(e.getReport().victory).toBe(false);
    expect(e.alliesAlive()).toBe(4);
  });
});
