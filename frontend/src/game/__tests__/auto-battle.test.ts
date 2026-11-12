// Auto Battle — core first, then the add-ons, tested after each step.
// @vitest-environment node
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
  index: 1,
  code: "OPERATION SILENT CHATEAU",
  location: "Valognes Estate",
  objective: "",
  difficulty: "HARD",
  reward: 400,
  terrain: "town",
  brief: "",
  enemies: [
    { type: "grenadier", wave: 1, count: 3 },
    { type: "volks", wave: 1, count: 4 },
  ],
} as const;

const SQUAD = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 2, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
  { id: "s3", name: "James Baker", type: "rifleman", rank: "Pvt.", level: 1, medals: [] },
  { id: "s4", name: "Chester Pruitt", type: "medic", rank: "Pvt.", level: 1, medals: [] },
  { id: "s5", name: "Raymond Boyd", type: "mg", rank: "Pvt.", level: 1, medals: [] },
] as const;

type AnyEngine = Record<string, unknown> & {
  setup: (m: unknown, s: unknown, b: number, v: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  setAutoBattle: (on: boolean) => void;
  isAutoBattle: () => boolean;
  selectUnit: (id: number) => void;
  selectAll: () => void;
  issueOrder: (x: number, y: number, q: boolean) => void;
};

function makeBattle() {
  return loadEngine().then(({ GameEngine }) => {
    const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
    let lastHud: Record<string, unknown> | null = null;
    const engine = new GameEngine(canvas, (h: unknown) => {
      lastHud = h as Record<string, unknown>;
    }) as unknown as AnyEngine;
    engine.setup(MISSION as never, SQUAD as never, 0, "");
    engine.begin();
    const squad = () =>
      ((engine as unknown as AnyEngine).units as Array<Record<string, unknown>>).filter(
        (u) => u.side === "allies" && !u.npc && u.alive,
      );
    return { engine, squad, hud: () => lastHud };
  });
}

function step(engine: AnyEngine, seconds: number) {
  for (let i = 0; i < seconds * 60; i++) engine.update(1 / 60);
}

describe("Auto Battle — core", () => {
  it("AUTO on: squad men advance east toward the enemy, HUD reports autoBattle", async () => {
    const { engine, squad, hud } = await makeBattle();
    const start = squad().map((u) => ({ id: u.id, x: u.x as number, y: u.y as number }));
    engine.setAutoBattle(true);
    expect(engine.isAutoBattle()).toBe(true);
    step(engine, 30);
    // update() alone does not emit HUD; the live loop does. Drive the
    // private emit directly to check the snapshot the UI reads.
    (engine as unknown as { emitHud: () => void }).emitHud();
    expect(hud()?.autoBattle).toBe(true);
    const east = squad().map((u) => {
      const s = start.find((p) => p.id === u.id);
      return s ? (u.x as number) - s.x : 0;
    });
    const maxEast = Math.max(0, ...east);
    console.log(`auto maxEast=${Math.round(maxEast)} alive=${squad().length}`);
    // At least one man must have advanced east toward the enemy.
    // Manual cover-seek is capped near 280, so 500 separates the two.
    expect(maxEast).toBeGreaterThan(500);
  }, 120000);

  it("AUTO off (manual): squad men do not advance east on their own", async () => {
    const { engine, squad } = await makeBattle();
    const start = squad().map((u) => ({ id: u.id, x: u.x as number, y: u.y as number }));
    step(engine, 20);
    const east = squad().map((u) => {
      const s = start.find((p) => p.id === u.id);
      return s ? (u.x as number) - s.x : 0;
    });
    const maxEast = Math.max(0, ...east);
    console.log(`manual maxEast=${Math.round(maxEast)} alive=${squad().length}`);
    // Idle men may seek nearby cover (capped near 280), but they do
    // not chase east toward the enemy the way AUTO does.
    expect(maxEast).toBeLessThan(500);
  }, 120000);

  it("add-on 1: AUTO uses abilities on its own — medic heals a hurt man", async () => {
    const { engine, squad } = await makeBattle();
    const units = (engine as unknown as AnyEngine).units as Array<Record<string, unknown>>;
    const medic = units.find((u) => u.side === "allies" && !u.npc && u.type === "medic")!;
    const hurt = units.find((u) => u.side === "allies" && !u.npc && u.type === "rifleman")!;
    hurt.hp = 20;
    // Put the hurt man next to the medic so he is in heal range.
    hurt.x = medic.x;
    hurt.y = medic.y;
    engine.setAutoBattle(true);
    step(engine, 3);
    console.log(`auto medic abilityCd=${medic.abilityCd} hurt hp=${hurt.hp}`);
    expect((medic.abilityCd as number) > 0).toBe(true);
    // Ability heals +50; the medic's passive aura only adds ~3/sec.
    expect((hurt.hp as number)).toBeGreaterThanOrEqual(60);
  }, 120000);

  it("add-on 1: without AUTO the medic does not heal on his own", async () => {
    const { engine } = await makeBattle();
    const units = (engine as unknown as AnyEngine).units as Array<Record<string, unknown>>;
    const medic = units.find((u) => u.side === "allies" && !u.npc && u.type === "medic")!;
    const hurt = units.find((u) => u.side === "allies" && !u.npc && u.type === "rifleman")!;
    hurt.hp = 20;
    hurt.x = medic.x;
    hurt.y = medic.y;
    step(engine, 3);
    expect((medic.abilityCd as number)).toBe(0);
    // Only the medic's passive aura (~3 hp/sec) applies, no +50 ability.
    expect((hurt.hp as number)).toBeLessThan(30);
  }, 120000);

  it("replay: the engine records a frame every 0.5s for the debrief screen", async () => {
    const { engine } = await makeBattle();
    const getReplay = () =>
      (engine as unknown as {
        getReplay: () => {
          frames: Array<{ t: number; units: unknown[] }>;
          result: string;
          durationSec: number;
          obstacles: Array<{ x: number; y: number; r: number; kind: string }>;
        };
      }).getReplay();
    let replay = getReplay();
    expect(replay.frames.length).toBeGreaterThanOrEqual(1);
    expect(replay.frames[0].t).toBe(0);
    // Trees, ruins and obstacles are marked on the replay map.
    expect(replay.obstacles.length).toBeGreaterThan(10);
    const kinds = new Set(replay.obstacles.map((o) => o.kind));
    console.log(`replay obstacles=${replay.obstacles.length} kinds=${[...kinds].join(",")}`);
    expect(kinds.has("ruin") || kinds.has("building")).toBe(true);
    engine.setAutoBattle(true);
    step(engine, 10);
    replay = getReplay();
    console.log(`replay frames=${replay.frames.length} duration=${replay.durationSec}s result=${replay.result}`);
    expect(replay.frames.length).toBeGreaterThanOrEqual(20);
    expect(replay.frames[replay.frames.length - 1].t).toBeGreaterThanOrEqual(10);
    expect(replay.frames[0].units.length).toBeGreaterThan(5);
  }, 120000);

  it("add-on 4: AUTO never spends RP on reinforcements — that stays manual", async () => {
    const { engine } = await makeBattle();
    engine.setAutoBattle(true);
    step(engine, 30);
    const called = (engine as unknown as AnyEngine).reinforcements as number;
    console.log(`auto reinforcements=${called}`);
    expect(called).toBe(0);
  }, 120000);

  it("add-on 2: any manual order takes command back", async () => {
    const { engine, squad } = await makeBattle();
    engine.setAutoBattle(true);
    expect(engine.isAutoBattle()).toBe(true);
    const first = squad()[0];
    engine.selectUnit(first.id as number);
    expect(engine.isAutoBattle()).toBe(false);
    engine.setAutoBattle(true);
    engine.selectAll();
    engine.issueOrder(2100, 675, false);
    expect(engine.isAutoBattle()).toBe(false);
  }, 120000);
});
