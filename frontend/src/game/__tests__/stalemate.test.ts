// Regression test for bug #2 (soft-lock / stalemate, no breaker):
// a player squad holding in cover vs a lone static MG42 out of its
// own range must not soft-lock forever. After 60s with no HP change
// or death on either side, the breaker orders living mobile units to
// hunt their nearest enemy. No damage/health/wave/RP/NPC changes.
// @vitest-environment node
import { describe, expect, it } from "vitest";

function stubBrowser() {
  const ctx = new Proxy({}, { get(_t, prop) {
    if (prop === "canvas") return {};
    if (prop === "measureText") return () => ({ width: 0 });
    if (prop === "getImageData") return () => ({ data: new Uint8ClampedArray(4) });
    if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createPattern") return () => ({ addColorStop: () => {} });
    return () => {};
  }, set() { return true; } });
  const makeCanvas = () => ({ width: 1600, height: 900, getContext: () => ctx, toDataURL: () => "", getBoundingClientRect: () => ({ width: 1600, height: 900, left: 0, top: 0 }), addEventListener: () => {}, removeEventListener: () => {}, style: {} });
  const store = new Map<string, string>();
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  g.window = globalThis;
  g.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
  g.document = { createElement: (tag: string) => (tag === "canvas" ? makeCanvas() : {}), fonts: { load: () => Promise.resolve([]) } };
  g.HTMLCanvasElement = function () {};
  g.requestAnimationFrame = () => 0;
  g.cancelAnimationFrame = () => {};
  g.performance = { now: () => 0 };
}
stubBrowser();
const loadEngine = async () => { const mod = await import("../engine"); return { GameEngine: mod.GameEngine }; };
const MISSION = { id: "op_02", index: 1, code: "OPERATION SILENT CHATEAU", location: "Valognes Estate", objective: "", difficulty: "HARD", reward: 400, terrain: "town", brief: "", enemies: [{ type: "grenadier", wave: 1, count: 3 }, { type: "volks", wave: 1, count: 4 }, { type: "mg42", wave: 2, count: 1 }] } as const;
const SQUAD = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 2, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
  { id: "s3", name: "James Baker", type: "rifleman", rank: "Pvt.", level: 1, medals: [] },
  { id: "s4", name: "Chester Pruitt", type: "medic", rank: "Pvt.", level: 1, medals: [] },
  { id: "s5", name: "Raymond Boyd", type: "mg", rank: "Pvt.", level: 1, medals: [] },
] as const;

describe("stalemate breaker", () => {
  it("orders idle player units to hunt after 60s with no combat, and not before", async () => {
    const { GameEngine } = await loadEngine();
    const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
    const engine = new GameEngine(canvas, () => {});
    const e = engine as unknown as Record<string, unknown>;
    engine.setup(MISSION as never, SQUAD as never, 0, "");
    engine.begin();
    // Bring in wave 2 so the static MG42 exists, then set up the stalemate.
    (e as { spawnWave: (i: number) => void }).spawnWave(1);
    const units = e.units as Array<Record<string, unknown>>;
    // Stalemate setup: only the player squad (west) and one static MG42
    // (east, 1900 away — MG42 range is 320) alive. No NPCs, no mobile axis.
    let mg42: Record<string, unknown> | null = null;
    for (const u of units) {
      if (u.side === "axis") {
        if (u.enemyType === "mg42") { mg42 = u; u.x = 2100; u.y = 675; }
        else { u.alive = false; u.hp = 0; }
      } else if (u.npc) { u.alive = false; u.hp = 0; }
      else { u.x = 120; u.y = 675; u.orders = []; u.chase = []; u.attackId = null; }
    }
    expect(mg42).not.toBeNull();
    const squad = units.filter((u) => u.side === "allies" && !u.npc && u.alive);
    const step = (secs: number) => {
      for (let s = 0; s < secs * 60; s++) (e as { update: (dt: number) => void }).update(1 / 60);
    };
    // 59s in: no hunt orders yet — a deliberate hold is safe for 60s.
    step(59);
    const idleAt59 = squad.filter((u) => (u.orders as unknown[]).length === 0 && (u.chase as unknown[]).length === 0).length;
    expect(idleAt59).toBeGreaterThan(0);
    // 60s+ : the breaker must have ordered the idle men east.
    step(6);
    const hunting = squad.filter((u) => (u.orders as unknown[]).length > 0 || (u.chase as unknown[]).length > 0).length;
    console.log(`STALEMATE idleAt59=${idleAt59} huntingAt65=${hunting}/${squad.length} phase=${e.phase}`);
    expect(hunting).toBeGreaterThan(0);
    // The hunt must actually close the distance: run on and check the
    // living squad has moved east of its hold position (or combat
    // resumed). Dead men keep their last position, so they must not
    // count toward the minimum — a man who dies in cover at x=390
    // would otherwise hold minX there even in a victory.
    const x0 = Math.min(...squad.map((u) => u.x as number));
    step(60);
    const aliveEnd = squad.filter((u) => u.alive);
    const x1 = aliveEnd.length ? Math.min(...aliveEnd.map((u) => u.x as number)) : x0;
    console.log(`STALEMATE minX ${Math.round(x0)} -> ${Math.round(x1)} phase=${e.phase} battleState=${e.battleState} alive=${aliveEnd.length}/${squad.length}`);
    expect(aliveEnd.length).toBeGreaterThan(0);
    expect(x1).toBeGreaterThan(x0 + 100);
  }, 120000);
});
