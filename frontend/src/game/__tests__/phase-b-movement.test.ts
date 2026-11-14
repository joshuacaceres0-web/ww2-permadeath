// @vitest-environment node
// Phase B of the 2026-11-13 voice-call package (Josh):
//  - vaulting: a footman on the move hops a low crate with
//    open ground behind it instead of pathing around;
//  - the PRONE button: still = go prone and stay (latch);
//    moving = DOLPHIN DIVE forward, landing prone with a
//    minimum hold the auto prone rule cannot undo;
//  - AI footmen running to cover sometimes dolphin dive the
//    last stretch into it (one roll per cover run).
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
  (globalThis as unknown as Record<string, unknown>).requestAnimationFrame = () => 0;
  (globalThis as unknown as Record<string, unknown>).cancelAnimationFrame = () => {};
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

const loadEngine = async () => (await import("../engine")).GameEngine;
const loadSprites = async () => await import("../sprites");

const SQUAD = [
  { id: "s-a", name: "Able", type: "rifleman", rank: "Pvt.", level: 0, medals: [], quirks: [] },
  { id: "s-b", name: "Baker", type: "rifleman", rank: "Sgt.", level: 3, medals: [], quirks: [] },
  { id: "s-c", name: "Charlie", type: "medic", rank: "Cpl.", level: 1, medals: [], quirks: [] },
];

const TOWN = {
  id: "op_02", index: 1, code: "SILENT CHATEAU", location: "test", objective: "test",
  difficulty: "MEDIUM", reward: 200, terrain: "town", brief: "test",
  enemies: [{ type: "grenadier", wave: 1, count: 1 }],
};

type U = {
  id: number; side: string; npc: boolean; alive: boolean; x: number; y: number;
  hp: number; maxHp: number; name: string; type: string; prone: boolean; suppression: number;
  leapT?: number; leapKind?: string; proneLatch?: boolean; proneHoldUntil?: number;
  coverDiveTried?: boolean; coverDestX?: number; coverDestY?: number;
  orders: Array<{ x: number; y: number }>; cover: unknown;
};

type Engine = {
  setup: (m: unknown, s: unknown, b: number, v?: string, cl?: number, lp?: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  units: U[];
  leaderUnit: () => U | null;
  leaderProneToggle: () => void;
  keys: Set<string>;
  elapsed: number;
  isFollower: (u: U) => boolean;
  blockers: Array<{ x: number; y: number; r: number; kind: string }>;
  covers: Array<{ x: number; y: number; r: number }>;
  pointBlocked: (x: number, y: number) => boolean;
  seekCover: (u: U, radius: number) => boolean;
};

async function makeEngine() {
  const GameEngine = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => unknown }).createElement("canvas");
  const e = new GameEngine(canvas as never, () => {}) as unknown as Engine;
  e.setup(TOWN, SQUAD, 0, "", 1, "");
  return e;
}

/** Park every enemy far away with a mountain of HP: a lone
 * parked grenadier near an edge gets shot or breaks and
 * deserts within a second, which ends the battle (phase
 * "over") and freezes every later assertion. */
function parkEnemies(e: Engine) {
  for (const u of e.units) if (u.side === "axis") {
    u.x = 3900; u.y = 675;
    u.hp = 100000; u.maxHp = 100000;
  }
}

describe("phase B: vaulting", () => {
  it("a footman ordered straight over a crate vaults it", async () => {
    const e = await makeEngine();
    e.begin();
    parkEnemies(e);
    // A crate pile with clear ground on both sides: crates
    // are placed as a tight three-crate pile, so the stage
    // point is west of the pile and the order's destination
    // is well east of it.
    const laneClear = (b: { x: number; y: number; r: number }) => {
      for (const p of [{ x: b.x - 45, y: b.y }, { x: b.x + 80, y: b.y }]) {
        if (e.pointBlocked(p.x, p.y)) return false;
      }
      return true;
    };
    const crate = e.blockers.find((b) => b.kind === "crate" && laneClear(b));
    expect(crate).toBeTruthy();
    const man = e.units.find((u) => e.isFollower(u) && u.alive && u.type === "rifleman")!;
    man.x = crate!.x - 45; man.y = crate!.y;
    man.orders = [{ x: crate!.x + 80, y: crate!.y }];
    let sawVault = false;
    for (let t = 0; t < 5; t += 0.05) {
      e.update(0.05);
      if (man.leapKind === "vault" || (man.leapT ?? 0) > 0) sawVault = true;
      if (man.x > crate!.x + 40) break;
    }
    expect(sawVault).toBe(true);
    expect(man.x).toBeGreaterThan(crate!.x + 40);
  }, 60000);
});

describe("phase B: prone button and the dolphin dive", () => {
  it("pressed standing still: prone, latched, and the latch holds him down", async () => {
    const e = await makeEngine();
    e.begin();
    parkEnemies(e);
    const lead = e.leaderUnit()!;
    lead.suppression = 0;
    e.leaderProneToggle();
    expect(lead.prone).toBe(true);
    expect(lead.proneLatch).toBe(true);
    // The auto rule (suppression < 30 stands a man up) must
    // not undo the latch.
    for (let t = 0; t < 2; t += 0.1) e.update(0.1);
    expect(lead.prone).toBe(true);
    // Pressing again stands him up.
    e.leaderProneToggle();
    expect(lead.prone).toBe(false);
    expect(lead.proneLatch).toBe(false);
  });

  it("pressed while moving: a dolphin dive forward, landing prone with a hold", async () => {
    const e = await makeEngine();
    e.begin();
    parkEnemies(e);
    const lead = e.leaderUnit()!;
    lead.x = 500; lead.y = 675;
    lead.suppression = 0;
    const x0 = lead.x;
    e.keys.add("d"); // running east
    e.update(0.1);
    expect(lead.x).toBeGreaterThan(x0);
    e.leaderProneToggle();
    expect(lead.leapKind).toBe("dive");
    // Ride the leap out (keys still down: no walking mid-air).
    for (let t = 0; t < 0.5; t += 0.05) e.update(0.05);
    e.keys.delete("d");
    expect(lead.leapT ?? 0).toBe(0);
    expect(lead.x).toBeGreaterThan(x0 + 30); // the leap carried him forward
    expect(lead.prone).toBe(true);
    expect(lead.proneLatch).toBe(true);
    expect((lead.proneHoldUntil ?? 0)).toBeGreaterThan(e.elapsed);
    // The hold + latch keep him down after the arc.
    for (let t = 0; t < 1; t += 0.1) e.update(0.1);
    expect(lead.prone).toBe(true);
  });

  it("the painter has a real dive pose, distinct from prone", async () => {
    const { sprite } = await loadSprites();
    const dive = sprite("us", "dive", "rifle", "us", false) as unknown as { width: number; height: number };
    const prone = sprite("us", "prone", "rifle", "us", false) as unknown as { width: number; height: number };
    expect(dive.width).toBe(prone.width);
    expect(dive).not.toBe(prone);
  });
});

describe("phase B: AI dolphin dives into cover", () => {
  it("with the roll forced, a man running to cover dives the last stretch and lands prone in it", async () => {
    const e = await makeEngine();
    e.begin();
    const realRandom = Math.random;
    Math.random = () => 0.1; // under the 0.35 dive chance, every run
    try {
      const cover = e.covers.find((c) => c.x > 900 && c.x < 3000);
      expect(cover).toBeTruthy();
      const foe = e.units.find((u) => u.side === "axis" && u.alive)!;
      foe.x = cover!.x + 210; foe.y = cover!.y;
      foe.hp = 100000; foe.maxHp = 100000;
      const man = e.units.find((u) => u.npc && u.side === "allies" && u.alive && u.type === "rifleman")
        ?? e.units.find((u) => u.npc && u.side === "allies" && u.alive)!;
      // Park everyone else: another enemy's fire can pin the
      // runner before his dive window, and another ally can
      // claim the cover spot first — both made this test flip
      // between runs.
      for (const u of e.units) {
        if (u === man || u === foe || !u.alive) continue;
        u.x = u.side === "axis" ? 3900 : 60;
        u.y = u.side === "axis" ? 60 : 1290;
        if (u.side === "axis") { u.hp = 100000; u.maxHp = 100000; }
      }
      man.x = cover!.x - 160; man.y = cover!.y;
      man.suppression = 0;
      // Pin the destination: with the full cover list in
      // play, seekCover's scoring sometimes sends him to a
      // different cover across a crate pile — he vaults it
      // (orders cleared), and the dive never gets its
      // window. One cover on the map makes the run the test
      // is about.
      (e as unknown as { covers: unknown[] }).covers = [cover];
      expect(e.seekCover(man as never, 220)).toBe(true);
      expect(man.coverDestX).toBeDefined();
      let sawDive = false;
      for (let t = 0; t < 12; t += 0.05) {
        e.update(0.05);
        if (man.leapKind === "dive") sawDive = true;
        if (sawDive && (man.leapT ?? 0) <= 0) break;
      }
      // Let the cover recompute (a 0.12s cadence) claim the
      // spot he landed on before asserting it.
      for (let t = 0; t < 0.5; t += 0.05) e.update(0.05);
      // The dive is the proof: the only dive source for a
      // non-leader is the cover-run check (the coverDiveTried
      // flag itself is re-stamped by any later re-seek, so
      // its sampled end-state is racy by design and is not
      // asserted).
      expect(sawDive).toBe(true);
      expect(man.prone).toBe(true); // landed prone...
      expect(man.cover).toBeTruthy(); // ...in the cover he was running for
    } finally {
      Math.random = realRandom;
    }
  }, 120000);
});
