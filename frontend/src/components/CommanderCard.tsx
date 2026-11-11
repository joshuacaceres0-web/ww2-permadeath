import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiPut } from "@/lib/api";
import type { GameState } from "@/lib/types";
import Portrait from "@/components/Portrait";

function hashName(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export default function CommanderCard({ state }: { state: GameState | undefined }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");

  const rename = useMutation({
    mutationFn: (n: string) => apiPut<GameState>("/state/commander", { name: n }),
    onSuccess: (s) => {
      qc.setQueryData(["state"], s);
      setEditing(false);
      toast(`${s.commander_rank} ${s.commander_name} takes command.`);
    },
    onError: () => toast.error("Name must be 1–32 characters"),
  });

  if (!state) {
    return (
      <div className="border border-[#2E3628] bg-[#1A1D17] p-4 font-mono text-xs text-[#5A664F]" data-testid="commander-card">
        Commander dossier loading…
      </div>
    );
  }

  const winsInLevel = state.wins_to_next_level ? 2 - state.wins_to_next_level : 2;
  const atMax = state.commander_level >= state.commander_max_level;

  return (
    <div className="relative border border-[#5C4A1E] bg-[#1A1D17] p-4" data-testid="commander-card">
      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#C68B45]">Commanding officer — you</p>
      <div className="mt-2 flex gap-3">
        <Portrait seed={hashName(state.commander_name)} type="rifleman" level={state.commander_level * 2} size={64} />
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) rename.mutate(name.trim());
              }}
            >
              <Input
                data-testid="commander-name-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={32}
                autoFocus
                className="h-8 font-mono text-sm"
              />
              <Button data-testid="commander-name-save" size="sm" type="submit" disabled={rename.isPending}>
                SIGN
              </Button>
            </form>
          ) : (
            <button
              data-testid="commander-name-edit"
              onClick={() => {
                setName(state.commander_name);
                setEditing(true);
              }}
              className="group flex items-center gap-2 text-left"
            >
              <span className="font-heading text-xl font-bold tracking-wide text-[#F0F5EB]" data-testid="commander-name">
                {state.commander_rank} {state.commander_name}
              </span>
              <Pencil size={12} className="text-[#8D9A83] group-hover:text-[#E5A93C]" />
            </button>
          )}
          <div className="mt-1 flex items-center gap-1" data-testid="commander-level">
            {Array.from({ length: state.commander_max_level }).map((_, i) => (
              <Star
                key={i}
                size={12}
                className={i < state.commander_level ? "fill-[#E5A93C] text-[#E5A93C]" : "text-[#3A4433]"}
              />
            ))}
            <span className="ml-1 font-mono text-[10px] text-[#8D9A83]">LVL {state.commander_level}</span>
          </div>
          <div className="mt-2">
            <div className="h-1.5 bg-[#121411]">
              <div className="h-full bg-[#E5A93C]" style={{ width: atMax ? "100%" : `${(winsInLevel / 2) * 100}%` }} />
            </div>
            <p className="mt-1 font-mono text-[10px] text-[#8D9A83]" data-testid="commander-next">
              {atMax
                ? "Highest rank attained."
                : `${state.wins_to_next_level} more victor${state.wins_to_next_level === 1 ? "y" : "ies"} to promotion`}
            </p>
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5 font-mono text-[10px]">
        <div className="border border-[#2E3628] p-2" data-testid="commander-unlock-squad">
          <p className="uppercase tracking-[0.15em] text-[#8D9A83]">Squad max</p>
          <p className="text-sm text-[#E3E7DC]">{state.max_squad} max</p>
        </div>
        <div className="border border-[#2E3628] p-2" data-testid="commander-unlock-discount">
          <p className="uppercase tracking-[0.15em] text-[#8D9A83]">Hire cost</p>
          <p className="text-sm text-[#E3E7DC]">−{Math.round(state.hire_discount * 100)}%</p>
        </div>
        <div className="border border-[#2E3628] p-2" data-testid="commander-unlock-combat">
          <p className="uppercase tracking-[0.15em] text-[#8D9A83]">Leadership</p>
          <p className="text-sm text-[#E3E7DC]">+{Math.round(state.combat_bonus * 100)}% aim</p>
        </div>
      </div>
    </div>
  );
}
