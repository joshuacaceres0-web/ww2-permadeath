// @vitest-environment node
// Graphics pass Slice 1 (Josh, 2026-11-13, Metal Slug
// direction): the troops are repainted at double density on
// the same logical grid, the walk cycle runs four real
// frames with leg and arm swing, deaths fall in three beats
// through a dedicated crumple frame, prone changes pass
// through a halfway frame, and Overlord's water moves.
// Painter pins read the recorded fillRects (native backing
// pixels); engine pins render real frames through a recording
// context and match the drawn sprite canvases by identity
// against the sprite cache.
import { describe, expect, it } from "vitest";

type Rect = { x: number; y: number; c: string };
type ImgRec = { img: unknown; x: number; y: number; w: number; h: number };
type FillRec = { x: number; y: number; w: number; h: number; c: string };

function makeRecordingCanvas() {
  const rects: Rect[] = [];
  const images: ImgRec[] = [];
  const fills: FillRec[] = [];
  const base: Record<string, unknown> = {
    fillStyle: "",
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, c: (this as { fillStyle: string }).fillStyle });
      fills.push({ x, y, w, h, c: (this as { fillStyle: string }).fillStyle });
    },
    drawImage: (...args: unknown[]) => {
      if (args.length >= 5) images.push({ img: args[0], x: args[1] as number, y: args[2] as number, w: args[3] as number, h: args[4] as number });
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
    rects,
    images,
    fills,
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

type FakeCanvas = ReturnType<typeof makeRecordingCanvas>;
const loadSprites = async () => await import("../sprites");
const loadEngine = async () => (await import("../engine")).GameEngine;

const SQUAD = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 2, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
  { id: "s3", name: "James Baker", type: "rifleman", rank: "Pvt.", level: 1, medals: [] },
  { id: "s4", name: "Chester Pruitt", type: "medic", rank: "Pvt.", level: 1, medals: [] },
  { id: "s5", name: "Raymond Boyd", type: "mg", rank: "Pvt.", level: 1, medals: [] },
] as const;

const TOWN = {
  id: "op_02", index: 1, code: "SILENT CHATEAU", location: "test", objective: "test",
  difficulty: "MEDIUM", reward: 200, terrain: "town", brief: "test",
  enemies: [{ type: "grenadier", wave: 1, count: 1 }],
} as const;

const OVERLORD = {
  id: "op_01", index: 0, code: "OVERLORD", location: "test", objective: "test",
  difficulty: "HARD", reward: 250, terrain: "dday", brief: "test",
  enemies: [
    { type: "volks", wave: 1, count: 6 },
    { type: "grenadier", wave: 1, count: 3 },
  ],
} as const;

type U = {
  side: string; npc: boolean; alive: boolean; x: number; y: number;
  suppression: number; prone: boolean; deathT?: number; type: string;
};
type Engine = {
  setup: (m: unknown, s: unknown, b: number, v?: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  render: () => void;
  units: U[];
  keys: Set<string>;
  elapsed: number;
  kill: (u: U, source: string, killer: null) => void;
};

describe("slice 1 painter: density, frames, variants", () => {
  it("paints at double density on the unchanged logical grid", async () => {
    const { sprite, SPR_W, SPR_H, SPR_SCALE } = await loadSprites();
    expect(SPR_W).toBe(16);
    expect(SPR_H).toBe(14);
    expect(SPR_SCALE).toBe(2);
    const c = sprite("us", "stand", "rifle", "us", false) as unknown as { width: number; height: number };
    expect(c.width).toBe(32);
    expect(c.height).toBe(28);
  });

  it("the face carries sub-pixel detail the old grid had no room for", async () => {
    const { sprite } = await loadSprites();
    const c = sprite("us", "stand", "rifle", "us", false) as unknown as FakeCanvas;
    const keys = new Set(c.rects.map((r) => `${r.x},${r.y},${r.c}`));
    // The mouth: a single native pixel at (13, 10).
    expect(keys.has("13,10,#7A4A30")).toBe(true);
    // The brim shadow line: native row 7 across the face.
    expect(keys.has("8,7,#20201A")).toBe(true);
    expect(keys.has("12,7,#20201A")).toBe(true);
  });

  it("the walk cycle is four distinct frames and the free arm swings", async () => {
    const { sprite } = await loadSprites();
    const set = (pose: string) => {
      const c = sprite("us", pose as never, "rifle", "us", false) as unknown as FakeCanvas;
      return new Set(c.rects.map((r) => `${r.x},${r.y},${r.c}`));
    };
    const a = set("walkA");
    const b = set("walkB");
    const cc = set("walkC");
    const d = set("walkD");
    const stand = set("stand");
    for (const s of [a, b, cc, d]) expect(s).not.toEqual(stand);
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(cc);
    expect(b).not.toEqual(d);
    expect(cc).not.toEqual(d);
    // Arm swing, at native resolution: walkC's free hand hangs
    // back at logical (2, 8) — one higher than the naive spot,
    // because the whole upper body rides a pixel up through
    // the passing pose; walkD's pumps up at (2, 5). The
    // standing man keeps both hands on the weapon — no skin
    // in either cell.
    const skinAt = (s: Set<string>, lx: number, ly: number) =>
      [...s].some((k) => {
        const [x, y] = k.split(",").map(Number);
        return Math.floor(x / 2) === lx && Math.floor(y / 2) === ly && k.endsWith("#C99A72");
      });
    expect(skinAt(cc, 2, 8)).toBe(true);
    expect(skinAt(d, 2, 5)).toBe(true);
    expect(skinAt(stand, 2, 8)).toBe(false);
    expect(skinAt(stand, 2, 5)).toBe(false);
  });

  it("the fall and the prone transition are their own frames", async () => {
    const { sprite } = await loadSprites();
    const set = (pose: string) => {
      const c = sprite("us", pose as never, "rifle", "us", false) as unknown as FakeCanvas;
      return new Set(c.rects.map((r) => `${r.x},${r.y},${r.c}`));
    };
    const fall = set("fall");
    expect(fall).not.toEqual(set("dead"));
    expect(fall).not.toEqual(set("kneel"));
    expect(fall).not.toEqual(set("hit"));
    const down = set("proneDown");
    expect(down).not.toEqual(set("prone"));
    expect(down).not.toEqual(set("kneel"));
    expect(down).not.toEqual(set("crouch"));
  });

  it("every weapon, head and treatment still paints a full man", async () => {
    const { sprite } = await loadSprites();
    const weapons = ["rifle", "smg", "mg", "sniper", "bazooka", "panzerfaust", "pistol", "mortar", "flak", "none", "thompson", "springfield", "mp40", "carbine", "trench", "bar", "fg42"] as const;
    const heads = ["us", "us-medic", "stahl", "para", "cap", "officer", "us-net", "us-para", "us-jeep", "us-pile", "us-hbt"] as const;
    for (const w of weapons) {
      for (const pose of ["stand", "prone", "proneDown", "fall"] as const) {
        const c = sprite("us", pose, w, "us", false) as unknown as FakeCanvas;
        expect(c.rects.length, `${pose}/${w}`).toBeGreaterThan(24);
      }
    }
    for (const h of heads) {
      const c = sprite("wehr", "stand", "rifle", h, false) as unknown as FakeCanvas;
      expect(c.rects.length, `head ${h}`).toBeGreaterThan(30);
    }
    const plain = sprite("us", "stand", "sniper", "us", false) as unknown as FakeCanvas;
    const ghillie = sprite("us", "stand", "sniper", "us", false, "ghillie") as unknown as FakeCanvas;
    const net = sprite("us", "stand", "sniper", "us", false, "net") as unknown as FakeCanvas;
    expect(new Set(ghillie.rects.map((r) => `${r.x},${r.y}`))).not.toEqual(new Set(plain.rects.map((r) => `${r.x},${r.y}`)));
    expect(new Set(net.rects.map((r) => `${r.x},${r.y}`))).not.toEqual(new Set(plain.rects.map((r) => `${r.x},${r.y}`)));
  });
});

describe("slice 1 engine: the new frames reach the field", () => {
  it("a walking squad cycles through walkC and walkD, frames that did not exist before", async () => {
    const GameEngine = await loadEngine();
    const { sprite } = await loadSprites();
    const canvas = makeRecordingCanvas();
    const e = new GameEngine(canvas as never, () => {}) as unknown as Engine;
    e.setup(TOWN as never, SQUAD as never, 0);
    e.begin();
    for (const u of e.units) if (u.side === "axis") { u.x = 100; u.y = 1300; }
    const seen = new Set<unknown>();
    e.keys.add("d");
    for (let tick = 0; tick < 150; tick++) {
      e.update(1 / 60);
      if (tick % 6 === 0) {
        canvas.images.length = 0;
        e.render();
        for (const im of canvas.images) seen.add(im.img);
      }
    }
    e.keys.delete("d");
    const walkC = sprite("us", "walkC", "rifle", "us", false);
    const walkD = sprite("us", "walkD", "rifle", "us", false);
    const walkCFlip = sprite("us", "walkC", "rifle", "us", true);
    const walkDFlip = sprite("us", "walkD", "rifle", "us", true);
    expect(seen.has(walkC) || seen.has(walkCFlip)).toBe(true);
    expect(seen.has(walkD) || seen.has(walkDFlip)).toBe(true);
  }, 60000);

  it("a death falls through the crumple frame before the corpse settles", async () => {
    const GameEngine = await loadEngine();
    const { sprite } = await loadSprites();
    const canvas = makeRecordingCanvas();
    const e = new GameEngine(canvas as never, () => {}) as unknown as Engine;
    e.setup(TOWN as never, SQUAD as never, 0);
    e.begin();
    for (const u of e.units) if (u.side === "axis") { u.x = 100; u.y = 1300; }
    const man = e.units.find((u) => u.side === "allies" && !u.npc && u.type === "rifleman")!;
    e.kill(man, "rifle", null);
    const drawnNear = () => {
      canvas.images.length = 0;
      e.render();
      return canvas.images.filter((im) => Math.hypot(im.x + im.w / 2 - man.x, im.y + im.h / 2 - man.y) < 46).map((im) => im.img);
    };
    // Mid-fall: deathT inside the crumple window (0.18..0.5).
    for (let tick = 0; tick < 18; tick++) e.update(1 / 60);
    const fallImgs = [sprite("us", "fall", "rifle", "us", false), sprite("us", "fall", "rifle", "us", true)];
    expect(drawnNear().some((img) => fallImgs.includes(img as never))).toBe(true);
    // Settled: the lasting corpse is the dead frame, and the
    // crumple is gone.
    for (let tick = 0; tick < 60; tick++) e.update(1 / 60);
    const deadImgs = [sprite("us", "dead", "rifle", "us", false), sprite("us", "dead", "rifle", "us", true)];
    const settled = drawnNear();
    expect(settled.some((img) => deadImgs.includes(img as never))).toBe(true);
    expect(settled.some((img) => fallImgs.includes(img as never))).toBe(false);
  }, 60000);

  it("going prone and getting up both pass through the halfway frame", async () => {
    const GameEngine = await loadEngine();
    const { sprite } = await loadSprites();
    const canvas = makeRecordingCanvas();
    const e = new GameEngine(canvas as never, () => {}) as unknown as Engine;
    e.setup(TOWN as never, SQUAD as never, 0);
    e.begin();
    for (const u of e.units) if (u.side === "axis") { u.x = 100; u.y = 1300; }
    const man = e.units.find((u) => u.side === "allies" && !u.npc && u.type === "rifleman")!;
    const downImgs = [sprite("us", "proneDown", "rifle", "us", false), sprite("us", "proneDown", "rifle", "us", true)];
    const drawnNear = () => {
      canvas.images.length = 0;
      e.render();
      return canvas.images.filter((im) => Math.hypot(im.x + im.w / 2 - man.x, im.y + im.h / 2 - man.y) < 46).map((im) => im.img);
    };
    man.suppression = 85;
    e.update(1 / 60);
    expect(man.prone).toBe(true);
    expect(drawnNear().some((img) => downImgs.includes(img as never))).toBe(true);
    // Let the transition finish: flat prone, no halfway frame.
    for (let tick = 0; tick < 30; tick++) e.update(1 / 60);
    expect(drawnNear().some((img) => downImgs.includes(img as never))).toBe(false);
    man.suppression = 0;
    e.update(1 / 60);
    expect(man.prone).toBe(false);
    expect(drawnNear().some((img) => downImgs.includes(img as never))).toBe(true);
  }, 60000);

  it("the Overlord waterline moves: surf rects sit somewhere else a moment later", async () => {
    const GameEngine = await loadEngine();
    const canvas = makeRecordingCanvas();
    const e = new GameEngine(canvas as never, () => {}) as unknown as Engine;
    e.setup(OVERLORD as never, SQUAD as never, 0);
    e.begin();
    // Per-dash positions, keyed by the dash's row: the reach
    // range as a set barely changes between moments (the rows
    // are out of phase with each other), so the motion has to
    // be read dash by dash.
    const surfXs = () => {
      canvas.fills.length = 0;
      e.render();
      return canvas.fills
        .filter((f) => typeof f.c === "string" && f.c.startsWith("rgba(214,228,226"))
        .map((f) => ({ y: Math.round(f.y), x: Math.round(f.x) }))
        .sort((a, b) => a.y - b.y);
    };
    const first = surfXs();
    expect(first.length).toBeGreaterThan(10);
    for (const d of first) {
      expect(d.x).toBeGreaterThan(230);
      expect(d.x).toBeLessThan(280);
    }
    // The landing intro holds the battle clock at zero for
    // its first seconds; run past it so real time flows.
    for (let tick = 0; tick < 600; tick++) e.update(1 / 60);
    expect(e.elapsed).toBeGreaterThan(2);
    const second = surfXs();
    expect(second.length).toBe(first.length);
    let moved = 0;
    for (let i = 0; i < first.length; i++) {
      if (Math.abs(second[i].x - first[i].x) >= 2) moved++;
    }
    expect(moved).toBeGreaterThan(first.length / 2);
  }, 60000);
});
