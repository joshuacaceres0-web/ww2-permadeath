// @vitest-environment node
// Prone (Josh, 2026-11-12): a footman under a real weight of
// fire (suppression 70+) drops flat. A prone man is much
// harder to hit at range (up to 45% of hits thwarted at
// 250+), gets no protection up close (60 and in), crawls at
// 0.45x, and fires 1.4x slower. He stays down until the
// fire slackens (suppression under 30). Vehicles and gun
// nests never go prone.
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

const FOREST = {
  id: "op_test", index: 99, code: "TEST OP", name: "Test", location: "Test",
  terrain: "forest", brief: "", reward: 500, enemies: [{ type: "volks", wave: 1, count: 3 }],
};

const SQUAD = [
  { id: "s-a", name: "Able", type: "rifleman", rank: "Pvt.", level: 0, medals: [], quirks: [] },
  { id: "s-b", name: "Baker", type: "rifleman", rank: "Sgt.", level: 3, medals: [], quirks: [] },
  { id: "s-c", name: "Charlie", type: "medic", rank: "Cpl.", level: 1, medals: [], quirks: [] },
];

type U = {
  id: number; side: string; npc: boolean; alive: boolean; x: number; y: number;
  hp: number; maxHp: number; attackId: number | null; abilityCd: number; name: string; type: string;
};

async function makeEngine(leaderPick = "") {
  const { GameEngine } = await loadEngine();
  const canvas = (document as unknown as { createElement: (t: string) => HTMLCanvasElement }).createElement("canvas");
  const engine = new GameEngine(canvas, () => {});
  (engine as { setup: (...a: unknown[]) => void }).setup(FOREST, SQUAD, 0, "", 1, leaderPick);
  return engine as unknown as {
    leaderUnit: () => U | null;
    isFollower: (u: U) => boolean;
    leaderId: number | null;
    selected: number[];
    squadOrder: string;
    leaderShootAt: (x: number, y: number) => void;
    leaderAbilityAt: (x: number, y: number) => void;
    setSquadOrder: (o: string) => void;
    begin: () => void;
    update: (dt: number) => void;
    units: U[];
    keys: Set<string>;
    bullets: unknown[];
    damage: (t: U, dmg: number, src: U) => void;
  };
}

function step(e: { update: (dt: number) => void }, seconds: number) {
  for (let t = 0; t < seconds; t += 0.1) e.update(0.1);
}

describe("team leader", () => {
  it("defaults to the most experienced man deployed", async () => {
    const e = await makeEngine();
    const lead = e.leaderUnit();
    expect(lead?.name).toBe("Baker");
    expect(e.leaderId).toBe(lead?.id);
    expect(e.selected).toEqual([lead?.id]);
    expect(e.squadOrder).toBe("formup");
  });

  it("honors the briefing pick over experience", async () => {
    const e = await makeEngine("s-c");
    expect(e.leaderUnit()?.name).toBe("Charlie");
  });

  it("WASD moves the leader and the squad follows in formation", async () => {
    const e = await makeEngine();
    e.begin();
    const lead = e.leaderUnit()!;
    const startX = lead.x;
    e.keys.add("d");
    step(e, 3);
    e.keys.delete("d");
    expect(lead.x).toBeGreaterThan(startX + 40);
    for (const u of e.units.filter((m) => e.isFollower(m) && m.alive)) {
      expect(Math.hypot(u.x - lead.x, u.y - lead.y)).toBeLessThan(220);
    }
  });

  it("left click on an enemy makes the leader fire without chasing", async () => {
    const e = await makeEngine();
    e.begin();
    const lead = e.leaderUnit()!;
    lead.x = 600; lead.y = 675;
    const foe = e.units.find((u) => u.side === "axis" && u.alive)!;
    foe.x = 760; foe.y = 675;
    const hp0 = foe.hp;
    const lx = lead.x;
    e.leaderShootAt(foe.x, foe.y);
    // The player shoots as he intends (Josh, 2026-11-13): the
    // click aims at where the enemy stands, it does NOT lock
    // him as a target the leader then tracks.
    expect(lead.attackId).toBeNull();
    step(e, 2.5);
    expect(foe.hp).toBeLessThan(hp0);
    expect(Math.abs(lead.x - lx)).toBeLessThan(16);
  });

  it("left click on open ground fires at the point", async () => {
    const e = await makeEngine();
    e.begin();
    const lead = e.leaderUnit()!;
    lead.x = 600; lead.y = 675;
    e.leaderShootAt(lead.x + 130, lead.y);
    let sawBullet = false;
    for (let t = 0; t < 1; t += 0.1) {
      e.update(0.1);
      if (e.bullets.length > 0) sawBullet = true;
    }
    expect(sawBullet).toBe(true);
  });

  it("right click fires the leader ability at the point", async () => {
    const e = await makeEngine();
    e.begin();
    const lead = e.leaderUnit()!;
    e.leaderAbilityAt(lead.x + 140, lead.y);
    expect(lead.abilityCd).toBeGreaterThan(0);
  });

  it("orders change follower behaviour: form up recalls, defend holds, attack engages", async () => {
    const e = await makeEngine();
    e.begin();
    const lead = e.leaderUnit()!;
    lead.x = 500; lead.y = 675;
    const follower = e.units.find((m) => e.isFollower(m) && m.alive)!;
    follower.x = 950; follower.y = 675;
    e.setSquadOrder("formup");
    step(e, 9);
    expect(Math.hypot(follower.x - lead.x, follower.y - lead.y)).toBeLessThan(130);
    const foe = e.units.find((u) => u.side === "axis" && u.alive)!;
    foe.x = lead.x + 400; foe.y = 675;
    e.setSquadOrder("defend");
    // DEFEND (Josh, 2026-11-13): scatter to cover near where
    // he stands — the follower must NOT close on the distant
    // foe the way ATTACK would. (The scatter itself is pinned
    // in phase-a-controls.test.ts.)
    let minFoeD = Infinity;
    for (let t = 0; t < 2; t += 0.25) {
      e.update(0.25);
      if (follower.alive) minFoeD = Math.min(minFoeD, Math.hypot(follower.x - foe.x, follower.y - foe.y));
    }
    expect(minFoeD).toBeGreaterThan(200);
    e.setSquadOrder("attack");
    let minD = Infinity;
    // 6s, not 4: since Phase B the defend scatter can end in
    // a dolphin dive, and the prone hold costs the attack
    // its first second before he is up and closing.
    for (let t = 0; t < 6; t += 0.25) {
      e.update(0.25);
      if (follower.alive) minD = Math.min(minD, Math.hypot(follower.x - foe.x, follower.y - foe.y));
    }
    expect(minD).toBeLessThan(330);
  });

  it("when the leader falls, the next most experienced man takes over", async () => {
    const e = await makeEngine();
    e.begin();
    const lead = e.leaderUnit()!;
    expect(lead.name).toBe("Baker");
    const foe = e.units.find((u) => u.side === "axis" && u.alive)!;
    for (let i = 0; i < 40 && lead.alive; i++) e.damage(lead, 25, foe);
    step(e, 0.3);
    const next = e.leaderUnit();
    expect(next?.name).toBe("Charlie");
    expect(e.selected).toEqual([next?.id]);
  });

  it("a follower fires on his own at an enemy in range", async () => {
    const e = await makeEngine();
    e.begin();
    const follower = e.units.find((m) => e.isFollower(m) && m.alive && m.type === "rifleman")!;
    const foe = e.units.find((u) => u.side === "axis" && u.alive)!;
    follower.x = 600; follower.y = 675;
    foe.x = 740; foe.y = 675;
    const hp0 = foe.hp;
    step(e, 2.5);
    expect(foe.hp).toBeLessThan(hp0);
  });

  it("the leader never walks himself to cover while idle", async () => {
    const e = await makeEngine();
    e.begin();
    const leader = e.leaderUnit()!;
    // Park the enemy far away: nobody is in range, so the only
    // thing that could move an idle man on his own is the
    // generic cover-seek rule — the leader is exempt from it
    // because Josh puts him where he wants him.
    for (const u of e.units) if (u.side === "axis") { u.x = 3900; u.y = 1200; }
    leader.x = 700; leader.y = 675;
    const x0 = leader.x, y0 = leader.y;
    step(e, 6);
    expect(Math.abs(leader.x - x0)).toBeLessThan(1.5);
    expect(Math.abs(leader.y - y0)).toBeLessThan(1.5);
  });
});
