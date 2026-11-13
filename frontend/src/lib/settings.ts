// Per-device game settings (not part of the save). Stored in localStorage.
export type GameSpeed = 0.75 | 1 | 1.25 | 1.5;
export type ShakeLevel = "off" | "low" | "full";
// What the player says they are playing on. "phone" forces the
// touch controls and hides the desktop cluster, "computer" does
// the reverse, "auto" keeps the screen-based guess.
export type ControlsMode = "auto" | "phone" | "computer";

export interface Settings {
  speed: GameSpeed;
  shake: ShakeLevel;
  volume: number; // 0..100
  muted: boolean; // mutes battle + menu sounds
  musicVolume: number; // 0..100, separate from SFX volume
  musicEnabled: boolean; // music on/off, menu / War Room / Barracks / Memorial only
  controls: ControlsMode; // which control set the battle shows
}

const KEY = "vanguard-settings";
export const DEFAULT_SETTINGS: Settings = { speed: 1, shake: "full", volume: 60, muted: false, musicVolume: 50, musicEnabled: true, controls: "auto" };

// The one place that decides touch vs desktop for a battle: the
// player's own pick wins over the screen heuristic, so the two
// control sets never mix on one screen.
export function resolveTouchControls(mode: ControlsMode, coarsePointer: boolean, narrowScreen: boolean): boolean {
  if (mode === "phone") return true;
  if (mode === "computer") return false;
  return coarsePointer || narrowScreen;
}

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<Settings>;
    return {
      speed: ([0.75, 1, 1.25, 1.5] as const).includes(raw.speed as GameSpeed) ? (raw.speed as GameSpeed) : DEFAULT_SETTINGS.speed,
      shake: (["off", "low", "full"] as const).includes(raw.shake as ShakeLevel) ? (raw.shake as ShakeLevel) : DEFAULT_SETTINGS.shake,
      volume: typeof raw.volume === "number" ? Math.max(0, Math.min(100, Math.round(raw.volume))) : DEFAULT_SETTINGS.volume,
      muted: raw.muted === true,
      musicVolume:
        typeof raw.musicVolume === "number"
          ? Math.max(0, Math.min(100, Math.round(raw.musicVolume)))
          : DEFAULT_SETTINGS.musicVolume,
      musicEnabled: raw.musicEnabled === undefined ? DEFAULT_SETTINGS.musicEnabled : raw.musicEnabled === true,
      controls: (["auto", "phone", "computer"] as const).includes(raw.controls as ControlsMode)
        ? (raw.controls as ControlsMode)
        : DEFAULT_SETTINGS.controls,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: settings last for this visit */
  }
}

export const SHAKE_FACTOR: Record<ShakeLevel, number> = { off: 0, low: 0.4, full: 1 };
