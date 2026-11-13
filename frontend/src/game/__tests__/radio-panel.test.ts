// @vitest-environment node
/**
 * Radio panel on the battle screen (Josh, 2026-11-13): the
 * RADIO button was on the field but useless in play. Two
 * separate breaks: in the corner cluster the dropdown opened
 * DOWN from a button hugging the bottom edge, so the whole
 * calls list rendered off the bottom of the screen (it only
 * ever showed inside the Esc menu, whose copy opens into a
 * centered modal); and on the phone the top-left radio button
 * sat inside the touch overlay's pointer-events-none root
 * with no pointer-events-auto of its own, so taps passed
 * straight through it. The list also ran long on short
 * screens with no way to scroll it.
 *
 * UI-chrome strings in components with no DOM test harness in
 * this repo, so the guard pins the source, like panel-style.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const radio = read("../../components/game/ReinforceMenu.tsx");
const touch = read("../../components/game/TouchControls.tsx");
const field = read("../../pages/Battlefield.tsx");

describe("radio panel fixes", () => {
  it("the corner cluster menu opens up into the screen, the touch menu hangs from the left edge", () => {
    expect(radio).toContain("bottom-full");
    expect(field).toContain('placement="up"');
    expect(field).toContain('align="left"');
  });

  it("the phone radio button can actually be tapped", () => {
    // The slot wrapper re-enables pointer events inside the
    // pointer-events-none touch overlay.
    expect(touch).toContain('<div className="pointer-events-auto">{radioSlot}</div>');
  });

  it("the calls list scrolls inside a capped panel", () => {
    expect(radio).toContain('data-testid="reinforce-menu-scroll"');
    expect(radio).toContain("overflow-y-auto");
    expect(radio).toContain("overscroll-contain");
    expect(radio).toContain("max-h-[min(72vh,30rem)]");
  });

  it("rally is a panel call wired to the engine", () => {
    expect(radio).toContain('data-testid="radio-rally"');
    expect(radio).toContain("RALLY CALL");
    expect(field).toContain("callRally()");
    // Locked calls stay visible with their unlock level,
    // rally included — nothing is hidden from the list.
    expect(radio).toContain("LVL ${RADIO_CALL_LEVEL.rally}");
    expect(radio).toContain("locked ? `LVL ${r.level}`");
  });
});
