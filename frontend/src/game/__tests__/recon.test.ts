// @vitest-environment node
/**
 * Recon (Josh, 2026-11-12): the squad's eyes. A sniper fights at
 * full range only with a Recon paired near him; alone he
 * self-spots at solo range. A Recon hidden in foliage is
 * spotted by the enemy at a fraction of the normal distance,
 * until his own fire gives him away; his Mark Target ability
 * lights an enemy through fog, makes the squad's fire on him
 * heavier, and a mark laid from concealment sets an ambush.
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

const TOWN = { id: "op_02", index: 1, code: "SILENT CHATEAU", location: "test", objective: "test", difficulty: "HARD", reward: 400, terrain: "town", brief: "test", enemies: [{ type: "volks", wave: 1, count: 3 }] } as const;
const FOREST = { id: "op_04", index: 3, code: "PERMAFROST", location: "test", objective: "test", difficulty: "EXTREME", reward: 1000, terrain: "forest", brief: "test", enemies: [{ type: "volks", wave: 1, count: 3 }] } as const;
const BEACH = { id: "op_01", index: 0, code: "OPERATION OVERLORD", location: "test", objective: "test", difficulty: "MODERATE", reward: 250, terrain: "dday", brief: "test", enemies: [{ type: "volks", wave: 1, count: 3 }] } as const;

type U = {
  id: number; side: string; npc: boolean; type: string; enemyType: string | null; alive: boolean;
  x: number; y: number; hp: number; maxHp: number; markedUntil?: number; markedAmbush?: boolean; lastShotT?: number;
};
type Engine = {
  setup: (m: unknown, s: unknown, b: number, v: string, cl?: number, leader?: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  damage: (u: U, amount: number, source: string, killerId: number | null) => void;
  effRange: (u: U) => number;
  reconPaired: (u: U) => boolean;
  reconHidden: (u: U) => boolean;
  exploredAt: (x: number, y: number) => boolean;
  units: U[];
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

describe("recon and the sniper pairing", () => {
  it("a lone sniper self-spots at solo range; a Recon beside him unlocks full range", async () => {
    const squad = [mk("s-lead", "rifleman", "Sgt."), mk("s-snipe", "sniper"), mk("s-recon", "recon")];
    const e = await makeEngine(TOWN, squad, "", "s-lead");
    const sniper = e.units.find((u) => u.type === "sniper")!;
    const recon = e.units.find((u) => u.type === "recon")!;
    recon.x = sniper.x + 400;
    recon.y = sniper.y;
    expect(e.reconPaired(sniper)).toBe(false);
    expect(e.effRange(sniper)).toBe(260);
    recon.x = sniper.x + 60;
    recon.y = sniper.y;
    expect(e.reconPaired(sniper)).toBe(true);
    expect(e.effRange(sniper)).toBe(460);
    // The pairing is the Recon class only: a rifleman beside him does nothing.
    recon.x = sniper.x + 900;
    const rifle = e.units.find((u) => u.type === "rifleman" && !u.npc)!;
    rifle.x = sniper.x + 40;
    rifle.y = sniper.y;
    expect(e.effRange(sniper)).toBe(260);
  });

  it("NPC snipers pair with NPC recon the same way", async () => {
    const e = await makeEngine(BEACH, [mk("s-lead", "rifleman", "Sgt.")], "beach", "s-lead");
    const sniper = e.units.find((u) => u.npc && u.type === "sniper")!;
    const recon = e.units.find((u) => u.npc && u.type === "recon")!;
    expect(sniper).toBeTruthy();
    expect(recon).toBeTruthy();
    recon.x = sniper.x + 500;
    recon.y = sniper.y;
    expect(e.effRange(sniper)).toBe(260);
    recon.x = sniper.x + 50;
    recon.y = sniper.y;
    expect(e.effRange(sniper)).toBe(460);
  });

  it("a Recon in the trees is not spotted at normal range; in the open he is", async () => {
    const squad = [mk("s-lead", "rifleman", "Sgt."), mk("s-recon", "recon")];
    const e = await makeEngine(FOREST, squad, "", "s-lead");
    const recon = e.units.find((u) => u.type === "recon")!;
    const tree = e.blockers.find((b) => b.kind === "tree")!;
    expect(tree).toBeTruthy();
    // Park everyone else far away; one enemy 150 east of the tree.
    // (The first tree stands deep in the forest, near where the
    // rest of the wave spawns — they are parked off too, or one
    // of them wanders inside even the shrunken spotting cap.)
    for (const u of e.units) {
      if (u.side === "allies" && u.id !== recon.id) { u.x = 60; u.y = 60; }
    }
    const foes = e.units.filter((u) => u.side === "axis");
    const foe = foes[0];
    for (const f of foes.slice(1)) { f.x = 3950; f.y = 60; }
    foe.x = tree.x + 150;
    foe.y = tree.y;
    recon.x = tree.x;
    recon.y = tree.y;
    expect(e.reconHidden(recon)).toBe(true);
    const hp0 = recon.hp;
    for (let t = 0; t < 4; t += 0.25) {
      recon.x = tree.x;
      recon.y = tree.y;
      // He holds fire while he hides: his own shot would stamp
      // lastShotT and give him away (that reveal is the next
      // test's ground). This test measures spotting only.
      (recon as unknown as { cooldown: number }).cooldown = 999;
      e.update(0.25);
    }
    expect(recon.hp).toBe(hp0); // never acquired, never shot
    // Out of the green at the same distance, he is fair game.
    // Find open ground 150 west of the foe: no canopy overhead.
    let open: { x: number; y: number } | null = null;
    for (let dy = -300; dy <= 300 && !open; dy += 20) {
      const cx = foe.x - 150;
      const cy = foe.y + dy;
      const inGreen = e.blockers.some((b) => (b.kind === "tree" || b.kind === "bush") && Math.hypot(b.x - cx, b.y - cy) <= b.r + 6);
      if (!inGreen) open = { x: cx, y: cy };
    }
    expect(open).not.toBeNull();
    recon.x = open!.x;
    recon.y = open!.y;
    expect(e.reconHidden(recon)).toBe(false);
    let hit = false;
    for (let t = 0; t < 8 && !hit; t += 0.25) {
      recon.x = open!.x;
      recon.y = open!.y;
      e.update(0.25);
      if (recon.hp < hp0) hit = true;
    }
    expect(hit).toBe(true);
  });

  it("firing gives a hidden Recon away for a few seconds", async () => {
    const squad = [mk("s-lead", "rifleman", "Sgt."), mk("s-recon", "recon")];
    const e = await makeEngine(FOREST, squad, "", "s-lead");
    const recon = e.units.find((u) => u.type === "recon")!;
    const tree = e.blockers.find((b) => b.kind === "tree")!;
    recon.x = tree.x;
    recon.y = tree.y;
    expect(e.reconHidden(recon)).toBe(true);
    recon.lastShotT = e.elapsed;
    expect(e.reconHidden(recon)).toBe(false);
  });

  it("a mark from concealment sets an ambush; a plain mark still feeds the squad's fire", async () => {
    const squad = [mk("s-lead", "rifleman", "Sgt."), mk("s-recon", "recon")];
    const e = await makeEngine(FOREST, squad, "", "s-lead");
    const recon = e.units.find((u) => u.type === "recon")!;
    const leader = e.units.find((u) => u.type === "rifleman" && !u.npc)!;
    const tree = e.blockers.find((b) => b.kind === "tree")!;
    // One foe, parked east of the tree with deep health; the rest
    // of the wave is parked out of the recon's sight entirely.
    const foes = e.units.filter((u) => u.side === "axis");
    const foe = foes[0];
    for (const f of foes.slice(1)) { f.x = 3950; f.y = 60; }
    foe.x = tree.x + 300;
    foe.y = tree.y;
    foe.hp = 100000;
    foe.maxHp = 100000;
    // Pin the leader and the recon at the tree; the follower recon marks on his own.
    for (let t = 0; t < 6 && foe.markedUntil === undefined; t += 0.25) {
      leader.x = tree.x - 30;
      leader.y = tree.y;
      recon.x = tree.x;
      recon.y = tree.y;
      e.update(0.25);
    }
    expect(foe.markedUntil).toBeGreaterThan(e.elapsed);
    expect(foe.markedAmbush).toBe(true);
    // The mark shows him through fog, far from any allied eyes.
    expect(e.exploredAt(foe.x, foe.y)).toBe(true);
    // First allied hit springs the ambush: 100 lands as 160.
    const hp0 = foe.hp;
    e.damage(foe, 100, "test", leader.id);
    expect(hp0 - foe.hp).toBe(160);
    // After that the mark still feeds fire: 100 lands as 130.
    const hp1 = foe.hp;
    e.damage(foe, 100, "test", leader.id);
    expect(hp1 - foe.hp).toBe(130);
  });

  it("a mark laid in the open carries no ambush", async () => {
    const squad = [mk("s-lead", "rifleman", "Sgt."), mk("s-recon", "recon")];
    const e = await makeEngine(TOWN, squad, "", "s-lead");
    const recon = e.units.find((u) => u.type === "recon")!;
    const foes = e.units.filter((u) => u.side === "axis");
    const foe = foes[0];
    for (const f of foes.slice(1)) { f.x = 3950; f.y = 60; }
    foe.x = recon.x + 300;
    foe.y = recon.y;
    for (let t = 0; t < 6 && foe.markedUntil === undefined; t += 0.25) {
      recon.x = foe.x - 300;
      recon.y = foe.y;
      e.update(0.25);
    }
    expect(foe.markedUntil).toBeGreaterThan(e.elapsed);
    expect(foe.markedAmbush).toBe(false);
  });
});
