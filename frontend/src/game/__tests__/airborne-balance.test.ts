// @vitest-environment node
// Airborne variant (2026-11-12). First a balance pass: the drop
// zone tightened to x 120-640 (the old x 120-1520 threw men into
// the bluff gun line; AUTO went 0 for 6, wiped in 16-71s), and
// 32 NPC paratroopers scatter across the same zone. Then Josh's
// redesign the same evening: airborne is an AMBUSH mission. No
// MG42 nests and no mortars in any wave — wave 1 is an enemy
// convoy (2 panzers, 1 halftrack, 20 foot troops) rolling
// slowly west on the road, holding its route until first
// contact, then halting to fight. The beach keeps every gun.
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

type U = {
  id: number;
  side: string; npc: boolean; enemyType: string | null; isStatic: boolean;
  x: number; y: number; convoy?: boolean; alive: boolean; vehicle: boolean;
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
    { type: "mg42", wave: 1, count: 9 },
    { type: "mortar", wave: 1, count: 3 },
  ],
} as const;

async function makeEngine(variant: string) {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {}) as unknown as {
    setup: (m: unknown, s: unknown, b: number, v: string) => void;
    begin: () => void;
    update: (dt: number) => void;
    units: U[];
    convoyContact: boolean;
    introT: number;
  };
  engine.setup(OVERLORD_W1 as never, SQUAD as never, 0, variant);
  return engine;
}

describe("airborne variant: drop zone and ambush convoy", () => {
  it("the drop zone stays west of the old bluff gun line (x < 700)", async () => {
    const e = await makeEngine("airborne");
    const squad = e.units.filter((u) => u.side === "allies" && !u.npc);
    expect(squad).toHaveLength(5);
    for (const u of squad) expect(u.x).toBeLessThan(700);
  });

  it("airborne fields no MG42 nests and no mortars: the convoy replaces them", async () => {
    const e = await makeEngine("airborne");
    const axis = e.units.filter((u) => u.side === "axis");
    expect(axis.filter((u) => u.enemyType === "mg42")).toHaveLength(0);
    expect(axis.filter((u) => u.enemyType === "mortar")).toHaveLength(0);
    // Josh's convoy spec: no trucks at all — 2 panzers and 1
    // halftrack on the road, and the foot column topped up to
    // 20 (the fixture's 9 infantry ride first, 11 more join).
    expect(axis.filter((u) => u.enemyType === "truck")).toHaveLength(0);
    const panzers = axis.filter((u) => u.enemyType === "panzer");
    expect(panzers).toHaveLength(2);
    const halftracks = axis.filter((u) => u.enemyType === "halftrack");
    expect(halftracks).toHaveLength(1);
    for (const v of [...panzers, ...halftracks]) expect(v.convoy).toBe(true);
    const escort = axis.filter((u) => u.convoy && !u.vehicle);
    expect(escort).toHaveLength(20);
  });

  it("the convoy rolls west on the road until first contact", async () => {
    const e = await makeEngine("airborne");
    e.begin();
    // The drop intro runs first; the convoy's march is measured
    // once the battle clock starts.
    for (let s = 0; s < 60 * 12 && e.introT >= 0; s++) e.update(1 / 60);
    const vehicles = e.units.filter((u) => u.convoy && u.vehicle);
    expect(vehicles).toHaveLength(3);
    const x0 = vehicles.map((t) => t.x);
    for (let s = 0; s < 60 * 3; s++) e.update(1 / 60);
    expect(e.convoyContact).toBe(false);
    vehicles.forEach((t, i) => expect(x0[i] - t.x).toBeGreaterThan(50));
  });

  it("on contact the vehicles halt and stay halted", async () => {
    const e = await makeEngine("airborne");
    e.begin();
    for (let s = 0; s < 60 * 12 && e.introT >= 0; s++) e.update(1 / 60);
    const panzer = e.units.filter((u) => u.enemyType === "panzer")[0];
    const man = e.units.filter((u) => u.side === "allies" && !u.npc)[0];
    man.x = panzer.x - 100;
    man.y = panzer.y;
    e.update(1 / 60);
    expect(e.convoyContact).toBe(true);
    const xAtContact = panzer.x;
    for (let s = 0; s < 60 * 2; s++) e.update(1 / 60);
    expect(Math.abs(panzer.x - xAtContact)).toBeLessThan(3);
  });

  it("the beach landing keeps all 9 MG42 nests and 3 mortars", async () => {
    const e = await makeEngine("beach");
    const statics = e.units.filter((u) => u.side === "axis" && u.isStatic);
    expect(statics.filter((u) => u.enemyType === "mg42")).toHaveLength(9);
    expect(statics.filter((u) => u.enemyType === "mortar")).toHaveLength(3);
  });

  it("the halftrack unloads six extra troops at first contact (Josh, 2026-11-12)", async () => {
    const e = await makeEngine("airborne");
    e.begin();
    for (let s = 0; s < 60 * 12 && e.introT >= 0; s++) e.update(1 / 60);
    const half = e.units.find((u) => u.enemyType === "halftrack")!;
    expect(half).toBeTruthy();
    const footBefore = e.units.filter((u) => u.side === "axis" && !u.vehicle).length;
    // No contact yet: the bay stays shut while the convoy marches.
    for (let s = 0; s < 60 * 2; s++) e.update(1 / 60);
    expect(e.units.filter((u) => u.side === "axis" && !u.vehicle).length).toBe(footBefore);
    // Force contact the same way the halt test does.
    const beforeIds = new Set(e.units.map((u) => u.id));
    const man = e.units.filter((u) => u.side === "allies" && !u.npc)[0];
    man.x = half.x - 100;
    man.y = half.y;
    e.update(1 / 60);
    expect(e.convoyContact).toBe(true);
    // The dropped six are the only new units, all foot, all
    // piled out around the halftrack.
    const dropped = e.units.filter((u) => !beforeIds.has(u.id));
    expect(dropped).toHaveLength(6);
    expect(dropped.every((u) => u.side === "axis" && !u.vehicle && u.convoy)).toBe(true);
    expect(dropped.every((u) => Math.abs(u.x - half.x) <= 60 && Math.abs(u.y - half.y) <= 80)).toBe(true);
    expect(dropped.filter((u) => u.enemyType === "grenadier")).toHaveLength(2);
    expect(dropped.filter((u) => u.enemyType === "volks")).toHaveLength(4);
    // Once only: more updates do not unload a second squad.
    for (let s = 0; s < 60 * 2; s++) e.update(1 / 60);
    expect(e.units.filter((u) => u.side === "axis" && !u.vehicle).length).toBe(footBefore + 6);
  });

  it("a halftrack destroyed on the march drops nobody", async () => {
    const e = await makeEngine("airborne");
    e.begin();
    for (let s = 0; s < 60 * 12 && e.introT >= 0; s++) e.update(1 / 60);
    const half = e.units.find((u) => u.enemyType === "halftrack")!;
    const footBefore = e.units.filter((u) => u.side === "axis" && !u.vehicle).length;
    half.alive = false;
    // Contact with the point panzer instead.
    const panzer = e.units.filter((u) => u.enemyType === "panzer")[0];
    const man = e.units.filter((u) => u.side === "allies" && !u.npc)[0];
    man.x = panzer.x - 100;
    man.y = panzer.y;
    e.update(1 / 60);
    expect(e.convoyContact).toBe(true);
    expect(e.units.filter((u) => u.side === "axis" && !u.vehicle).length).toBe(footBefore);
  });
});
