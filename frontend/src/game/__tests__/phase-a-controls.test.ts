// @vitest-environment node
// Phase A of the 2026-11-13 voice-call package (Josh):
//  - overhead bars (health / morale / reload) show ONLY over
//    the player's own squad infantry — NPC allies, enemies,
//    statics and vehicles show nothing overhead;
//  - the player shoots as he intends: clicks and the touch
//    FIRE stick aim a snapshot shot, never a target lock
//    (attackId is never set by fire input), and the leader
//    never repositions himself;
//  - DEFEND means scatter to cover (each follower dives for
//    cover near where HE stands and does not trail the
//    leader); FORM UP keeps the formation (pinned in
//    leader-controls.test.ts).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type FillRec = { x: number; y: number; w: number; h: number; c: string };

function makeRecordingCanvas() {
  const fills: FillRec[] = [];
  const images: unknown[] = [];
  const base: Record<string, unknown> = {
    fillStyle: "",
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push({ x, y, w, h, c: (this as { fillStyle: string }).fillStyle });
    },
    drawImage: (...args: unknown[]) => {
      images.push(args);
    },
    measureText: () => ({ width: 0 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createPattern: () => ({}),
  };
  const ctx = new Proxy(base, {
    get(t, prop) {
      if (prop === "canvas") return canvas;
      if (prop in t) return t[prop as string];
      return () => {};
    },
    set(t, prop, v) {
      t[prop as string] = v;
      return true;
    },
  });
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: () => "",
    getBoundingClientRect: () => ({ width: 1600, height: 900, left: 0, top: 0 }),
    addEventListener: () => {},
    removeEventListener: () => {},
    style: {},
    fills,
    images,
  };
  return canvas;
}

function stubBrowser() {
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
    createElement: (tag: string) => (tag === "canvas" ? makeRecordingCanvas() : {}),
    fonts: { load: () => Promise.resolve([]) },
  };
  (globalThis as unknown as Record<string, unknown>).HTMLCanvasElement = function () {};
}

stubBrowser();

const loadEngine = async () => (await import("../engine")).GameEngine;

const SQUAD = [
  { id: "s-a", name: "Able", type: "rifleman", rank: "Pvt.", level: 0, medals: [], quirks: [] },
  { id: "s-b", name: "Baker", type: "rifleman", rank: "Sgt.", level: 3, medals: [], quirks: [] },
  { id: "s-c", name: "Charlie", type: "medic", rank: "Cpl.", level: 1, medals: [], quirks: [] },
];

const FOREST = {
  id: "op_test", index: 99, code: "TEST OP", name: "Test", location: "Test",
  terrain: "forest", brief: "", reward: 500, enemies: [{ type: "volks", wave: 1, count: 3 }],
};

const TOWN = {
  id: "op_02", index: 1, code: "SILENT CHATEAU", location: "test", objective: "test",
  difficulty: "MEDIUM", reward: 200, terrain: "town", brief: "test",
  enemies: [{ type: "grenadier", wave: 1, count: 1 }],
};

type U = {
  id: number; side: string; npc: boolean; alive: boolean; x: number; y: number;
  hp: number; maxHp: number; morale: number; attackId: number | null; name: string; type: string;
  reloadT: number; reloadTotal: number; cover: unknown;
};

type Engine = {
  setup: (m: unknown, s: unknown, b: number, v?: string, cl?: number, lp?: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  render: () => void;
  units: U[];
  leaderUnit: () => U | null;
  leaderId: number | null;
  leaderShootAt: (x: number, y: number) => void;
  setTouchAim: (v: { x: number; y: number } | null) => void;
  setSquadOrder: (o: string) => void;
  isFollower: (u: U) => boolean;
  manualShot: { x: number; y: number; until: number } | null;
  covers: Array<{ x: number; y: number; r: number }>;
};

async function makeEngine(mission: unknown, canvas?: ReturnType<typeof makeRecordingCanvas>) {
  const GameEngine = await loadEngine();
  const c = canvas ?? makeRecordingCanvas();
  const e = new GameEngine(c as never, () => {}) as unknown as Engine;
  e.setup(mission, SQUAD, 0, "", 1, "");
  return { e, canvas: c };
}

function step(e: Engine, seconds: number) {
  for (let t = 0; t < seconds; t += 0.1) e.update(0.1);
}

describe("phase A: overhead bars belong to the player's own squad only", () => {
  it("a damaged own man shows plates; damaged NPC ally and enemy show none", async () => {
    const { e, canvas } = await makeEngine(TOWN);
    e.begin();
    const lead = e.leaderUnit()!;
    lead.x = 700; lead.y = 675;
    lead.hp = lead.maxHp * 0.5;
    lead.reloadT = 1; lead.reloadTotal = 2;
    const npc = e.units.find((u) => u.npc && u.side === "allies" && u.alive);
    expect(npc).toBeTruthy();
    npc!.x = 990; npc!.y = 675;
    npc!.hp = npc!.maxHp * 0.5;
    const foe = e.units.find((u) => u.side === "axis" && u.alive)!;
    foe.x = 700; foe.y = 430;
    foe.hp = foe.maxHp * 0.5;
    foe.morale = 40;
    foe.reloadT = 1; foe.reloadTotal = 2;
    // Let fog settle on the teleported positions.
    e.update(0.15);
    canvas.fills.length = 0;
    e.render();
    const platesNear = (u: U) =>
      canvas.fills.filter(
        (f) => f.c === "rgba(10,12,8,0.85)" && Math.hypot(f.x + f.w / 2 - u.x, f.y + f.h / 2 - u.y) < 48,
      ).length;
    // Health + morale + reload plates over the player's man.
    expect(platesNear(lead)).toBeGreaterThanOrEqual(3);
    // Nothing overhead for the 2nd Platoon man or the enemy.
    expect(platesNear(npc!)).toBe(0);
    expect(platesNear(foe)).toBe(0);
  }, 60000);

  it("vehicle health bars are gone from the draw code", () => {
    const src = readFileSync(fileURLToPath(new URL("../engine.ts", import.meta.url)), "utf8");
    expect(src).not.toContain("fy - 30, w * pct");
    expect(src).not.toContain("fy - 32, w * pct");
    expect(src).not.toContain("fy - 37, w * pct");
    expect(src).toContain("ownBars");
  });
});

describe("phase A: the player shoots as he intends", () => {
  it("clicking an enemy sets a snapshot shot, never an attack lock", async () => {
    const { e } = await makeEngine(FOREST);
    e.begin();
    const lead = e.leaderUnit()!;
    lead.x = 600; lead.y = 675;
    const foe = e.units.find((u) => u.side === "axis" && u.alive)!;
    foe.x = 760; foe.y = 675;
    e.leaderShootAt(foe.x, foe.y);
    expect(lead.attackId).toBeNull();
    expect(e.manualShot).not.toBeNull();
    expect(Math.hypot(e.manualShot!.x - foe.x, e.manualShot!.y - foe.y)).toBeLessThan(2);
    // The target walks away mid-window: the leader does NOT
    // follow him — no chase, no repositioning of any kind.
    const lx = lead.x;
    const ly = lead.y;
    foe.x = 1400; foe.y = 300;
    step(e, 2);
    expect(lead.attackId).toBeNull();
    expect(Math.hypot(lead.x - lx, lead.y - ly)).toBeLessThan(4);
  });

  it("the touch FIRE stick fires along the thumb and never locks a target", async () => {
    const { e } = await makeEngine(FOREST);
    e.begin();
    const lead = e.leaderUnit()!;
    lead.x = 600; lead.y = 675;
    const foe = e.units.find((u) => u.side === "axis" && u.alive)!;
    foe.x = 740; foe.y = 675; // dead ahead of the stick, in range
    e.setTouchAim({ x: 1, y: 0 });
    for (let i = 0; i < 5; i++) {
      e.update(0.1);
      expect(lead.attackId).toBeNull();
    }
    expect(e.manualShot).not.toBeNull();
    expect(e.manualShot!.x).toBeGreaterThan(lead.x); // aimed east, along the stick
    e.setTouchAim(null);
    expect(e.manualShot).toBeNull();
  });
});

describe("phase A: DEFEND scatters to cover", () => {
  it("a follower dives for cover near himself and does not trail the leader", async () => {
    const { e } = await makeEngine(TOWN);
    e.begin();
    const raw = e as unknown as { covers: Array<{ x: number; y: number; r: number }>; pointBlocked: (x: number, y: number) => boolean };
    const cover = raw.covers.find((c) => c.x > 900 && c.x < 3000);
    expect(cover).toBeTruthy();
    const foe = e.units.find((u) => u.side === "axis" && u.alive)!;
    foe.x = cover!.x + 210; foe.y = cover!.y;
    foe.hp = 100000; foe.maxHp = 100000; // a threat that stays a threat
    const follower = e.units.find((u) => e.isFollower(u) && u.alive && u.type === "rifleman")!;
    follower.x = cover!.x - 130; follower.y = cover!.y;
    const lead = e.leaderUnit()!;
    lead.x = Math.max(60, cover!.x - 950); lead.y = cover!.y;
    e.update(0.15); // cover recompute on the staged positions
    expect(follower.cover).toBeNull();
    e.setSquadOrder("defend");
    let held = false;
    for (let t = 0; t < 14 && !held; t += 0.25) {
      e.update(0.25);
      if (follower.cover) held = true;
    }
    expect(held).toBe(true);
    // He held cover near HIS OWN start, ~950 from the leader —
    // he did not trail the leader back west.
    expect(Math.hypot(follower.x - lead.x, follower.y - lead.y)).toBeGreaterThan(400);
  }, 120000);
});
