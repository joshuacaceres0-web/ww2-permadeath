// @vitest-environment node
/**
 * Barracks update UI pins (Josh, 2026-11-13): the stores panel,
 * the dossier's upgrades and equipment sections, the debrief's
 * earned ledger, the crate item riding the battle report home,
 * and the gear drawn on the man (sprite heads and guns, the
 * portrait's earned headgear). Source pins in the pattern of
 * radio-panel.test.ts — the behaviour itself is covered by
 * barracks-gear.test.ts and the backend suite.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("barracks update UI", () => {
  it("the Barracks has the stores panel with buy buttons and the loss rule", () => {
    const src = read("../../pages/Barracks.tsx");
    expect(src).toContain('data-testid="stores-panel"');
    expect(src).toContain("SQUAD STORES");
    expect(src).toContain("buy-btn-");
    expect(src).toContain("lost with him if he falls");
  });

  it("the dossier carries upgrades with train buttons and equip controls", () => {
    const src = read("../../pages/Barracks.tsx");
    expect(src).toContain('data-testid="dossier-upgrades"');
    expect(src).toContain('data-testid="dossier-points"');
    expect(src).toContain("upgrade-btn-");
    expect(src).toContain('data-testid="dossier-equipment"');
    expect(src).toContain("equip-btn-");
    expect(src).toContain("unequip-btn-");
    expect(src).toContain("Upgrades die with the man");
  });

  it("the debrief shows the earned ledger and the report carries the crate item", () => {
    const src = read("../../pages/Battlefield.tsx");
    expect(src).toContain('data-testid="debrief-earned"');
    expect(src).toContain("upgrade pts");
    expect(src).toContain('data-testid="debrief-gear-lost"');
    expect(src).toContain("loot_item: r.lootItem");
  });

  it("the sprite painter knows the earned heads and the carried guns", () => {
    const src = read("../sprites.ts");
    for (const head of ["us-net", "us-para", "us-jeep", "us-pile", "us-hbt"]) expect(src).toContain(head);
    for (const gun of ["thompson", "springfield", "mp40"]) expect(src).toContain(`case "${gun}"`);
  });

  it("the portrait draws earned headgear, garrison cap included", () => {
    const src = read("../../components/Portrait.tsx");
    expect(src).toContain("gearHead");
    expect(src).toContain("garrisoncap");
    expect(src).toContain("nethelmet");
  });
});
