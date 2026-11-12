// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mergeObstacles } from "../ReplayViewer";
import * as fs from "node:fs";

describe("replay obstacle merge", () => {
  it("merges overlapping same-kind obstacles into single shapes", () => {
    const replay = JSON.parse(fs.readFileSync("/home/hatch/workspace/ww2-auto-replay.json", "utf-8")) as {
      obstacles: Array<{ x: number; y: number; r: number; kind: string }>;
    };
    const merged = mergeObstacles(replay.obstacles as never);
    console.log(`obstacles ${replay.obstacles.length} -> clusters ${merged.length}`);
    expect(merged.length).toBeLessThan(replay.obstacles.length);
    // Nothing is dropped: every obstacle lands in exactly one cluster.
    expect(merged.reduce((t, m) => t + m.count, 0)).toBe(replay.obstacles.length);
    // Ruin walls collapse into a handful of clusters, not 136 squares.
    expect(merged.filter((m) => m.kind === "ruin").length).toBeLessThan(30);
  });
});
