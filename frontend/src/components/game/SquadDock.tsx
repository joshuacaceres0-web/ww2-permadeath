import { UNIT_TYPES } from "@/game/data";
import type { HudSnapshot, HudUnit } from "@/game/engine";
import { Button } from "@/components/ui/button";

interface Props {
  hud: HudSnapshot;
  onSelect: (id: number) => void;
  onAbility: (id: number) => void;
}

function UnitCard({
  unit,
  index,
  selected,
  onSelect,
  onAbility,
}: {
  unit: HudUnit;
  index: number;
  selected: boolean;
  onSelect: (id: number) => void;
  onAbility: (id: number) => void;
}) {
  const spec = UNIT_TYPES[unit.type];
  const hpPct = Math.max(0, Math.round((unit.hp / unit.maxHp) * 100));
  const abilityReady = unit.alive && unit.abilityCd <= 0;

  return (
    <div
      data-testid={`unit-dock-card-${index}`}
      onClick={() => onSelect(unit.id)}
      className={`group relative w-44 shrink-0 cursor-pointer border px-3 py-2 text-left transition-colors duration-150 ${
        unit.alive ? "bg-[#1A1D17]" : "bg-[#15170F] opacity-60"
      } ${selected ? "border-[#4ECDC4]" : "border-[#2E3628] hover:border-[#E5A93C]"}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-[13px] font-semibold text-[#EDEDE2]">
          {index + 1} · {unit.name.split(" ").slice(-1)[0].toUpperCase()}
        </span>
        <span className="shrink-0 whitespace-nowrap font-mono text-[10px] tracking-[0.1em] text-[#E5A93C]">
          {unit.alive ? `${unit.rank.toUpperCase()} ${spec.label.slice(0, 3).toUpperCase()}` : "KIA"}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full bg-[#121411]">
        <div
          className={`h-full ${hpPct > 50 ? "bg-[#5EB872]" : hpPct > 20 ? "bg-[#E5A93C]" : "bg-[#E24A4A]"}`}
          style={{ width: `${unit.alive ? hpPct : 0}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-[#8D9A83]">
        <span data-testid={`unit-dock-hp-${index}`}>
          {unit.alive ? `${unit.hp}/${unit.maxHp}` : "—"}
        </span>
        <span className={unit.pinned ? "text-[#E24A4A]" : ""}>
          {unit.pinned ? "PINNED" : unit.kills > 0 ? `${unit.kills} KILLS` : "STABLE"}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <Button
          data-testid={`ability-btn-${index}`}
          variant="outline"
          size="xs"
          disabled={!unit.alive || !abilityReady}
          onClick={(e) => {
            e.stopPropagation();
            onAbility(unit.id);
          }}
          className={`h-5 flex-1 font-mono text-[10px] ${
            abilityReady ? "border-[#E5A93C] text-[#E5A93C]" : ""
          }`}
        >
          {unit.alive
            ? unit.abilityCd > 0
              ? `${spec.ability.name} ${Math.ceil(unit.abilityCd)}s`
              : spec.ability.name
            : "OUT OF ACTION"}
        </Button>
        {unit.orders > 0 && (
          <span className="font-mono text-[10px] text-[#4ECDC4]">{unit.orders}▸</span>
        )}
      </div>
    </div>
  );
}

export default function SquadDock({ hud, onSelect, onAbility }: Props) {
  return (
    <div className="flex gap-2 overflow-x-auto px-3 py-2" data-testid="squad-dock">
      {hud.units.map((u, i) => (
        <UnitCard
          key={u.id}
          unit={u}
          index={i}
          selected={hud.selectedIds.includes(u.id)}
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
  );
}
