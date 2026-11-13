// The graveyard inside the Memorial Wall. Graves are laid by the game, not the
// player (Josh, 2026-11-12): every fallen man already rests in the ground, in
// the order the men fell, and there is no placement step. The player's only
// hands-on work is tending: pick a stone, then leave a tribute on his grave.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiDelete, apiPost } from "@/lib/api";
import type { Decor, DecorKind, MemorialEntry } from "@/lib/types";
import Sprite from "@/components/memorial/Sprite";
import { RibbonRack } from "@/components/Medals";

const DECOR: Array<{ kind: DecorKind; label: string }> = [
  { kind: "poppies", label: "Poppies" },
  { kind: "roses", label: "Roses" },
  { kind: "lilies", label: "Lilies" },
  { kind: "wreath", label: "Wreath" },
  { kind: "candle", label: "Candle" },
  { kind: "flag", label: "Flag" },
];

interface Props {
  entries: MemorialEntry[];
  decor: Decor[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export default function Graveyard({ entries, decor, selectedId, onSelect }: Props) {
  const qc = useQueryClient();
  const [removing, setRemoving] = useState(false);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["decor"] });
  };
  const fail = () => toast.error("The ground is frozen — try again");

  const addDecor = useMutation({
    mutationFn: (v: { kind: DecorKind; entryId: string }) =>
      apiPost<Decor>("/graveyard/decor", { kind: v.kind, entry_id: v.entryId }),
    onSettled: refresh,
    onError: fail,
  });
  const removeDecor = useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/graveyard/decor/${id}`),
    onSettled: refresh,
    onError: fail,
  });

  const selected = entries.find((e) => e.id === selectedId) ?? null;

  type Item =
    | { id: string; what: "grave"; x: number; y: number; entry: MemorialEntry }
    | { id: string; what: "decor"; x: number; y: number; kind: DecorKind };
  const items: Item[] = [
    ...entries
      .filter((e) => e.grave_x !== null && e.grave_y !== null)
      .map((e) => ({ id: e.id, what: "grave" as const, x: e.grave_x!, y: e.grave_y!, entry: e })),
    ...decor.map((d) => ({ id: d.id, what: "decor" as const, x: d.x, y: d.y, kind: d.kind })),
  ].sort((a, b) => a.y - b.y);

  return (
    <section className="space-y-3" data-testid="graveyard">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#75826F]">Field of honor</p>
          <h2 className="font-heading text-2xl font-bold tracking-tight text-[#F3F7EE]">THE GRAVEYARD</h2>
          <p className="font-mono text-[11px] text-[#75826F]">
            The company lays each man to rest in the order he fell. Your hands tend the graves: click a stone to
            read his story, then leave flowers, a flag, a candle.
          </p>
        </div>
      </div>

      {/* Tending bar: pick a grave, then a tribute for it. */}
      <div
        className="flex flex-wrap items-center gap-1.5 border border-[#2E3628] bg-[#0E100D] p-2.5"
        data-testid="graveyard-tend"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#75826F]">
          {selected ? `Tending ${selected.rank} ${selected.name} —` : "Pick a grave to tend it —"}
        </span>
        {DECOR.map((d) => (
          <Button
            key={d.kind}
            data-testid={`graveyard-tool-${d.kind}`}
            size="xs"
            variant="outline"
            disabled={!selected || addDecor.isPending}
            onClick={() => selected && addDecor.mutate({ kind: d.kind, entryId: selected.id })}
            className="gap-1"
          >
            <Sprite kind={d.kind} scale={1.4} /> {d.label.toUpperCase()}
          </Button>
        ))}
        <Button
          data-testid="graveyard-tool-remove"
          size="xs"
          variant={removing ? "destructive" : "outline"}
          onClick={() => setRemoving((r) => !r)}
        >
          <Trash2 size={12} className="mr-1" /> {removing ? "CLICK A TRIBUTE" : "REMOVE"}
        </Button>
        {removing && (
          <span className="font-mono text-[11px] text-[#E5A93C]">▸ Click a tribute to take it away. Stones stay.</span>
        )}
      </div>

      {/* The field */}
      <div
        data-testid="graveyard-field"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onSelect(null);
        }}
        className="graveyard-field relative aspect-[16/6] max-h-[62svh] w-full select-none overflow-hidden border border-[#2E3628]"
      >
        {items.map((it) => {
          const isSelected = it.what === "grave" && it.id === selectedId;
          return (
            <div
              key={`${it.what}-${it.id}`}
              data-testid={it.what === "grave" ? `grave-${it.id}` : `decor-${it.id}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (it.what === "grave") {
                  onSelect(isSelected ? null : it.id);
                } else if (removing) {
                  removeDecor.mutate(it.id);
                }
              }}
              className={`group absolute -translate-x-1/2 -translate-y-full ${
                it.what === "grave" ? "cursor-pointer" : removing ? "cursor-not-allowed" : ""
              }`}
              style={{ left: `${it.x * 100}%`, top: `${it.y * 100}%`, zIndex: Math.round(it.y * 100) }}
              title={it.what === "grave" ? `${it.entry.rank} ${it.entry.name}` : it.kind}
            >
              {it.what === "grave" ? (
                <div className="flex flex-col items-center">
                  <Sprite
                    kind={it.entry.portrait_seed % 3 === 0 ? "tombstone" : "cross"}
                    scale={4}
                    className={isSelected ? "drop-shadow-[0_0_6px_rgba(229,169,60,0.9)]" : ""}
                  />
                  {(it.entry.medals ?? []).length > 0 && (
                    <span className="-mt-9 mb-5 rounded-sm bg-[#0E100D]/60 p-0.5">
                      <RibbonRack medals={it.entry.medals} scale={0.7} testid={`grave-ribbons-${it.id}`} />
                    </span>
                  )}
                  <span
                    className={`mt-0.5 whitespace-nowrap px-1 font-mono text-[9px] tracking-wider ${
                      isSelected ? "bg-[#3A2B0E] text-[#FFD97D]" : "bg-[#0E100D]/70 text-[#D5DCD0] opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    {it.entry.name.split(" ").slice(-1)[0].toUpperCase()}
                  </span>
                </div>
              ) : (
                <Sprite kind={it.kind} scale={3} />
              )}
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
