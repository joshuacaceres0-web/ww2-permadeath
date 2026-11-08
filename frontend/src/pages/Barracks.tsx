import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownToLine, ArrowUpToLine, Shield, Siren } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import type { GameState, Soldier, UnitTypeId } from "@/lib/types";
import { UNIT_TYPES, rankFor } from "@/game/data";

const UNIT_ORDER: UnitTypeId[] = ["rifleman", "medic", "mg", "sniper", "at"];

function StatBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 font-mono text-[9px] uppercase tracking-[0.15em] text-[#8D9A83]">{label}</span>
      <div className="h-1 flex-1 bg-[#121411]">
        <div className="h-full bg-[#E5A93C]" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

export default function Barracks() {
  const qc = useQueryClient();
  const { data: state } = useQuery({ queryKey: ["state"], queryFn: () => apiGet<GameState>("/state"), retry: false });
  const { data: squad } = useQuery({ queryKey: ["squad"], queryFn: () => apiGet<Soldier[]>("/squad"), retry: false });

  const soldiers = squad ?? [];
  const active = soldiers.filter((s) => s.status === "active");
  const reserve = soldiers.filter((s) => s.status === "reserve");
  const emergency = soldiers.length === 0;

  const hire = useMutation({
    mutationFn: (type: UnitTypeId) => apiPost<Soldier>("/squad/hire", { type }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["squad"] });
      qc.invalidateQueries({ queryKey: ["state"] });
      toast(`${s.name} reports for duty — "${s.quirk}", ${s.hometown}`);
    },
    onError: (e) => {
      const detail =
        e instanceof ApiError && e.body && typeof e.body === "object" && "detail" in e.body
          ? String((e.body as { detail: unknown }).detail)
          : "Requisition refused";
      toast.error(detail);
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "reserve" }) =>
      apiPost<Soldier>(`/squad/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["squad"] });
    },
    onError: (e) => {
      const detail =
        e instanceof ApiError && e.body && typeof e.body === "object" && "detail" in e.body
          ? String((e.body as { detail: unknown }).detail)
          : "Assignment refused";
      toast.error(detail);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#8D9A83]">
            Replacement depot
          </p>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-[#F0F5EB]">THE BARRACKS</h1>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs">
          {emergency && (
            <Badge variant="outline" className="border-[#5C2626] font-mono text-[#E24A4A]" data-testid="emergency-badge">
              <Siren size={12} className="mr-1" /> LINE EMPTY — NEXT HIRE IS FREE
            </Badge>
          )}
          <span className="text-[#8D9A83]">
            Requisition: <span className="text-[#E5A93C]">{state ? `${state.requisition} RP` : "—"}</span>
          </span>
        </div>
      </div>

      {/* Requisition grid */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {UNIT_ORDER.map((id) => {
          const spec = UNIT_TYPES[id];
          const cost = emergency ? 0 : spec.cost;
          const affordable = state ? state.requisition >= cost : false;
          const dps = Math.round(spec.dmg / spec.fireInterval);
          return (
            <Card key={id} data-testid={`requisition-card-${id}`} className="border-[#2E3628] bg-[#1A1D17] transition-colors duration-150 hover:border-[#E5A93C]">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="font-heading text-lg tracking-wider text-[#F0F5EB]">
                      {spec.label.toUpperCase()}
                    </CardTitle>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8D9A83]">
                      {spec.role} · {spec.weapon}
                    </p>
                  </div>
                  <Badge variant="outline" className="border-[#5C4A1E] font-mono text-[#E5A93C]">
                    {cost === 0 ? "FREE" : `${spec.cost} RP`}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <StatBar label="HP" pct={(spec.hp / 130) * 100} />
                <StatBar label="Range" pct={(spec.range / 420) * 100} />
                <StatBar label="DPS" pct={(dps / 65) * 100} />
                <StatBar label="Sight" pct={(spec.vision / 420) * 100} />
                <p className="pt-1 font-mono text-[11px] leading-relaxed text-[#A2B29A]">{spec.blurb}</p>
                <p className="border border-[#2E3628] bg-[#22271E] p-2 font-mono text-[11px] leading-relaxed text-[#E3E7DC]">
                  <span className="text-[#E5A93C]">{spec.ability.name}</span> — {spec.ability.desc}
                </p>
                <Button
                  data-testid={`hire-btn-${id}`}
                  variant={affordable || emergency ? "default" : "outline"}
                  className="w-full"
                  disabled={(!affordable && !emergency) || hire.isPending}
                  onClick={() => hire.mutate(id)}
                >
                  {hire.isPending ? "PAPERWORK…" : emergency ? "CONSCRIPT — FREE" : `HIRE — ${spec.cost} RP`}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Deployment squad */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-[#2E3628] bg-[#1A1D17]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-heading text-lg tracking-wider text-[#F0F5EB]">
              <Shield size={16} className="text-[#E5A93C]" /> DEPLOYMENT SQUAD
              <span className="ml-auto font-mono text-xs text-[#8D9A83]">{active.length}/5</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {active.map((s) => (
              <SoldierRow key={s.id} s={s} onBench={() => setStatus.mutate({ id: s.id, status: "reserve" })} />
            ))}
            {squad && active.length === 0 && (
              <p className="font-mono text-xs text-[#E24A4A]">Nobody stands in the line.</p>
            )}
            {!squad && <p className="font-mono text-xs text-[#5A664F]">Roster offline…</p>}
          </CardContent>
        </Card>

        <Card className="border-[#2E3628] bg-[#1A1D17]">
          <CardHeader>
            <CardTitle className="font-heading text-lg tracking-wider text-[#F0F5EB]">
              RESERVES
              <span className="ml-2 font-mono text-xs text-[#8D9A83]">{reserve.length}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {reserve.map((s) => (
              <SoldierRow
                key={s.id}
                s={s}
                onDeploy={() => setStatus.mutate({ id: s.id, status: "active" })}
              />
            ))}
            {squad && reserve.length === 0 && (
              <p className="font-mono text-xs text-[#75826F]">Every able body is already in the line.</p>
            )}
            {!squad && <p className="font-mono text-xs text-[#5A664F]">Roster offline…</p>}
            <Link
              to="/"
              data-testid="barracks-back-btn"
              className={buttonVariants({ variant: "outline", size: "sm", className: "w-full" })}
            >
              BACK TO THE WAR ROOM
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SoldierRow({
  s,
  onBench,
  onDeploy,
}: {
  s: Soldier;
  onBench?: () => void;
  onDeploy?: () => void;
}) {
  return (
    <div
      data-testid={`soldier-card-${s.id}`}
      className="flex items-center justify-between gap-3 border border-[#2E3628] bg-[#22271E] px-3 py-2"
    >
      <div className="min-w-0">
        <p className="truncate font-mono text-[13px] font-semibold text-[#EDEDE2]">
          {rankFor(s.xp)} {s.name}
        </p>
        <p className="font-mono text-[10px] text-[#8D9A83]">
          {UNIT_TYPES[s.type].label} · "{s.quirk}" · {s.kills} kills · {s.missions} ops
        </p>
      </div>
      {onBench && (
        <Button
          data-testid={`demote-btn-${s.id}`}
          variant="outline"
          size="xs"
          onClick={onBench}
          className="shrink-0 font-mono text-[10px]"
        >
          <ArrowDownToLine size={12} className="mr-1" /> BENCH
        </Button>
      )}
      {onDeploy && (
        <Button
          data-testid={`promote-btn-${s.id}`}
          variant="outline"
          size="xs"
          onClick={onDeploy}
          className="shrink-0 border-[#E5A93C] font-mono text-[10px] text-[#E5A93C]"
        >
          <ArrowUpToLine size={12} className="mr-1" /> DEPLOY
        </Button>
      )}
    </div>
  );
}
