// @vitest-environment node
/**
 * The battle takes the full screen (Josh, main chat
 * 2026-11-13): the top app header — the bar titled
 * VANGUARD '44 / PERMAFROST — is not rendered on the battle
 * route, and the battle view uses the full viewport height,
 * so the map gains the freed space. Every other page keeps
 * the header exactly as it was. Source pins, in the style of
 * controls-mode.test.ts: this UI chrome has no DOM harness.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layoutSrc = readFileSync(new URL("../../components/Layout.tsx", import.meta.url), "utf8");
const battleSrc = readFileSync(new URL("../../pages/Battlefield.tsx", import.meta.url), "utf8");

describe("battle fullscreen: no app header on /game", () => {
  it("the header renders only when not in game", () => {
    const guard = layoutSrc.indexOf("{!inGame && (");
    const header = layoutSrc.indexOf("<header");
    const brand = layoutSrc.indexOf('data-testid="brand-link"');
    const main = layoutSrc.indexOf("<main");
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(header).toBeGreaterThan(guard);
    expect(brand).toBeGreaterThan(guard);
    expect(brand).toBeLessThan(main);
    // The old half-measure — hide the header on /game only in
    // short viewports — is gone; it never renders there now.
    expect(layoutSrc).not.toContain('inGame && "short:hidden"');
  });

  it("the header still exists for the other pages: brand, nav, chips, DEPLOY", () => {
    expect(layoutSrc).toContain("VANGUARD '44");
    expect(layoutSrc).toContain("Permafrost · The Sacrifice Division");
    // The nav testids live in the NAV array, rendered via
    // data-testid={n.testid} on both the header nav and the
    // mobile nav.
    expect(layoutSrc).toContain('testid: "nav-link-war-room"');
    expect(layoutSrc).toContain('testid: "nav-link-barracks"');
    expect(layoutSrc).toContain('testid: "nav-link-memorial"');
    expect(layoutSrc).toContain('data-testid="commander-chip"');
    expect(layoutSrc).toContain('data-testid="requisition-chip"');
    expect(layoutSrc).toContain('data-testid="quick-deploy-btn"');
  });

  it("on the battle route the column, the main region and the battle root claim the full height", () => {
    // The page column is a full-viewport flex column…
    expect(layoutSrc).toContain("flex min-h-svh flex-col");
    // …the /game main is the flexible remainder of it…
    expect(layoutSrc).toContain('? "flex min-h-0 flex-1 flex-col"');
    // …and the battle root fills that remainder.
    expect(battleSrc).toContain('className="flex min-h-0 flex-1 flex-col short:h-svh"');
  });
});
