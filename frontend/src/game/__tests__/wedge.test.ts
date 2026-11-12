// Regression test for bug #1 (cover-boundary wedge): a unit parked 2px
// outside a cover blocker's collision radius and ordered straight through
// it must move around or drop the order within a few seconds, never wedge
// for hundreds of seconds with orders pending.
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
const MISSION = { id: "op_02", index: 1, code: "OPERATION SILENT CHATEAU", location: "Valognes Estate", objective: "", difficulty: "HARD", reward: 400, terrain: "town", brief: "", enemies: [{ type: "grenadier", wave: 1, count: 3 }, { type: "volks", wave: 1, count: 4 }] } as const;
const SQUAD = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 2, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
  { id: "s3", name: "James Baker", type: "rifleman", rank: "Pvt.", level: 1, medals: [] },
  { id: "s4", name: "Chester Pruitt", type: "medic", rank: "Pvt.", level: 1, medals: [] },
  { id: "s5", name: "Raymond Boyd", type: "mg", rank: "Pvt.", level: 1, medals: [] },
] as const;

describe("bug1 wedge probe", () => {
  it("unit hugging a cover blocker can still move / drops its order", async () => {
    const { GameEngine } = await loadEngine();
    const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
    // Fresh battle per blocker: a previous iteration may have ended the
    // battle (phase "over" makes update() a no-op), which made later
    // blockers look frozen when they were never simulated at all.
    let worst = 0;
    let frozen = 0;
    const first = new GameEngine(canvas, () => {});
    const fe = first as unknown as Record<string, unknown>;
    first.setup(MISSION as never, SQUAD as never, 0, "");
    const blockers = (fe.blockers as Array<{ x: number; y: number; r: number }>).slice(0, 6);
    console.log(`blockers=${blockers.length}`);
    for (let i = 0; i < blockers.length; i++) {
      const engine = new GameEngine(canvas, () => {});
      const e = engine as unknown as Record<string, unknown>;
      engine.setup(MISSION as never, SQUAD as never, 0, "");
      engine.begin();
      const b = blockers[i];
      const live = (e.units as Array<Record<string, unknown>>).filter((u) => u.side === "allies" && !u.npc && u.alive);
      if (!live.length) break;
      const u = live[0];
      u.x = b.x + b.r + 9 + 2; u.y = b.y; u.hp = u.maxHp; u.suppression = 0; u.pinned = false;
      (e as { selectUnit: (id: number) => void }).selectUnit(u.id as number);
      (e as { issueOrder: (x: number, y: number, q: boolean) => void }).issueOrder(b.x - 400, b.y, false);
      const startX = u.x as number;
      let stuckSeconds = 0;
      let lastX = startX; let lastT = 0;
      for (let step = 0; step < 60 * 30; step++) {
        (e as { update: (dt: number) => void }).update(1 / 60);
        // A dead unit keeps whatever orders it held — update() skips
        // dead units, so counting "stuck" seconds on a corpse would
        // fail the test for a man who was shot while wedged, not for
        // a wedge. Stop the clock at death.
        if (!u.alive) break;
        if (step % 60 === 0) {
          const t = step / 60;
          if (Math.abs((u.x as number) - lastX) < 2 && ((u.orders as unknown[]).length > 0 || (u.chase as unknown[]).length > 0)) stuckSeconds += 1;
          lastX = u.x as number; lastT = t;
        }
        if ((e.phase as string) === "over") break;
      }
      if ((e.phase as string) === "over") { console.log(`blocker ${i} battle ended early`); continue; }
      const moved = Math.abs((u.x as number) - startX);
      if (!u.alive) { console.log(`blocker ${i} unit died while wedged (moved=${Math.round(moved)} before death)`); continue; }
      const ordersLeft = ((u.orders as unknown[]).length + (u.chase as unknown[]).length);
      console.log(`blocker ${i} r=${b.r} moved=${Math.round(moved)} stuckSeconds~${stuckSeconds} ordersLeft=${ordersLeft} alive=${u.alive}`);
      worst = Math.max(worst, stuckSeconds);
      if (stuckSeconds >= 4 && ordersLeft > 0) frozen++;
    }
    expect(frozen).toBe(0);
    expect(worst).toBeLessThan(4);
  }, 120000);
});
