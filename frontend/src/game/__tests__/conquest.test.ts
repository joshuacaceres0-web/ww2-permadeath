// @vitest-environment node
// CONQUEST (Phase D, Josh, 2026-11-13): there are no waves.
// The whole enemy force deploys at the start, the trench lines
// are control points, holding every line at once wins, and the
// enemy can take a line back. These tests pin that structure
// on two operations (town = 3 lines, causeway = 2 lines).
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
  return { GameEngine: mod.GameEngine, CAPTURE_TIME: mod.CAPTURE_TIME };
};

const TOWN = {
  id: "op_02",
  code: "OPERATION SILENT CHATEAU",
  location: "Valognes Estate",
  objective: "test",
  difficulty: "HARD",
  reward: 400,
  terrain: "town",
  brief: "test",
  enemies: [
    { type: "grenadier", wave: 1, count: 2 },
    { type: "volks", wave: 1, count: 2 },
    { type: "volks", wave: 2, count: 2 },
    { type: "grenadier", wave: 3, count: 1 },
    { type: "mg42", wave: 3, count: 1 },
  ],
} as const; // total force: 8

const CAUSEWAY = {
  id: "op_03",
  code: "OPERATION IRON CROSSROADS",
  location: "Carentan Causeway",
  objective: "test",
  difficulty: "SEVERE",
  reward: 650,
  terrain: "causeway",
  brief: "test",
  enemies: [
    { type: "volks", wave: 1, count: 3 },
    { type: "grenadier", wave: 2, count: 2 },
  ],
} as const; // total force: 5

const SQUAD = [
  { id: "s1", name: "Boyd", rank: "Sgt", level: 1, type: "rifleman", hp: 100, kills: 0, medals: [] },
  { id: "s2", name: "Kowalski", rank: "Cpl", level: 1, type: "medic", hp: 100, kills: 0, medals: [] },
  { id: "s3", name: "Reyes", rank: "Pfc", level: 1, type: "mg", hp: 100, kills: 0, medals: [] },
  { id: "s4", name: "Novak", rank: "Pfc", level: 1, type: "sniper", hp: 100, kills: 0, medals: [] },
  { id: "s5", name: "Hale", rank: "Pvt", level: 1, type: "at", hp: 100, kills: 0, medals: [] },
] as never;

type U = Record<string, unknown> & {
  id: number; x: number; y: number; hp: number; alive: boolean;
  side: string; npc: boolean; type: string; enemyType: string | null;
  aggressive?: boolean; counterAttack?: boolean; isStatic: boolean;
};
type Pt = {
  label: string; x: number; y: number;
  owner: string; progress: number; contested: boolean;
  spots: Array<{ x: number; y: number }>;
};
type Hud = Record<string, unknown> & {
  log: Array<{ text: string }>; pointsHeld: number; pointsTotal: number;
};
type AnyEngine = Record<string, unknown> & {
  units: U[];
  points: Pt[];
  leaderId: number | null;
  update: (dt: number) => void;
  damage: (u: U, dmg: number, source: string, killer: number | null) => void;
  battleState: string;
  emitHud: () => void;
  retreat: () => void;
  setAutoBattle: (on: boolean) => void;
};

async function makeEngine(mission: unknown) {
  const { GameEngine, CAPTURE_TIME } = await loadEngine();
  let hud: Hud | null = null;
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, (h: Hud) => {
    hud = h;
  });
  engine.setup(mission as never, SQUAD as never, 0, "");
  engine.begin();
  const e = engine as unknown as AnyEngine;
  return {
    e,
    CAPTURE_TIME,
    hud: () => {
      e.emitHud();
      return hud as unknown as Hud;
    },
  };
}

function step(e: AnyEngine, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) e.update(1 / 60);
}

/** Step while holding men at fixed positions — the test's way
 * of standing a man in a trench line the way a player would. */
function pinStep(e: AnyEngine, pins: Array<{ u: U; x: number; y: number }>, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 4); i++) {
    for (const p of pins) {
      p.u.x = p.x;
      p.u.y = p.y;
    }
    step(e, 0.25);
  }
}

function axis(e: AnyEngine) {
  return e.units.filter((u) => u.side === "axis");
}
function roster(e: AnyEngine) {
  return e.units.filter((u) => u.side === "allies" && !u.npc);
}
function leader(e: AnyEngine) {
  return roster(e).find((u) => u.id === e.leaderId)!;
}
function killAllAxis(e: AnyEngine, except?: U[]) {
  for (const u of [...e.units]) {
    if (u.side === "axis" && u.alive && !(except ?? []).includes(u)) {
      e.damage(u, 99999, "rifle", null);
    }
  }
}
/** A standing spot inside a point's line: the middle spot,
 * 8 east of the trench floor, the way the garrison stands. */
function standSpot(p: Pt) {
  const s = p.spots[Math.floor(p.spots.length / 2)];
  return { x: s.x + 8, y: s.y };
}

describe("conquest deployment", () => {
  it("town: the full force is on the field at the start, and nothing arrives later", { timeout: 60000 }, async () => {
    const { e } = await makeEngine(TOWN);
    expect(axis(e).length).toBe(8); // every spec in all three groups
    expect(axis(e).every((u) => !u.aggressive)).toBe(true); // nobody charges on spawn
    step(e, 30);
    // No wave growth: the only legal arrivals are the timed
    // counter-attack pair (45s+, so none yet) — count is exact.
    expect(axis(e).length).toBe(8);
  });

  it("causeway: the full force deploys at the start too", { timeout: 60000 }, async () => {
    const { e } = await makeEngine(CAUSEWAY);
    expect(axis(e).length).toBe(5);
    expect(axis(e).every((u) => !u.aggressive)).toBe(true);
  });

  it("a depth man camps near his home instead of charging a player he never spotted", { timeout: 30000 }, async () => {
    const { e } = await makeEngine(TOWN);
    // The group 3 grenadier deploys in the east (x > 3200).
    const depth = axis(e).filter((u) => u.x > 3200 && u.enemyType === "grenadier");
    expect(depth.length).toBeGreaterThanOrEqual(1);
    const man = depth[0];
    const home = { x: man.x, y: man.y };
    step(e, 10);
    expect(man.alive).toBe(true);
    expect(Math.hypot(man.x - home.x, man.y - home.y)).toBeLessThan(250);
  });
});

describe("conquest control points", () => {
  it("town has 3 points, causeway has 2, all enemy-held, and the HUD says so", async () => {
    const town = await makeEngine(TOWN);
    expect(town.e.points.length).toBe(3);
    expect(town.e.points.map((p) => p.label)).toEqual(["A", "B", "C"]);
    expect(town.e.points.every((p) => p.owner === "axis")).toBe(true);
    expect(town.hud().pointsTotal).toBe(3);
    expect(town.hud().pointsHeld).toBe(0);
    const cw = await makeEngine(CAUSEWAY);
    expect(cw.e.points.length).toBe(2);
    expect(cw.hud().pointsTotal).toBe(2);
  });

  it("a point flips after an uncontested hold, and not before the clock runs out", async () => {
    const { e, CAPTURE_TIME } = await makeEngine(TOWN);
    killAllAxis(e);
    const p = e.points[0];
    const spot = standSpot(p);
    const lead = leader(e);
    pinStep(e, [{ u: lead, ...spot }], CAPTURE_TIME - 1);
    expect(p.owner).toBe("axis"); // 5 of 6 seconds is not the line
    pinStep(e, [{ u: lead, ...spot }], 2);
    expect(p.owner).toBe("allies");
    expect(p.progress).toBe(0);
  });

  it("contested ground does not flip", async () => {
    const { e, CAPTURE_TIME } = await makeEngine(TOWN);
    const foe = axis(e).find((u) => u.enemyType === "grenadier")!;
    killAllAxis(e, [foe]);
    const p = e.points[0];
    const spot = standSpot(p);
    const lead = leader(e);
    // Both men inside the same line but at opposite ends of it:
    // presence on both sides, and far enough apart (the line
    // runs ~1200) that they never spot each other and fight —
    // the contest is about ground, not a duel.
    const far = p.spots[0];
    pinStep(
      e,
      [
        { u: lead, ...spot },
        { u: foe, x: far.x + 8, y: far.y },
      ],
      CAPTURE_TIME + 4,
    );
    expect(p.contested).toBe(true);
    expect(p.owner).toBe("axis");
  });

  it("the enemy takes a line back once the squad leaves it", async () => {
    const { e, CAPTURE_TIME } = await makeEngine(TOWN);
    const foe = axis(e).find((u) => u.enemyType === "grenadier")!;
    killAllAxis(e, [foe]);
    foe.x = 3950;
    foe.y = 100; // parked far east, out of the way
    const p = e.points[0];
    const spot = standSpot(p);
    const lead = leader(e);
    pinStep(e, [{ u: lead, ...spot }], CAPTURE_TIME + 1);
    expect(p.owner).toBe("allies");
    // The squad leaves; the defender stands in the line instead.
    lead.x = 120;
    lead.y = 675;
    pinStep(e, [{ u: foe, ...spot }], CAPTURE_TIME + 1);
    expect(p.owner).toBe("axis");
  });

  it("retake pressure: the enemy is ordered back onto a lost line and retakes it", { timeout: 120000 }, async () => {
    const { e, CAPTURE_TIME } = await makeEngine(TOWN);
    // Leave the three depth men alive (the ones who deployed
    // in the east — the trench garrison is exempt from retake
    // duty by design), parked east of line A but outside
    // every point.
    const party = axis(e).filter((u) => !u.isStatic && u.x > 3200);
    expect(party.length).toBe(3);
    killAllAxis(e, party);
    // The 2nd Platoon is cleared too: its squads hunt any
    // enemy within 900, so a staged retake party gets cut
    // down crossing the town no matter where it parks (three
    // probe runs died exactly that way). The platoon's hunt
    // is covered by the npc suites; here it is a confound.
    for (const u of [...e.units]) {
      if (u.npc && u.alive) e.damage(u, 99999, "rifle", null);
    }
    const p = e.points[0];
    const lead = leader(e);
    const spot = standSpot(p);
    // Parked 420 east of line A, ON THE STREET: the street
    // is the one corridor the town generator keeps clear of
    // buildings, and 420 is beyond even the roster sniper's
    // reach of the line (340 + a follower's offset). A party
    // parked closer trades fire with the capture party
    // during the hold and arrives shot up or broken; a party
    // parked off-street gets hung up on the town's buildings
    // on the way back. Both are the game working; this test
    // isolates the retake itself.
    const { roadYAt } = await import("../engine");
    const park = { x: spot.x + 420, y: roadYAt(spot.x + 420) };
    party.forEach((u) => {
      u.x = park.x;
      u.y = park.y;
    });
    // Take line A while the party is pinned at its park.
    pinStep(
      e,
      [{ u: lead, ...spot }, ...party.map((u) => ({ u, ...park }))],
      CAPTURE_TIME + 1,
    );
    expect(p.owner).toBe("allies");
    // The squad leaves the line entirely (staged: the whole
    // roster is pulled back west, so the line stands empty).
    for (const u of e.units) {
      if (u.side === "allies" && !u.npc && u.alive) {
        u.x = 120;
        u.y = 675;
      }
    }
    // The retake clock (12s) sends the party; they walk back
    // in and stand in the empty line, and it flips.
    pinStep(e, party.map((u) => ({ u, ...park })), 5); // ride out the retake interval
    step(e, 35);
    expect(p.owner).toBe("axis");
  });

  it("killing every enemy files NO victory while the lines are untaken — and no fresh platoon men arrive", async () => {
    const { e } = await makeEngine(TOWN);
    const npcsBefore = e.units.filter((u) => u.npc && u.side === "allies").length;
    killAllAxis(e);
    step(e, 10);
    expect(e.battleState).toBe("active"); // ground, not bodies
    expect(e.points.every((p) => p.owner === "axis")).toBe(true);
    expect(e.units.filter((u) => u.npc && u.side === "allies").length).toBe(npcsBefore);
  });

  it("victory files when every line is held at once, and not while one is still enemy", async () => {
    const { e, CAPTURE_TIME } = await makeEngine(TOWN);
    killAllAxis(e);
    const men = roster(e);
    const pins = e.points.map((p, i) => ({ u: men[i], ...standSpot(p) }));
    // Hold A and B only: no victory while C is enemy.
    pinStep(e, pins.slice(0, 2), CAPTURE_TIME + 1);
    expect(e.points[0].owner).toBe("allies");
    expect(e.points[1].owner).toBe("allies");
    expect(e.battleState).toBe("active");
    // Take C as well: the battle files.
    pinStep(e, pins, CAPTURE_TIME + 1);
    expect(e.points.every((p) => p.owner === "allies")).toBe(true);
    expect(e.battleState).toBe("victory");
  });

  it("an AUTO squad mops up: clears the field, then walks the lines and wins", { timeout: 180000 }, async () => {
    const { e } = await makeEngine(TOWN);
    e.setAutoBattle(true);
    killAllAxis(e);
    let t = 0;
    while (e.battleState === "active" && t < 280) {
      step(e, 5);
      t += 5;
    }
    expect(e.battleState).toBe("victory");
  });
});

describe("conquest losses still file", () => {
  it("a squad wipe is a defeat", async () => {
    const { e } = await makeEngine(TOWN);
    for (const u of roster(e)) e.damage(u, 99999, "rifle", null);
    step(e, 2);
    expect(e.battleState).toBe("defeat");
  });

  it("a retreat still files a defeat", { timeout: 120000 }, async () => {
    const { e } = await makeEngine(TOWN);
    e.retreat();
    let t = 0;
    while (e.battleState === "active" && t < 170) {
      step(e, 5);
      t += 5;
    }
    expect(e.battleState).toBe("defeat");
  });
});
