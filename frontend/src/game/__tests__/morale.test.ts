// @vitest-environment node
// Morale: drops under fire, casualties and suppression; recovers out
// of fire, faster near a medic or a leader; at 20 a man breaks and
// falls back instead of fighting; at 45 he rallies.
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

const SQUAD = [
  { id: "s1", name: "Boyd", rank: "Sgt", level: 1, type: "rifleman", hp: 100, kills: 0, medals: [] },
  { id: "s2", name: "Kowalski", rank: "Cpl", level: 1, type: "medic", hp: 100, kills: 0, medals: [] },
  { id: "s3", name: "Reyes", rank: "Pfc", level: 1, type: "mg", hp: 100, kills: 0, medals: [] },
  { id: "s4", name: "Novak", rank: "Pfc", level: 1, type: "sniper", hp: 100, kills: 0, medals: [] },
  { id: "s5", name: "Hale", rank: "Pvt", level: 1, type: "at", hp: 100, kills: 0, medals: [] },
] as never;

type U = Record<string, unknown> & {
  x: number; y: number; hp: number; maxHp: number; morale: number; broken: boolean;
  suppression: number; lastHitT: number; side: string; npc: boolean; type: string;
};
type AnyEngine = Record<string, unknown> & {
  units: U[];
  update: (dt: number) => void;
  damage: (u: U, dmg: number, source: string, killer: number | null) => void;
  elapsed: number;
};

async function makeEngine() {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {});
  engine.setup(MISSION as never, SQUAD as never, 0, "");
  engine.begin();
  const e = engine as unknown as AnyEngine;
  // Deterministic by default: no flee roll in morale tests.
  (e as unknown as { fleeChance: number }).fleeChance = 0;
  (e as unknown as { fleeChanceNormal: number }).fleeChanceNormal = 0;
  return e;
}

function step(e: AnyEngine, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) e.update(1 / 60);
}

function park(e: AnyEngine, west = true) {
  // Park everyone on their own side, far from the enemy, so the
  // sim measures morale alone and nobody shoots anybody. The enemy
  // is also disarmed (range 0): a stray long-range bullet used to
  // land mid-test and reset the recovery clock, failing the recovery
  // tests about one run in four.
  for (const u of e.units) {
    if (u.side === "allies") { u.x = 200; u.y = 600; }
    else { u.x = 2100; u.y = 600; (u as Record<string, unknown>).range = 0; }
    (u as Record<string, unknown>).speed = 0;
  }
}

// Same disarm, for tests that cannot park (the broken man must be
// able to run, so his speed stays).
function disarmEnemy(e: AnyEngine) {
  for (const u of e.units) {
    if (u.side === "axis") (u as Record<string, unknown>).range = 0;
  }
}

describe("replay records morale, cover and medics", () => {
  it("every replay frame carries morale, broken, cover type and medic flags", async () => {
    const e = await makeEngine();
    const hurt = e.units.find((x) => x.side === "allies" && !x.npc && x.type === "rifleman")!;
    e.damage(hurt, 40, "rifle", null);
    // Only 1s: long enough to record a frame after the hit, short
    // enough that his morale has not climbed back to 100 yet.
    step(e, 1);
    const replay = (e as unknown as { getReplay: () => { frames: Array<{ units: Array<Record<string, unknown>> }> } | null }).getReplay();
    expect(replay).not.toBeNull();
    const last = replay!.frames[replay!.frames.length - 1];
    expect(last.units.length).toBeGreaterThan(0);
    for (const u of last.units) {
      expect(typeof u.morale).toBe("number");
      expect(typeof u.broken).toBe("boolean");
      expect(typeof u.medic).toBe("boolean");
      expect(u.coverType === null || u.coverType === "light" || u.coverType === "heavy").toBe(true);
      expect(u.coverKind === null || u.coverKind === "trench").toBe(true);
      if (u.cover === true) expect(u.coverType === "light" || u.coverType === "heavy").toBe(true);
    }
    const hurtNow = last.units.find((u) => u.id === (hurt as unknown as { id: number }).id)!;
    expect(hurtNow.morale as number).toBeLessThan(100);
    const medics = last.units.filter((u) => u.medic === true);
    expect(medics.length).toBeGreaterThanOrEqual(2); // player medic + at least the enemy medic
  });

  it("morale bar colours match the live game", async () => {
    const { moraleBarColor } = await import("../../components/game/ReplayViewer");
    expect(moraleBarColor(100, false)).toBe("#7FB069");
    expect(moraleBarColor(50, false)).toBe("#E5A93C");
    expect(moraleBarColor(20, false)).toBe("#E24A4A");
    expect(moraleBarColor(90, true)).toBe("#E24A4A");
  }, 30000);
});

describe("morale", () => {
  it("starts at 100 for every man", async () => {
    const e = await makeEngine();
    expect(e.units.every((u) => u.morale === 100 && u.broken === false)).toBe(true);
  });

  it("a hit drops morale by 0.3 per HP lost", async () => {
    const e = await makeEngine();
    const u = e.units.find((x) => x.side === "axis" && x.type === "rifleman")!;
    e.damage(u, 40, "rifle", null);
    expect(u.morale).toBeCloseTo(88, 5);
    expect(u.hp).toBeLessThan(u.maxHp);
  });

  it("a nearby casualty shakes the men beside him", async () => {
    const e = await makeEngine();
    park(e);
    const victim = e.units.find((x) => x.side === "allies" && !x.npc && x.type === "rifleman")!;
    const near = e.units.find((x) => x.side === "allies" && !x.npc && x.type === "mg")!;
    victim.x = 200; victim.y = 600;
    near.x = 220; near.y = 600;
    const far = e.units.find((x) => x.side === "allies" && x.npc)!;
    far.x = 200; far.y = 200;
    e.damage(victim, 999, "rifle", null);
    expect(victim.alive).toBe(false);
    expect(near.morale).toBeLessThanOrEqual(92); // -8 nearby
    expect(far.morale).toBeGreaterThan(near.morale); // -4 far away
  });

  it("morale recovers out of fire", async () => {
    const e = await makeEngine();
    park(e);
    // The MG man, not the rifleman: the rifleman is Boyd, the Sgt,
    // so he counts as his own leader and would get the leader bonus.
    const u = e.units.find((x) => x.side === "allies" && !x.npc && x.type === "mg")!;
    u.morale = 50;
    u.lastHitT = -100; // long out of fire
    u.suppression = 0;
    // Move the medic and the sergeant to the top corner: far from
    // the man (no bonus) and far from the enemy (nobody gets shot,
    // so no casualty shock resets the recovery clock mid-test).
    for (const a of e.units) {
      if (a !== u && a.side === "allies") { a.x = 200; a.y = 200; }
    }
    step(e, 5);
    expect(u.morale).toBeGreaterThan(50);
    expect(u.morale).toBeLessThan(71); // 4/s base, 5s = +20
  });

  it("morale recovers faster beside a medic", async () => {
    const e = await makeEngine();
    park(e);
    const u = e.units.find((x) => x.side === "allies" && !x.npc && x.type === "rifleman")!;
    const medic = e.units.find((x) => x.side === "allies" && !x.npc && x.type === "medic")!;
    u.morale = 50;
    u.lastHitT = -100;
    u.suppression = 0;
    medic.x = 210; medic.y = 600; // beside the man
    // Sergeant in the top corner: no leader bonus in this run, and
    // nobody in range of the enemy, so no casualty shock mid-test.
    for (const a of e.units) {
      if (a !== u && a !== medic && a.side === "allies") { a.x = 200; a.y = 200; }
    }
    step(e, 5);
    expect(u.morale).toBeGreaterThan(70); // 4 base + 4 medic = 8/s
  });

  it("a broken man falls back away from the enemy and does not shoot", async () => {
    const e = await makeEngine();
    disarmEnemy(e);
    const u = e.units.find((x) => x.side === "allies" && !x.npc && x.type === "rifleman")!;
    u.x = 800; u.y = 600;
    u.morale = 10;
    u.lastHitT = -100; // out of fire so he does not keep dropping
    u.suppression = 0;
    const startX = u.x;
    const killsBefore = u.kills;
    step(e, 4);
    expect(u.broken).toBe(true);
    expect(u.x).toBeLessThan(startX - 20); // ran west, away from the squad
    expect(u.kills).toBe(killsBefore);
  });

  it("a broken man rallies once his morale climbs back to 45", async () => {
    const e = await makeEngine();
    park(e);
    const u = e.units.find((x) => x.side === "allies" && !x.npc && x.type === "rifleman")!;
    u.morale = 10;
    u.lastHitT = -100;
    u.suppression = 0;
    step(e, 1);
    expect(u.broken).toBe(true);
    // The medic and the sergeant are parked right beside him in
    // park(), so he recovers at 11/s and rallies in a few seconds.
    step(e, 10);
    expect(u.morale).toBeGreaterThanOrEqual(45);
    expect(u.broken).toBe(false);
  });
});
