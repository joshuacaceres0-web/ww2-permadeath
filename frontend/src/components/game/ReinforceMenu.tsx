// Field radio: spend requisition to call AI-controlled 2nd Platoon teams
// into the fight, and call in radio support from a living radioman.
// Eight calls, one per commander level (2nd Lt. to Maj. Gen.):
// Rally Call 1, reinforcements 2, supply drop 3, air recon 4, mortar
// strike 5, smoke screen 6, artillery 7, tank support 8. Every call
// needs the radio up, and a locked call shows the level it needs.
// Support is player-called from this menu (AUTO never calls it).
// The dropdown opens toward the screen (placement prop: the corner
// cluster sits at the bottom edge, so its menu opens UP — opening
// down put the whole list off the bottom of the screen, Josh,
// 2026-11-13) and the calls list scrolls inside it (wheel and
// touch drag) so every call stays reachable on a short screen.
import { useState } from "react";
import { Radio } from "lucide-react";
import type { ReinforcementKind } from "@/lib/types";
import type { RadioSupportKind, SupportCd } from "@/game/engine";
import { ARTILLERY_CD, SUPPLY_CD, RECON_CD, MORTAR_CD, SMOKE_CD, RADIO_CALL_LEVEL } from "@/game/engine";
import { PANEL_BTN, PANEL_LABEL, PANEL_SOLID } from "@/components/game/panel";

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
  /** Rally Call: free, local to the radioman's own ability. */
  onRally: () => void;
  /** Which way the dropdown opens. The corner cluster hugs the
   * bottom edge of the screen, so it opens "up"; the touch row
   * and the Esc menu open "down". */
  placement?: "up" | "down";
  /** Which edge of the button the dropdown hangs from. The
   * touch row sits at the left edge, so it hangs "left". */
  align?: "left" | "right";
}

export default function ReinforceMenu({ rp, left, disabled, pending, radioLive, commanderLevel, supportCd, tankUsed, supportCost, reinforceCost, onCall, onSupport, onRally, placement = "down", align = "right" }: Props) {
  const [open, setOpen] = useState(false);
  const reinforcementsLocked = commanderLevel < RADIO_CALL_LEVEL.reinforce;
  const rallyLocked = commanderLevel < RADIO_CALL_LEVEL.rally;
  const rallyCd = supportCd.rally ?? 0;
  const menuPos = `${placement === "up" ? "bottom-full mb-1" : "top-full mt-1"} ${align === "left" ? "left-0" : "right-0"}`;
  return (
    <div className="relative">
      <button
        data-testid="reinforce-btn"
        className={`flex items-center px-2 py-1.5 text-[10px] ${PANEL_BTN}`}
        disabled={disabled || !radioLive}
        title={!radioLive ? "Radio is down — no radioman in the squad. Hire one in the Barracks." : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Radio size={12} className="mr-1 text-[#4ECDC4]" /> <span className="text-[#4ECDC4]">{radioLive ? "RADIO" : "NO RADIOMAN"}</span>{" "}
        <span className="ml-1 text-[#8D9A83]">{left}/3</span>
      </button>
      {open && !disabled && radioLive && (
        <div
          data-testid="reinforce-menu"
          className={`absolute z-30 flex max-h-[min(72vh,30rem)] w-64 flex-col p-2 ${menuPos} ${PANEL_SOLID}`}
        >
          <p className={`mb-1.5 shrink-0 ${PANEL_LABEL}`}>
            Radio support · LVL {commanderLevel} · {rp} RP · {left} calls left
          </p>
          <div
            data-testid="reinforce-menu-scroll"
            className="min-h-0 overflow-y-auto overscroll-contain pr-0.5"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            <p className={`mb-1.5 ${PANEL_LABEL}`}>
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
                className="mb-1 flex w-full items-center justify-between border border-[#2E3628] bg-[#0D0F0C]/60 px-2 py-1.5 text-left font-mono text-[11px] text-[#E3E7DC] transition-colors duration-150 hover:border-[#4ECDC4] disabled:opacity-40"
              >
                <span>
                  <span className="block font-semibold">{r.label}</span>
                  <span className="block text-[9px] text-[#8D9A83]">{r.men} · AI-controlled</span>
                </span>
                <span className="text-[#E5A93C]">{reinforcementsLocked ? "LVL 2" : `${reinforceCost[r.kind]} RP`}</span>
              </button>
            ))}
            <p className={`mb-1.5 mt-2 ${PANEL_LABEL}`}>
              Radio support · needs a living radioman
            </p>
            <button
              data-testid="radio-rally"
              disabled={rallyLocked || rallyCd > 0}
              onClick={() => {
                onRally();
                setOpen(false);
              }}
              className="mb-1 flex w-full items-center justify-between border border-[#2E3628] bg-[#0D0F0C]/60 px-2 py-1.5 text-left font-mono text-[11px] text-[#E3E7DC] transition-colors duration-150 hover:border-[#E5A93C] disabled:opacity-40"
            >
              <span>
                <span className="block font-semibold">RALLY CALL</span>
                <span className="block text-[9px] text-[#8D9A83]">Radioman steadies nearby men, +15 morale</span>
              </span>
              <span className="text-[#E5A93C]">{rallyLocked ? `LVL ${RADIO_CALL_LEVEL.rally}` : rallyCd > 0 ? `${rallyCd}s` : "FREE"}</span>
            </button>
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
                  className="mb-1 flex w-full items-center justify-between border border-[#2E3628] bg-[#0D0F0C]/60 px-2 py-1.5 text-left font-mono text-[11px] text-[#E3E7DC] transition-colors duration-150 hover:border-[#E5A93C] disabled:opacity-40"
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
        </div>
      )}
    </div>
  );
}
