// @vitest-environment node
/**
 * Explosives pass (Josh, 2026-11-13):
 * (a) A thrown frag bursts on a 2.0s fuse counted from the
 *     throw — it flies, lands, and sits live where it fell
 *     until the fuse runs out. No damage before the fuse.
 * (b) A frag throw is capped at 200 units: a throw ordered
 *     past the cap still happens, clamped to the cap.
 * (c) AI footmen scatter from a live frag whose blast could
 *     reach them; pinned-down men stay; the player's own
 *     leader never auto-runs.
 * (d) A man who steps on a mine dies outright — no damage
 *     roll, no lucky charm. Bystanders keep the old blast.
 * (e) Mines are hidden until an allied engineer spots one
 *     (existing detector range); a spotted mine stays marked
 *     and AI men steer around it. The leader stays manual.
 */
import { readFileSync } from "node:fs";
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

const TOWN = {
  id: "op_02", index: 1, code: "SILENT CHATEAU", location: "test", objective: "test",
  difficulty: "HARD", reward: 400, terrain: "town", brief: "test",
  enemies: [{ type: "volks", wave: 1, count: 3 }],
} as const;
const BEACH = { id: "op_01", index: 0, code: "OPERATION OVERLORD", location: "test", objective: "test", difficulty: "MODERATE", reward: 250, terrain: "dday", brief: "test", enemies: [{ type: "volks", wave: 1, count: 3 }] } as const;
const mk = (id: string, type: string, rank = "Pvt.") => ({ id, name: id, type, rank, level: 1, medals: [] });

type Proj = { x: number; y: number; sx: number; sy: number; tx: number; ty: number; t: number; dur: number; side: string; dmg: number; aoe: number; kind: string; sourceType: string; killerId: number | null; smokeT: number; fuseT?: number };
type Mine = { x: number; y: number; armed: boolean; revealed?: boolean; cleared?: boolean };
type U = {
  id: number; side: string; npc: boolean; type: string; enemyType?: string; alive: boolean;
  x: number; y: number; hp: number; maxHp: number; suppression: number; pinned: boolean;
  prone?: boolean; broken: boolean; isStatic: boolean; equipment: string[]; charmUsed: boolean;
  coverSeekT: number;
  orders: Array<{ x: number; y: number }>;
};

/** Drop a live frag on a point, fuse already burning: the
 * state every thrown grenade is in once it has landed. */
function liveFrag(e: Engine, x: number, y: number, side: string) {
  e.projectiles.push({
    x, y, sx: x, sy: y, tx: x, ty: y, t: 0.6, dur: 0.5,
    side, dmg: 60, aoe: 70, kind: "grenade", sourceType: "grenade",
    killerId: null, smokeT: 0, fuseT: 2.0,
  });
}
type Engine = {
  setup: (m: unknown, s: unknown, b: number, v: string, cl?: number, leader?: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  castGround: (u: U, x: number, y: number) => void;
  moveToward: (u: U, x: number, y: number, dt: number) => void;
  units: U[];
  projectiles: Proj[];
  mines: Mine[];
  leaderId: number;
};

async function makeTown(squad: unknown[], leader = "s1") {
  const GameEngine = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const e = new GameEngine(canvas, () => {}) as unknown as Engine;
  e.setup(TOWN as never, squad as never, 0, "", 1, leader);
  e.begin();
  return e;
}

/** Park every axis man far away except the one under test, so
 * stray fire cannot touch the numbers. */
function parkAxis(e: Engine, keep?: U) {
  for (const u of e.units) {
    if (u.side === "axis" && u !== keep) { u.x = 3950; u.y = 60; }
  }
}

async function makeBeach(squad: unknown[], leader = "s-lead") {
  const GameEngine = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const e = new GameEngine(canvas, () => {}) as unknown as Engine & { introT: number };
  e.setup(BEACH as never, squad as never, 0, "beach", 8, leader);
  e.begin();
  // Play through the landing intro with the whole force pinned
  // at the waterline, west of the mine band (x 320-780), so the
  // field is intact when the test starts (engineer.test's way).
  for (let t = 0; t < 20 && e.introT >= 0; t += 0.25) {
    for (const u of e.units) {
      if (u.side === "axis") { u.x = 3950; u.y = 60; }
      else { u.x = 60 + (u.id % 6) * 9; u.y = 1180; }
    }
    e.update(0.25);
  }
  for (const u of e.units) if (u.side === "axis") { u.x = 3950; u.y = 60; }
  return e;
}

describe("grenade fuse (a)", () => {
  it("a thrown frag deals no damage before the fuse ends, then bursts on the spot at full strength", async () => {
    const e = await makeTown([mk("s1", "rifleman", "Sgt.")]);
    const leader = e.units.find((u) => u.side === "allies" && !u.npc)!;
    const foe = e.units.find((u) => u.side === "axis")!;
    parkAxis(e, foe);
    leader.x = 1000; leader.y = 675;
    foe.x = 1150; foe.y = 675;
    const hp0 = foe.hp;
    e.castGround(leader, foe.x, foe.y);
    expect(e.projectiles.length).toBe(1);
    const p = e.projectiles[0];
    expect(p.kind).toBe("grenade");
    expect(p.fuseT).toBeCloseTo(2.0, 5);
    // 1.75s in: the flight (0.5s) is long done — the grenade
    // is sitting on the spot, live — and the man on top of it
    // is still untouched. (He is held pinned by suppression:
    // since the scatter rule landed, an unpinned man would
    // simply run off the grenade — that is test (c)'s job.)
    for (let t = 0; t < 7; t++) {
      foe.x = 1150; foe.y = 675;
      foe.suppression = 100;
      foe.coverSeekT = 999;
      e.update(0.25);
    }
    expect(e.projectiles.length).toBe(1);
    expect(p.t).toBeGreaterThanOrEqual(p.dur); // landed, waiting on the fuse
    expect(p.fuseT!).toBeGreaterThan(0);
    expect(foe.hp).toBe(hp0);
    // Past the fuse (2.25s total): burst, on the spot, for the
    // frag's full centre damage of 60.
    foe.x = 1150; foe.y = 675;
    foe.suppression = 100;
    foe.coverSeekT = 999;
    e.update(0.25);
    foe.x = 1150; foe.y = 675;
    foe.suppression = 100;
    foe.coverSeekT = 999;
    e.update(0.25);
    expect(e.projectiles.length).toBe(0);
    expect(foe.hp).toBeCloseTo(hp0 - 60, 0);
  });

  it("an AI rifleman's throw runs on the same fuse", async () => {
    const e = await makeTown([mk("s1", "rifleman", "Sgt."), mk("s2", "rifleman")]);
    const thrower = e.units.filter((u) => u.side === "allies" && !u.npc)[1];
    const foe = e.units.find((u) => u.side === "axis")!;
    parkAxis(e, foe);
    thrower.x = 1000; thrower.y = 675;
    foe.x = 1120; foe.y = 675;
    e.castGround(thrower, foe.x, foe.y);
    expect(e.projectiles.length).toBe(1);
    expect(e.projectiles[0].fuseT).toBeCloseTo(2.0, 5);
    // The follower's rifle may be working the same target —
    // what this test pins is the grenade's own clock: still
    // live at 1.5s (long past its 0.5s flight), gone by 2.25s.
    for (let t = 0; t < 6; t++) e.update(0.25);
    expect(e.projectiles.length).toBe(1);
    expect(e.projectiles[0].fuseT!).toBeGreaterThan(0);
    for (let t = 0; t < 3; t++) e.update(0.25);
    expect(e.projectiles.length).toBe(0);
  });
});

describe("grenade throw range (b)", () => {
  it("a throw ordered at 400 lands at the 200 cap, on the same line", async () => {
    const e = await makeTown([mk("s1", "rifleman", "Sgt.")]);
    const leader = e.units.find((u) => u.side === "allies" && !u.npc)!;
    parkAxis(e);
    leader.x = 1000; leader.y = 675;
    e.castGround(leader, 1400, 675);
    expect(e.projectiles.length).toBe(1);
    const p = e.projectiles[0];
    expect(Math.hypot(p.tx - leader.x, p.ty - leader.y)).toBeCloseTo(200, 0);
    expect(p.ty).toBeCloseTo(675, 5);
    expect(p.tx).toBeGreaterThan(leader.x); // same direction, just shorter
  });

  it("a throw inside the cap lands where it was ordered", async () => {
    const e = await makeTown([mk("s1", "rifleman", "Sgt.")]);
    const leader = e.units.find((u) => u.side === "allies" && !u.npc)!;
    parkAxis(e);
    leader.x = 1000; leader.y = 675;
    e.castGround(leader, 1120, 675);
    expect(e.projectiles.length).toBe(1);
    const p = e.projectiles[0];
    expect(Math.hypot(p.tx - leader.x, p.ty - leader.y)).toBeCloseTo(120, 0);
    expect(p.tx).toBeCloseTo(1120, 5);
    expect(p.ty).toBeCloseTo(675, 5);
  });
});

describe("fleeing a live grenade (c)", () => {
  it("an unpinned AI man inside the blast runs clear before the fuse ends and takes no blast", async () => {
    const e = await makeTown([mk("s1", "rifleman", "Sgt."), mk("s2", "rifleman")]);
    parkAxis(e);
    const leader = e.units.find((u) => u.side === "allies" && !u.npc && u.type === "rifleman")!;
    const man = e.units.filter((u) => u.side === "allies" && !u.npc)[1];
    leader.x = 400; leader.y = 200;
    man.x = 1500; man.y = 675;
    liveFrag(e, 1500, 675, "axis");
    // Half the fuse: he is running — well past halfway out of
    // the 70 blast already (pathing bends the line, so this
    // asserts the run, not a sprint time).
    for (let t = 0; t < 4; t++) e.update(0.25);
    const dMid = Math.hypot(man.x - 1500, man.y - 675);
    expect(dMid).toBeGreaterThan(40);
    // The burst: he is well clear of it and untouched.
    for (let t = 0; t < 5; t++) e.update(0.25);
    expect(e.projectiles.length).toBe(0);
    expect(man.alive).toBe(true);
    expect(man.hp).toBe(man.maxHp);
  });

  it("an enemy man flees an allied frag the same way", async () => {
    const e = await makeTown([mk("s1", "rifleman", "Sgt.")]);
    const leader = e.units.find((u) => u.side === "allies" && !u.npc)!;
    const foe = e.units.find((u) => u.side === "axis")!;
    parkAxis(e, foe);
    leader.x = 400; leader.y = 200;
    foe.x = 1500; foe.y = 675;
    liveFrag(e, 1500, 675, "allies");
    for (let t = 0; t < 4; t++) e.update(0.25);
    expect(Math.hypot(foe.x - 1500, foe.y - 675)).toBeGreaterThan(40);
    for (let t = 0; t < 5; t++) e.update(0.25);
    expect(foe.alive).toBe(true);
    expect(foe.hp).toBe(foe.maxHp);
  });

  it("a gunner deployed on his bipod stays on the gun and takes the blast", async () => {
    const e = await makeTown([mk("s1", "rifleman", "Sgt."), mk("s2", "mg")]);
    parkAxis(e);
    const leader = e.units.find((u) => u.side === "allies" && !u.npc && u.type === "rifleman")!;
    const mg = e.units.find((u) => u.side === "allies" && !u.npc && u.type === "mg")!;
    leader.x = 400; leader.y = 200;
    mg.x = 1500; mg.y = 675;
    mg.prone = true; // down on the bipod: planted, cannot move
    liveFrag(e, 1500, 675, "axis");
    // Hold the fire on him: suppression in the prone band is
    // what keeps a gunner down on his bipod in the real game.
    for (let t = 0; t < 6; t++) {
      mg.suppression = 80;
      e.update(0.25);
    }
    expect(mg.x).toBeCloseTo(1500, 0);
    expect(mg.y).toBeCloseTo(675, 0);
    for (let t = 0; t < 3; t++) {
      mg.suppression = 80;
      e.update(0.25);
    }
    expect(e.projectiles.length).toBe(0);
    expect(mg.hp).toBeLessThan(mg.maxHp); // he ate it where he lay
  });

  it("a suppression-pinned man stays down in it instead of running", async () => {
    const e = await makeTown([mk("s1", "rifleman", "Sgt."), mk("s2", "rifleman")]);
    parkAxis(e);
    const leader = e.units.find((u) => u.side === "allies" && !u.npc && u.type === "rifleman")!;
    const man = e.units.filter((u) => u.side === "allies" && !u.npc)[1];
    // His leader stands at his shoulder, so the formation
    // anchor is already satisfied; the cover-seek clock is
    // held off so nothing but the grenade could move him.
    leader.x = 1490; leader.y = 675;
    man.x = 1500; man.y = 675;
    liveFrag(e, 1500, 675, "axis");
    for (let t = 0; t < 9; t++) {
      man.suppression = 100; // pinned, and staying pinned
      man.coverSeekT = 999;
      e.update(0.25);
    }
    expect(man.pinned).toBe(true);
    expect(Math.hypot(man.x - 1500, man.y - 675)).toBeLessThan(70);
    expect(man.hp).toBeLessThan(man.maxHp); // still inside when it burst
  });

  it("the player's own leader never auto-runs, even standing on the grenade", async () => {
    const e = await makeTown([mk("s1", "rifleman", "Sgt."), mk("s2", "rifleman")]);
    parkAxis(e);
    const leader = e.units.find((u) => u.side === "allies" && !u.npc && u.type === "rifleman")!;
    leader.x = 1500; leader.y = 675;
    liveFrag(e, 1500, 675, "axis");
    for (let t = 0; t < 6; t++) e.update(0.25);
    expect(leader.x).toBeCloseTo(1500, 0);
    expect(leader.y).toBeCloseTo(675, 0);
    for (let t = 0; t < 3; t++) e.update(0.25);
    expect(e.projectiles.length).toBe(0);
    expect(leader.hp).toBeLessThan(leader.maxHp); // his feet were his own choice
  });
});

describe("mine instant kill (d)", () => {
  it("a full-health man who steps on a mine dies outright; a bystander at the fringe takes the normal blast", async () => {
    const e = await makeBeach([mk("s-lead", "rifleman", "Sgt."), mk("s-step", "rifleman")]);
    expect(e.mines.length).toBeGreaterThan(10);
    const mine = e.mines[0];
    const stepper = e.units.find((u) => !u.npc && u.type === "rifleman" && u.id !== e.leaderId)!;
    const bystander = e.units.find((u) => u.id === e.leaderId)!;
    expect(stepper.hp).toBe(stepper.maxHp); // full health: the old 55 blast could never have killed him
    stepper.x = mine.x; stepper.y = mine.y;
    bystander.x = mine.x + 25; bystander.y = mine.y; // inside the 34 blast, outside the 11 trigger
    e.update(0.05); // a short tick: the mine check runs, nobody has time to wander out of his ring
    expect(mine.armed).toBe(false);
    expect(stepper.alive).toBe(false);
    expect(stepper.hp).toBe(0);
    // The bystander keeps the old maths: 55 falling off over
    // 34 — at 25 out he takes about 31 and lives.
    expect(bystander.alive).toBe(true);
    expect(bystander.hp).toBeLessThan(bystander.maxHp);
    expect(bystander.hp).toBeGreaterThan(bystander.maxHp - 45);
  });

  it("the lucky charm does not save him: the kill is not a hit, so the charm never rolls", async () => {
    const e = await makeBeach([mk("s-lead", "rifleman", "Sgt."), mk("s-step", "rifleman")]);
    const mine = e.mines[0];
    const stepper = e.units.find((u) => !u.npc && u.type === "rifleman" && u.id !== e.leaderId)!;
    stepper.equipment = ["charm"];
    stepper.charmUsed = false;
    stepper.x = mine.x; stepper.y = mine.y;
    // Force every die in the building to land on the charm's
    // number: if the damage path were used, the 15% intercept
    // (roll < 0.15) would fire and save him.
    const orig = Math.random;
    Math.random = () => 0;
    try {
      e.update(0.05);
    } finally {
      Math.random = orig;
    }
    expect(stepper.alive).toBe(false);
    expect(stepper.charmUsed).toBe(false); // it never even got its roll
  });
});

describe("mine visibility and avoidance (e)", () => {
  it("an unspotted mine is not drawn at all; only a revealed one is (source pin)", () => {
    const src = readFileSync(new URL("../engine.ts", import.meta.url), "utf8");
    const start = src.indexOf("private drawMines");
    expect(start).toBeGreaterThanOrEqual(0);
    const body = src.slice(start, src.indexOf("private ", start + 20));
    expect(body).toContain("if (!m.revealed) continue;");
  });

  it("once spotted, a mine stays revealed for the rest of the battle", async () => {
    const e = await makeBeach([mk("s-lead", "rifleman", "Sgt."), mk("s-eng", "engineer")]);
    const eng = e.units.find((u) => !u.npc && u.type === "engineer")!;
    const mine = e.mines[0];
    expect(mine.revealed).toBeFalsy();
    eng.x = mine.x - 40; eng.y = mine.y; // inside the 70 detector range
    e.update(0.05);
    expect(mine.revealed).toBe(true);
    // The engineer leaves; the mark does not.
    eng.x = 80; eng.y = 1180;
    for (let t = 0; t < 8; t++) {
      eng.x = 80; eng.y = 1180;
      e.update(0.25);
    }
    expect(mine.revealed).toBe(true);
    expect(mine.armed).toBe(true);
  });

  it("an AI man routed past a revealed mine steers around it and never enters the trigger ring", async () => {
    const e = await makeBeach([mk("s-lead", "rifleman", "Sgt."), mk("s-eng", "engineer"), mk("s-walk", "rifleman")]);
    const eng = e.units.find((u) => !u.npc && u.type === "engineer")!;
    const walker = e.units.find((u) => !u.npc && u.type === "rifleman" && u.id !== e.leaderId && u !== eng)!;
    const mine = e.mines[0];
    // Spot it, then take the engineer off the field so he
    // cannot clear it mid-test.
    eng.x = mine.x - 40; eng.y = mine.y;
    e.update(0.05);
    expect(mine.revealed).toBe(true);
    eng.x = 80; eng.y = 1180;
    // Route the walker straight through the mine's position.
    walker.x = mine.x - 120; walker.y = mine.y;
    walker.orders = [{ x: mine.x + 120, y: mine.y }];
    let minD = Infinity;
    for (let t = 0; t < 32; t++) {
      for (const u of e.units) if (u.npc) { u.x = 40; u.y = 1180; }
      eng.x = 80; eng.y = 1180;
      e.update(0.25);
      minD = Math.min(minD, Math.hypot(walker.x - mine.x, walker.y - mine.y));
      if (walker.x > mine.x + 40) break;
    }
    expect(walker.x).toBeGreaterThan(mine.x + 40); // he got past it
    expect(minD).toBeGreaterThan(11); // and never inside the ring
    expect(mine.armed).toBe(true); // so it never went off
    expect(walker.alive).toBe(true);
  });

  it("the leader is not steered: a revealed mine is his warning, not an autopilot", async () => {
    const e = await makeBeach([mk("s-lead", "rifleman", "Sgt."), mk("s-eng", "engineer")]);
    const eng = e.units.find((u) => !u.npc && u.type === "engineer")!;
    const leader = e.units.find((u) => u.id === e.leaderId)!;
    const mine = e.mines[0];
    eng.x = mine.x - 40; eng.y = mine.y;
    e.update(0.05);
    expect(mine.revealed).toBe(true);
    // Drive him straight over the plate with the same funnel
    // his WASD keys use: no bend is applied to his line.
    leader.x = mine.x - 120; leader.y = mine.y;
    let minD = Infinity;
    for (let t = 0; t < 60; t++) {
      e.moveToward(leader, mine.x + 120, mine.y, 0.05);
      minD = Math.min(minD, Math.hypot(leader.x - mine.x, leader.y - mine.y));
      if (leader.x > mine.x + 40) break;
    }
    expect(leader.x).toBeGreaterThan(mine.x + 40);
    expect(minD).toBeLessThanOrEqual(11);
  });
});
