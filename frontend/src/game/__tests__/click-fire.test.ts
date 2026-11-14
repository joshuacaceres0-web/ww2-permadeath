// @vitest-environment node
// Click-fire, reconciled from Josh's three orders of
// 2026-11-13 (audit fix + "I need to be able to shoot
// wherever I click" + the AT bazooka decision + hold-to-
// fire for automatics):
//  - the trigger is NEVER refused for distance: the leader
//    fires toward any click and his rounds die at the
//    weapon's range (maxTravel), falling short past it;
//  - state gates still eat clicks — reloading, pinned in
//    the open, prone and crawling — and now SAY so with a
//    floating tag at the click point, throttled per reason;
//    there is no out-of-range tag anymore;
//  - an AT leader whose click snaps to an enemy vehicle
//    inside 260 fires the BAZOOKA at it (fireAt, the auto
//    path's own shot); every other AT click is the trench
//    gun toward the point; the bazooka never fires at
//    ground or infantry;
//  - automatics (MG class gun; Thompson/MP40/BAR/FG42 by
//    their defs) keep firing while the button is held, aim
//    following the cursor; semi-automatics fire once per
//    press — the shot spends the click;
//  - a click during the intro cinematic queues nothing.
import { readFileSync } from "node:fs";
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
  const makeCanvas = () => {
    const listeners = new Map<string, (ev: unknown) => void>();
    return {
      width: 0,
      height: 0,
      _listeners: listeners,
      getContext: () => ctx,
      toDataURL: () => "",
      getBoundingClientRect: () => ({ width: 1600, height: 900, left: 0, top: 0 }),
      addEventListener: (type: string, fn: (ev: unknown) => void) => void listeners.set(type, fn),
      removeEventListener: (type: string) => void listeners.delete(type),
      style: {},
    };
  };
  const winListeners = new Map<string, (ev: unknown) => void>();
  (globalThis as unknown as Record<string, unknown>).addEventListener =
    (type: string, fn: (ev: unknown) => void) => void winListeners.set(type, fn);
  (globalThis as unknown as Record<string, unknown>).removeEventListener =
    (type: string) => void winListeners.delete(type);
  (globalThis as unknown as Record<string, unknown>).__winListeners = winListeners;
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
    createElement: (tag: string) => (tag === "canvas" ? makeCanvas() : {}),
    fonts: { load: () => Promise.resolve([]) },
  };
  (globalThis as unknown as Record<string, unknown>).HTMLCanvasElement = function () {};
}

stubBrowser();

const engineSrc = readFileSync(new URL("../engine.ts", import.meta.url), "utf8");

const TOWN = {
  id: "op_02", index: 1, code: "SILENT CHATEAU", location: "test", objective: "test",
  difficulty: "MEDIUM", reward: 200, terrain: "town", brief: "test",
  enemies: [{ type: "grenadier", wave: 1, count: 1 }],
};

const TOWN_ARMOR = {
  ...TOWN,
  enemies: [
    { type: "panzer", wave: 1, count: 1 },
    { type: "grenadier", wave: 1, count: 1 },
  ],
};

const RIFLE_SQUAD = [
  { id: "s-a", name: "Able", type: "rifleman", rank: "Pvt.", level: 0, medals: [], quirks: [] },
  { id: "s-b", name: "Baker", type: "rifleman", rank: "Sgt.", level: 3, medals: [], quirks: [] },
  { id: "s-c", name: "Charlie", type: "medic", rank: "Cpl.", level: 1, medals: [], quirks: [] },
];

const AT_SQUAD = [
  { id: "s-a", name: "Boomer", type: "at", rank: "Sgt.", level: 3, medals: [], quirks: [] },
  { id: "s-b", name: "Baker", type: "rifleman", rank: "Pvt.", level: 0, medals: [], quirks: [] },
  { id: "s-c", name: "Charlie", type: "medic", rank: "Cpl.", level: 1, medals: [], quirks: [] },
];

const MG_SQUAD = [
  { id: "s-a", name: "Heavy", type: "mg", rank: "Sgt.", level: 3, medals: [], quirks: [] },
  { id: "s-b", name: "Baker", type: "rifleman", rank: "Pvt.", level: 0, medals: [], quirks: [] },
  { id: "s-c", name: "Charlie", type: "medic", rank: "Cpl.", level: 1, medals: [], quirks: [] },
];

type U = {
  id: number; side: string; npc: boolean; alive: boolean; x: number; y: number;
  hp: number; maxHp: number; name: string; type: string; vehicle?: boolean;
  prone: boolean; proneLatch: boolean; pinned: boolean; suppression: number; cover: unknown;
  cooldown: number;
  mag: number; magSize: number; altMag: number; reloadT: number; reloadTime: number;
  dmg: number; equipment: string[]; spread: number; abilityCd: number;
};

type B = { ox: number; oy: number; x: number; y: number; vx: number; vy: number; killerId: number | null; maxTravel?: number };

type Engine = {
  setup: (m: unknown, s: unknown, b: number, v?: string, cl?: number, lp?: string) => void;
  begin: () => void;
  update: (dt: number) => void;
  units: U[];
  bullets: B[];
  leaderUnit: () => U | null;
  leaderShootAt: (x: number, y: number) => void;
  keys: Set<string>;
  elapsed: number;
  clickTags: Array<{ x: number; y: number; text: string; until: number }>;
  manualShot: unknown;
  mouseHeld: boolean;
  mouse: { x: number; y: number; inside: boolean };
  autoWeapon: (u: U) => boolean;
  introT: number;
  aiming: boolean;
  aimUnitId: number | null;
  attach: () => void;
  resize: () => void;
};

type CanvasStub = { _listeners: Map<string, (ev: never) => void> };

async function makeAttachedEngine(mission: unknown = TOWN, squad: unknown = RIFLE_SQUAD) {
  const { GameEngine } = await import("../engine");
  const canvas = (document as unknown as { createElement: (t: string) => unknown }).createElement("canvas") as unknown as CanvasStub;
  const e = new GameEngine(canvas as never, () => {}) as unknown as Engine;
  e.setup(mission, squad, 0, "", 1, "");
  e.begin();
  e.attach();
  e.resize();
  return { e, canvas };
}

/** Fire a synthetic pointer event at the engine's real
 * canvas listener, the way the browser would deliver it. */
function pointer(canvas: CanvasStub, type: string, init: Record<string, unknown> = {}) {
  const fn = canvas._listeners.get(type);
  if (!fn) throw new Error(`no ${type} listener registered on the canvas`);
  let prevented = false;
  const ev = {
    button: 0, pointerType: "mouse", clientX: 600, clientY: 400, shiftKey: false,
    ...init,
    preventDefault: () => { prevented = true; },
  };
  fn(ev as never);
  return { wasPrevented: () => prevented };
}

function keydown(key: string) {
  const reg = (globalThis as unknown as Record<string, unknown>).__winListeners as Map<string, (ev: never) => void>;
  const fn = reg.get("keydown");
  if (!fn) throw new Error("no window keydown listener registered");
  fn({ key, preventDefault: () => {} } as never);
}

async function makeEngine(mission: unknown = TOWN, squad: unknown = RIFLE_SQUAD) {
  const { GameEngine } = await import("../engine");
  const canvas = (document as unknown as { createElement: (t: string) => unknown }).createElement("canvas");
  const e = new GameEngine(canvas as never, () => {}) as unknown as Engine;
  e.setup(mission, squad, 0, "", 1, "");
  e.begin();
  return e;
}

/** Park every enemy where it cannot interfere. */
function parkEnemies(e: Engine) {
  for (const u of e.units) if (u.side === "axis") {
    u.x = 3900; u.y = 60;
    u.hp = 100000; u.maxHp = 100000;
  }
}

function step(e: Engine, seconds: number, dt = 0.05) {
  for (let t = 0; t < seconds; t += dt) e.update(dt);
}

/** Count a man's shots by watching his magazine fall. */
function countShots(e: Engine, lead: U, seconds: number) {
  let shots = 0;
  let prev = lead.mag;
  for (let t = 0; t < seconds; t += 0.05) {
    e.update(0.05);
    if (lead.mag < prev) shots += prev - lead.mag;
    prev = lead.mag;
  }
  return shots;
}

describe("free fire: the trigger is never refused for distance", () => {
  it("a rifleman click at 600 (range 240) fires, and his rounds die at his range", async () => {
    const e = await makeEngine();
    parkEnemies(e);
    const lead = e.leaderUnit()!;
    lead.x = 300; lead.y = 675;
    lead.suppression = 0;
    const mag0 = lead.mag;
    e.leaderShootAt(900, 675);
    expect(e.clickTags).toHaveLength(0); // no refusal of any kind
    let maxTravel = 0;
    let sawCapped = false;
    for (let t = 0; t < 1.5; t += 0.05) {
      e.update(0.05);
      for (const b of e.bullets) {
        if (b.killerId !== lead.id) continue;
        if (b.maxTravel === 240) sawCapped = true;
        maxTravel = Math.max(maxTravel, Math.hypot(b.x - b.ox, b.y - b.oy));
      }
    }
    expect(lead.mag).toBeLessThan(mag0); // he fired
    expect(sawCapped).toBe(true); // the round carries his range as its cap
    expect(maxTravel).toBeGreaterThan(150); // it really flew toward the far click…
    expect(maxTravel).toBeLessThanOrEqual(255); // …and fell short at his range, never past it
  }, 60000);

  it("a click while reloading fires nothing and floats RELOADING", async () => {
    const e = await makeEngine();
    parkEnemies(e);
    const lead = e.leaderUnit()!;
    lead.suppression = 0;
    lead.reloadT = 5;
    const mag0 = lead.mag;
    e.leaderShootAt(lead.x + 130, lead.y);
    expect(e.clickTags.map((t) => t.text)).toEqual(["Reloading"]);
    step(e, 1.6); // past the click window, still mid-reload
    expect(lead.mag).toBe(mag0);
    expect(e.bullets.some((b) => b.killerId === lead.id)).toBe(false);
  }, 60000);

  it("a pinned leader's click floats PINNED DOWN and fires nothing", async () => {
    const e = await makeEngine();
    parkEnemies(e);
    const lead = e.leaderUnit()!;
    lead.suppression = 80; // keeps the pinned flag set honestly
    lead.pinned = true;
    const mag0 = lead.mag;
    e.leaderShootAt(lead.x + 130, lead.y);
    expect(e.clickTags.map((t) => t.text)).toEqual(["Pinned down"]);
    step(e, 0.5);
    expect(lead.mag).toBe(mag0);
  }, 60000);

  it("a prone, crawling leader's click floats CAN'T FIRE WHILE CRAWLING", async () => {
    const e = await makeEngine();
    parkEnemies(e);
    const lead = e.leaderUnit()!;
    lead.suppression = 0;
    lead.prone = true;
    lead.proneLatch = true; // the player's own latch: he stays down (an unlatched auto-prone would stand back up)
    const mag0 = lead.mag;
    e.keys.add("d"); // crawling east
    e.leaderShootAt(lead.x + 130, lead.y);
    expect(e.clickTags.map((t) => t.text)).toEqual(["Can't fire while crawling"]);
    step(e, 0.3);
    e.keys.delete("d");
    expect(lead.mag).toBe(mag0);
  }, 60000);

  it("the feedback is throttled: repeated blocked clicks tag once a second per reason", async () => {
    const e = await makeEngine();
    parkEnemies(e);
    const lead = e.leaderUnit()!;
    lead.suppression = 0;
    lead.reloadT = 99;
    e.leaderShootAt(lead.x + 130, lead.y);
    e.leaderShootAt(lead.x + 140, lead.y);
    e.leaderShootAt(lead.x + 150, lead.y);
    expect(e.clickTags).toHaveLength(1);
    step(e, 1.2);
    e.leaderShootAt(lead.x + 130, lead.y);
    expect(e.clickTags).toHaveLength(2);
  }, 60000);

  it("a click during the intro cinematic queues no shot", async () => {
    const e = await makeEngine();
    parkEnemies(e);
    const lead = e.leaderUnit()!;
    lead.suppression = 0;
    e.introT = 3; // cinematic running
    e.leaderShootAt(lead.x + 130, lead.y);
    expect(e.manualShot).toBeNull();
    e.introT = -1; // combat starts: the same click now queues
    e.leaderShootAt(lead.x + 130, lead.y);
    expect(e.manualShot).not.toBeNull();
    // And the intro's end clears any queued shot as a belt
    // to the guard's braces (source pin).
    const clears = engineSrc.match(/introT = -1;[\s\S]{0,220}?manualShot = null/g) ?? [];
    expect(clears.length).toBeGreaterThanOrEqual(2);
  }, 60000);
});

describe("the AT leader: bazooka for clicked vehicles, trench gun for everything else", () => {
  async function makeAtWithPanzer(distToPanzer: number) {
    const e = await makeEngine(TOWN_ARMOR, AT_SQUAD);
    const lead = e.leaderUnit()!;
    expect(lead.type).toBe("at");
    lead.x = 600; lead.y = 675;
    lead.suppression = 0;
    lead.cooldown = 0; // staging: skip the random spawn cooldown so the click answers on the next tick
    const panzer = e.units.find((u) => u.vehicle && u.side === "axis")!;
    panzer.x = 600 + distToPanzer; panzer.y = 675;
    panzer.hp = 100000; panzer.maxHp = 100000;
    panzer.dmg = 0; // its return fire cannot kill or pin anyone mid-assert
    panzer.cooldown = 999; // and it stays silent for the whole assert
    for (const u of e.units) if (u.side === "axis" && !u.vehicle) { u.x = 3900; u.y = 60; u.hp = 100000; u.maxHp = 100000; }
    return { e, lead, panzer };
  }

  it("a click on a vehicle at 200 fires the bazooka at it", async () => {
    const { e, lead, panzer } = await makeAtWithPanzer(200);
    e.leaderShootAt(panzer.x, panzer.y);
    expect(e.clickTags).toHaveLength(0);
    step(e, 0.2);
    expect(lead.mag).toBe(0); // the tube's one round is gone…
    expect(lead.reloadT).toBeGreaterThan(0); // …and it is reloading
    expect(lead.altMag).toBe(5); // the trench gun never spoke
  }, 60000);

  it("a click on open ground at 200 fires the trench gun toward it — not the bazooka, not silence", async () => {
    const { e, lead } = await makeAtWithPanzer(1500); // armour far out of the picture
    e.leaderShootAt(lead.x + 200, lead.y);
    expect(e.clickTags).toHaveLength(0);
    step(e, 0.15);
    expect(lead.altMag).toBe(4); // trench gun fired…
    expect(lead.mag).toBe(1); // …bazooka untouched
    expect(e.bullets.some((b) => b.killerId === lead.id && b.vx > 0)).toBe(true); // toward the click
  }, 60000);

  it("a click on a vehicle at 300 is beyond the tube: the trench gun answers toward it instead", async () => {
    const { e, lead, panzer } = await makeAtWithPanzer(300);
    e.leaderShootAt(panzer.x, panzer.y);
    expect(e.clickTags).toHaveLength(0); // distance is not a refusal anymore
    step(e, 0.15);
    expect(lead.mag).toBe(1); // no rocket…
    expect(lead.altMag).toBe(4); // …the trench gun fired toward the click
  }, 60000);

  it("a click inside 110 still answers with the trench gun, as before", async () => {
    const { e, lead } = await makeAtWithPanzer(1500);
    e.leaderShootAt(lead.x + 90, lead.y);
    step(e, 0.15);
    expect(lead.altMag).toBe(4);
    expect(lead.mag).toBe(1);
  }, 60000);

  it("with the bazooka reloading, a vehicle click tags RELOADING and nothing fires at it", async () => {
    const { e, lead, panzer } = await makeAtWithPanzer(200);
    lead.reloadT = 3;
    e.leaderShootAt(panzer.x, panzer.y);
    expect(e.clickTags.map((t) => t.text)).toEqual(["Reloading"]);
    step(e, 0.3);
    expect(lead.mag).toBe(1); // no rocket
    expect(lead.altMag).toBe(5); // and no trench-gun fallthrough at a vehicle
  }, 60000);
});

describe("hold to fire: automatics sustain, semi-automatics fire once per press", () => {
  it("the auto set is exactly the MG class gun and the four flagged looted guns", async () => {
    const e = await makeEngine(TOWN, MG_SQUAD);
    parkEnemies(e);
    const lead = e.leaderUnit()!;
    expect(lead.type).toBe("mg");
    expect(e.autoWeapon(lead)).toBe(true); // the MG class gun
    lead.type = "rifleman";
    expect(e.autoWeapon(lead)).toBe(false); // a plain rifle class gun
    for (const g of ["thompson", "mp40", "bar", "fg42"]) {
      lead.equipment = [g];
      expect(e.autoWeapon(lead)).toBe(true);
    }
    for (const g of ["carbine", "springfield", "trench97"]) {
      lead.equipment = [g];
      expect(e.autoWeapon(lead)).toBe(false);
    }
  }, 60000);

  it("an MG leader with the button held fires a stream at the aim point, and the aim follows the cursor", async () => {
    const e = await makeEngine(TOWN, MG_SQUAD);
    parkEnemies(e);
    const lead = e.leaderUnit()!;
    lead.x = 600; lead.y = 675;
    lead.suppression = 0;
    lead.cooldown = 0; // staging: skip the random spawn cooldown
    e.leaderShootAt(900, 675);
    e.mouseHeld = true;
    e.mouse = { x: 900, y: 675, inside: true };
    const east = countShots(e, lead, 0.5);
    expect(east).toBeGreaterThanOrEqual(2);
    // Swing the cursor north: fresh rounds head that way.
    e.mouse = { x: 600, y: 200, inside: true };
    let northBullet: B | undefined;
    for (let t = 0; t < 0.6 && !northBullet; t += 0.05) {
      e.update(0.05);
      northBullet = e.bullets.find((b) => b.killerId === lead.id && b.vy < -100);
    }
    expect(northBullet).toBeTruthy();
    const total = east + countShots(e, lead, 0.5);
    expect(total).toBeGreaterThanOrEqual(4); // a stream, not a shot
  }, 60000);

  it("a rifleman with the button held fires exactly one shot — the press spends the click", async () => {
    const e = await makeEngine();
    parkEnemies(e);
    const lead = e.leaderUnit()!;
    lead.x = 600; lead.y = 675;
    lead.suppression = 0;
    e.leaderShootAt(900, 675);
    e.mouseHeld = true;
    e.mouse = { x: 900, y: 675, inside: true };
    step(e, 0.4);
    expect(e.manualShot).toBeNull(); // spent by the shot itself
    const shots = countShots(e, lead, 1);
    expect(shots).toBe(0); // nothing more while merely held (the one shot already counted)
    expect(lead.mag).toBe(lead.magSize - 1);
  }, 60000);

  it("a hold through an empty magazine reloads and resumes while still held", async () => {
    const e = await makeEngine(TOWN, MG_SQUAD);
    parkEnemies(e);
    const lead = e.leaderUnit()!;
    lead.x = 600; lead.y = 675;
    lead.suppression = 0;
    lead.mag = 3; // nearly dry
    lead.reloadTime = 0.6; // a quick belt change for the test
    e.leaderShootAt(900, 675);
    e.mouseHeld = true;
    e.mouse = { x: 900, y: 675, inside: true };
    let sawReload = false;
    let shots = 0;
    let prev = lead.mag;
    for (let t = 0; t < 3; t += 0.05) {
      e.update(0.05);
      if (lead.reloadT > 0) sawReload = true;
      if (lead.mag < prev) shots += prev - lead.mag;
      prev = lead.mag;
    }
    expect(sawReload).toBe(true); // the mag emptied mid-hold and he reloaded…
    expect(shots).toBeGreaterThan(3); // …and the fire resumed past the first 3 rounds
  }, 60000);
});

describe("right-click aim mode (Josh, 2026-11-13): right hold aims, Q alone owns the ability", () => {
  it("holding the right button enters aim mode; releasing it (or leaving the canvas) exits — and it never touches the ability", async () => {
    const { e, canvas } = await makeAttachedEngine();
    parkEnemies(e);
    const lead = e.leaderUnit()!;
    expect(e.aiming).toBe(false);
    pointer(canvas, "pointerdown", { button: 2 });
    expect(e.aiming).toBe(true);
    expect(e.aimUnitId).toBeNull(); // right click no longer arms the ability…
    expect(lead.abilityCd).toBe(0); // …and never cast it either
    pointer(canvas, "pointerup", { button: 2 });
    expect(e.aiming).toBe(false);
    pointer(canvas, "pointerdown", { button: 2 });
    expect(e.aiming).toBe(true);
    pointer(canvas, "pointerleave");
    expect(e.aiming).toBe(false);
    // The browser menu stays suppressed on the canvas.
    const cm = pointer(canvas, "contextmenu");
    expect(cm.wasPrevented()).toBe(true);
    // Production no longer calls the one-motion ability helper from a click.
    expect(engineSrc).not.toContain("this.leaderAbilityAt(p.x, p.y)");
  }, 60000);

  it("Q still arms the ability and the casting left click is not gunfire", async () => {
    const { e, canvas } = await makeAttachedEngine();
    parkEnemies(e);
    const lead = e.leaderUnit()!;
    lead.suppression = 0;
    keydown("q");
    expect(e.aimUnitId).toBe(lead.id); // armed, exactly as Q has always worked
    pointer(canvas, "pointerdown", { button: 0 });
    expect(e.aimUnitId).toBeNull(); // consumed by the cast
    expect(lead.abilityCd).toBeGreaterThan(0); // the ability went off
    expect(e.mouseHeld).toBe(false); // the casting press never became a hold…
    expect(e.manualShot).toBeNull(); // …and queued no gunshot
  }, 60000);

  it("an aimed shot flies at the weapon's own spread; a hip shot at double", async () => {
    const e = await makeEngine();
    parkEnemies(e);
    const lead = e.leaderUnit()!;
    lead.x = 600; lead.y = 675;
    lead.suppression = 0;
    lead.cooldown = 0;
    const realRandom = Math.random;
    const fireOne = (aimed: boolean) => {
      e.aiming = aimed;
      lead.cooldown = 0;
      Math.random = () => 0.75; // spawnBullet's roll: offset = (0.75*2-1) * spreadUsed = 0.5 * spreadUsed
      try {
        e.leaderShootAt(lead.x + 200, lead.y); // due east
        e.update(0.05);
      } finally {
        Math.random = realRandom;
      }
      const mine = e.bullets.filter((bb) => bb.killerId === lead.id);
      const b = mine[mine.length - 1]; // the round this click just fired (earlier ones may still be flying)
      if (!b) throw new Error("the leader did not fire");
      return Math.abs(Math.atan2(b.vy, b.vx)); // aim was due east: the offset IS the angle
    };
    const hipOffset = fireOne(false);
    const aimedOffset = fireOne(true);
    // With the roll pinned at 0.75: aimed offset = 0.5 * base spread,
    // hip offset = 0.5 * base spread * HIP_SPREAD_MULT (2).
    expect(aimedOffset).toBeGreaterThan(lead.spread * 0.3);
    expect(aimedOffset).toBeLessThan(lead.spread * 0.7);
    expect(hipOffset).toBeGreaterThan(aimedOffset * 1.8);
    expect(hipOffset).toBeLessThan(aimedOffset * 2.2);
  }, 60000);

  it("automatic hold-fire still sustains while aiming", async () => {
    const e = await makeEngine(TOWN, MG_SQUAD);
    parkEnemies(e);
    const lead = e.leaderUnit()!;
    lead.x = 600; lead.y = 675;
    lead.suppression = 0;
    lead.cooldown = 0;
    e.aiming = true; // right button held with the left
    e.leaderShootAt(900, 675);
    e.mouseHeld = true;
    e.mouse = { x: 900, y: 675, inside: true };
    const shots = countShots(e, lead, 0.5);
    expect(shots).toBeGreaterThanOrEqual(2);
  }, 60000);

  it("the range ring renders only while aiming (source pin)", () => {
    expect(engineSrc).toMatch(/private drawAimRing\(ctx: CanvasRenderingContext2D\) \{\n    if \(!this\.aiming\) return;/);
    expect(engineSrc).toContain("this.drawAimRing(ctx);");
    expect(engineSrc).toContain("ctx.arc(snap(L.x), snap(L.y), L.range, 0, Math.PI * 2);");
  });
});
