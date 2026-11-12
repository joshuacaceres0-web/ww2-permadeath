// Recorder: runs one full Silent Chateau battle with AUTO on and
// writes a position snapshot every 0.5s to a JSON replay file.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";

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
    { type: "officer", wave: 2, count: 1 },
    { type: "grenadier", wave: 2, count: 3 },
    { type: "mg42", wave: 2, count: 1 },
    { type: "fallschirmjager", wave: 2, count: 3 },
    { type: "mortar", wave: 2, count: 1 },
    { type: "volks", wave: 3, count: 3 },
    { type: "grenadier", wave: 3, count: 3 },
    { type: "officer", wave: 3, count: 1 },
    { type: "fallschirmjager", wave: 3, count: 3 },
    { type: "mortar", wave: 3, count: 1 },
  ],
} as const;

const SQUAD = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 2, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
  { id: "s3", name: "James Baker", type: "rifleman", rank: "Pvt.", level: 1, medals: [] },
  { id: "s4", name: "Chester Pruitt", type: "medic", rank: "Pvt.", level: 1, medals: [] },
  { id: "s5", name: "Raymond Boyd", type: "mg", rank: "Pvt.", level: 1, medals: [] },
] as const;

describe("AUTO replay recorder", () => {
  it("records a full AUTO battle", async () => {
    const { GameEngine } = await loadEngine();
    const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
    const engine = new GameEngine(canvas, () => {}) as unknown as Record<string, unknown> & {
      setup: (m: unknown, s: unknown, b: number, v: string) => void;
      begin: () => void;
      update: (dt: number) => void;
      setAutoBattle: (on: boolean) => void;
    };
    engine.setup(MISSION as never, SQUAD as never, 0, "");
    engine.begin();
    engine.setAutoBattle(true);
    const frames: Array<Record<string, unknown>> = [];
    const snap = (t: number) => {
      const units = (engine.units as Array<Record<string, unknown>>).map((u) => ({
        id: u.id,
        side: u.side,
        npc: u.npc,
        type: u.type,
        enemyType: u.enemyType,
        name: u.name,
        x: Math.round(u.x as number),
        y: Math.round(u.y as number),
        hp: Math.round(u.hp as number),
        maxHp: u.maxHp,
        alive: u.alive,
        kills: u.kills,
        cover: !!u.cover,
      }));
      frames.push({ t, phase: engine.phase, battleState: engine.battleState, wave: (engine.waveIndex as number) + 1, units });
    };
    snap(0);
    let t = 0;
    for (let step = 0; step < 60 * 240; step++) {
      engine.update(1 / 60);
      t += 1 / 60;
      if (step % 30 === 0) snap(Math.round(t * 10) / 10);
      if (engine.phase === "over") {
        snap(Math.round(t * 10) / 10);
        break;
      }
    }
    const squad = (engine.units as Array<Record<string, unknown>>).filter((u) => u.side === "allies" && !u.npc);
    const replay = (
      engine as unknown as { getReplay: () => { obstacles: Array<{ x: number; y: number; r: number; kind: string }> } }
    ).getReplay();
    const result = {
      mission: "OPERATION SILENT CHATEAU",
      mapW: 2400,
      mapH: 1350,
      durationSec: Math.round(t),
      result: engine.battleState,
      squadAlive: squad.filter((u) => u.alive).length,
      squadKills: squad.reduce((n, u) => n + (u.kills as number), 0),
      obstacles: replay.obstacles,
      frames,
    };
    fs.writeFileSync("/home/hatch/workspace/ww2-auto-replay.json", JSON.stringify(result));
    console.log(`AUTO replay: ${result.result} in ${result.durationSec}s, squad alive ${result.squadAlive}/5, kills ${result.squadKills}, frames ${frames.length}`);
    expect(frames.length).toBeGreaterThan(10);
  }, 180000);
});
