// @vitest-environment node
/**
 * In-battle panel language (Josh, 2026-11-12): everything that
 * floats on the battlefield shares ONE panel style — the shared
 * constants in components/game/panel.ts — with ONE selected
 * state (amber). Before this, the battle UI mixed three panel
 * backgrounds and two selected styles (orders amber-filled,
 * formations teal text with no fill, the picked card teal).
 *
 * UI-chrome strings in components with no DOM test harness in
 * this repo, so the guard pins the source, like auto-labels.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const panel = read("../../components/game/panel.ts");
const field = read("../../pages/Battlefield.tsx");
const dock = read("../../components/game/SquadDock.tsx");
const radio = read("../../components/game/ReinforceMenu.tsx");
const touch = read("../../components/game/TouchControls.tsx");

describe("in-battle panel language", () => {
  it("the shared panel module defines the whole language", () => {
    for (const name of ["PANEL", "PANEL_SOLID", "PANEL_REST", "PANEL_LABEL", "PANEL_BTN", "PANEL_BTN_ACTIVE"]) {
      expect(panel).toContain(`export const ${name}`);
    }
  });

  it("orders and formations share the one amber selected state", () => {
    // Both the order buttons and the formation buttons in the
    // corner cluster resolve their active class from the constant.
    const uses = field.split("PANEL_BTN_ACTIVE").length - 1;
    expect(uses).toBeGreaterThanOrEqual(2);
    // The touch orders resolve theirs from the ghost variant:
    // same amber family (border, fill hue, text), translucent
    // fill — Josh's 2026-11-13 phone-transparency ask
    // supersedes the shared solid constant on touch only.
    expect(touch).toContain("TOUCH_BTN_ACTIVE");
    expect(touch).toContain("bg-[#3A2B0E]/60");
    expect(touch).not.toContain("PANEL_BTN_ACTIVE");
    // The old teal-text-only formation selection is gone.
    expect(field).not.toContain('? "border-[#4ECDC4] text-[#4ECDC4]"');
  });

  it("the corner cluster, Esc menu and radio dropdown use the shared panels", () => {
    expect(field).toContain("PANEL_SOLID"); // Esc menu
    expect(field).toContain("PANEL_REST"); // cluster quiets at rest
    expect(radio).toContain("PANEL_SOLID"); // radio dropdown
    expect(radio).toContain("PANEL_BTN"); // radio trigger chrome
  });

  it("the picked squad card uses the same amber, not the old teal", () => {
    expect(dock).toContain('selected ? "border-[#E5A93C]"');
    expect(dock).not.toContain('selected ? "border-[#4ECDC4]"');
    // Cards left the old solid background for the panel tone.
    expect(dock).not.toContain("bg-[#1A1D17]");
    expect(radio).not.toContain("bg-[#1A1D17]");
    expect(touch).not.toContain("bg-[#1A1D17]");
  });
});
