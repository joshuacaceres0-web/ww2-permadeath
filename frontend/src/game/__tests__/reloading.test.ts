// @vitest-environment node
// Reloading (Josh, 2026-11-13): every weapon has a magazine.
// A man fires it dry, then cannot fire while he reloads — an
// amber bar fills over his head — then he is back in the fight.
// MG belts take longest, pistols are fastest, rifles and the
// sniper sit between. Both sides live by it; vehicles and
// mortars are exempt (crew-served, their own slow cycle).
import { describe, expect, it } from "vitest";
import { UNIT_TYPES, ENEMY_TYPES } from "../data";

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

const SQUAD = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 2, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
  { id: "s4", name: "Chester Pruitt", type: "medic", rank: "Pvt.", level: 1, medals: [] },
  { id: "s5", name: "Raymond Boyd", type: "mg", rank: "Pvt.", level: 1, medals: [] },
  { id: "s6", name: "Tom Reilly", type: "radioman", rank: "Pvt.", level: 1, medals: [] },
] as const;

const TOWN = {
  id: "op_02",
  index: 1,
  code: "SILENT CHATEAU",
  location: "test",
  objective: "test",
  difficulty: "HARD",
  reward: 400,
  terrain: "town",
  brief: "test",
  enemies: [{ type: "volks", wave: 1, count: 3 }],
} as const;

type U = {
  id: number; side: string; npc: boolean; type: string; enemyType: string | null;
  alive: boolean; x: number; y: number; hp: number; maxHp: number;
  cooldown: number; speed: number; mag: number; magSize: number;
  reloadT: number; reloadTime: number; reloadTotal: number;
  lastShotT?: number; burst: number; burstTarget: { x: number; y: number } | null;
};
type Engine = {
  setup: (m: unknown, s: unknown, b: number, v: string, cl?: number, leader?: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  units: U[];
  leaderId: number | null;
  elapsed: number;
  manualShot: { x: number; y: number; until: number } | null;
  callTank: () => boolean;
};

async function makeEngine(leader?: string) {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {}) as unknown as Engine;
  engine.setup(TOWN as never, SQUAD as never, 0, "", 8, leader);
  engine.begin();
  return engine;
}

/** Park and freeze everyone except the two duelists. */
function isolate(e: Engine, keep: U[]) {
  for (const u of e.units) {
    if (keep.includes(u)) continue;
    u.x = u.side === "allies" ? 40 : 3950;
    u.y = 40;
    u.speed = 0;
    u.cooldown = 9999;
  }
}

/** Run a duel for `seconds`, pinning the pair in place, holding
 * the foe's fire, and counting the shooter's shots by their
 * muzzle stamps. A shot counts as DURING the reload only when
 * the reload was still running at both ends of its tick: the
 * shot that lands in the same update the reload completes is
 * the man firing the instant his magazine seats, which is the
 * rule working, not breaking. */
function duel(e: Engine, shooter: U, foe: U, seconds: number) {
  const sx = shooter.x, sy = shooter.y, fx = foe.x, fy = foe.y;
  let shots = 0;
  let prev = shooter.lastShotT ?? -1;
  let sawReload = false;
  let shotsWhenReloadStarted = -1;
  let shotsDuringReload = 0;
  let reloadTotalSeen = 0;
  for (let t = 0; t < seconds; t += 0.1) {
    shooter.x = sx; shooter.y = sy;
    foe.x = fx; foe.y = fy;
    foe.cooldown = 999; // the foe never shoots in an allied duel
    const wasReloading = shooter.reloadT > 0;
    e.update(0.1);
    if (shooter.lastShotT !== undefined && shooter.lastShotT !== prev) {
      shots++;
      prev = shooter.lastShotT;
      if (wasReloading && shooter.reloadT > 0) shotsDuringReload++;
    }
    if (shooter.reloadT > 0 && !sawReload) {
      sawReload = true;
      shotsWhenReloadStarted = shots;
      reloadTotalSeen = shooter.reloadTotal;
    }
  }
  return { shots, sawReload, shotsWhenReloadStarted, shotsDuringReload, reloadTotalSeen };
}

describe("reloading", () => {
  it("the spec table: MG belts longest, pistols fastest, vehicles and mortars exempt", () => {
    const infantry = [
      ...Object.values(UNIT_TYPES).filter((t) => !t.vehicle),
      ...Object.values(ENEMY_TYPES).filter((t) => !t.vehicle && t.type !== "mortar"),
    ];
    const times = infantry.map((t) => t.reloadTime);
    expect(Math.max(...times)).toBe(4.5); // the two MG belts
    expect(UNIT_TYPES.mg.reloadTime).toBe(4.5);
    expect(ENEMY_TYPES.mg42.reloadTime).toBe(4.5);
    expect(Math.min(...times.filter((t) => t > 0))).toBe(1.2); // pistols
    expect(ENEMY_TYPES.funk.reloadTime).toBe(1.2);
    expect(ENEMY_TYPES.officer.reloadTime).toBe(1.2);
    expect(ENEMY_TYPES.medic.reloadTime).toBe(1.2);
    // Rifles and the sniper between the extremes.
    expect(UNIT_TYPES.rifleman.magSize).toBe(8); // the Garand's en bloc
    expect(UNIT_TYPES.rifleman.reloadTime).toBe(2.2);
    expect(UNIT_TYPES.sniper.magSize).toBe(5);
    expect(UNIT_TYPES.at.magSize).toBe(1); // a bazooka is loaded after every shot
    // Exempt: no magazine at all.
    for (const t of ["tank", "panzer", "halftrack", "truck", "mortar"] as const) {
      const spec = t in UNIT_TYPES ? UNIT_TYPES[t as keyof typeof UNIT_TYPES] : ENEMY_TYPES[t as keyof typeof ENEMY_TYPES];
      expect(spec.magSize).toBe(0);
    }
  });

  it("a rifleman fires his 8, goes silent for the reload, then fires again", async () => {
    const e = await makeEngine();
    const shooter = e.units.find((u) => u.side === "allies" && !u.npc && u.type === "rifleman" && u.id !== e.leaderId)!;
    const foe = e.units.find((u) => u.side === "axis")!;
    isolate(e, [shooter, foe]);
    shooter.x = 500; shooter.y = 675;
    foe.x = 650; foe.y = 675;
    foe.hp = 100000; foe.maxHp = 100000;
    const r = duel(e, shooter, foe, 11);
    expect(r.sawReload).toBe(true);
    expect(r.shotsWhenReloadStarted).toBe(8); // exactly one Garand magazine
    expect(r.shotsDuringReload).toBe(0); // not one shot while he reloads
    expect(r.reloadTotalSeen).toBeCloseTo(2.2, 1);
    expect(r.shots).toBeGreaterThan(8); // and he is back in the fight
    expect(shooter.mag).toBeLessThan(8);
  }, 60000);

  it("an enemy volks lives by it too: 5 from the Kar98k, silence, then fire again", async () => {
    const e = await makeEngine();
    const volks = e.units.find((u) => u.side === "axis")!;
    const target = e.units.find((u) => u.side === "allies" && !u.npc && u.type === "rifleman")!;
    isolate(e, [volks, target]);
    volks.x = 650; volks.y = 675;
    target.x = 500; target.y = 675;
    target.hp = 100000; target.maxHp = 100000;
    // The target holds his fire (the duel helper freezes the
    // SECOND unit's cooldown; here the shooter is the axis man,
    // so run the same loop by hand with roles as they lie).
    let shots = 0;
    let prev = volks.lastShotT ?? -1;
    let shotsWhenReloadStarted = -1;
    let shotsDuringReload = 0;
    for (let t = 0; t < 14; t += 0.1) {
      volks.x = 650; volks.y = 675;
      target.x = 500; target.y = 675;
      target.cooldown = 999;
      const wasReloading = volks.reloadT > 0;
      e.update(0.1);
      if (volks.lastShotT !== undefined && volks.lastShotT !== prev) {
        shots++;
        prev = volks.lastShotT;
        if (wasReloading && volks.reloadT > 0) shotsDuringReload++;
      }
      if (volks.reloadT > 0 && shotsWhenReloadStarted < 0) shotsWhenReloadStarted = shots;
    }
    expect(shotsWhenReloadStarted).toBe(5);
    expect(shotsDuringReload).toBe(0);
    expect(shots).toBeGreaterThan(5);
  }, 60000);

  it("the leader's own clicked fire stops at empty and resumes after the reload", async () => {
    const e = await makeEngine("s1");
    const leader = e.units.find((u) => u.id === e.leaderId)!;
    isolate(e, [leader]);
    leader.x = 500; leader.y = 675;
    leader.mag = 2; // two rounds left in his Garand
    let shots = 0;
    let prev = leader.lastShotT ?? -1;
    let shotsWhenReloadStarted = -1;
    let shotsDuringReload = 0;
    for (let t = 0; t < 8; t += 0.1) {
      leader.x = 500; leader.y = 675;
      // A fresh click at a point 150 east, every tick.
      e.manualShot = { x: 650, y: 675, until: e.elapsed + 0.5 };
      const wasReloading = leader.reloadT > 0;
      e.update(0.1);
      if (leader.lastShotT !== undefined && leader.lastShotT !== prev) {
        shots++;
        prev = leader.lastShotT;
        if (wasReloading && leader.reloadT > 0) shotsDuringReload++;
      }
      if (leader.reloadT > 0 && shotsWhenReloadStarted < 0) shotsWhenReloadStarted = shots;
    }
    expect(shotsWhenReloadStarted).toBe(2);
    expect(shotsDuringReload).toBe(0); // clicks during the reload fire nothing
    expect(shots).toBeGreaterThan(2);
  }, 60000);

  it("an MG barrage dies with its belt: 3 rounds left means 3 rounds fired", async () => {
    const e = await makeEngine();
    const mg = e.units.find((u) => u.side === "allies" && !u.npc && u.type === "mg")!;
    const foe = e.units.find((u) => u.side === "axis")!;
    isolate(e, [mg, foe]);
    mg.x = 500; mg.y = 675;
    foe.x = 650; foe.y = 675;
    foe.hp = 100000; foe.maxHp = 100000;
    mg.mag = 3;
    // The state Suppressive Barrage leaves behind: 16 rounds
    // walking across the target area, one every 0.06s.
    mg.burst = 16;
    mg.burstTarget = { x: 650, y: 675 };
    let shots = 0;
    let prev = mg.lastShotT ?? -1;
    for (let t = 0; t < 2; t += 0.02) {
      foe.cooldown = 999;
      e.update(0.02);
      if (mg.lastShotT !== undefined && mg.lastShotT !== prev) { shots++; prev = mg.lastShotT; }
    }
    expect(shots).toBe(3);
    expect(mg.burst).toBe(0);
    expect(mg.reloadT).toBeGreaterThan(0);
    expect(mg.reloadTotal).toBeCloseTo(4.5, 1); // the belt takes longest
  }, 60000);

  it("the Sherman never reloads: it keeps firing straight through", async () => {
    const e = await makeEngine();
    expect(e.callTank()).toBe(true);
    const tank = e.units.find((u) => u.type === "tank")!;
    expect(tank.magSize).toBe(0);
    const foe = e.units.find((u) => u.side === "axis")!;
    isolate(e, [tank, foe]);
    tank.x = 500; tank.y = 675;
    foe.x = 700; foe.y = 675;
    foe.hp = 100000; foe.maxHp = 100000;
    let shots = 0;
    let prev = tank.lastShotT ?? -1;
    for (let t = 0; t < 12; t += 0.1) {
      tank.x = 500; tank.y = 675;
      foe.x = 700; foe.y = 675;
      foe.cooldown = 999;
      e.update(0.1);
      if (tank.lastShotT !== undefined && tank.lastShotT !== prev) { shots++; prev = tank.lastShotT; }
      expect(tank.reloadT).toBe(0);
    }
    expect(shots).toBeGreaterThanOrEqual(3);
  }, 60000);
});
