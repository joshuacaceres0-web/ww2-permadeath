// On-screen controls for touch devices: D-pad scroll (hold), selection box, formations,
// and big buttons for pause / select all / ability / take cover.
import {
  BoxSelect,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Pause,
  Play,
  Shield,
  Users,
  Zap,
} from "lucide-react";
import type { Formation, GameEngine } from "@/game/engine";

interface Props {
  engineRef: { current: GameEngine | null };
  paused: boolean;
  disabled: boolean;
  formation: Formation;
  touchBox: boolean;
}

export const FORMATIONS: Array<{ id: Formation; label: string; glyph: string }> = [
  { id: "wedge", label: "WEDGE", glyph: "▲" },
  { id: "line", label: "LINE", glyph: "━" },
  { id: "column", label: "COLUMN", glyph: "┃" },
  { id: "spread", label: "SPREAD", glyph: "⁘" },
];

function PadButton({ dir, x, y, children }: { dir: string; x: number; y: number; children: React.ReactNode }) {
  return (
    <button
      data-testid={`touch-pan-${dir}`}
      aria-label={`Scroll ${dir}`}
      className="pad-btn flex h-11 w-11 items-center justify-center border border-[#2E3628] bg-[#1A1D17]/90 text-[#E3E7DC] active:bg-[#3A2B0E] short:h-10 short:w-10"
      data-x={x}
      data-y={y}
    >
      {children}
    </button>
  );
}

export default function TouchControls({ engineRef, paused, disabled, formation, touchBox }: Props) {
  const hold = (e: React.PointerEvent) => {
    const t = (e.target as HTMLElement).closest(".pad-btn") as HTMLElement | null;
    if (!t) return;
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone — holding still works via pointerleave/up */
    }
    engineRef.current?.setHoldPan(Number(t.dataset.x), Number(t.dataset.y));
  };
  const release = () => engineRef.current?.setHoldPan(0, 0);

  const big =
    "flex h-12 min-w-12 flex-col items-center justify-center gap-0.5 border px-2 font-mono text-[9px] tracking-wider transition-colors duration-150 disabled:opacity-40 short:h-11";

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between p-2" data-testid="touch-controls">
      <div
        className="pointer-events-auto grid grid-cols-3 gap-1 touch-none"
        onPointerDown={hold}
        onPointerUp={release}
        onPointerCancel={release}
        onPointerLeave={release}
      >
        <span />
        <PadButton dir="up" x={0} y={-1}><ChevronUp size={18} /></PadButton>
        <span />
        <PadButton dir="left" x={-1} y={0}><ChevronLeft size={18} /></PadButton>
        <span className="flex items-center justify-center font-mono text-[8px] text-[#5A664F]">MAP</span>
        <PadButton dir="right" x={1} y={0}><ChevronRight size={18} /></PadButton>
        <span />
        <PadButton dir="down" x={0} y={1}><ChevronDown size={18} /></PadButton>
        <span />
      </div>
      <div className="pointer-events-auto flex flex-col items-end gap-1.5">
        <div className="flex gap-1" data-testid="touch-formations">
          {FORMATIONS.map((f) => (
            <button
              key={f.id}
              data-testid={`touch-formation-${f.id}`}
              disabled={disabled}
              onClick={() => engineRef.current?.setFormation(f.id)}
              className={`flex h-9 min-w-11 flex-col items-center justify-center border px-1.5 font-mono text-[8px] tracking-wider transition-colors duration-150 disabled:opacity-40 ${
                formation === f.id
                  ? "border-[#4ECDC4] bg-[#12302E]/95 text-[#4ECDC4]"
                  : "border-[#2E3628] bg-[#1A1D17]/90 text-[#A2B29A]"
              }`}
            >
              <span className="text-[11px] leading-none">{f.glyph}</span>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <button
            data-testid="touch-box-select"
            disabled={disabled}
            onClick={() => engineRef.current?.setTouchBox(!touchBox)}
            className={`${big} ${touchBox ? "border-[#4ECDC4] bg-[#12302E]/95 text-[#4ECDC4]" : "border-[#2E3628] bg-[#1A1D17]/90 text-[#E3E7DC]"}`}
          >
            <BoxSelect size={16} /> {touchBox ? "DRAG…" : "BOX"}
          </button>
          <button data-testid="touch-select-all" disabled={disabled} onClick={() => engineRef.current?.selectAll()} className={`${big} border-[#2E3628] bg-[#1A1D17]/90 text-[#4ECDC4]`}>
            <Users size={16} /> ALL
          </button>
          <button data-testid="touch-cover" disabled={disabled} onClick={() => engineRef.current?.takeCover()} className={`${big} border-[#2E3628] bg-[#1A1D17]/90 text-[#E3E7DC]`}>
            <Shield size={16} /> COVER
          </button>
          <button data-testid="touch-ability" disabled={disabled} onClick={() => engineRef.current?.abilitySelected()} className={`${big} border-[#5C4A1E] bg-[#1A1D17]/90 text-[#E5A93C]`}>
            <Zap size={16} /> ABILITY
          </button>
          <button data-testid="touch-pause" disabled={disabled} onClick={() => engineRef.current?.togglePause()} className={`${big} border-[#E5A93C] bg-[#3A2B0E]/90 text-[#FFD97D]`}>
            {paused ? <Play size={16} /> : <Pause size={16} />} {paused ? "GO" : "PAUSE"}
          </button>
        </div>
      </div>
    </div>
  );
}
