// @vitest-environment node
/**
 * Barracks update (Josh, 2026-11-13): a man's upgrades and the
 * stores gear he carries fold into his build in the engine —
 * and the effects measure, not just display.
 *
 *  - toughness / parahelmet raise his health; eyes /
 *    binoculars his vision; marksmanship his damage; steady
 *    hands shorten his reload; legs raise his speed; extra
 *    ammo pouches grow his magazine (never a one-shot tube);
 *    the aid bag strengthens a medic's healing.
 *  - a carried gun reshapes his weapon (Thompson faster and
 *    shorter, Springfield longer and heavier, MP40 tighter).
 *  - the field dressing knits him back up after quiet seconds.
 *  - the lucky charm turns a killing hit aside, sometimes:
 *    across 80 charmed men taking one lethal hit each, some
 *    live and most die (15% — the bounds are wide on purpose).
 *  - a looted crate sometimes holds a stores item for the
 *    report, alongside its RP.
 */
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const E = (type: string, wave: number, count: number) => ({ type, wave, count });
const QUIET = { id: "op_02", index: 1, code: "QUIET", location: "test", objective: "", difficulty: "HARD", reward: 400, terrain: "town", brief: "", enemies: [E("volks", 1, 1), E("volks", 2, 1), E("volks", 3, 1)] } as Any;

function man(id: string, type: string, extra: Record<string, unknown> = {}) {
  return { id, name: `Man ${id}`, type, rank: "Pvt.", level: 0, medals: [], ...extra } as Any;
}

async function build(squad: Any[]) {
  const GameEngine = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const e = new GameEngine(canvas, () => {}) as Any;
  e.setup(QUIET, squad, 0, "", 8);
  e.begin();
  return e;
}
const unitOf = (e: Any, id: string) => (e.units as Any[]).find((u) => u.soldierId === id);

describe("barracks upgrades and gear in the build", () => {
  it("upgrades raise the man's own stats", async () => {
    const e = await build([
      man("plain", "rifleman"),
      man("vet", "rifleman", { upgrades: { toughness: 3, marksmanship: 2, steady: 2, legs: 1, eyes: 2, nerve: 1 } }),
    ]);
    const plain = unitOf(e, "plain");
    const vet = unitOf(e, "vet");
    expect(vet.maxHp).toBe(plain.maxHp + 36);
    expect(vet.dmg).toBe(plain.dmg);
    expect(vet.dmgMult).toBeCloseTo(plain.dmgMult * 1.16, 5);
    expect(vet.reloadTime).toBeCloseTo(plain.reloadTime * 0.88 * 0.88, 5);
    expect(vet.speed).toBeCloseTo(plain.speed * 1.06, 5);
    expect(vet.vision).toBe(plain.vision + 50);
    expect(vet.moraleMul).toBeCloseTo(0.85, 5);
  });

  it("gear applies: helmet, glasses, pouches, aid bag", async () => {
    const e = await build([
      man("plain", "rifleman"),
      man("kitted", "rifleman", { equipment: ["parahelmet", "binoculars", "ammo"] }),
      man("doc", "medic", { equipment: ["aidbag"] }),
      man("atman", "at", { equipment: ["ammo"] }),
    ]);
    const plain = unitOf(e, "plain");
    const kitted = unitOf(e, "kitted");
    expect(kitted.maxHp).toBe(plain.maxHp + 12);
    expect(kitted.vision).toBe(plain.vision + 60);
    expect(kitted.magSize).toBe(Math.ceil(plain.magSize * 1.5));
    expect(unitOf(e, "doc").healMult).toBeCloseTo(1.3, 5);
    // The bazooka's one-shot tube is not a magazine: pouches
    // do not grow it.
    expect(unitOf(e, "atman").magSize).toBe(1);
  });

  it("carried guns reshape the weapon", async () => {
    const e = await build([
      man("plain", "rifleman"),
      man("tommy", "rifleman", { equipment: ["thompson"] }),
      man("glass", "sniper", { equipment: ["springfield"] }),
      man("plainS", "sniper"),
      man("cap", "rifleman", { equipment: ["mp40"] }),
    ]);
    const plain = unitOf(e, "plain");
    const tommy = unitOf(e, "tommy");
    expect(tommy.fireInterval).toBeCloseTo(plain.fireInterval * 0.55, 5);
    expect(tommy.dmg).toBe(plain.dmg + 2);
    expect(tommy.range).toBeLessThan(plain.range);
    const glass = unitOf(e, "glass");
    const plainS = unitOf(e, "plainS");
    expect(glass.range).toBe(plainS.range + 60);
    expect(glass.dmg).toBe(plainS.dmg + 5);
    const cap = unitOf(e, "cap");
    expect(cap.dmg).toBe(plain.dmg + 3);
    expect(cap.spread).toBeCloseTo(plain.spread * 0.8, 5);
  });

  it("the dressing knits a quiet man back toward 60%", async () => {
    const e = await build([
      man("plain", "rifleman"),
      man("dressed", "rifleman", { equipment: ["dressing"] }),
    ]);
    const plain = unitOf(e, "plain");
    const dressed = unitOf(e, "dressed");
    for (const u of [plain, dressed]) {
      u.hp = u.maxHp * 0.3;
      u.lastHitT = -100; // long out of fire
    }
    const before = dressed.hp;
    for (let i = 0; i < 50; i++) e.update(0.1);
    expect(dressed.hp).toBeGreaterThan(before + 1.5);
    expect(dressed.hp).toBeLessThanOrEqual(dressed.maxHp * 0.6 + 0.01);
    expect(plain.hp).toBeCloseTo(plain.maxHp * 0.3, 3);
  });

  it("the charm turns some killing hits aside, once a man", async () => {
    let saved = 0;
    let died = 0;
    for (let i = 0; i < 80; i++) {
      const e = await build([man("lucky", "rifleman", { equipment: ["charm"] })]);
      const u = unitOf(e, "lucky");
      e.damage(u, 100000, "rifleman", null);
      if (u.alive) {
        saved++;
        expect(u.hp).toBe(1);
        expect(u.charmUsed).toBe(true);
        // Spent: the next killing hit lands.
        e.damage(u, 100000, "rifleman", null);
        expect(u.alive).toBe(false);
      } else died++;
    }
    expect(saved).toBeGreaterThanOrEqual(3);
    expect(saved).toBeLessThanOrEqual(30);
    expect(died).toBe(80 - saved);
  }, 120000);

  it("a looted crate sometimes holds a stores item", async () => {
    const { CRATE_RP } = await import("../data");
    let found: string | null = null;
    for (let attempt = 0; attempt < 16 && !found; attempt++) {
      const GameEngine = await loadEngine();
      const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
      const e = new GameEngine(canvas, () => {}) as Any;
      e.crateChance = 1; // a crate in every attempt (the crate.test pattern)
      e.setup(QUIET, [man("looter", "rifleman")], 0, "", 8);
      e.begin();
      const crate = (e.crates as Any[])[0];
      expect(crate).toBeTruthy();
      const looter = unitOf(e, "looter");
      looter.x = crate.x;
      looter.y = crate.y;
      for (let i = 0; i < 5; i++) e.update(0.1);
      const report = e.getReport();
      expect(report.lootRp).toBe(CRATE_RP);
      found = report.lootItem;
    }
    expect(found).not.toBeNull();
  }, 120000);
});
