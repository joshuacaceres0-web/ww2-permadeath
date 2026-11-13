import { useRef, useState, type ReactNode, type RefObject } from "react";
import type { GameEngine, Formation, SquadOrder } from "@/game/engine";
import { PANEL_BTN, PANEL_BTN_ACTIVE } from "@/components/game/panel";

interface Props {
  engineRef: RefObject<GameEngine | null>;
  paused: boolean;
  disabled: boolean;
  formation: Formation;
  squadOrder: SquadOrder;
  radioSlot?: ReactNode;
}

export const FORMATIONS: Array<{ id: Formation; label: string; glyph: string }> = [
  { id: "wedge", label: "WEDGE", glyph: "▲" },
  { id: "line", label: "LINE", glyph: "━" },
  { id: "column", label: "COLUMN", glyph: "┃" },
  { id: "spread", label: "SPREAD", glyph: "⁘" },
];

const ORDERS: Array<{ id: SquadOrder; label: string }> = [
  { id: "attack", label: "ATTACK" },
  { id: "defend", label: "DEFEND" },
  { id: "formup", label: "FORM UP" },
];

/** One virtual stick: drag the knob, the vector (clamped to the
 * base radius) streams to the engine; release zeroes it. */
function Stick({
  label,
  accent,
  onVector,
}: {
  label: string;
  accent: string;
  onVector: (v: { x: number; y: number } | null) => void;
}) {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);
  const R = 44;

  const vectorFrom = (clientX: number, clientY: number) => {
    const el = baseRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    let dx = clientX - (r.left + r.width / 2);
    let dy = clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > R) {
      dx = (dx / d) * R;
      dy = (dy / d) * R;
    }
    return { x: dx, y: dy };
  };

  return (
    <div
      ref={baseRef}
      className="pointer-events-auto relative h-32 w-32 shrink-0 touch-none rounded-full border bg-[#0D0F0C]/50"
      style={{ borderColor: accent }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const v = vectorFrom(e.clientX, e.clientY);
        if (v) {
          setKnob(v);
          onVector({ x: v.x / R, y: v.y / R });
        }
      }}
      onPointerMove={(e) => {
        if (!knob) return;
        const v = vectorFrom(e.clientX, e.clientY);
        if (v) {
          setKnob(v);
          onVector({ x: v.x / R, y: v.y / R });
        }
      }}
      onPointerUp={() => {
        setKnob(null);
        onVector(null);
      }}
      onPointerCancel={() => {
        setKnob(null);
        onVector(null);
      }}
    >
      <div
        className="absolute h-14 w-14 rounded-full border bg-[#0D0F0C]/85"
        style={{
          borderColor: accent,
          left: `calc(50% - 28px + ${knob?.x ?? 0}px)`,
          top: `calc(50% - 28px + ${knob?.y ?? 0}px)`,
        }}
      />
      <span className="pointer-events-none absolute inset-x-0 -bottom-5 text-center font-mono text-[9px] tracking-[0.2em] text-[#8D9A83]">
        {label}
      </span>
    </div>
  );
}

/** Twin-stick phone controls for the leader system (Josh,
 * 2026-11-12): left stick moves the leader, right stick aims
 * and fires. Ability, orders, formation, cover and the radio
 * sit at the edges; the middle of the screen stays clear. The
 * MENU button lives in Battlefield (top right). No AUTO: the
 * mode is gone. */
export default function TouchControls({ engineRef, disabled, formation, squadOrder, radioSlot }: Props) {
  if (disabled) return null;
  const eng = () => engineRef.current;
  return (
    <div className="pointer-events-none absolute inset-0 z-20" data-testid="touch-controls">
      {/* Top-left working row: radio entry, formation cycle, cover.
          The overlay root is pointer-events-none, so the radio
          slot needs its own pointer-events-auto wrapper like the
          buttons beside it — without it the RADIO button rendered
          but every tap passed straight through it (Josh,
          2026-11-13). The wrapper also covers the open dropdown,
          which hangs inside the slot. */}
      <div className="absolute left-2 top-10 flex items-center gap-1.5">
        <div className="pointer-events-auto">{radioSlot}</div>
        <button
          data-testid="touch-formation-btn"
          className={`pointer-events-auto px-2.5 py-2 text-[10px] ${PANEL_BTN} text-[#E3E7DC]!`}
          onClick={() => {
            const order: Formation[] = ["wedge", "line", "column", "spread"];
            eng()?.setFormation(order[(order.indexOf(formation) + 1) % order.length]);
          }}
        >
          {FORMATIONS.find((f) => f.id === formation)?.glyph} {formation.toUpperCase()}
        </button>
        <button
          data-testid="touch-cover-btn"
          className={`pointer-events-auto px-2.5 py-2 text-[10px] ${PANEL_BTN} text-[#E3E7DC]!`}
          onClick={() => eng()?.takeCover()}
        >
          COVER
        </button>
      </div>

      {/* Orders along the bottom middle, between the sticks */}
      <div className="absolute inset-x-0 bottom-3 flex items-end justify-center gap-1.5 pb-6" data-testid="touch-orders">
        {ORDERS.map((o) => (
          <button
            key={o.id}
            data-testid={`touch-order-${o.id}`}
            onClick={() => eng()?.setSquadOrder(o.id)}
            className={`pointer-events-auto px-3 py-2.5 text-[11px] ${PANEL_BTN} ${squadOrder === o.id ? PANEL_BTN_ACTIVE : ""}`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* Ability: the big thumb button above the shoot stick */}
      <button
        data-testid="touch-ability-btn"
        className="pointer-events-auto absolute bottom-44 right-5 flex h-16 w-16 items-center justify-center rounded-full border border-[#E5A93C] bg-[#3A2B0E]/85 font-mono text-[10px] font-bold tracking-wider text-[#FFD97D]"
        onClick={() => {
          const e = eng();
          const lead = e?.leaderUnit();
          if (e && lead) e.startAim(lead.id);
        }}
      >
        ABILITY
      </button>

      {/* The sticks */}
      <div className="absolute bottom-5 left-4">
        <Stick label="MOVE" accent="#4ECDC4" onVector={(v) => eng()?.setTouchMove(v)} />
      </div>
      <div className="absolute bottom-5 right-4">
        <Stick label="FIRE" accent="#E24A4A" onVector={(v) => eng()?.setTouchAim(v)} />
      </div>
    </div>
  );
}
