// @vitest-environment node
// Trench combat (Josh's playtest bug, 2026-11-12): men in
// trenches froze — they did not shoot back and fire never hit
// them. Root cause, four parts: (1) THE freeze — the bullet
// sweep killed every round entering a trench blocker's r 14
// circle, and a seated man stands inside that circle, so no
// round ever reached him from either side and his own rounds
// toward the enemy died in the wall; the sweep now skips
// trenches like the blocked grid and collisions always did.
// (2) Rounds stopped by cover fed suppression at 0.7x against a
// 9/s decay, so a dug-in man pinned at 55 forever, and the fire
// gate was !pinned; pinned men in cover now return fire at a
// slower rate, and heavy cover (q 0.9+) absorbs more of a
// stopped round's suppression (0.35x). (3) coverBetween never
// required the cover to lie between shooter and target, so a
// seated man kept the 0.95 even against shots from directly
// behind him; flank fire now lands full. Locked here: a pinned
// trench man returns fire and his rounds land, an ordered man
// walks out, frontal damage is small but real, flank is full.
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

type CoverT = { x: number; y: number; r: number; q: number; kind: string };
type U = {
  id: number; side: string; npc: boolean; type: string; enemyType: string | null; alive: boolean;
  x: number; y: number; hp: number; maxHp: number;
  suppression: number; morale: number; pinned: boolean; shootT?: number;
  trenchHold?: boolean; cover: CoverT | null; attackId: number | null;
};

const SQUAD = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 2, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
  { id: "s3", name: "James Baker", type: "rifleman", rank: "Pvt.", level: 1, medals: [] },
  { id: "s4", name: "Chester Pruitt", type: "medic", rank: "Pvt.", level: 1, medals: [] },
  { id: "s5", name: "Raymond Boyd", type: "mg", rank: "Pvt.", level: 1, medals: [] },
] as const;

const OVERLORD_W1 = {
  id: "op_01",
  index: 0,
  code: "OVERLORD",
  location: "test",
  objective: "test",
  difficulty: "HARD",
  reward: 250,
  terrain: "dday",
  brief: "test",
  enemies: [
    { type: "volks", wave: 1, count: 6 },
    { type: "grenadier", wave: 1, count: 3 },
  ],
} as const;

type Engine = {
  setup: (m: unknown, s: unknown, b: number, v: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  selectUnit: (id: number) => void;
  issueOrder: (x: number, y: number, q: boolean) => void;
  units: U[];
  covers: CoverT[];
  bullets: Array<{ killerId: number | null }>;
};

async function makeEngine() {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {}) as unknown as Engine;
  engine.setup(OVERLORD_W1 as never, SQUAD as never, 0, "");
  return engine;
}

describe("trench combat", () => {
  it("a pinned garrison man in a trench still shoots back", async () => {
    const e = await makeEngine();
    e.begin();
    const volks = e.units.find((u) => u.trenchHold && u.enemyType === "volks")!;
    const ally = e.units.find((u) => u.side === "allies" && !u.npc && u.type === "rifleman")!;
    ally.x = volks.x - 120;
    ally.y = volks.y;
    volks.hp = 600; volks.maxHp = 600;
    ally.hp = 600; ally.maxHp = 600;
    let fired = false;
    for (let s = 0; s < 60 * 6; s++) {
      // Sustained incoming fire holds him at pinning suppression.
      volks.suppression = 90;
      e.update(1 / 60);
      if ((volks.shootT ?? 0) > 0.05 || e.bullets.some((b) => b.killerId === volks.id)) fired = true;
    }
    expect(volks.cover?.kind).toBe("trench");
    expect(volks.pinned).toBe(true);
    expect(fired).toBe(true);
    // And his rounds actually LAND — the ally in the open was hit
    // at least once. (Before the bullet-sweep fix his shots died
    // inside the trench blocker's circle and never reached out.)
    expect(ally.hp).toBeLessThan(600);
  });

  it("a squad man seated in a trench walks out when ordered", async () => {
    const e = await makeEngine();
    e.begin();
    const man = e.units.filter((u) => u.side === "allies" && !u.npc)[1];
    // Second trench line (x 2600), away from the wave 1 garrison.
    const spot = e.covers
      .filter((c) => c.kind === "trench")
      .sort((a, b) => Math.abs(a.x - 2600) - Math.abs(b.x - 2600))[0];
    man.x = spot.x + 8;
    man.y = spot.y;
    for (let s = 0; s < 15; s++) e.update(1 / 60);
    expect(man.cover?.kind).toBe("trench");
    e.selectUnit(man.id);
    e.issueOrder(man.x + 220, man.y, false);
    for (let s = 0; s < 60 * 3; s++) e.update(1 / 60);
    expect(man.x).toBeGreaterThan(spot.x + 120);
  });

  async function shotLoss(mode: "frontal" | "open" | "flank", seconds = 5): Promise<number> {
    const e = await makeEngine();
    e.begin();
    const target = e.units.find((u) => u.trenchHold && u.enemyType === "volks")!;
    const shooter = e.units.find((u) => u.side === "allies" && !u.npc && u.type === "mg")!;
    if (mode === "open") {
      // A spot with no cover anywhere near.
      outer: for (const cx of [2200, 2400, 2000, 2600]) {
        for (const cy of [240, 420, 900, 1100]) {
          if (e.covers.every((c) => Math.hypot(c.x - cx, c.y - cy) > 70)) {
            target.x = cx;
            target.y = cy;
            break outer;
          }
        }
      }
    }
    shooter.x = mode === "flank" ? target.x + 130 : target.x - 130;
    shooter.y = target.y;
    shooter.attackId = target.id;
    shooter.hp = 5000; shooter.maxHp = 5000;
    target.hp = 1000; target.maxHp = 1000;
    const tx = target.x;
    const ty = target.y;
    for (let s = 0; s < 60 * seconds; s++) {
      // A steady target: re-seat him each tick and keep his nerve
      // (his return fire is not what this measures).
      target.x = tx; target.y = ty;
      target.suppression = 40;
      target.morale = 100;
      e.update(1 / 60);
    }
    return 1000 - target.hp;
  }

  it("frontal fire on a trench is reduced but real; flank fire is full", async () => {
    const open = await shotLoss("open");
    // Frontal runs longer: at a 5% leak rate a 5s window can
    // honestly roll zero hits; 14s makes the statistics settle.
    const frontal = await shotLoss("frontal", 14);
    const flank = await shotLoss("flank");
    expect(open).toBeGreaterThan(40);
    expect(frontal).toBeGreaterThan(0);
    expect(frontal).toBeLessThan(open * 0.4);
    expect(flank).toBeGreaterThan(open * 0.55);
  }, 60000);
});
