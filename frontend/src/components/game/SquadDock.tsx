import { UNIT_TYPES } from "@/game/data";
import type { HudSnapshot, HudUnit } from "@/game/engine";
import { Button } from "@/components/ui/button";

interface Props {
  hud: HudSnapshot;
  onSelect: (id: number) => void;
  onAbility: (id: number) => void;
  onSplit?: () => void;
  onSelectTeam?: (i: 0 | 1) => void;
  onMerge?: () => void;
}

function UnitCard({
  unit,
  index,
  selected,
  briefing,
  isLeader,
  onSelect,
  onAbility,
}: {
  unit: HudUnit;
  index: number;
  selected: boolean;
  briefing: boolean;
  isLeader: boolean;
  onSelect: (id: number) => void;
  onAbility: (id: number) => void;
}) {
  const spec = UNIT_TYPES[unit.type];
  const hpPct = Math.max(0, Math.round((unit.hp / unit.maxHp) * 100));
  // Abilities only work once the battle is running (engine.startAim
  // returns unless phase == "battle"), so a live-looking button in
  // the briefing was a no-op. Disable it there and say why.
  const abilityReady = unit.alive && unit.abilityCd <= 0 && !briefing;

  return (
    <div
      data-testid={`unit-dock-card-${index}`}
      onClick={() => onSelect(unit.id)}
      className={`group relative w-40 shrink-0 cursor-pointer border px-2.5 py-1.5 short:w-full short:px-2 short:py-1 text-left transition-colors duration-150 ${
        unit.alive ? "bg-[#0D0F0C]/85" : "bg-[#0D0F0C]/60 opacity-60"
      } ${selected ? "border-[#E5A93C]" : "border-[#2E3628] hover:border-[#E5A93C]"}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-[13px] font-semibold text-[#EDEDE2]">
          {index + 1} · {unit.name.split(" ").slice(-1)[0].toUpperCase()}
          {isLeader && (
            <span className="ml-1.5 border border-[#E5A93C] px-1 align-middle text-[9px] tracking-wider text-[#E5A93C]" title="Team leader: you drive this man. If he falls, the next most experienced man takes over.">
              ★ LEADER
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap font-mono text-[10px] tracking-[0.1em] text-[#E5A93C]">
          {unit.type === "radioman" && (
            <span className="border border-[#4ECDC4]/70 px-1 text-[9px] text-[#4ECDC4]" title="Carries the radio — no radioman, no reinforcements">
              RADIO
            </span>
          )}
          {unit.coward && unit.alive && (
            <span className="border border-[#E5A93C]/70 px-1 text-[9px] text-[#E5A93C]" title="Coward: when his morale goes he may run for the edge — if he flees, the round ends">
              COWARD
            </span>
          )}
          {unit.alive ? `${unit.rank.toUpperCase()} ${spec.label.slice(0, 3).toUpperCase()}` : "KIA"}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full bg-[#121411]">
        <div
          className={`h-full ${hpPct > 50 ? "bg-[#5EB872]" : hpPct > 20 ? "bg-[#E5A93C]" : "bg-[#E24A4A]"}`}
          style={{ width: `${unit.alive ? hpPct : 0}%` }}
        />
      </div>
      <div className="mt-0.5 h-1 w-full bg-[#121411]" data-testid={`unit-dock-morale-${index}`}>
        <div
          className={`h-full ${unit.broken ? "bg-[#3D348B]" : unit.morale > 60 ? "bg-[#56B4E8]" : unit.morale > 30 ? "bg-[#4A6FD4]" : "bg-[#9B59D0]"}`}
          style={{ width: `${unit.alive ? unit.morale : 0}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-[#8D9A83] short:hidden">
        <span data-testid={`unit-dock-hp-${index}`}>
          {unit.alive ? `${unit.hp}/${unit.maxHp}` : "—"}
        </span>
        <span className={unit.broken || unit.pinned ? "text-[#E24A4A]" : ""}>
          {unit.broken ? "BROKEN" : unit.pinned ? "PINNED" : unit.kills > 0 ? `${unit.kills} KILLS` : "STABLE"}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        {isLeader ? (
          <Button
            data-testid={`ability-btn-${index}`}
            variant="outline"
            size="xs"
            disabled={!unit.alive || !abilityReady}
            title={briefing ? "Abilities open once the assault begins" : "Leader ability: Q, or right click where it should land"}
            onClick={(e) => {
              e.stopPropagation();
              onAbility(unit.id);
            }}
            className={`h-5 flex-1 font-mono text-[10px] ${
              abilityReady ? "border-[#E5A93C] text-[#E5A93C]" : ""
            }`}
          >
            {unit.alive
              ? briefing
                ? `${spec.ability.name} — AFTER BEGIN`
                : unit.abilityCd > 0
                  ? `${spec.ability.name} ${Math.ceil(unit.abilityCd)}s`
                  : spec.ability.name
              : "OUT OF ACTION"}
          </Button>
        ) : (
          <span
            className="flex h-5 flex-1 items-center justify-center border border-[#2E3628] px-1 font-mono text-[10px] text-[#8D9A83]"
            title="AUTO: he follows the leader and uses his ability on his own judgment"
          >
            {unit.alive ? `${spec.ability.name} — AUTO` : "OUT OF ACTION"}
          </span>
        )}
        {unit.orders > 0 && (
          <span className="font-mono text-[10px] text-[#4ECDC4]">{unit.orders}▸</span>
        )}
      </div>
    </div>
  );
}

export default function SquadDock({ hud, onSelect, onAbility }: Props) {
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2 short:px-1.5 short:py-1.5">
    <div className="flex gap-2 overflow-x-auto short:h-full short:flex-col short:gap-1 short:overflow-y-auto" data-testid="squad-dock">
      {hud.units.map((u, i) => (
        <UnitCard
          key={u.id}
          unit={u}
          index={i}
          selected={hud.selectedIds.includes(u.id)}
          briefing={hud.briefing}
          isLeader={hud.leaderId === u.id}
          onSelect={onSelect}
          onAbility={onAbility}
        />
      ))}
      {hud.units.length === 0 && (
        <div className="px-3 py-4 font-mono text-xs text-[#8D9A83]">
          No men in the deployment squad — hire in the barracks.
        </div>
      )}
    </div>
    </div>
  );
}
