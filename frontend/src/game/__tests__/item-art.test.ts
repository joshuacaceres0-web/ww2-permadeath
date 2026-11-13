// @vitest-environment node
/**
 * Item models (Josh, 2026-11-13): every item in the stores
 * has one drawn 16-bit model, the same shape in the Barracks
 * grid, the dossier, the debrief, and (worn) on the troop.
 * These tests hold the atlas honest:
 *  - every ITEM_DEFS id has a model, and there are no orphans;
 *  - every model is a full 12x10 map over the shared legend,
 *    with enough filled pixels and colours to read at card
 *    size — no invisible gear;
 *  - the gun silhouettes read apart: the long guns reach the
 *    frame's edge, the carbine stops short, the Thompson's
 *    drum is a solid block under the barrel, the MP40's stick
 *    magazine hangs below it;
 *  - the three medic whites (dressing, aid bag, surgical kit)
 *    are three different drawings, not one shape renamed.
 */
import { describe, expect, it } from "vitest";
import { ART_H, ART_W, ITEM_ART, ITEM_ART_LEGEND } from "../itemArt";
import { ITEM_DEFS } from "../data";

const filled = (rows: string[]) => {
  const cells: Array<[number, number, string]> = [];
  rows.forEach((row, y) => row.split("").forEach((ch, x) => { if (ch !== ".") cells.push([x, y, ch]); }));
  return cells;
};
const colorsOf = (rows: string[]) => new Set(filled(rows).map(([, , ch]) => ITEM_ART_LEGEND[ch]));

describe("item models", () => {
  it("every store item has a model, and every model has an item", () => {
    expect(Object.keys(ITEM_ART).sort()).toEqual(ITEM_DEFS.map((d) => d.id).sort());
  });

  it("every model is a complete, readable map", () => {
    for (const [id, rows] of Object.entries(ITEM_ART)) {
      expect(rows, id).toHaveLength(ART_H);
      for (const row of rows) {
        expect(row, id).toHaveLength(ART_W);
        for (const ch of row) expect(ch === "." || ch in ITEM_ART_LEGEND, `${id}:${ch}`).toBe(true);
      }
      expect(filled(rows).length, id).toBeGreaterThanOrEqual(10);
      expect(colorsOf(rows).size, id).toBeGreaterThanOrEqual(3);
    }
  });

  it("the gun silhouettes read apart", () => {
    const maxX = (id: string) => Math.max(...filled(ITEM_ART[id]).map(([x]) => x));
    expect(maxX("bar")).toBe(11);
    expect(maxX("springfield")).toBe(11);
    expect(maxX("carbine")).toBeLessThanOrEqual(10);
    // The Thompson's drum: a solid block under the barrel.
    const drum = filled(ITEM_ART.thompson).filter(([x, y]) => y >= 5 && y <= 8 && x >= 3 && x <= 6);
    expect(drum.length).toBeGreaterThanOrEqual(8);
    // The MP40's stick magazine hangs below the receiver.
    const mag = filled(ITEM_ART.mp40).filter(([x, y]) => y >= 5 && (x === 4 || x === 5));
    expect(mag.length).toBeGreaterThanOrEqual(6);
    // No two guns share a drawing.
    const guns = ["thompson", "mp40", "carbine", "springfield", "trench97", "bar", "fg42"];
    const seen = new Set(guns.map((id) => ITEM_ART[id].join("/")));
    expect(seen.size).toBe(guns.length);
  });

  it("the medic whites and the headgear are each their own drawing", () => {
    const whites = ["dressing", "aidbag", "surgical"].map((id) => ITEM_ART[id].join("/"));
    expect(new Set(whites).size).toBe(3);
    const heads = ["nethelmet", "parahelmet", "jeepcap", "pilecap", "hbtcap", "garrisoncap"].map((id) => ITEM_ART[id].join("/"));
    expect(new Set(heads).size).toBe(6);
    // Signature colours land where they should.
    expect(colorsOf(ITEM_ART.flares)).toContain(ITEM_ART_LEGEND.F);
    expect(colorsOf(ITEM_ART.codebook)).toContain(ITEM_ART_LEGEND.r);
    expect(colorsOf(ITEM_ART.codebook)).toContain(ITEM_ART_LEGEND.P);
    expect(colorsOf(ITEM_ART.ghillie).size).toBeGreaterThanOrEqual(4);
  });
});
