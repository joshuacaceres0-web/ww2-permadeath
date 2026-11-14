// @vitest-environment node
// Phase A VERIFICATION re-run (2026-11-13, on the post Phase D
// build): Phase A shipped earlier (bars own-squad-only, manual
// control purity, DEFEND scatters / FORM UP holds), and Phase
// B, Phase C, the controls+fire job, the explosives pass and
// Phase D conquest have all landed on top of it since. This
// file pins the Phase A properties those changes could have
// quietly broken and that the older suites do NOT already pin:
//
//  - the zero-input TEMPTATION test: the leader in manual play
//    with an enemy in range, a cover beside him and a weight of
//    fire on him (suppression refreshed the way live fire
//    refreshes it) does not move, does not acquire, does not
//    fire, does not take the cover — for six full seconds;
//  - the attack-lock provenance test: Phase A's rule is that
//    the leader's attackId is NEVER set by input (his clicks
//    are snapshot shots). The one input path that writes
//    attackId is the squad order (issueOrder); it must not
//    write it on the leader;
//  - the prone latch semantics: the latch (and a dive's hold)
//    outrank the auto stand-up rule for the leader, and the
//    older suppression rule (Josh, 2026-11-12) that drops EVERY
//    footman flat at suppression 70+ applies to the leader
//    too — pinned here so it is a decision on record;
//  - FORM UP's negative half: staged exactly like the DEFEND
//    scatter test in phase-a-controls.test.ts (a follower
//    beside a cover, a live threat beyond it), the follower
//    under FORM UP goes to his formation slot by the leader
//    and does NOT dive into the cover.
//
// Already pinned elsewhere, re-run and cited in the report:
// bars (phase-a-controls), click = snapshot shot (phase-a-
// controls, leader-controls, click-fire), the leader never
// walks to cover while idle (leader-controls), DEFEND scatter
// (phase-a-controls), vault is AI-only (phase-b-movement),
// the leader never flees a grenade (explosives), the AUTO
// driver still fights incl. its leader (auto-battle,
// phase-b-movement).
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

const SQUAD = [
  { id: "s-a", name: "Able", type: "rifleman", rank: "Pvt.", level: 0, medals: [], quirks: [] },
  { id: "s-b", name: "Baker", type: "rifleman", rank: "Sgt.", level: 3, medals: [], quirks: [] },
  { id: "s-c", name: "Charlie", type: "medic", rank: "Cpl.", level: 1, medals: [], quirks: [] },
];

const TOWN = {
  id: "op_02", index: 1, code: "SILENT CHATEAU", location: "test", objective: "test",
  difficulty: "MEDIUM", reward: 200, terrain: "town", brief: "test",
  enemies: [{ type: "grenadier", wave: 1, count: 1 }],
};

const FOREST = {
  id: "op_test", index: 99, code: "TEST OP", name: "Test", location: "Test",
  terrain: "forest", brief: "", reward: 500, enemies: [{ type: "volks", wave: 1, count: 3 }],
};

type U = {
  id: number; side: string; npc: boolean; alive: boolean; x: number; y: number;
  hp: number; maxHp: number; morale: number; name: string; type: string;
  attackId: number | null; targetId: number | null;
  suppression: number; pinned: boolean; prone: boolean; proneLatch?: boolean;
  mag: number; magSize: number; reloadT: number; cover: unknown;
  homeX: number; homeY: number; patrolX: number; patrolY: number;
};

type Engine = {
  setup: (m: unknown, s: unknown, b: number, v?: string, cl?: number, lp?: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  units: U[];
  bullets: Array<{ killerId: number | null }>;
  leaderUnit: () => U | null;
  leaderId: number | null;
  selected: number[];
  squadOrder: string;
  manualShot: { x: number; y: number; until: number } | null;
  isFollower: (u: U) => boolean;
  setAutoBattle: (on: boolean) => void;
  isAutoBattle: () => boolean;
  leaderProneToggle: () => void;
  covers: Array<{ x: number; y: number; r: number }>;
  issueOrder: (x: number, y: number, queue: boolean) => void;
};

async function makeEngine(mission: unknown) {
  const { GameEngine } = await import("../engine");
  const canvas = (document as unknown as { createElement: (t: string) => unknown }).createElement("canvas");
  const e = new GameEngine(canvas as never, () => {}) as unknown as Engine;
  e.setup(mission, SQUAD, 0, "", 1, "");
  return e;
}

describe("phase A re-verified: the tempted leader does nothing on his own", () => {
  it("enemy in range, cover beside him, pinned under refreshed suppression: no move, no acquire, no fire, no cover", async () => {
    const e = await makeEngine(TOWN);
    e.begin();
    const cover = e.covers.find((c) => c.x > 900 && c.x < 3000);
    expect(cover).toBeTruthy();
    const lead = e.leaderUnit()!;
    lead.x = cover!.x - 130; lead.y = cover!.y;
    lead.hp = lead.maxHp; // he weathers the whole window
    const foe = e.units.find((u) => u.side === "axis" && u.alive)!;
    foe.x = lead.x + 180; foe.y = lead.y;
    foe.hp = 100000; foe.maxHp = 100000; // the threat stays a threat
    // The threat stays HERE: its garrison home is this spot now.
    foe.homeX = foe.x; foe.homeY = foe.y; foe.patrolX = foe.x; foe.patrolY = foe.y;
    // Everyone else far west: nobody rescues or interferes.
    for (const u of e.units) {
      if (u.id !== lead.id && u.id !== foe.id) { u.x = 60; u.y = 120; }
    }
    e.update(0.15); // cover + fog settle on the staged positions
    expect(lead.cover).toBeNull();
    const x0 = lead.x, y0 = lead.y;
    const mag0 = lead.mag;
    // The distance the window actually opens at (the settle
    // can push a staged man out of a blocked cell): staged
    // 180 east, inside his rifle range either way.
    let minFoeD = Math.hypot(foe.x - lead.x, foe.y - lead.y);
    let sawPinned = false;
    let peakSuppression = 0;
    let leaderBullets = 0;
    for (let t = 0; t < 6; t += 0.1) {
      // Sustained incoming fire, staged the way the prone
      // suite stages it: suppression held at a weight that
      // pins (55+) and flattens (70+) any footman.
      lead.suppression = 95;
      e.update(0.1);
      leaderBullets += e.bullets.filter((b) => b.killerId === lead.id).length;
      sawPinned = sawPinned || lead.pinned;
      peakSuppression = Math.max(peakSuppression, lead.suppression);
      minFoeD = Math.min(minFoeD, Math.hypot(foe.x - lead.x, foe.y - lead.y));
      expect(lead.attackId).toBeNull();
      expect(lead.targetId).toBeNull();
      expect(e.manualShot).toBeNull();
      expect(Math.hypot(lead.x - x0, lead.y - y0)).toBeLessThan(1.5);
    }
    // The temptation was real: he was pinned under a
    // flattening weight of fire with a live enemy who began
    // inside his rifle range and stayed in the fight
    // (a garrison man patrols around his home post, so his
    // distance breathes — the minimum is the proof he was
    // there to be shot at and shot back at).
    expect(sawPinned).toBe(true);
    expect(peakSuppression).toBeGreaterThanOrEqual(70);
    expect(foe.alive).toBe(true);
    expect(minFoeD).toBeLessThan(240);
    // ...and he still never fired, never reloaded, never took
    // the cover beside him.
    expect(leaderBullets).toBe(0);
    expect(lead.mag).toBe(mag0);
    expect(lead.reloadT).toBe(0);
    expect(lead.cover).toBeNull();
  }, 120000);
});

describe("phase A re-verified: no input path target-locks the leader", () => {
  it("a squad fire-concentration order writes attackId on followers, never on the leader", async () => {
    const e = await makeEngine(FOREST);
    e.begin();
    const lead = e.leaderUnit()!;
    lead.x = 600; lead.y = 675;
    const foe = e.units.find((u) => u.side === "axis" && u.alive)!;
    foe.x = 760; foe.y = 675;
    foe.hp = 100000; foe.maxHp = 100000;
    // Reach the order the only way the engine allows it: from
    // the AUTO driver, where the right-click order still
    // lives. The order takes manual control back as it lands
    // — so whatever it writes operates in MANUAL play.
    e.setAutoBattle(true);
    e.selected = e.units.filter((u) => u.side === "allies" && !u.npc && u.alive).map((u) => u.id);
    e.update(0.15); // fog settles so the order can see its target
    e.issueOrder(foe.x, foe.y, false);
    expect(e.isAutoBattle()).toBe(false); // it took manual command back
    // The order is real: a follower carries the lock...
    const follower = e.units.find((u) => e.isFollower(u) && u.alive)!;
    expect(follower.attackId).toBe(foe.id);
    // ...but the leader never does (Phase A: his clicks are
    // snapshot shots; a target lock is auto-acquisition).
    expect(lead.attackId).toBeNull();
    // And left alone with the order standing, he does not
    // fire a single round of his own.
    let leaderBullets = 0;
    for (let t = 0; t < 3; t += 0.1) {
      e.update(0.1);
      leaderBullets += e.bullets.filter((b) => b.killerId === lead.id).length;
      expect(lead.attackId).toBeNull();
    }
    expect(leaderBullets).toBe(0);
    expect(lead.mag).toBe(lead.magSize);
  }, 120000);
});

describe("phase A re-verified: prone latch semantics for the leader", () => {
  it("latched prone, fire slackens: the auto stand-up rule yields and he stays down until the player stands him", async () => {
    const e = await makeEngine(FOREST);
    e.begin();
    for (const u of e.units) if (u.side === "axis") { u.x = 3900; u.y = 1200; u.hp = 100000; u.maxHp = 100000; }
    const lead = e.leaderUnit()!;
    lead.suppression = 0;
    e.leaderProneToggle();
    expect(lead.prone).toBe(true);
    expect(lead.proneLatch).toBe(true);
    for (let t = 0; t < 3; t += 0.1) {
      lead.suppression = 0;
      e.update(0.1);
      expect(lead.prone).toBe(true);
    }
    e.leaderProneToggle();
    expect(lead.prone).toBe(false);
    expect(lead.proneLatch).toBe(false);
  }, 60000);

  it("the suppression drop itself (Josh, 2026-11-12) applies to the leader too: 70+ puts him flat", async () => {
    const e = await makeEngine(FOREST);
    e.begin();
    for (const u of e.units) if (u.side === "axis") { u.x = 3900; u.y = 1200; u.hp = 100000; u.maxHp = 100000; }
    const lead = e.leaderUnit()!;
    expect(lead.prone).toBeFalsy();
    // Pinned by the Phase A audit's own case (a click while
    // pinned in the open is refused), prone is the older
    // every-footman rule: Phase A's latch governs standing
    // back up, not the drop. Pinned here as a decision on
    // record, not an accident.
    lead.suppression = 80;
    e.update(1 / 60);
    expect(lead.prone).toBe(true);
  }, 60000);
});

describe("phase A re-verified: FORM UP does not scatter", () => {
  it("the DEFEND staging under FORM UP: the follower goes to his slot by the leader, not into the cover", async () => {
    const e = await makeEngine(TOWN);
    e.begin();
    const cover = e.covers.find((c) => c.x > 900 && c.x < 3000);
    expect(cover).toBeTruthy();
    const foe = e.units.find((u) => u.side === "axis" && u.alive)!;
    foe.x = cover!.x + 210; foe.y = cover!.y;
    foe.hp = 100000; foe.maxHp = 100000;
    const follower = e.units.find((u) => e.isFollower(u) && u.alive && u.type === "rifleman")!;
    follower.x = cover!.x - 130; follower.y = cover!.y;
    const lead = e.leaderUnit()!;
    lead.x = Math.max(60, cover!.x - 420); lead.y = cover!.y;
    expect(e.squadOrder).toBe("formup");
    // The same window the DEFEND test in phase-a-controls
    // needs to dive into that cover and hold it.
    for (let t = 0; t < 12; t += 0.25) e.update(0.25);
    // He is on his formation post by the leader (the leader-
    // controls recall distance), nowhere near the cover the
    // DEFEND order sends him into.
    expect(Math.hypot(follower.x - lead.x, follower.y - lead.y)).toBeLessThan(130);
    expect(Math.hypot(follower.x - cover!.x, follower.y - cover!.y)).toBeGreaterThan(100);
  }, 120000);
});
