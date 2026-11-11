// Background music: one shared HTMLAudio element, looped, for menu screens only.
// Tracks (all original, loopable WAVs in /public/music/):
//   menu / memorial -> letters-home.wav (slow, somber, 70 BPM)
//   war-room        -> battle-drums.wav (Battlefield 1942 feel, original, 136 BPM)
//   barracks        -> swing-in-the-barracks.wav v2 (darker swing, 110 BPM)
//   march-to-normandy.wav is intentionally unused for now.
// No music in battle, How to Play, or Settings (except the existing Test Sound).
// Autoplay rules: browsers block play() with no user gesture, so a play that is
// refused is retried on the next pointerdown / keydown. Switching tracks is
// clean: one element, one src at a time, no overlap, no double playback, and
// the hook below only re-runs when the track changes, never on re-render.
import { useEffect } from "react";
import { loadSettings } from "@/lib/settings";

export type MusicTrack = "menu" | "war-room" | "barracks" | "memorial";

const TRACK_SRC: Record<MusicTrack, string> = {
  menu: "/music/letters-home.wav",
  memorial: "/music/letters-home.wav",
  "war-room": "/music/battle-drums.wav",
  barracks: "/music/swing-in-the-barracks.wav",
};

let audio: HTMLAudioElement | null = null;
let current: MusicTrack | null = null;
let pending: MusicTrack | null = null;
let unlockArmed = false;

function syncVolume() {
  if (!audio) return;
  const s = loadSettings();
  audio.volume = s.muted || !s.musicEnabled ? 0 : Math.max(0, Math.min(1, s.musicVolume / 100));
  audio.muted = s.muted || !s.musicEnabled;
}

export function setMusicVolume(v: number) {
  syncVolume();
}
export function setMusicMuted(m: boolean) {
  if (!m && audio && current && audio.paused) void tryPlay();
  syncVolume();
}
export function setMusicEnabled(on: boolean) {
  if (!audio) return;
  if (!on) audio.pause();
  else if (current) void tryPlay();
  syncVolume();
}

/** The track a screen wants, for tests / debugging. */
export function currentMusicTrack(): MusicTrack | null {
  return current;
}
export function currentMusicSrc(): string | null {
  return current ? TRACK_SRC[current] : null;
}

function armUnlock() {
  if (unlockArmed || typeof window === "undefined") return;
  unlockArmed = true;
  const onGesture = () => {
    if (pending && audio) void tryPlay();
  };
  window.addEventListener("pointerdown", onGesture);
  window.addEventListener("keydown", onGesture);
}

async function tryPlay() {
  if (!audio || !current) return;
  syncVolume();
  try {
    await audio.play();
    pending = null;
  } catch {
    // Autoplay blocked: retry on the next user gesture.
    pending = current;
    armUnlock();
  }
}

export function playMusic(track: MusicTrack) {
  if (typeof window === "undefined") return;
  const s = loadSettings();
  if (!s.musicEnabled || s.muted) {
    // Remember the request so un-muting / re-enabling can start it.
    pending = track;
    if (audio) audio.pause();
    current = track;
    return;
  }
  if (!audio) {
    audio = new Audio();
    audio.loop = true;
    audio.preload = "auto";
  }
  if (current === track && !audio.paused && audio.src.endsWith(TRACK_SRC[track])) {
    syncVolume();
    return; // already playing this track: do not restart it
  }
  current = track;
  pending = track;
  audio.src = TRACK_SRC[track];
  audio.load();
  void tryPlay();
}

export function stopMusic() {
  pending = null;
  current = null;
  if (audio) audio.pause();
}

/** Mount on a music screen: plays `track`, stops it on unmount. No-op re-renders. */
export function useMusic(track: MusicTrack | null) {
  useEffect(() => {
    if (track) playMusic(track);
    else stopMusic();
    return () => stopMusic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);
}
