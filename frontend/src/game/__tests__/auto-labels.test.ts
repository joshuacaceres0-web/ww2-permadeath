// @vitest-environment node
/**
 * AUTO labels (Josh, 2026-11-12): any troop the player is not
 * directly controlling is labelled AUTO in the battle squad list.
 * The follower ability line reads "<ability> — AUTO" (it used to
 * say ON HIS OWN); the team leader keeps his LEADER chip and his
 * clickable ability instead; and the retreat banner reads
 * RETREATING — AUTO while the squad is out of the player's hands.
 * Label only: no AUTO mode or toggle comes back with this.
 *
 * These are UI strings in components with no DOM test harness in
 * this repo, so the guard pins the exact source strings.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dock = readFileSync(new URL("../../components/game/SquadDock.tsx", import.meta.url), "utf8");
const field = readFileSync(new URL("../../pages/Battlefield.tsx", import.meta.url), "utf8");

describe("AUTO labels", () => {
  it("follower cards read AUTO, and ON HIS OWN is gone from battle UI", () => {
    expect(dock).toContain("— AUTO");
    expect(dock).not.toContain("ON HIS OWN");
    expect(field).not.toContain("ON HIS OWN");
  });

  it("the leader keeps his LEADER chip, not an AUTO label", () => {
    expect(dock).toContain("★ LEADER");
    expect(dock).toContain("isLeader");
  });

  it("the retreat banner reads AUTO while the squad runs itself", () => {
    expect(field).toContain("RETREATING — AUTO");
  });
});
