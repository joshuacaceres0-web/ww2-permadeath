// @vitest-environment node
// Prone crawl animation (Josh, 2026-11-12): a crawling prone man
// gets moving limbs. proneA and proneB are the two crawl frames —
// legs scissored opposite ways, the reaching hand in a different
// spot — and both differ from the still "prone" pose. Verified at
// the pixel level: the sprite painter records every pixel it lays
// down, and the frames' pixel sets must differ in the leg rows.
import { describe, expect, it } from "vitest";

type Rect = { x: number; y: number; c: string };
type FakeCanvas = {
  width: number; height: number; rects: Rect[];
  getContext: () => unknown; toDataURL: () => string;
  getBoundingClientRect: () => { width: number; height: number; left: number; top: number };
  addEventListener: () => void; removeEventListener: () => void; style: Record<string, string>;
};

function stubBrowser() {
  const makeCanvas = (): FakeCanvas => {
    const rects: Rect[] = [];
    const ctx = {
      fillStyle: "",
      fillRect(x: number, y: number) {
        rects.push({ x, y, c: (this as { fillStyle: string }).fillStyle });
      },
      getImageData: () => ({ data: new Uint8ClampedArray(16 * 14 * 4) }),
      putImageData: () => {},
      measureText: () => ({ width: 0 }),
    };
    return {
      width: 0, height: 0, rects,
      getContext: () => ctx,
      toDataURL: () => "",
      getBoundingClientRect: () => ({ width: 1600, height: 900, left: 0, top: 0 }),
      addEventListener: () => {}, removeEventListener: () => {}, style: {},
    };
  };
  (globalThis as unknown as Record<string, unknown>).document = {
    createElement: (tag: string) => (tag === "canvas" ? makeCanvas() : {}),
    fonts: { load: () => Promise.resolve([]) },
  };
  (globalThis as unknown as Record<string, unknown>).window = globalThis;
  (globalThis as unknown as Record<string, unknown>).HTMLCanvasElement = function () {};
}

stubBrowser();

describe("prone crawl frames", () => {
  it("proneA and proneB move the limbs: leg and hand pixels differ from the still pose", async () => {
    const { sprite, PAL } = await import("../sprites");
    const pixels = (pose: "prone" | "proneA" | "proneB") => {
      const c = sprite("us", pose, "rifle", "us", false) as unknown as FakeCanvas;
      return new Set(c.rects.map((r) => `${r.x},${r.y},${r.c}`));
    };
    const still = pixels("prone");
    const a = pixels("proneA");
    const b = pixels("proneB");
    const boots = PAL.us.boots;
    const bootAt = (set: Set<string>, x: number, y: number) => set.has(`${x},${y},${boots}`);
    // Still pose: both boots flat at rows 10-11, none raised.
    expect(bootAt(still, 0, 10)).toBe(true);
    expect(bootAt(still, 0, 9)).toBe(false);
    // Frame A raises the rear boot (row 9) — the pushing leg.
    expect(bootAt(a, 0, 9)).toBe(true);
    expect(bootAt(a, 4, 9)).toBe(false);
    // Frame B raises the front boot instead — the legs scissor.
    expect(bootAt(b, 4, 9)).toBe(true);
    expect(bootAt(b, 0, 9)).toBe(false);
    // The reaching hand (skin-dark) trades places between frames.
    const handA = [...a].some((p) => p.startsWith("11,11,#93664A"));
    const handB = [...b].some((p) => p.startsWith("9,11,#93664A"));
    expect(handA).toBe(true);
    expect(handB).toBe(true);
    // And the frames are genuinely different pictures.
    expect(a).not.toEqual(still);
    expect(b).not.toEqual(still);
    expect(a).not.toEqual(b);
  });
});
