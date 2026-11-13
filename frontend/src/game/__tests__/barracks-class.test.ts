// @vitest-environment node
/**
 * Class items (Josh, 2026-11-13): two per hireable class,
 * locked to that class, each tied to the job the class does.
 * Measured here at the engine level:
 *  - build stats: surgical healing, bearer box belt, spare
 *    barrel reload, match ammunition, ghillie spotting.
 *  - the bayonet's close-range punch, on the bullet itself.
 *  - the rifleman's frag under a grenade bandolier, and the
 *    MG barrage through a spare barrel (24, not 16).
 *  - morphine: a patched man returns steadier, a broken man
 *    is steadied where he stands.
 *  - shaped charges bite armour 40% harder; the satchel is
 *    one heavy throw per battle, then rockets again.
 *  - the code book prices the first call at zero, once; the
 *    antenna and batteries stack their cooldown cuts.
 *  - flares stretch a mark to 16s; the probe kit finds mines
 *    wider and clears them faster; the tool roll's bags stand
 *    stronger. The camo net deepens the hide factor.
 * Class fit itself (who may equip what) is the backend's law,
 * covered in test_barracks_update.py; the slot pool stays the
 * same two for everything.
 */
import { describe, expect, it } from "vitest";
import { UNIT_TYPES } from "../data";

function stubBrowser() {
  const grad = { addColorStop: () => {} };
  const ctx = new Proxy({}, {
    get(_t, p) {
      if (p === "createLinearGradient" || p === "createRadialGradient") return () => grad;
      if (p === "measureText") return () => ({ width: 10 });
      if (p === "getImageData") return () => ({ data: new Uint8ClampedArray(4) });
      return () => {};
    },
    set: () => true,
  });
  const makeCanvas = () => ({
    width: 960, height: 540, style: {},
    getContext: () => ctx,
    addEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }),
  });
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
const lastBulletFrom = (e: Any, u: Any) => [...e.bullets].reverse().find((b: Any) => b.killerId === u.id);

describe("class items in the build", () => {
  it("class stats land on the man: surgical, bearer box, barrel, match ammo, ghillie", async () => {
    const e = await build([
      man("doc", "medic", { equipment: ["surgical"] }),
      man("docP", "medic"),
      man("gunner", "mg", { equipment: ["bearerbox", "barrel"] }),
      man("gunnerP", "mg"),
      man("snip", "sniper", { equipment: ["matchammo", "ghillie"] }),
      man("snipP", "sniper"),
    ]);
    expect(unitOf(e, "doc").healMult).toBeCloseTo(unitOf(e, "docP").healMult * 1.5, 5);
    expect(unitOf(e, "gunner").magSize).toBe(Math.ceil(unitOf(e, "gunnerP").magSize * 1.5));
    expect(unitOf(e, "gunner").reloadTime).toBeCloseTo(unitOf(e, "gunnerP").reloadTime * 0.7, 5);
    const snip = unitOf(e, "snip");
    const snipP = unitOf(e, "snipP");
    expect(snip.range).toBe(snipP.range + 40);
    expect(snip.spread).toBeCloseTo(snipP.spread * 0.7, 5);
    expect(snip.spotMul).toBeCloseTo(0.7, 5);
  });

  it("the bayonet punches inside 70 and not beyond", async () => {
    const e = await build([
      man("steel", "rifleman", { equipment: ["bayonet"] }),
      man("plain", "rifleman"),
    ]);
    const steel = unitOf(e, "steel");
    const plain = unitOf(e, "plain");
    const near = e.spawnEnemyUnit("volks", steel.x + 50, steel.y, () => 0.5, true);
    e.fireAt(steel, near, false);
    e.fireAt(plain, near, false);
    const steelDmg = lastBulletFrom(e, steel).dmg;
    const plainDmg = lastBulletFrom(e, plain).dmg;
    expect(steelDmg).toBeCloseTo(plainDmg * 1.35, 5);
    const far = e.spawnEnemyUnit("volks", steel.x + 200, steel.y, () => 0.5, true);
    e.fireAt(steel, far, false);
    expect(lastBulletFrom(e, steel).dmg).toBeCloseTo(plainDmg, 5);
  });

  it("the grenade bandolier loads his frag and the spare barrel lengthens the barrage", async () => {
    const e = await build([
      man("frag", "rifleman", { equipment: ["grenades"] }),
      man("fragP", "rifleman"),
      man("mgB", "mg", { equipment: ["barrel"] }),
      man("mgP", "mg"),
    ]);
    const frag = unitOf(e, "frag");
    e.castGround(frag, frag.x + 100, frag.y);
    const proj = e.projectiles[e.projectiles.length - 1];
    expect(proj.dmg).toBe(85);
    expect(proj.aoe).toBe(85);
    expect(frag.abilityCd).toBeCloseTo(UNIT_TYPES.rifleman.ability.cd * 0.6, 5);
    const fragP = unitOf(e, "fragP");
    e.castGround(fragP, fragP.x + 100, fragP.y);
    expect(e.projectiles[e.projectiles.length - 1].dmg).toBe(60);
    const mgB = unitOf(e, "mgB");
    e.castGround(mgB, mgB.x + 100, mgB.y);
    expect(mgB.burst).toBe(24);
    const mgP = unitOf(e, "mgP");
    e.castGround(mgP, mgP.x + 100, mgP.y);
    expect(mgP.burst).toBe(16);
  });

  it("morphine returns a patched man steadier, and steadies a broken one", async () => {
    const e = await build([
      man("doc", "medic", { equipment: ["morphine"] }),
      man("hurt", "rifleman"),
      man("broke", "rifleman"),
    ]);
    const doc = unitOf(e, "doc");
    const hurt = unitOf(e, "hurt");
    hurt.x = doc.x + 40; hurt.y = doc.y;
    hurt.hp = hurt.maxHp * 0.4;
    hurt.morale = 40;
    e.castAuto(doc);
    expect(hurt.hp).toBeGreaterThan(hurt.maxHp * 0.4);
    expect(hurt.morale).toBe(60);
    const broke = unitOf(e, "broke");
    broke.x = doc.x + 40; broke.y = doc.y + 30;
    broke.hp = broke.maxHp * 0.3;
    broke.broken = true;
    broke.willFlee = true;
    broke.morale = 30;
    doc.abilityCd = 0;
    e.castAuto(doc);
    expect(broke.morale).toBe(65);
  });

  it("shaped charges bite armour harder, out of the same bazooka", async () => {
    const e = await build([
      man("atS", "at", { equipment: ["shaped"] }),
      man("atP", "at"),
    ]);
    const shaped = unitOf(e, "atS");
    const plain = unitOf(e, "atP");
    const t1 = e.spawnEnemyUnit("truck", shaped.x + 300, shaped.y, () => 0.5, true);
    const hp1 = t1.hp;
    e.damage(t1, 100, "at", shaped.id);
    const shapedHit = hp1 - t1.hp;
    const t2 = e.spawnEnemyUnit("truck", plain.x + 300, plain.y, () => 0.5, true);
    const hp2 = t2.hp;
    e.damage(t2, 100, "at", plain.id);
    expect(shapedHit).toBeCloseTo((hp2 - t2.hp) * 1.4, 4);
  });

  it("the satchel is one heavy throw a battle, then the rockets come back", async () => {
    const e = await build([man("atS", "at", { equipment: ["satchel"] })]);
    const at = unitOf(e, "atS");
    const truck = e.spawnEnemyUnit("truck", at.x + 150, at.y, () => 0.5, true);
    const hp0 = truck.hp;
    e.fireAt(at, truck, false);
    expect(at.satchelUsed).toBe(true);
    expect(e.bullets.length).toBe(0);
    const proj = e.projectiles[e.projectiles.length - 1];
    expect(proj.dmg).toBe(260);
    for (let i = 0; i < 20; i++) e.update(0.1);
    // 260 in one bang: the truck (150 hp) does not survive it.
    expect(truck.hp).toBeLessThanOrEqual(0);
    expect(truck.alive).toBe(false);
    expect(hp0).toBe(150);
    e.fireAt(at, truck, false);
    expect(lastBulletFrom(e, at)).toBeDefined();
  });

  it("the code book covers one call a battle; antenna and batteries stack", async () => {
    const e = await build([
      man("radio", "radioman", { equipment: ["codebook", "antenna", "batteries"] }),
    ]);
    const radio = unitOf(e, "radio");
    expect(radio).toBeDefined();
    expect(e.supportCost("artillery")).toBe(0);
    expect(e.codeBookCovers()).toBe(true);
    expect(e.codeBookCovers()).toBe(false);
    expect(e.supportCost("artillery")).toBeGreaterThan(0);
    expect(e.radioCd(60)).toBe(36); // 60 x 0.8 batteries x 0.75 antenna
    const e2 = await build([man("radio", "radioman", { equipment: ["antenna"] })]);
    expect(e2.radioCd(60)).toBe(45);
    const e3 = await build([man("radio", "radioman")]);
    expect(e3.radioCd(60)).toBe(60);
    expect(e3.supportCost("artillery")).toBeGreaterThan(0);
    expect(e3.codeBookCovers()).toBe(false);
  });

  it("flares stretch the mark; the net deepens the hide", async () => {
    const e = await build([
      man("rec", "recon", { equipment: ["flares", "camonet"] }),
      man("recP", "recon"),
    ]);
    const rec = unitOf(e, "rec");
    expect(e.hideFactor(rec)).toBe(0.35);
    expect(e.hideFactor(unitOf(e, "recP"))).toBe(0.55);
    const foe = e.spawnEnemyUnit("volks", rec.x + 150, rec.y, () => 0.5, true);
    e.castAuto(rec);
    expect(foe.markedUntil - e.elapsed).toBeCloseTo(16, 4);
  });

  it("the probe kit finds mines wider and clears them faster", async () => {
    const e = await build([
      man("eng", "engineer", { equipment: ["probekit"] }),
      man("engP", "engineer"),
    ]);
    const eng = unitOf(e, "eng");
    const engP = unitOf(e, "engP");
    const mineFar = { x: eng.x + 100, y: eng.y, armed: true, revealed: false, cleared: false, clearT: 0 };
    const mineFarP = { x: engP.x + 100, y: engP.y + 400, armed: true, revealed: false, cleared: false, clearT: 0 };
    engP.y += 400;
    mineFarP.y = engP.y;
    e.mines.push(mineFar, mineFarP);
    e.stepEngineers(0.1);
    expect(mineFar.revealed).toBe(true); // 100 <= 120 with the kit
    expect(mineFarP.revealed).toBe(false); // 100 > 70 without it
    const work = { x: eng.x + 18, y: eng.y, armed: true, revealed: true, cleared: false, clearT: 0 };
    e.mines.push(work);
    for (let i = 0; i < 26; i++) e.stepEngineers(0.1);
    expect(work.cleared).toBe(true); // 2.6s of work at the kit's 2.5
  });

  it("the tool roll's bags stand stronger", async () => {
    const e = await build([
      man("eng", "engineer", { equipment: ["toolroll"] }),
      man("engH", "engineer", { equipment: ["hbtcap"] }),
      man("engP", "engineer"),
    ]);
    const cases: Array<[string, number]> = [["eng", 150], ["engH", 165], ["engP", 110]];
    for (const [id, hp] of cases) {
      const u = unitOf(e, id);
      const before = e.covers.length;
      e.castGround(u, u.x + 40, u.y + 160);
      const bag = e.covers[e.covers.length - 1];
      expect(e.covers.length, id).toBe(before + 1);
      expect(bag.hp, id).toBe(hp);
    }
  });
});
