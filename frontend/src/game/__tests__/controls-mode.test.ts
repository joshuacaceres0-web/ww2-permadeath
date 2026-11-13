// @vitest-environment node
/**
 * The Settings CONTROLS pick (Josh, 2026-11-13): on itch the
 * touch layer and the desktop cluster rendered on top of each
 * other. Now the player selects what they are on — phone forces
 * touch, computer forces desktop, auto keeps the screen guess —
 * and the battle shows exactly one control set. The fullscreen
 * takeover button rides along: one button, both control sets.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

import { DEFAULT_SETTINGS, loadSettings, resolveTouchControls } from "../../lib/settings";

const settingsSrc = readFileSync(new URL("../../pages/Settings.tsx", import.meta.url), "utf8");
const battleSrc = readFileSync(new URL("../../pages/Battlefield.tsx", import.meta.url), "utf8");
const dockSrc = readFileSync(new URL("../../components/game/SquadDock.tsx", import.meta.url), "utf8");
const touchSrc = readFileSync(new URL("../../components/game/TouchControls.tsx", import.meta.url), "utf8");
const radioSrc = readFileSync(new URL("../../components/game/ReinforceMenu.tsx", import.meta.url), "utf8");
const layoutSrc = readFileSync(new URL("../../components/Layout.tsx", import.meta.url), "utf8");

describe("resolveTouchControls — the player's pick wins", () => {
  it("phone forces touch even on a wide fine-pointer screen", () => {
    expect(resolveTouchControls("phone", false, false)).toBe(true);
  });
  it("computer forces desktop even on a coarse narrow phone screen", () => {
    expect(resolveTouchControls("computer", true, true)).toBe(false);
  });
  it("auto keeps the old heuristic: coarse pointer or narrow screen", () => {
    expect(resolveTouchControls("auto", true, false)).toBe(true);
    expect(resolveTouchControls("auto", false, true)).toBe(true);
    expect(resolveTouchControls("auto", false, false)).toBe(false);
  });
});

describe("the controls setting itself", () => {
  it("defaults to auto and survives a round trip", () => {
    store.clear();
    expect(DEFAULT_SETTINGS.controls).toBe("auto");
    expect(loadSettings().controls).toBe("auto");
    store.set("vanguard-settings", JSON.stringify({ controls: "phone" }));
    expect(loadSettings().controls).toBe("phone");
    store.set("vanguard-settings", JSON.stringify({ controls: "computer" }));
    expect(loadSettings().controls).toBe("computer");
  });
  it("a garbage stored value falls back to auto, never breaks the load", () => {
    store.set("vanguard-settings", JSON.stringify({ controls: "banana" }));
    expect(loadSettings().controls).toBe("auto");
  });
  it("Settings offers the three picks with the shared Choice testids", () => {
    expect(settingsSrc).toContain('name="controls"');
    expect(settingsSrc).toContain('"PHONE"');
    expect(settingsSrc).toContain('"COMPUTER"');
    expect(settingsSrc).toContain("never mix on one screen");
  });
});

describe("the battle wiring", () => {
  it("the touch decision runs through the resolver and the saved pick", () => {
    expect(battleSrc).toContain("resolveTouchControls(loadSettings().controls");
  });
  it("the desktop cluster never renders while touch controls are up", () => {
    expect(battleSrc).toContain('{!touch && !fullMap && !hud?.briefing && hud?.state === "active" && (');
    expect(battleSrc).toContain('data-testid="battle-controls"');
    expect(battleSrc).toContain("<TouchControls");
  });
  it("one fullscreen takeover button serves both control sets", () => {
    expect(battleSrc).toContain('data-testid="fullscreen-btn"');
    expect(battleSrc).toContain("toggleFullscreen");
    expect(battleSrc).toContain("EXIT FULLSCREEN");
    expect(battleSrc).toContain("requestFullscreen");
  });
  it("the briefing teaches the controls the player actually has", () => {
    expect(battleSrc).toContain("the left stick moves him, the FIRE ring shoots");
    expect(battleSrc).toContain("WASD moves him, left click shoots");
  });
  it("on touch the squad dock is the compact chip strip, never the right column", () => {
    expect(battleSrc).toContain('variant={touch ? "compact" : "full"}');
    // The page root must not flip to a row on sideways phones
    // either, or the strip lands on the right and squeezes
    // the canvas (the first package test shot showed both).
    expect(battleSrc).toContain('touch ? "flex min-h-0 flex-1 flex-col" : "flex min-h-0 flex-1 flex-col short:flex-row"');
    expect(dockSrc).toContain('variant?: "full" | "compact"');
    expect(dockSrc).toContain('data-testid="squad-dock"');
    // The chips keep the card testids and the tap-to-select.
    expect(dockSrc).toContain("unit-dock-card-");
    expect(dockSrc).toContain("unit-dock-morale-");
  });
});

describe("phone ghost controls and scrollable overlays (Josh, 2026-11-13)", () => {
  it("the sticks and the ability button are see-through at rest and firm up under a thumb", () => {
    expect(touchSrc).toContain("bg-[#0D0F0C]/20");
    expect(touchSrc).toContain('knob ? "bg-[#0D0F0C]/70" : "bg-[#0D0F0C]/40"');
    expect(touchSrc).toContain("border-[#E5A93C]/60 bg-[#3A2B0E]/40");
    // No solid stick base or knob may come back.
    expect(touchSrc).not.toContain("bg-[#0D0F0C]/50");
    expect(touchSrc).not.toContain("bg-[#0D0F0C]/85");
  });
  it("the debrief and battle-menu panels scroll inside their overlays", () => {
    expect(battleSrc).toContain("max-h-full max-w-lg overflow-y-auto overscroll-contain");
    expect(battleSrc).toContain("max-h-full w-full max-w-sm overflow-y-auto overscroll-contain");
  });
});

describe("phone UI pass: no duplicates, ghosted bottom edge (Josh, 2026-11-13)", () => {
  it("the picked touch order ghosts instead of the solid desktop active block", () => {
    expect(touchSrc).toContain("TOUCH_BTN_ACTIVE");
    expect(touchSrc).toContain("bg-[#3A2B0E]/60");
    expect(touchSrc).not.toContain("PANEL_BTN_ACTIVE");
  });
  it("the phone dock strip and its chips are see-through; the desktop dock bar stays solid", () => {
    expect(dockSrc).toContain('u.alive ? "bg-[#0D0F0C]/55"');
    expect(battleSrc).toContain('touch\n            ? "border-t border-[#2E3628] bg-[#0D0F0C]/60"');
    expect(battleSrc).toContain('"border-t border-[#2E3628] bg-[#0D0F0C] short:w-40');
  });
  it("the touch radio button drops the word the status strip already shows, and its header drops the RP the strip already shows", () => {
    expect(radioSrc).toContain("touch?: boolean");
    expect(radioSrc).toContain("{!touch && <span");
    expect(radioSrc).toContain('`Radio support · LVL ${commanderLevel}`');
    expect(radioSrc).toContain("· ${rp} RP · ${left} calls left`");
    // Only the instance in the touch row gets the slim treatment.
    expect(battleSrc).toContain('align="left"\n                touch');
  });
  it("toasts leave the bottom right corner on touch and keep it on desktop", () => {
    expect(layoutSrc).toContain('position={touch ? "top-center" : "bottom-right"}');
    expect(layoutSrc).toContain("resolveTouchControls");
  });
  it("every in-battle scroll surface contains its own scroll", () => {
    // Briefing body (the radio list and the two overlay panels
    // were pinned in the block above / in ReinforceMenu).
    expect(battleSrc).toContain("overflow-y-auto overscroll-contain p-4 sm:p-6 short:p-3");
    expect(radioSrc).toContain('data-testid="reinforce-menu-scroll"');
    expect(radioSrc).toContain("overflow-y-auto overscroll-contain");
  });
});
