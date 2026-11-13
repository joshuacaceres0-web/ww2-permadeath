// @vitest-environment node
/**
 * Carried gear is drawn on the man (Josh, 2026-11-13): what
 * he equips shows on his sprite in battle, in the game's own
 * pixel style, and the Barracks portrait matches. Verified at
 * the painter level with a recording canvas: the pixel map a
 * sprite paints is the assertion.
 *  - every looted gun paints a different shape from the class
 *    rifle, standing and prone; the Thompson paints heavier
 *    (the drum), the BAR paints longer.
 *  - earned helmets repaint the head; unequipped returns the
 *    exact standard sprite (the same cached canvas).
 *  - the ghillie wrap recolours the man and grows a shaggy
 *    silhouette; the camouflage net drapes him lighter and
 *    leaves his own colours alone.
 *  - lookOf, the engine's own read of a unit, carries the gun
 *    and the treatment into a live battle: a man holding an
 *    FG42 reads as that gun.
 */
import { describe, expect, it } from "vitest";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

class FakeCtx {
  pixels = new Map<string, string>();
  fillStyle = "#000";
  constructor() {
    return new Proxy(this, {
      get(t, p) {
        if (p in t) return (t as Any)[p];
        if (p === "measureText") return () => ({ width: 10 });
        if (p === "createLinearGradient" || p === "createRadialGradient") return () => ({ addColorStop: () => {} });
        return () => {};
      },
      set(t, p, v) {
        (t as Any)[p] = v;
        return true;
      },
    });
  }
  fillRect(x: number, y: number, w: number, h: number) {
    for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) this.pixels.set(`${x + dx},${y + dy}`, this.fillStyle);
  }
  getImageData(_x: number, _y: number, w: number, h: number) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (const key of this.pixels.keys()) {
      const [px, py] = key.split(",").map(Number);
      if (px >= 0 && py >= 0 && px < w && py < h) data[(py * w + px) * 4 + 3] = 255;
    }
    return { data };
  }
  putImageData() {}
}

function stubBrowser() {
  const store = new Map<string, string>();
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  g.window = globalThis;
  g.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
  g.document = {
    createElement: (tag: string) => {
      if (tag !== "canvas") return {};
      const ctx = new FakeCtx();
      return { width: 0, height: 0, style: {}, __ctx: ctx, getContext: () => ctx, addEventListener: () => {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }) };
    },
    fonts: { load: () => Promise.resolve([]) },
  };
  g.HTMLCanvasElement = function () {};
}
stubBrowser();

const loadSprites = async () => (await import("../sprites")) as Any;
// Slice 1 paints sprites at SPR_SCALE 2 density: the raw map
// is keyed in native backing pixels, so fold it back to the
// logical 16x14 grid this suite asserts on (a sub-pixel detail
// mark reads as its logical cell's colour, last write wins).
const pixelsOf = (canvas: Any) => {
  const raw = canvas.__ctx.pixels as Map<string, string>;
  const folded = new Map<string, string>();
  for (const [k, v] of raw) {
    const [x, y] = k.split(",").map(Number);
    folded.set(`${Math.floor(x / 2)},${Math.floor(y / 2)}`, v);
  }
  return folded;
};
const mapKey = (m: Map<string, string>) => [...m.entries()].sort().map(([k, v]) => `${k}:${v}`).join("|");
const maxX = (m: Map<string, string>) => Math.max(...[...m.keys()].map((k) => Number(k.split(",")[0])));

describe("carried gear drawn on the man", () => {
  it("every looted gun paints its own shape, standing and prone", async () => {
    const { sprite } = await loadSprites();
    for (const pose of ["stand", "prone"] as const) {
      const rifle = pixelsOf(sprite("us", pose, "rifle", "us", false));
      for (const gun of ["thompson", "mp40", "carbine", "springfield", "trench", "bar", "fg42"]) {
        const m = pixelsOf(sprite("us", pose, gun, "us", false));
        expect(mapKey(m), `${gun} ${pose}`).not.toBe(mapKey(rifle));
      }
    }
    // Standing tells: the Thompson's drum paints dark metal
    // under the barrel where the rifle paints nothing, and the
    // BAR's barrel runs longer than the rifle's.
    const rifleStand = pixelsOf(sprite("us", "stand", "rifle", "us", false));
    const thompsonStand = pixelsOf(sprite("us", "stand", "thompson", "us", false));
    expect(thompsonStand.get("9,8")).toBe("#24231E");
    expect(thompsonStand.get("10,9")).toBe("#24231E");
    expect(rifleStand.has("9,8")).toBe(false);
    expect(maxX(pixelsOf(sprite("us", "stand", "bar", "us", false)))).toBeGreaterThan(maxX(rifleStand));
  });

  it("earned headgear repaints the head, and unequip returns the standard sprite itself", async () => {
    const { sprite } = await loadSprites();
    const standard = sprite("us", "stand", "rifle", "us", false);
    for (const head of ["us-net", "us-para", "us-jeep", "us-pile", "us-hbt"]) {
      expect(mapKey(pixelsOf(sprite("us", "stand", "rifle", head, false))), head).not.toBe(mapKey(pixelsOf(standard)));
    }
    // The medic's cross is its own standard.
    expect(sprite("us", "stand", "rifle", "us", false)).toBe(standard);
  });

  it("the ghillie remakes the man; the net drapes him lighter", async () => {
    const { sprite } = await loadSprites();
    const plain = pixelsOf(sprite("us", "stand", "sniper", "us", false));
    const ghillie = pixelsOf(sprite("us", "stand", "sniper", "us", false, "ghillie"));
    expect(mapKey(ghillie)).not.toBe(mapKey(plain));
    // Shag above the helmet line, where the plain man is bare sky.
    expect(ghillie.get("6,0")).toBe("#6B7A3A");
    expect(plain.has("6,0")).toBe(false);
    // His uniform colour itself changed: the chest pixel that
    // is issue green on the plain man is ghillie green here.
    expect(plain.get("7,7")).toBe("#5E6539");
    expect(ghillie.get("7,7")).toBe("#55603A");
    const net = pixelsOf(sprite("us", "stand", "rifle", "us", false, "net"));
    const rifleman = pixelsOf(sprite("us", "stand", "rifle", "us", false));
    expect(mapKey(net)).not.toBe(mapKey(rifleman));
    expect(net.get("7,1")).toBe("#2E3324");
    // Lighter: no palette swap — his chest keeps the issue green.
    expect(net.get("7,7")).toBe("#5E6539");
    // And prone wears it too.
    const proneGhillie = pixelsOf(sprite("us", "prone", "sniper", "us", false, "ghillie"));
    expect(proneGhillie.get("6,0")).toBe("#6B7A3A");
  });

  it("a man with a looted gun reads as that gun in a live battle", async () => {
    const { GameEngine, lookOf } = await import("../engine") as Any;
    const E = (type: string, wave: number, count: number) => ({ type, wave, count });
    const QUIET = { id: "op_02", index: 1, code: "QUIET", location: "test", objective: "", difficulty: "HARD", reward: 400, terrain: "town", brief: "", enemies: [E("volks", 1, 1), E("volks", 2, 1), E("volks", 3, 1)] } as Any;
    const man = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, name: `Man ${id}`, type, rank: "Pvt.", level: 0, medals: [], ...extra }) as Any;
    const canvas = (document as Any).createElement("canvas");
    const e = new GameEngine(canvas, () => {}) as Any;
    e.setup(QUIET, [
      man("looter", "rifleman", { equipment: ["fg42"] }),
      man("plain", "rifleman"),
      man("wrapped", "sniper", { equipment: ["ghillie"] }),
      man("netted", "recon", { equipment: ["camonet"] }),
    ], 0, "", 8);
    e.begin();
    const unitOf = (id: string) => (e.units as Any[]).find((u) => u.soldierId === id);
    expect(lookOf(unitOf("looter")).weapon).toBe("fg42");
    expect(lookOf(unitOf("plain")).weapon).toBe("rifle");
    expect(lookOf(unitOf("wrapped")).fx).toBe("ghillie");
    expect(lookOf(unitOf("netted")).fx).toBe("net");
    expect(lookOf(unitOf("plain")).fx).toBeUndefined();
  }, 120000);
});
