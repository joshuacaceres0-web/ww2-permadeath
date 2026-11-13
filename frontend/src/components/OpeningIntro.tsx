// Opening intro (2026-11-13): a short title sequence in the game's
// own style that plays once per session before the start menu —
// the theatre, the road of the four operations from Normandy to
// the Hurtgen, the Sacrifice Division and what permadeath means
// here — then hands off to the menu over the same dusk scene.
// Click or Enter advances a beat; the SKIP button or Escape ends
// it at once. The menu itself is untouched.
import { useCallback, useEffect, useRef, useState } from "react";
import StartScene from "@/components/StartScene";

const ROAD: Array<{ code: string; place: string }> = [
  { code: "OPERATION OVERLORD", place: "Normandy, France · 6 June 1944" },
  { code: "OPERATION SILENT CHATEAU", place: "Valognes Estate" },
  { code: "OPERATION IRON CROSSROADS", place: "Carentan Causeway" },
  { code: "OPERATION PERMAFROST FLAK", place: "Hürtgen Forest" },
];

// Beat durations in ms; the last beat is the title card.
const BEATS = [3400, 4800, 4400, 2400];
const TITLE_BEAT = BEATS.length - 1;

const kicker = "font-[Silkscreen] text-[10px] tracking-[0.35em] text-[#E5A93C]";
const headline =
  "mt-3 font-[Silkscreen] font-bold leading-tight text-[#F0F5EB] text-[clamp(24px,6vw,52px)]";
const shadow = { textShadow: "3px 3px 0 #050605" } as const;

export default function OpeningIntro({ onDone }: { onDone: () => void }) {
  const [reduce] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [beat, setBeat] = useState(reduce ? TITLE_BEAT : 0);
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setLeaving(true);
    window.setTimeout(onDone, reduce ? 60 : 420);
  }, [onDone, reduce]);

  const advance = useCallback(() => {
    if (doneRef.current) return;
    if (beat >= TITLE_BEAT) finish();
    else setBeat(beat + 1);
  }, [beat, finish]);

  // Each beat runs on its own clock; the title beat ends the show.
  useEffect(() => {
    if (leaving) return;
    const ms = reduce ? 1100 : BEATS[beat];
    const t = window.setTimeout(() => {
      if (beat >= TITLE_BEAT) finish();
      else setBeat(beat + 1);
    }, ms);
    return () => window.clearTimeout(t);
  }, [beat, leaving, reduce, finish]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, finish]);

  return (
    <div
      className="absolute inset-0 z-50 overflow-hidden bg-[#050605] transition-opacity duration-500"
      style={{ opacity: leaving ? 0 : 1 }}
      data-testid="opening-intro"
      role="dialog"
      aria-label="Vanguard 44 opening intro"
      onClick={advance}
    >
      <StartScene />
      {/* The scrim sits heavy for the text beats and lifts on the
          title card, so the handoff to the menu (same scene) is
          seamless. */}
      <div
        className="absolute inset-0 transition-opacity duration-700"
        style={{ background: "#050605", opacity: beat >= TITLE_BEAT ? 0.45 : 0.78 }}
      />
      <div className="relative z-10 flex h-full flex-col justify-center px-5 sm:px-12">
        {beat === 0 && (
          <div key="b0" className="intro-beat-in max-w-2xl">
            <p className={kicker}>EUROPEAN THEATRE · 1944</p>
            <p className={headline} style={shadow}>
              FOUR OPERATIONS.
              <br />
              <span className="text-[#E5A93C]">ONE SQUAD.</span>
            </p>
          </div>
        )}
        {beat === 1 && (
          <div key="b1" className="intro-beat-in max-w-2xl">
            <p className={kicker}>THE ROAD INLAND</p>
            <div className="mt-5 space-y-3 border-l-2 border-[#E5A93C]/60 pl-4">
              {ROAD.map((op, i) => (
                <p
                  key={op.code}
                  className="intro-line-in font-[Silkscreen] text-sm tracking-wider text-[#E3E7DC] sm:text-lg"
                  style={{ animationDelay: `${i * 0.35}s`, ...shadow }}
                >
                  <span className="text-[#E5A93C]">▸ </span>
                  {op.code}
                  <span className="block font-mono text-xs normal-case tracking-normal text-[#A2B29A] sm:text-sm">
                    {op.place}
                  </span>
                </p>
              ))}
            </div>
          </div>
        )}
        {beat === 2 && (
          <div key="b2" className="intro-beat-in max-w-2xl">
            <p className={kicker}>PERMAFROST</p>
            <p className={headline} style={shadow}>
              THE SACRIFICE DIVISION
            </p>
            <p className="mt-4 font-mono text-sm leading-relaxed text-[#E3E7DC] sm:text-base">
              Your men do not respawn.
              <br />
              When a man falls, his name goes on the Memorial wall.
              <br />
              <span className="text-[#E5A93C]">It stays there.</span>
            </p>
          </div>
        )}
        {beat >= TITLE_BEAT && (
          <div key="b3" className="intro-beat-in max-w-2xl">
            <p className={kicker}>EUROPEAN THEATRE · 1944</p>
            <h1
              className="mt-2 whitespace-nowrap font-[Silkscreen] text-[clamp(26px,8.6vw,72px)] font-bold leading-none text-[#F0F5EB]"
              style={{ textShadow: "4px 4px 0 #050605, 0 0 0 #000" }}
            >
              VANGUARD<span className="text-[#E5A93C]">'44</span>
            </h1>
            <p className="mt-3 font-[Silkscreen] text-xs tracking-[0.18em] text-[#A2B29A] sm:text-sm">
              PERMAFROST, THE SACRIFICE DIVISION
            </p>
          </div>
        )}
      </div>
      <p className="absolute bottom-4 left-5 z-10 font-mono text-[11px] text-[#5A664F] sm:left-12">
        CLICK TO CONTINUE · ESC TO SKIP
      </p>
      <button
        type="button"
        data-testid="intro-skip"
        onClick={(e) => {
          e.stopPropagation();
          finish();
        }}
        className="pixel-btn absolute bottom-4 right-5 z-10 border-2 border-[#2E3628] bg-[#1A1D17]/90 px-4 py-2 font-[Silkscreen] text-xs tracking-wider text-[#E3E7DC] hover:border-[#E5A93C] hover:text-[#FFD97D] sm:right-12"
      >
        SKIP ▸
      </button>
    </div>
  );
}
