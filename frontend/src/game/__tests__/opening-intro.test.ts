// @vitest-environment node
/**
 * Opening intro (2026-11-13): a short title sequence before the
 * start menu — the theatre, the four operations from Normandy
 * to the Hurtgen, the Sacrifice Division and the permadeath
 * creed, then the title card. It must always be skippable, it
 * plays once per session, and the menu behind it stays exactly
 * as it was.
 *
 * UI-chrome strings in components with no DOM test harness in
 * this repo, so the guard pins the source, like radio-panel.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const intro = read("../../components/OpeningIntro.tsx");
const menu = read("../../pages/StartMenu.tsx");

describe("opening intro", () => {
  it("walks the whole campaign road, Normandy to the Hurtgen", () => {
    expect(intro).toContain("OPERATION OVERLORD");
    expect(intro).toContain("Normandy, France · 6 June 1944");
    expect(intro).toContain("OPERATION SILENT CHATEAU");
    expect(intro).toContain("OPERATION IRON CROSSROADS");
    expect(intro).toContain("OPERATION PERMAFROST FLAK");
    expect(intro).toContain("Hürtgen Forest");
  });

  it("names the division and the permadeath creed, then the title", () => {
    expect(intro).toContain("THE SACRIFICE DIVISION");
    expect(intro).toContain("Your men do not respawn.");
    expect(intro).toContain("Memorial wall");
    expect(intro).toContain("VANGUARD");
    expect(intro).toContain("opening-intro");
  });

  it("is always escapable: a skip button, Escape, and click to advance", () => {
    expect(intro).toContain('data-testid="intro-skip"');
    expect(intro).toContain('"Escape"');
    expect(intro).toContain("onClick={advance}");
    // The skip ends the show through the same finish path.
    expect(intro).toContain("onDone");
  });

  it("plays over the menu's own dusk scene for a seamless handoff", () => {
    expect(intro).toContain("StartScene");
  });

  it("the menu mounts it once per session and its own layout is unchanged", () => {
    expect(menu).toContain("<OpeningIntro onDone={finishIntro} />");
    expect(menu).toContain('sessionStorage.getItem("v44:intro-seen")');
    expect(menu).toContain('data-testid="start-menu"');
    expect(menu).toContain('data-testid="menu-continue"');
    expect(menu).toContain('data-testid="menu-new-game"');
    expect(menu).toContain('data-testid="start-title"');
  });
});
