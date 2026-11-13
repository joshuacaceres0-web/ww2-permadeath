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
import { CLASS_ITEM_IDS, GUN_DEFS, ITEM_DEFS } from "../data";

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

  it("guns are found only, carry stat lines, and never fit the AT man", () => {
    const src = read("../../pages/Barracks.tsx");
    expect(src).toContain("found-only-");
    expect(src).toContain("gun-stats-");
    expect(src).toContain("Guns are loot only");
    const sprites = read("../sprites.ts");
    for (const w of ["carbine", "trench", "bar", "fg42"]) expect(sprites).toContain(`case "${w}"`);
    // The AT man keeps his bazooka split: no gun fits him.
    for (const d of ITEM_DEFS.filter((x) => x.kind === "gun")) {
      expect(d.restrict).not.toContain("at");
      expect(GUN_DEFS[d.id]).toBeDefined();
    }
    expect(Object.keys(GUN_DEFS)).toHaveLength(7);
  });

  it("class items: two per class, locked to it, locks shown plainly", () => {
    const src = read("../../pages/Barracks.tsx");
    expect(src).toContain("CLASS_ITEM_IDS");
    expect(src).toContain("class-lock-");
    expect(src).toContain("CLASS`");
    const classItems = ITEM_DEFS.filter((d) => CLASS_ITEM_IDS.has(d.id));
    expect(classItems).toHaveLength(16);
    const perClass = new Map<string, number>();
    for (const d of classItems) {
      expect(d.restrict).toHaveLength(1);
      expect(d.price).toBe(75);
      perClass.set(d.restrict![0], (perClass.get(d.restrict![0]) ?? 0) + 1);
    }
    expect([...perClass.values()].sort()).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
    expect([...perClass.keys()].sort()).toEqual(["at", "engineer", "medic", "mg", "radioman", "recon", "rifleman", "sniper"]);
  });

  it("the portrait draws earned headgear, garrison cap included", () => {
    const src = read("../../components/Portrait.tsx");
    expect(src).toContain("gearHead");
    expect(src).toContain("garrisoncap");
    expect(src).toContain("nethelmet");
  });
});
