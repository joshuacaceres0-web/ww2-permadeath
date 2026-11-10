// Per-device game settings (not part of the save). Stored in localStorage.
export type GameSpeed = 0.75 | 1 | 1.25 | 1.5;
export type ShakeLevel = "off" | "low" | "full";

export interface Settings {
  speed: GameSpeed;
  shake: ShakeLevel;
  volume: number; // 0..100
  muted: boolean; // mutes battle + menu sounds
}

const KEY = "vanguard-settings";
export const DEFAULT_SETTINGS: Settings = { speed: 1, shake: "full", volume: 60, muted: false };

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<Settings>;
    return {
      speed: ([0.75, 1, 1.25, 1.5] as const).includes(raw.speed as GameSpeed) ? (raw.speed as GameSpeed) : DEFAULT_SETTINGS.speed,
      shake: (["off", "low", "full"] as const).includes(raw.shake as ShakeLevel) ? (raw.shake as ShakeLevel) : DEFAULT_SETTINGS.shake,
      volume: typeof raw.volume === "number" ? Math.max(0, Math.min(100, Math.round(raw.volume))) : DEFAULT_SETTINGS.volume,
      muted: raw.muted === true,
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
