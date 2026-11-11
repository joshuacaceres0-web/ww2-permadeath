// @vitest-environment node
// Headless music test: stub Audio / window / localStorage, then import the
// real music module and assert track mapping, clean switching, stop on
// battle, and Mute All silencing.
import { describe, expect, it, vi } from "vitest";

const instances: Array<Record<string, unknown>> = [];
class FakeAudio {
  src = "";
  loop = false;
  preload = "";
  volume = 1;
  muted = false;
  paused = true;
  playCalls = 0;
  pauseCalls = 0;
  constructor() {
    instances.push(this as unknown as Record<string, unknown>);
  }
  load() {}
  async play() {
    this.playCalls++;
    this.paused = false;
  }
  pause() {
    this.pauseCalls++;
    this.paused = true;
  }
}

const store = new Map<string, string>();
(globalThis as unknown as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
(globalThis as unknown as Record<string, unknown>).window = globalThis;
(globalThis as unknown as Record<string, unknown>).Audio = FakeAudio;
(globalThis as unknown as Record<string, unknown>).addEventListener = () => {};
// music.ts uses window.addEventListener only via armUnlock; stub it on globalThis too.
(globalThis as unknown as Record<string, unknown>).addEventListener = () => {};

function setSettings(s: Record<string, unknown>) {
  store.set("vanguard-settings", JSON.stringify(s));
}
const base = { speed: 1, shake: "full", volume: 60, muted: false, musicVolume: 50, musicEnabled: true };

describe("music", () => {
  it("maps screens to tracks, switches cleanly, stops on battle, respects mute", async () => {
    setSettings(base);
    const m = await import("../music");
    // Start Menu -> Letters Home
    m.playMusic("menu");
    expect(m.currentMusicSrc()).toBe("/music/letters-home.wav");
    expect(instances.length).toBe(1);
    expect(instances[0].loop).toBe(true);
    expect(instances[0].volume).toBe(0.5);
    // Same track again: no restart (no extra play call)
    const plays = (instances[0] as unknown as { playCalls: number }).playCalls;
    await m.playMusic("menu");
    expect((instances[0] as unknown as { playCalls: number }).playCalls).toBe(plays);
    // War Room switches src, still one element
    m.playMusic("war-room");
    expect(m.currentMusicSrc()).toBe("/music/battle-drums.wav");
    expect(instances.length).toBe(1);
    // Barracks, then Memorial (same file as menu)
    m.playMusic("barracks");
    expect(m.currentMusicSrc()).toBe("/music/swing-in-the-barracks.wav");
    m.playMusic("memorial");
    expect(m.currentMusicSrc()).toBe("/music/letters-home.wav");
    // Mute All silences music
    setSettings({ ...base, muted: true });
    m.setMusicMuted(true);
    expect(instances[0].muted).toBe(true);
    expect(instances[0].volume).toBe(0);
    // Un-mute restores volume
    setSettings(base);
    m.setMusicMuted(false);
    expect(instances[0].volume).toBe(0.5);
    // Music off pauses; stop (battle entry) clears the track
    m.setMusicEnabled(false);
    expect((instances[0] as unknown as { paused: boolean }).paused).toBe(true);
    m.setMusicEnabled(true);
    m.stopMusic();
    expect(m.currentMusicTrack()).toBeNull();
    expect((instances[0] as unknown as { paused: boolean }).paused).toBe(true);
    // march-to-normandy is unused: no track maps to it
    expect(Object.values(m).join("")).not.toContain("march-to-normandy");
  });
});
