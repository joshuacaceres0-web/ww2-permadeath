// @vitest-environment node
/**
 * NPC squad idle push (Josh, 2026-11-13, bug hunt item 23):
 * a 2nd Platoon squad that has not fought for
 * NPC_SQUAD_IDLE_PUSH seconds (25) pushes up toward the fight
 * on its own, instead of sitting until the 60s stalemate
 * breaker.
 *
 * The sit being rescued is the anchored one from the hunt: a
 * squad whose leader is held in place (cover hold, a medic's
 * leash, a pathing wedge — the audit never pinned which) while
 * his men anchor on him, out of range, fighting nothing. In
 * the open a platoon squad advances on its own, so the test
 * holds squad 0's leader at his park spot with the test's
 * hand, standing in for any of those holds; what is under
 * test is the rescue, not the hold. Hunt orders override
 * anchor following (the orders branch runs first), so once
 * the push fires the men march even though the leader is
 * still held, and the leader carries hunt orders of his own.
 * The player's own squad, equally idle, is never pushed.
 */
import { describe, expect, it } from "vitest";
import { NPC_SQUAD_IDLE_PUSH } from "../engine";

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
const TRICKLE = { id: "op_02", index: 1, code: "TRICKLE", location: "test", objective: "", difficulty: "HARD", reward: 400, terrain: "town", brief: "", enemies: [E("volks", 1, 1), E("volks", 2, 1), E("volks", 3, 1)] } as Any;
const SQUAD5 = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 2, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
  { id: "s3", name: "Samuel Novak", type: "radioman", rank: "Pvt.", level: 1, medals: [] },
  { id: "s4", name: "Chester Pruitt", type: "medic", rank: "Pvt.", level: 1, medals: [] },
  { id: "s5", name: "Raymond Boyd", type: "mg", rank: "Pvt.", level: 1, medals: [] },
] as const;

describe("NPC squad idle push", () => {
  it("a squad anchored on a held leader pushes up inside 25s; the player's squad is not pushed", async () => {
    expect(NPC_SQUAD_IDLE_PUSH).toBe(25);
    const GameEngine = await loadEngine();
    const { roadYAt } = await import("../engine");
    const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
    let lastHud: Any = null;
    const e = new GameEngine(canvas, (h: Any) => { lastHud = h; }) as Any;
    e.setup(TRICKLE, SQUAD5, 0, "", 8);
    e.fleeChance = 0;
    e.fleeChanceNormal = 0;
    e.begin();
    // The fight to push toward: one static MG42 mid-map, far
    // out of anyone's vision from the west edge.
    e.spawnEnemyUnit("mg42", 1500, roadYAt(1500), () => 0.5, true);
    // Park NPC squad 0 at the west edge and hold its leader
    // (spawn order puts the squad leader first).
    const squad0 = () => (e.units as Any[]).filter((u) => u.npc && u.npcSquad === 0 && u.alive);
    for (const u of squad0()) u.x = 250;
    const leader = squad0()[0];
    const leaderSpot = { x: leader.x, y: leader.y };
    const followers = () => squad0().filter((u) => u.id !== leader.id);
    const meanX = (arr: Any[]) => arr.reduce((s, u) => s + u.x, 0) / Math.max(1, arr.length);
    const playerMean0 = meanX((e.units as Any[]).filter((u) => u.side === "allies" && !u.npc));
    let pushLoggedAt: number | null = null;
    let leaderOrderedAt: number | null = null;
    let followerMeanAt20 = 0;
    let t = 0;
    for (let step = 0; step < 460; step++) {
      // The hold: whatever strands a squad in the real game,
      // the leader does not leave his spot in this test.
      leader.x = leaderSpot.x;
      leader.y = leaderSpot.y;
      e.update(0.1);
      t = (step + 1) / 10;
      if (Math.abs(t - 20) < 0.06) followerMeanAt20 = meanX(followers());
      if (leaderOrderedAt === null && t >= 20 && (leader.orders ?? []).length > 0) leaderOrderedAt = t;
      if (pushLoggedAt === null && t >= 15) {
        e.emitHud();
        const lines = (lastHud?.log ?? []).map((l: Any) => String(l.text ?? l));
        if (lines.some((s: string) => s.includes("2nd Platoon pushes up"))) pushLoggedAt = t;
      }
      if (e.phase === "over") break;
    }
    // Anchored on the held leader, the squad sat: at t=20 the
    // followers are still back at the park, not marching.
    expect(followerMeanAt20).toBeLessThan(250 + 160);
    // The push fired inside the window (25s + cadence slack),
    // well before the 60s stalemate breaker could explain it,
    // and it ordered the anchor himself, not just his men.
    expect(pushLoggedAt).not.toBeNull();
    expect(pushLoggedAt!).toBeLessThan(40);
    expect(leaderOrderedAt).not.toBeNull();
    expect(leaderOrderedAt!).toBeLessThan(40);
    // And the men are genuinely marching east by t=46, orders
    // over anchors, even with the leader still held.
    expect(meanX(followers())).toBeGreaterThan(250 + 250);
    // The player's own idle squad was never pushed.
    const playerMeanEnd = meanX((e.units as Any[]).filter((u) => u.side === "allies" && !u.npc && u.alive));
    expect(Math.abs(playerMeanEnd - playerMean0)).toBeLessThan(90);
  }, 120000);
});
