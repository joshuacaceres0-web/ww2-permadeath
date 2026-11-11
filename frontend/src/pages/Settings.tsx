// Settings: game speed, screen shake, volume. Saved on this device only — never touches the save.
import { useState } from "react";
import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type GameSpeed, type Settings as S, type ShakeLevel } from "@/lib/settings";
import { menuSfx, onMenuClick, setSfxMuted, setSfxVolume, sfx } from "@/game/sfx";
import { setMusicEnabled, setMusicMuted, setMusicVolume, useMusic } from "@/game/music";

const SPEEDS: Array<{ v: GameSpeed; label: string }> = [
  { v: 0.75, label: "SLOW" },
  { v: 1, label: "NORMAL" },
  { v: 1.25, label: "FAST" },
  { v: 1.5, label: "FASTER" },
];
const SHAKES: Array<{ v: ShakeLevel; label: string }> = [
  { v: "off", label: "OFF" },
  { v: "low", label: "LOW" },
  { v: "full", label: "FULL" },
];

function Choice<T extends string | number>({ name, value, options, onPick }: { name: string; value: T; options: Array<{ v: T; label: string }>; onPick: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.v)}
          role="radio"
          aria-checked={value === o.v}
          data-testid={`settings-${name}-${String(o.v)}`}
          onClick={() => onPick(o.v)}
          className={`border-2 px-3 py-2 font-[Silkscreen] text-xs shadow-[2px_2px_0_0_#050605] transition-colors duration-100 ${
            value === o.v ? "border-[#E5A93C] bg-[#E5A93C] text-[#141108]" : "border-[#2E3628] bg-[#1A1D17] text-[#A2B29A] hover:text-[#E3E7DC]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function Settings() {
  useMusic(null); // No music on Settings (except TEST SOUND).
  const [s, setS] = useState<S>(() => loadSettings());
  const update = (patch: Partial<S>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveSettings(next);
    setSfxVolume(next.volume);
    setSfxMuted(next.muted);
    setMusicVolume(next.musicVolume);
    setMusicMuted(next.muted);
    setMusicEnabled(next.musicEnabled);
  };
  return (
    <div className="min-h-svh bg-[#0D0F0C] px-5 py-8 text-[#E3E7DC] sm:px-12" data-testid="settings-page" onClickCapture={onMenuClick}>
      <div className="mx-auto max-w-xl">
        <Link to="/" data-testid="settings-back-btn" className={buttonVariants({ variant: "outline", size: "sm" })}>
          ◂ START MENU
        </Link>
        <h1 className="mt-6 font-[Silkscreen] text-3xl font-bold text-[#F0F5EB] sm:text-4xl" style={{ textShadow: "3px 3px 0 #050605" }}>
          SETTINGS
        </h1>
        <p className="mt-2 font-mono text-sm text-[#A2B29A]">Saved on this device. Your campaign is not affected.</p>

        <section className="mt-6 space-y-3 border border-[#2E3628] bg-[#1A1D17] p-4">
          <h2 className="font-[Silkscreen] text-sm text-[#F0F5EB]">GAME SPEED</h2>
          <p className="font-mono text-sm text-[#8D9A83]">How fast battles run. Pause still works at any speed.</p>
          <Choice name="speed" value={s.speed} options={SPEEDS} onPick={(v) => update({ speed: v })} />
        </section>

        <section className="mt-3 space-y-3 border border-[#2E3628] bg-[#1A1D17] p-4">
          <h2 className="font-[Silkscreen] text-sm text-[#F0F5EB]">SCREEN SHAKE</h2>
          <p className="font-mono text-sm text-[#8D9A83]">Camera jolt from explosions.</p>
          <Choice name="shake" value={s.shake} options={SHAKES} onPick={(v) => update({ shake: v })} />
        </section>

        <section className="mt-3 space-y-3 border border-[#2E3628] bg-[#1A1D17] p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-[Silkscreen] text-sm text-[#F0F5EB]">SOUND</h2>
            <button
              role="switch"
              aria-checked={s.muted}
              data-testid="settings-mute-toggle"
              onClick={() => {
                const m = !s.muted;
                update({ muted: m });
                if (!m) menuSfx("select");
              }}
              className={`border-2 px-3 py-2 font-[Silkscreen] text-xs shadow-[2px_2px_0_0_#050605] transition-colors duration-100 ${
                s.muted ? "border-[#E24A4A] bg-[#3A1414] text-[#F0B4B4]" : "border-[#2E3628] bg-[#121411] text-[#A2B29A]"
              }`}
            >
              {s.muted ? "■ MUTED" : "□ MUTE ALL"}
            </button>
          </div>
          <p className="font-mono text-sm text-[#8D9A83]">Mute silences battle and menu sounds.</p>
          <div className="flex items-center justify-between">
            <h2 className="font-[Silkscreen] text-sm text-[#F0F5EB]">VOLUME</h2>
            <span className="font-[Silkscreen] text-sm text-[#E5A93C]" data-testid="settings-volume-value">
              {s.muted || s.volume === 0 ? "MUTE" : `${s.volume}%`}
            </span>
          </div>
          <p className="font-mono text-sm text-[#8D9A83]">Battle sounds and menu blips.</p>
          <input
            type="range"
            min={0}
            max={100}
            step={10}
            value={s.volume}
            onChange={(e) => update({ volume: Number(e.target.value) })}
            onPointerUp={() => sfx("shot")}
            onKeyUp={() => sfx("shot")}
            data-testid="settings-volume-slider"
            aria-label="Volume"
            className="w-full accent-[#E5A93C]"
          />
          <button
            onClick={() => sfx("boom")}
            data-testid="settings-volume-test"
            className="border-2 border-[#2E3628] bg-[#121411] px-3 py-1.5 font-[Silkscreen] text-xs text-[#A2B29A] shadow-[2px_2px_0_0_#050605] hover:text-[#E3E7DC]"
          >
            ▸ TEST SOUND
          </button>
        </section>

        <section className="mt-3 space-y-3 border border-[#2E3628] bg-[#1A1D17] p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-[Silkscreen] text-sm text-[#F0F5EB]">MUSIC</h2>
            <button
              role="switch"
              aria-checked={s.musicEnabled}
              data-testid="settings-music-toggle"
              onClick={() => update({ musicEnabled: !s.musicEnabled })}
              className={`border-2 px-3 py-2 font-[Silkscreen] text-xs shadow-[2px_2px_0_0_#050605] transition-colors duration-100 ${
                s.musicEnabled ? "border-[#2E3628] bg-[#121411] text-[#A2B29A]" : "border-[#E24A4A] bg-[#3A1414] text-[#F0B4B4]"
              }`}
            >
              {s.musicEnabled ? "♪ MUSIC ON" : "■ MUSIC OFF"}
            </button>
          </div>
          <p className="font-mono text-sm text-[#8D9A83]">
            Menu, War Room, Barracks and Memorial only. No music in battle. Mute All above also silences music.
          </p>
          <div className="flex items-center justify-between">
            <h2 className="font-[Silkscreen] text-sm text-[#F0F5EB]">MUSIC VOLUME</h2>
            <span className="font-[Silkscreen] text-sm text-[#E5A93C]" data-testid="settings-music-volume-value">
              {!s.musicEnabled || s.muted || s.musicVolume === 0 ? "MUTE" : `${s.musicVolume}%`}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={10}
            value={s.musicVolume}
            onChange={(e) => update({ musicVolume: Number(e.target.value) })}
            data-testid="settings-music-volume-slider"
            aria-label="Music volume"
            className="w-full accent-[#E5A93C]"
          />
        </section>

        <button
          onClick={() => update(DEFAULT_SETTINGS)}
          data-testid="settings-restore-defaults"
          className="mt-4 font-mono text-sm text-[#8D9A83] underline hover:text-[#E3E7DC]"
        >
          Restore defaults
        </button>
      </div>
    </div>
  );
}
