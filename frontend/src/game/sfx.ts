// Tiny 16-bit style battle sounds synthesised with WebAudio (no audio files).
// Volume comes from Settings; 0 = silent.
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
import { loadSettings } from "@/lib/settings";

const initial = loadSettings();
let volume = initial.volume / 100;
let muted = initial.muted;
const lastAt: Record<string, number> = {};

export function setSfxVolume(v: number) {
  volume = Math.max(0, Math.min(1, v / 100));
}

/** Mute switch from Settings — silences battle and menu sounds alike. */
export function setSfxMuted(m: boolean) {
  muted = m;
}

function audio(): AudioContext | null {
  if (muted || volume <= 0) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      noise = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
      const d = noise.getChannelData(0);
      // Crushed noise: hold each sample for 4 frames for a lo-fi bite.
      for (let i = 0; i < d.length; i += 4) {
        const v = Math.random() * 2 - 1;
        for (let k = 0; k < 4 && i + k < d.length; k++) d[i + k] = v;
      }
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export type Sfx = "shot" | "mg" | "boom" | "death" | "click";
export type MenuSfx = "nav" | "select" | "back";

const SPEC: Record<Sfx, { dur: number; gain: number; freq: number; gap: number; tone?: number }> = {
  shot: { dur: 0.09, gain: 0.25, freq: 2200, gap: 0.05 },
  mg: { dur: 0.06, gain: 0.18, freq: 1600, gap: 0.04 },
  boom: { dur: 0.55, gain: 0.6, freq: 420, gap: 0.08, tone: 60 },
  death: { dur: 0.25, gain: 0.25, freq: 600, gap: 0.15, tone: 180 },
  click: { dur: 0.04, gain: 0.2, freq: 3000, gap: 0.03, tone: 880 },
};

// Menu blips: pure square-wave notes, NES-style. [frequency Hz, start s, length s]
const MENU: Record<MenuSfx, Array<[number, number, number]>> = {
  nav: [[660, 0, 0.035]],
  select: [[523, 0, 0.05], [784, 0.05, 0.08]],
  back: [[587, 0, 0.05], [392, 0.05, 0.08]],
};

export function menuSfx(kind: MenuSfx) {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  if (now - (lastAt[kind] ?? -1) < 0.04) return;
  lastAt[kind] = now;
  for (const [f, t, d] of MENU[kind]) {
    const o = a.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(f, now + t);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.setValueAtTime(0.12 * volume, now + t);
    g.gain.exponentialRampToValueAtTime(0.0001, now + t + d);
    o.connect(g).connect(a.destination);
    o.start(now + t);
    o.stop(now + t + d + 0.01);
  }
}

/** Click-capture handler: blip on any button/link inside a menu screen. */
export function onMenuClick(e: { target: EventTarget | null }) {
  const el = (e.target as HTMLElement | null)?.closest?.("a,button,[role=radio]") as HTMLElement | null;
  if (!el || el.hasAttribute("disabled") || el.getAttribute("data-testid") === "settings-mute-toggle") return;
  const id = el.getAttribute("data-testid") ?? "";
  menuSfx(/back|close|cancel/.test(id) ? "back" : /^(map-|warroom-view|settings-)/.test(id) ? "nav" : "select");
}

/** Play a sound; rapid repeats are throttled so gunfire doesn't clip. */
export function sfx(kind: Sfx) {
  const a = audio();
  if (!a || !noise) return;
  const s = SPEC[kind];
  const now = a.currentTime;
  if (now - (lastAt[kind] ?? -1) < s.gap) return;
  lastAt[kind] = now;
  const out = a.createGain();
  out.gain.setValueAtTime(s.gain * volume, now);
  out.gain.exponentialRampToValueAtTime(0.001, now + s.dur);
  out.connect(a.destination);
  const src = a.createBufferSource();
  src.buffer = noise;
  const lp = a.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(s.freq, now);
  lp.frequency.exponentialRampToValueAtTime(Math.max(80, s.freq * 0.2), now + s.dur);
  src.connect(lp).connect(out);
  src.start(now);
  src.stop(now + s.dur);
  if (s.tone) {
    const o = a.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(s.tone * 2, now);
    o.frequency.exponentialRampToValueAtTime(s.tone, now + s.dur);
    const og = a.createGain();
    og.gain.setValueAtTime(s.gain * volume * 0.35, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + s.dur);
    o.connect(og).connect(a.destination);
    o.start(now);
    o.stop(now + s.dur);
  }
}
