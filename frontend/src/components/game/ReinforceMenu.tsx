// Field radio: spend requisition to call AI-controlled 2nd Platoon teams
// into the fight, and call in radio support from a living radioman.
// Eight calls, one per commander level (2nd Lt. to Maj. Gen.):
// Rally Call 1, reinforcements 2, supply drop 3, air recon 4, mortar
// strike 5, smoke screen 6, artillery 7, tank support 8. Every call
// needs the radio up, and a locked call shows the level it needs.
// Support is player-called from this menu (AUTO never calls it).
import { useState } from "react";
import { Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReinforcementKind } from "@/lib/types";
import type { RadioSupportKind, SupportCd } from "@/game/engine";
import { ARTILLERY_CD, SUPPLY_CD, RECON_CD, MORTAR_CD, SMOKE_CD, RADIO_CALL_LEVEL } from "@/game/engine";

export const REINFORCEMENTS: Array<{ kind: ReinforcementKind; label: string; men: string; cost: number }> = [
  { kind: "rifle", label: "RIFLE SQUAD", men: "3 riflemen", cost: 15 },
  { kind: "heavy", label: "HEAVY TEAM", men: "MG + bazooka", cost: 25 },
];

export const RADIO_SUPPORT: Array<{
  kind: RadioSupportKind;
  label: string;
  detail: string;
  cd: number;
  /** Commander level that unlocks this call. */
  level: number;
  /** Once per battle (the tank), not a cooldown. */
  once?: boolean;
}> = [
  { kind: "supply", label: "SUPPLY DROP", detail: "Field dressing +50 HP, worst-wounded man", cd: SUPPLY_CD, level: RADIO_CALL_LEVEL.supply },
  { kind: "recon", label: "AIR RECON", detail: "Spotter flight lifts the fog over the enemy", cd: RECON_CD, level: RADIO_CALL_LEVEL.recon },
  { kind: "mortar", label: "MORTAR STRIKE", detail: "1 shell on the biggest enemy group", cd: MORTAR_CD, level: RADIO_CALL_LEVEL.mortar },
  { kind: "smoke", label: "SMOKE SCREEN", detail: "Smoke over the squad, blocks enemy fire 20s", cd: SMOKE_CD, level: RADIO_CALL_LEVEL.smoke },
  { kind: "artillery", label: "ARTILLERY", detail: "3 shells on the biggest enemy group", cd: ARTILLERY_CD, level: RADIO_CALL_LEVEL.artillery },
  { kind: "tank", label: "TANK SUPPORT", detail: "M4 Sherman rolls in, once per battle", cd: 0, level: RADIO_CALL_LEVEL.tank, once: true },
];

interface Props {
  rp: number;
  left: number;
  disabled: boolean;
  pending: boolean;
  /** False when no squad radioman is alive: the radio is down. */
  radioLive: boolean;
  /** Commander level (1-8) — gates the calls, one per level. */
  commanderLevel: number;
  /** Seconds left on each radio support call-in (0 = ready). */
  supportCd: SupportCd;
  /** True once the tank has been called this battle. */
  tankUsed: boolean;
  /** What each radio support call costs right now, at the living
   * radioman's level (a rookie pays full cost, a veteran pays less). */
  supportCost: Record<RadioSupportKind, number>;
  /** What the two reinforcement teams cost right now, same discount. */
  reinforceCost: { rifle: number; heavy: number };
  onCall: (kind: ReinforcementKind) => void;
  onSupport: (kind: RadioSupportKind) => void;
}

export default function ReinforceMenu({ rp, left, disabled, pending, radioLive, commanderLevel, supportCd, tankUsed, supportCost, reinforceCost, onCall, onSupport }: Props) {
  const [open, setOpen] = useState(false);
  const reinforcementsLocked = commanderLevel < RADIO_CALL_LEVEL.reinforce;
  return (
    <div className="relative">
      <Button
        data-testid="reinforce-btn"
        variant="outline"
        size="xs"
        className="border-[#4ECDC4]/60 text-[#4ECDC4]"
        disabled={disabled || !radioLive}
        title={!radioLive ? "Radio is down — no radioman in the squad. Hire one in the Barracks." : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Radio size={12} className="mr-1" /> {radioLive ? "RADIO" : "NO RADIOMAN"}{" "}
        <span className="ml-1 text-[#8D9A83]">{left}/3</span>
      </Button>
      {open && !disabled && radioLive && (
        <div
          data-testid="reinforce-menu"
          className="absolute right-0 top-full z-30 mt-1 w-64 border border-[#2E3628] bg-[#0D0F0C]/95 p-2 shadow-xl backdrop-blur"
        >
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-[#8D9A83]">
            Radio support · LVL {commanderLevel} · {rp} RP · {left} calls left
          </p>
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-[#8D9A83]">
            Call 2nd Platoon {reinforcementsLocked ? "· LVL 2 to unlock" : ""}
          </p>
          {REINFORCEMENTS.map((r) => (
            <button
              key={r.kind}
              data-testid={`reinforce-${r.kind}`}
              disabled={pending || rp < reinforceCost[r.kind] || left <= 0 || reinforcementsLocked}
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
              <span className="text-[#E5A93C]">{reinforcementsLocked ? "LVL 2" : `${reinforceCost[r.kind]} RP`}</span>
            </button>
          ))}
          <p className="mb-1.5 mt-2 font-mono text-[9px] uppercase tracking-[0.2em] text-[#8D9A83]">
            Radio support · needs a living radioman
          </p>
          {RADIO_SUPPORT.map((r) => {
            const cd = supportCd[r.kind];
            const cost = supportCost[r.kind];
            const locked = commanderLevel < r.level;
            const used = r.once && tankUsed;
            const broke = rp < cost;
            const label = locked ? `LVL ${r.level}` : used ? "USED" : r.once ? `${cost} RP` : cd > 0 ? `${cd}s` : `${cost} RP`;
            return (
              <button
                key={r.kind}
                data-testid={`radio-support-${r.kind}`}
                disabled={locked || used || cd > 0 || broke}
                onClick={() => {
                  onSupport(r.kind);
                  setOpen(false);
                }}
                className="mb-1 flex w-full items-center justify-between border border-[#2E3628] bg-[#1A1D17] px-2 py-1.5 text-left font-mono text-[11px] text-[#E3E7DC] transition-colors duration-150 hover:border-[#E5A93C] disabled:opacity-40"
              >
                <span>
                  <span className="block font-semibold">{r.label}</span>
                  <span className="block text-[9px] text-[#8D9A83]">{r.detail}</span>
                </span>
                <span className="text-[#E5A93C]">{label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
