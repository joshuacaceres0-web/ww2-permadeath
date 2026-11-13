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
});
