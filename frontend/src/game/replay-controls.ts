// Play/pause for the battle replay (in-game ReplayViewer and the
// standalone viewer share the same two-state rule). One button,
// exactly two states: while the replay is playing it offers PAUSE,
// while it is paused it offers PLAY. The button is never missing in
// either state, on phone or desktop.

/** Label for the single play/pause toggle. */
export function replayPlayLabel(playing: boolean): string {
  return playing ? "❚❚ PAUSE" : "▶ PLAY";
}

/** PLAY pressed while paused at (or past) the last frame must restart
 * from frame 0. Resuming from the last frame ends the loop on the
 * first tick, so PLAY looks dead and the replay never plays again —
 * that was the bug: the replay finished, the button said PLAY, and
 * tapping it did nothing. */
export function replayPlayRestarts(frameIdx: number, frameCount: number): boolean {
  return frameIdx >= frameCount - 1;
}
