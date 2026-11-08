// Field radio: spend requisition to call AI-controlled 2nd Platoon teams into the fight.
import { useState } from "react";
import { Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReinforcementKind } from "@/lib/types";

export const REINFORCEMENTS: Array<{ kind: ReinforcementKind; label: string; men: string; cost: number }> = [
  { kind: "rifle", label: "RIFLE SQUAD", men: "3 riflemen", cost: 15 },
  { kind: "heavy", label: "HEAVY TEAM", men: "MG + bazooka", cost: 25 },
];

interface Props {
  rp: number;
  left: number;
  disabled: boolean;
  pending: boolean;
  onCall: (kind: ReinforcementKind) => void;
}

export default function ReinforceMenu({ rp, left, disabled, pending, onCall }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button
        data-testid="reinforce-btn"
        variant="outline"
        size="xs"
        className="border-[#4ECDC4]/60 text-[#4ECDC4]"
        disabled={disabled || left <= 0}
        onClick={() => setOpen((o) => !o)}
      >
        <Radio size={12} className="mr-1" /> RADIO <span className="ml-1 text-[#8D9A83]">{left}/3</span>
      </Button>
      {open && !disabled && (
        <div
          data-testid="reinforce-menu"
          className="absolute right-0 top-full z-30 mt-1 w-56 border border-[#2E3628] bg-[#0D0F0C]/95 p-2 shadow-xl backdrop-blur"
        >
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-[#8D9A83]">
            Call 2nd Platoon · {rp} RP · {left} calls left
          </p>
          {REINFORCEMENTS.map((r) => (
            <button
              key={r.kind}
              data-testid={`reinforce-${r.kind}`}
              disabled={pending || rp < r.cost || left <= 0}
              onClick={() => {
                onCall(r.kind);
                setOpen(false);
              }}
              className="mb-1 flex w-full items-center justify-between border border-[#2E3628] bg-[#1A1D17] px-2 py-1.5 text-left font-mono text-[11px] text-[#E3E7DC] transition-colors duration-150 hover:border-[#4ECDC4] disabled:opacity-40"
            >
              <span>
                <span className="block font-semibold">{r.label}</span>
                <span className="block text-[9px] text-[#8D9A83]">{r.men} · AI-controlled</span>
              </span>
              <span className="text-[#E5A93C]">{r.cost} RP</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
