// The player-arranged graveyard inside the Memorial Wall. Lay each fallen man's stone
// where you choose, scatter tributes, drag anything to rearrange. Positions persist (0..1).
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Hand, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiDelete, apiPost, apiPut } from "@/lib/api";
import type { Decor, DecorKind, MemorialEntry } from "@/lib/types";
import Sprite from "@/components/memorial/Sprite";
import Portrait from "@/components/Portrait";
import { RibbonRack } from "@/components/Medals";

type Tool =
  | { mode: "move" }
  | { mode: "remove" }
  | { mode: "grave"; entryId: string }
  | { mode: "decor"; kind: DecorKind };

const DECOR: Array<{ kind: DecorKind; label: string }> = [
  { kind: "poppies", label: "Poppies" },
  { kind: "roses", label: "Roses" },
  { kind: "lilies", label: "Lilies" },
  { kind: "wreath", label: "Wreath" },
  { kind: "candle", label: "Candle" },
  { kind: "flag", label: "Flag" },
];

interface Drag {
  id: string;
  what: "grave" | "decor";
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface Props {
  entries: MemorialEntry[];
  decor: Decor[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export default function Graveyard({ entries, decor, selectedId, onSelect }: Props) {
  const qc = useQueryClient();
  const fieldRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>({ mode: "move" });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [override, setOverride] = useState<Record<string, { x: number; y: number }>>({});

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["memorial"] }),
      qc.invalidateQueries({ queryKey: ["decor"] }),
    ]);
    setOverride({});
  };
  const fail = () => toast.error("The ground is frozen — try again");

  const placeGrave = useMutation({
    mutationFn: (v: { id: string; x: number | null; y: number | null }) =>
      apiPut<MemorialEntry>(`/memorial/${v.id}/grave`, { x: v.x, y: v.y }),
    onSettled: refresh,
    onError: fail,
  });
  const addDecor = useMutation({
    mutationFn: (v: { kind: DecorKind; x: number; y: number }) => apiPost<Decor>("/graveyard/decor", v),
    onSettled: refresh,
    onError: fail,
  });
  const moveDecor = useMutation({
    mutationFn: (v: { id: string; x: number; y: number }) =>
      apiPut<Decor>(`/graveyard/decor/${v.id}`, { x: v.x, y: v.y }),
    onSettled: refresh,
    onError: fail,
  });
  const removeDecor = useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/graveyard/decor/${id}`),
    onSettled: refresh,
    onError: fail,
  });

  const toField = (clientX: number, clientY: number) => {
    const r = fieldRef.current!.getBoundingClientRect();
    return {
      x: clamp((clientX - r.left) / r.width, 0.03, 0.97),
      y: clamp((clientY - r.top) / r.height, 0.16, 0.97),
    };
  };

  const onFieldDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    const p = toField(e.clientX, e.clientY);
    if (tool.mode === "grave") {
      const entry = entries.find((x) => x.id === tool.entryId);
      setOverride((o) => ({ ...o, [tool.entryId]: p }));
      placeGrave.mutate({ id: tool.entryId, ...p });
      if (entry) toast(`${entry.rank} ${entry.name} is laid to rest.`);
      setTool({ mode: "move" });
      onSelect(tool.entryId);
    } else if (tool.mode === "decor") {
      addDecor.mutate({ kind: tool.kind, ...p });
    } else {
      onSelect(null);
    }
  };

  const onItemDown = (e: React.PointerEvent, id: string, what: "grave" | "decor", x: number, y: number) => {
    e.stopPropagation();
    if (tool.mode === "remove") {
      if (what === "decor") removeDecor.mutate(id);
      else {
        placeGrave.mutate({ id, x: null, y: null });
        if (selectedId === id) onSelect(null);
      }
      return;
    }
    if (tool.mode !== "move") return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id, what, x, y, startX: e.clientX, startY: e.clientY, moved: false });
  };

  const onItemMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const moved = drag.moved || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4;
    const p = toField(e.clientX, e.clientY);
    setDrag({ ...drag, ...p, moved });
  };

  const onItemUp = () => {
    if (!drag) return;
    if (drag.moved) {
      setOverride((o) => ({ ...o, [drag.id]: { x: drag.x, y: drag.y } }));
      if (drag.what === "grave") placeGrave.mutate({ id: drag.id, x: drag.x, y: drag.y });
      else moveDecor.mutate({ id: drag.id, x: drag.x, y: drag.y });
    } else if (drag.what === "grave") {
      onSelect(selectedId === drag.id ? null : drag.id);
    }
    setDrag(null);
  };

  const posOf = (id: string, x: number, y: number) => {
    if (drag?.id === id) return { x: drag.x, y: drag.y };
    return override[id] ?? { x, y };
  };

  const placed = entries.filter((e) => e.grave_x !== null && e.grave_y !== null);
  const unplaced = entries.filter((e) => (e.grave_x === null || e.grave_y === null) && !override[e.id]);

  type Item = { id: string; what: "grave" | "decor"; x: number; y: number; entry?: MemorialEntry; kind?: DecorKind };
  const items: Item[] = [
    ...placed.map((e) => ({ id: e.id, what: "grave" as const, ...posOf(e.id, e.grave_x!, e.grave_y!), entry: e })),
    ...entries
      .filter((e) => (e.grave_x === null || e.grave_y === null) && override[e.id])
      .map((e) => ({ id: e.id, what: "grave" as const, ...override[e.id], entry: e })),
    ...decor.map((d) => ({ id: d.id, what: "decor" as const, ...posOf(d.id, d.x, d.y), kind: d.kind })),
  ].sort((a, b) => a.y - b.y);

  const cursor =
    tool.mode === "grave" || tool.mode === "decor" ? "cursor-copy" : tool.mode === "remove" ? "cursor-not-allowed" : "cursor-default";

  return (
    <section className="space-y-3" data-testid="graveyard">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#75826F]">Field of honor</p>
          <h2 className="font-heading text-2xl font-bold tracking-tight text-[#F3F7EE]">THE GRAVEYARD</h2>
          <p className="font-mono text-[11px] text-[#75826F]">
            Lay each man to rest where you choose. Drag stones and tributes to rearrange; click a stone to read his story.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            data-testid="graveyard-tool-move"
            size="xs"
            variant={tool.mode === "move" ? "default" : "outline"}
            onClick={() => setTool({ mode: "move" })}
          >
            <Hand size={12} className="mr-1" /> ARRANGE
          </Button>
          {DECOR.map((d) => (
            <Button
              key={d.kind}
              data-testid={`graveyard-tool-${d.kind}`}
              size="xs"
              variant={tool.mode === "decor" && tool.kind === d.kind ? "default" : "outline"}
              onClick={() => setTool({ mode: "decor", kind: d.kind })}
              className="gap-1"
            >
              <Sprite kind={d.kind} scale={1.4} /> {d.label.toUpperCase()}
            </Button>
          ))}
          <Button
            data-testid="graveyard-tool-remove"
            size="xs"
            variant={tool.mode === "remove" ? "destructive" : "outline"}
            onClick={() => setTool({ mode: "remove" })}
          >
            <Trash2 size={12} className="mr-1" /> CLEAR
          </Button>
        </div>
      </div>

      {/* Unplaced stones */}
      <div className="flex flex-wrap items-center gap-2 border border-[#2E3628] bg-[#0E100D] p-2.5" data-testid="graveyard-tray">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#75826F]">
          {unplaced.length ? "Awaiting burial —" : "Every man has a resting place."}
        </span>
        {unplaced.map((e) => {
          const active = tool.mode === "grave" && tool.entryId === e.id;
          return (
            <button
              key={e.id}
              data-testid={`graveyard-tray-${e.id}`}
              onClick={() => setTool(active ? { mode: "move" } : { mode: "grave", entryId: e.id })}
              className={`flex items-center gap-2 border px-2 py-1 font-mono text-[11px] ${
                active ? "border-[#E5A93C] bg-[#3A2B0E] text-[#FFD97D]" : "border-[#2E3628] text-[#D5DCD0] hover:border-[#C68B45]"
              }`}
            >
              <Portrait seed={e.portrait_seed} type={e.type} size={20} fallen />
              {e.rank} {e.name}
            </button>
          );
        })}
        {tool.mode === "grave" && (
          <span className="font-mono text-[11px] text-[#E5A93C]" data-testid="graveyard-hint">
            ▸ Click the ground to lay his stone
          </span>
        )}
        {tool.mode === "decor" && (
          <span className="font-mono text-[11px] text-[#E5A93C]">▸ Click the ground to place {tool.kind} — as many as you like</span>
        )}
      </div>

      {/* The field */}
      <div
        ref={fieldRef}
        data-testid="graveyard-field"
        onPointerDown={onFieldDown}
        className={`graveyard-field relative aspect-[16/6] max-h-[62svh] w-full touch-none select-none overflow-hidden border border-[#2E3628] ${cursor}`}
      >
        {items.map((it) => {
          const selected = it.what === "grave" && it.id === selectedId;
          return (
            <div
              key={it.id}
              data-testid={it.what === "grave" ? `grave-${it.id}` : `decor-${it.id}`}
              onPointerDown={(e) => onItemDown(e, it.id, it.what, it.x, it.y)}
              onPointerMove={onItemMove}
              onPointerUp={onItemUp}
              className={`group absolute -translate-x-1/2 -translate-y-full ${
                tool.mode === "move" ? "cursor-grab active:cursor-grabbing" : tool.mode === "remove" ? "cursor-pointer" : ""
              }`}
              style={{ left: `${it.x * 100}%`, top: `${it.y * 100}%`, zIndex: Math.round(it.y * 100) }}
              title={it.entry ? `${it.entry.rank} ${it.entry.name}` : it.kind}
            >
              {it.what === "grave" && it.entry ? (
                <div className="flex flex-col items-center">
                  <Sprite
                    kind={it.entry.portrait_seed % 3 === 0 ? "tombstone" : "cross"}
                    scale={4}
                    className={selected ? "drop-shadow-[0_0_6px_rgba(229,169,60,0.9)]" : ""}
                  />
                  {(it.entry.medals ?? []).length > 0 && (
                    <span className="-mt-9 mb-5 rounded-sm bg-[#0E100D]/60 p-0.5">
                      <RibbonRack medals={it.entry.medals} scale={0.7} testid={`grave-ribbons-${it.id}`} />
                    </span>
                  )}
                  <span
                    className={`mt-0.5 whitespace-nowrap px-1 font-mono text-[9px] tracking-wider ${
                      selected ? "bg-[#3A2B0E] text-[#FFD97D]" : "bg-[#0E100D]/70 text-[#D5DCD0] opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    {it.entry.name.split(" ").slice(-1)[0].toUpperCase()}
                  </span>
                </div>
              ) : it.kind ? (
                <Sprite kind={it.kind} scale={3} />
              ) : null}
            </div>
          );
        })}
        {items.length === 0 && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-xs text-[#75826F]">
            Quiet ground. Nobody rests here yet.
          </p>
        )}
      </div>
    </section>
  );
}
