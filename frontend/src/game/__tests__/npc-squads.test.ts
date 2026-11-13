// @vitest-environment node
/**
 * NPC squads (Josh, 2026-11-12): 2nd Platoon deploys in squads
 * of 8 with leaders, made of the same classes the player hires.
 * Followers anchor to their own leader; when he falls, the next
 * most senior man (rank, then kills, then level) takes over.
 * Wave-clear men join the smallest living squad. An NPC radioman
 * never opens the player's radio.
 */
import { describe, expect, it } from "vitest";

function stubBrowser() {
  const grad = { addColorStop: () => {} };
  const ctx = new Proxy(
    {},
    {
      get(_t, p) {
        if (p === "createLinearGradient" || p === "createRadialGradient") return () => grad;
        if (p === "measureText") return () => ({ width: 10 });
        if (p === "getImageData")
          return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
        if (p === "createPattern") return () => ({});
        return typeof p === "string" ? () => {} : undefined;
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

const SQUAD = [
  { id: "s1", name: "Frank Hayes", type: "rifleman", rank: "Sgt.", level: 2, medals: [] },
  { id: "s2", name: "Walter Kowalski", type: "rifleman", rank: "Cpl.", level: 1, medals: [] },
  { id: "s3", name: "James Baker", type: "rifleman", rank: "Pvt.", level: 1, medals: [] },
  { id: "s4", name: "Chester Pruitt", type: "medic", rank: "Pvt.", level: 1, medals: [] },
] as const;

const TOWN = {
  id: "op_02", index: 1, code: "SILENT CHATEAU", location: "test", objective: "test",
  difficulty: "HARD", reward: 400, terrain: "town", brief: "test",
  enemies: [{ type: "volks", wave: 1, count: 3 }],
} as const;

const BEACH = {
  id: "op_01", index: 0, code: "OPERATION OVERLORD", location: "test", objective: "test",
  difficulty: "MODERATE", reward: 250, terrain: "dday", brief: "test",
  enemies: [{ type: "volks", wave: 1, count: 3 }],
} as const;

type U = {
  id: number; side: string; npc: boolean; type: string; alive: boolean;
  x: number; y: number; hp: number; maxHp: number; rank: string; kills: number; level: number;
  npcSquad?: number; npcLeader?: boolean;
};
type Engine = {
  setup: (m: unknown, s: unknown, b: number, v: string, cl?: number) => void;
  begin: () => void;
  update: (dt: number) => void;
  damage: (u: U, amount: number, source: string, killerId: number | null) => void;
  npcSquadLeaderOf: (s: number) => U | null;
  radioLive: () => boolean;
  spawnWaveAllies: (n: number) => void;
  units: U[];
};

async function makeEngine(mission: unknown, variant = "") {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {}) as unknown as Engine;
  engine.setup(mission as never, SQUAD as never, 0, variant, 8);
  engine.begin();
  return engine;
}

const npcsOf = (e: Engine) => e.units.filter((u) => u.npc && u.side === "allies");

describe("NPC squads", () => {
  it("deploys in squads of 8 with a rifleman sergeant leading each", async () => {
    const e = await makeEngine(TOWN);
    const npcs = npcsOf(e);
    expect(npcs.length).toBe(12);
    const bySquad = new Map<number, U[]>();
    for (const u of npcs) bySquad.set(u.npcSquad!, [...(bySquad.get(u.npcSquad!) ?? []), u]);
    expect([...bySquad.values()].map((g) => g.length).sort()).toEqual([4, 8]);
    for (const [idx, members] of bySquad) {
      const leader = e.npcSquadLeaderOf(idx);
      expect(leader).not.toBeNull();
      expect(leader!.type).toBe("rifleman");
      expect(leader!.rank).toBe("Sgt.");
      expect(members.filter((m) => m.npcLeader)).toEqual([leader]);
    }
  });

  it("fields the player's classes at NPC scaling, support slot rotating", async () => {
    const e = await makeEngine(BEACH, "beach");
    const npcs = npcsOf(e);
    expect(npcs.length).toBe(32);
    const types = new Set(npcs.map((u) => u.type));
    for (const t of ["rifleman", "medic", "mg", "sniper", "at", "recon", "engineer", "radioman"]) {
      expect(types.has(t), `missing NPC class ${t}`).toBe(true);
    }
    const rifle = npcs.find((u) => u.type === "rifleman")!;
    expect(rifle.maxHp).toBe(Math.round(120 * 0.9));
  });

  it("an NPC radioman does not open the player's radio", async () => {
    const e = await makeEngine(TOWN);
    expect(npcsOf(e).some((u) => u.type === "radioman")).toBe(true);
    expect(e.radioLive()).toBe(false);
  });

  it("followers regroup on their leader when he moves off", async () => {
    const e = await makeEngine(BEACH, "beach");
    for (const u of e.units) if (u.side === "axis") { u.x = 3950; u.y = 60; }
    const leader = e.npcSquadLeaderOf(0)!;
    const mates = npcsOf(e).filter((u) => u.npcSquad === 0 && u.id !== leader.id);
    leader.x += 600;
    const before = mates.reduce((s, m) => s + Math.hypot(m.x - leader.x, m.y - leader.y), 0) / mates.length;
    for (let t = 0; t < 8; t += 0.25) e.update(0.25);
    const alive = mates.filter((m) => m.alive);
    const after = alive.reduce((s, m) => s + Math.hypot(m.x - leader.x, m.y - leader.y), 0) / alive.length;
    expect(before).toBeGreaterThan(400);
    expect(after).toBeLessThan(before * 0.5);
  });

  it("leader death hands over by rank, then kills", async () => {
    const e = await makeEngine(TOWN);
    const first = e.npcSquadLeaderOf(0)!;
    const mates = npcsOf(e).filter((u) => u.npcSquad === 0 && u.id !== first.id);
    const corporals = mates.filter((m) => m.rank === "Cpl.");
    const pfc = mates.find((m) => m.rank === "Pfc.")!;
    pfc.kills = 9; // kills do not beat rank
    e.damage(first, 100000, "test", null);
    expect(first.alive).toBe(false);
    const second = e.npcSquadLeaderOf(0)!;
    expect(second.id).toBe(corporals[0].id);
    // Both corporals fall: now the high-kill Pfc. leads the Pfcs.
    for (const c of corporals) e.damage(c, 100000, "test", null);
    const third = e.npcSquadLeaderOf(0)!;
    expect(third.id).toBe(pfc.id);
  });

  it("wave-clear men join the smallest living squad, or form a new one", async () => {
    const e = await makeEngine(TOWN);
    for (const u of npcsOf(e)) if (u.npcSquad === 1) e.damage(u, 100000, "test", null);
    const before = npcsOf(e).length;
    e.spawnWaveAllies(2);
    const joined = npcsOf(e).slice(before);
    expect(joined.length).toBe(2);
    expect(joined.every((u) => u.npcSquad === 0)).toBe(true);
    for (const u of npcsOf(e)) if (u.alive) e.damage(u, 100000, "test", null);
    const before2 = npcsOf(e).length;
    e.spawnWaveAllies(2);
    const fresh = npcsOf(e).slice(before2);
    expect(fresh[0].npcSquad).toBe(2);
    expect(fresh[0].npcLeader).toBe(true);
    expect(fresh[1].npcSquad).toBe(2);
  });
});
