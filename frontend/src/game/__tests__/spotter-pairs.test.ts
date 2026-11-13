// @vitest-environment node
/**
 * Enemy spotter pairs + the ranges pass (2026-11-13): ranges and
 * vision rescaled per class for the 4000-wide maps, and the
 * Scharfschutze now fields a Beobachter spotter at his shoulder,
 * paired the same way the player's Recon pairs with a sniper —
 * full range (460) while the spotter lives near him, solo range
 * (260) the moment he falls or strays. A prone or in-foliage
 * target is acquired at 0.7x reach; a spotter hidden in foliage
 * is hidden like a Recon (0.55x) until his own fire gives him
 * away.
 */
import { describe, expect, it } from "vitest";

function stubBrowser() {
  const grad = { addColorStop: () => {} };
  const ctx = new Proxy({}, {
    get(_t, p) {
      if (p === "createLinearGradient" || p === "createRadialGradient") return () => grad;
      if (p === "measureText") return () => ({ width: 10 });
      if (p === "getImageData") return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (p === "createPattern") return () => ({});
      return typeof p === "string" ? () => {} : undefined;
    },
    set() { return true; },
  });
  const makeCanvas = () => ({ width: 0, height: 0, getContext: () => ctx, toDataURL: () => "", getBoundingClientRect: () => ({ width: 1600, height: 900, left: 0, top: 0 }), addEventListener: () => {}, removeEventListener: () => {}, style: {} });
  const store = new Map<string, string>();
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  g.window = globalThis;
  g.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
  g.document = { createElement: (tag: string) => (tag === "canvas" ? makeCanvas() : {}), fonts: { load: () => Promise.resolve([]) } };
  g.HTMLCanvasElement = function () {};
}
stubBrowser();
const loadEngine = async () => (await import("../engine")).GameEngine;

const TOWN_SNIPER = { id: "op_02", index: 1, code: "SILENT CHATEAU", location: "test", objective: "test", difficulty: "HARD", reward: 400, terrain: "town", brief: "test", enemies: [{ type: "scharfschutze", wave: 1, count: 1 }, { type: "volks", wave: 1, count: 2 }] } as const;
const FOREST = { id: "op_04", index: 3, code: "PERMAFROST", location: "test", objective: "test", difficulty: "EXTREME", reward: 1000, terrain: "forest", brief: "test", enemies: [{ type: "volks", wave: 1, count: 3 }] } as const;

type U = {
  id: number; side: string; npc: boolean; type: string; enemyType: string | null; alive: boolean;
  x: number; y: number; hp: number; maxHp: number; prone: boolean; vehicle: boolean;
  range: number; vision: number; lastShotT?: number;
};
type Engine = {
  setup: (m: unknown, s: unknown, b: number, v: string, cl?: number, leader?: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  damage: (u: U, amount: number, source: string, killerId: number | null) => void;
  effRange: (u: U) => number;
  reconPaired: (u: U) => boolean;
  reconHidden: (u: U) => boolean;
  concealedTarget: (u: U) => boolean;
  autoTarget: (u: U) => U | null;
  spawnEnemyUnit: (t: string, x: number, y: number, rng: () => number, trench?: boolean) => U;
  units: U[];
  foliage: Array<{ x: number; y: number; r: number }>;
  blockers: Array<{ x: number; y: number; r: number; kind?: string }>;
  elapsed: number;
};

async function makeEngine(mission: unknown, squad: unknown[], variant = "", leader = "") {
  const GameEngine = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const e = new GameEngine(canvas, () => {}) as unknown as Engine;
  e.setup(mission as never, squad as never, 0, variant, 8, leader);
  e.begin();
  return e;
}
const mk = (id: string, type: string, rank = "Pvt.") => ({ id, name: id, type, rank, level: 1, medals: [] });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("enemy spotter pairs", () => {
  it("a Scharfschutze spawns with a Beobachter at his shoulder", async () => {
    const e = await makeEngine(TOWN_SNIPER, [mk("s-lead", "rifleman", "Sgt.")], "", "s-lead");
    const sniper = e.units.find((u) => u.enemyType === "scharfschutze")!;
    const spotter = e.units.find((u) => u.enemyType === "spotter")!;
    expect(sniper).toBeTruthy();
    expect(spotter).toBeTruthy();
    expect(dist(sniper, spotter)).toBeLessThan(70);
    expect(spotter.vision).toBe(500);
  });

  it("the pair unlocks full range; alone the Scharfschutze self-spots at solo range", async () => {
    const e = await makeEngine(FOREST, [mk("s-lead", "rifleman", "Sgt.")], "", "s-lead");
    const rng = () => 0.5;
    const sniper = e.spawnEnemyUnit("scharfschutze", 2000, 600, rng, false);
    const spotter = e.spawnEnemyUnit("spotter", 2600, 600, rng, false);
    expect(e.reconPaired(sniper)).toBe(false);
    expect(e.effRange(sniper)).toBe(260);
    spotter.x = sniper.x + 60;
    spotter.y = sniper.y;
    expect(e.reconPaired(sniper)).toBe(true);
    expect(e.effRange(sniper)).toBe(460);
    // The spotter falls: the sniper is back to self-spotting.
    e.damage(spotter, 9999, "rifle", null);
    expect(spotter.alive).toBe(false);
    expect(e.effRange(sniper)).toBe(260);
  });

  it("the spotter stays glued to his sniper", async () => {
    const e = await makeEngine(FOREST, [mk("s-lead", "rifleman", "Sgt.")], "", "s-lead");
    const rng = () => 0.5;
    const sniper = e.spawnEnemyUnit("scharfschutze", 3000, 675, rng, false);
    const spotter = e.spawnEnemyUnit("spotter", 3300, 675, rng, false);
    expect(dist(sniper, spotter)).toBeGreaterThan(250);
    for (let t = 0; t < 140; t++) e.update(0.1);
    expect(dist(sniper, spotter)).toBeLessThan(90);
  }, 30000);

  it("a Beobachter in the trees is hidden like a Recon until he fires", async () => {
    const e = await makeEngine(FOREST, [mk("s-lead", "rifleman", "Sgt.")], "", "s-lead");
    const rng = () => 0.5;
    const spotter = e.spawnEnemyUnit("spotter", 2000, 600, rng, false);
    const tree = e.foliage[0] ?? e.blockers.find((b) => b.kind === "tree")!;
    expect(tree).toBeTruthy();
    spotter.x = tree.x;
    spotter.y = tree.y;
    spotter.lastShotT = undefined;
    expect(e.reconHidden(spotter)).toBe(true);
    // His own shot gives him away.
    spotter.lastShotT = e.elapsed;
    expect(e.reconHidden(spotter)).toBe(false);
    // In the open he is never hidden, shot or no shot.
    spotter.x = 200;
    spotter.y = 1200;
    spotter.lastShotT = undefined;
    expect(e.reconHidden(spotter)).toBe(false);
  });
});

describe("concealed targets and the rescaled numbers", () => {
  it("prone and foliage targets read as concealed; vehicles never do", async () => {
    const e = await makeEngine(FOREST, [mk("s-lead", "rifleman", "Sgt."), mk("s-rifle", "rifleman")], "", "s-lead");
    const man = e.units.find((u) => u.type === "rifleman" && !u.npc && u.id !== undefined && u.x < 900) ?? e.units.find((u) => u.type === "rifleman" && !u.npc)!;
    man.x = 200;
    man.y = 1200;
    man.prone = false;
    expect(e.concealedTarget(man)).toBe(false);
    man.prone = true;
    expect(e.concealedTarget(man)).toBe(true);
    man.prone = false;
    const tree = e.foliage[0] ?? e.blockers.find((b) => b.kind === "tree")!;
    man.x = tree.x;
    man.y = tree.y;
    expect(e.concealedTarget(man)).toBe(true);
  });

  it("a searcher acquires a prone man at 0.7x reach, a standing man at full reach", async () => {
    const e = await makeEngine(FOREST, [mk("s-lead", "rifleman", "Sgt."), mk("s-rifle", "rifleman")], "", "s-lead");
    const rng = () => 0.5;
    const volks = e.spawnEnemyUnit("volks", 1800, 675, rng, false);
    const target = e.units.filter((u) => u.side === "allies" && !u.npc).sort((a, b) => a.x - b.x)[0];
    // Park every other allied man far away so the volks sees one target.
    for (const u of e.units) {
      if (u.side === "allies" && u.id !== target.id) {
        u.x = 60;
        u.y = 60;
      }
    }
    // 190 away: inside the volks' listed 220, beyond 0.7x of it (154).
    target.x = volks.x - 190;
    target.y = volks.y;
    target.prone = true;
    expect(e.autoTarget(volks)).toBeNull();
    target.prone = false;
    expect(e.autoTarget(volks)?.id).toBe(target.id);
  });

  it("the class ladder: snipers longest, MG and mortar long, rifles mid, SMG and pistol short", async () => {
    const { UNIT_TYPES, ENEMY_TYPES } = await import("../data");
    // Longest reach on the field: the two sniper classes, then mortar.
    expect(UNIT_TYPES.sniper.range).toBe(460);
    expect(ENEMY_TYPES.scharfschutze.range).toBe(460);
    expect(ENEMY_TYPES.mortar.range).toBe(620);
    // MG long.
    expect(UNIT_TYPES.mg.range).toBe(320);
    expect(ENEMY_TYPES.mg42.range).toBe(340);
    // Rifles mid.
    expect(UNIT_TYPES.rifleman.range).toBe(240);
    expect(ENEMY_TYPES.volks.range).toBe(220);
    // SMG and pistol short.
    expect(ENEMY_TYPES.grenadier.range).toBe(180);
    expect(UNIT_TYPES.medic.range).toBe(170);
    // The spotters hold the longest vision on the field.
    expect(UNIT_TYPES.recon.vision).toBe(500);
    expect(ENEMY_TYPES.spotter.vision).toBe(500);
    expect(UNIT_TYPES.sniper.vision).toBe(480);
  });
});
