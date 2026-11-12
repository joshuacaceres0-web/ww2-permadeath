// Play/pause toggle for the battle replay: one button, exactly two
// states. The bug was PLAY at the last frame doing nothing — the loop
// ended again on the first tick, so the replay finished, the button
// said PLAY, and tapping it never played again.
import { describe, expect, it } from "vitest";
import { replayPlayLabel, replayPlayRestarts } from "../replay-controls";

describe("replay play/pause", () => {
  it("shows PAUSE while playing and PLAY while paused, in both states", () => {
    expect(replayPlayLabel(true)).toBe("❚❚ PAUSE");
    expect(replayPlayLabel(false)).toBe("▶ PLAY");
  });

  it("PLAY at the last frame restarts from frame 0", () => {
    expect(replayPlayRestarts(99, 100)).toBe(true);
    expect(replayPlayRestarts(100, 100)).toBe(true);
    expect(replayPlayRestarts(0, 1)).toBe(true);
  });

  it("PLAY mid-replay resumes from here, it does not restart", () => {
    expect(replayPlayRestarts(0, 100)).toBe(false);
    expect(replayPlayRestarts(50, 100)).toBe(false);
    expect(replayPlayRestarts(98, 100)).toBe(false);
  });
});
