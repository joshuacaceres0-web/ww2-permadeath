import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownToLine, ArrowUpToLine, Shield, Siren, Snowflake } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import type { GameState, Soldier, UnitTypeId } from "@/lib/types";
import { RANKS, UNIT_TYPES, levelBonus } from "@/game/data";
import Portrait from "@/components/Portrait";
import { MedalList, RibbonRack } from "@/components/Medals";

const UNIT_ORDER: UnitTypeId[] = ["rifleman", "medic", "mg", "sniper", "at"];

const errDetail = (e: unknown, fallback: string) =>
  e instanceof ApiError && e.body && typeof e.body === "object" && "detail" in e.body
    ? String((e.body as { detail: unknown }).detail)
    : fallback;

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
  const [dossier, setDossier] = useState<Soldier | null>(null);
  const { data: state } = useQuery({ queryKey: ["state"], queryFn: () => apiGet<GameState>("/state"), retry: false });
  const { data: squad } = useQuery({ queryKey: ["squad"], queryFn: () => apiGet<Soldier[]>("/squad"), retry: false });

  const soldiers = squad ?? [];
  const active = soldiers.filter((s) => s.status === "active");
  const reserve = soldiers.filter((s) => s.status === "reserve");
  const emergency = squad !== undefined && soldiers.length === 0;
  const maxSquad = state?.max_squad ?? 5;

  const hire = useMutation({
    mutationFn: (type: UnitTypeId) => apiPost<Soldier>("/squad/hire", { type }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["squad"] });
      qc.invalidateQueries({ queryKey: ["state"] });
      toast(`${s.rank} ${s.name} reports for duty — "${s.quirk}", ${s.hometown}`);
    },
    onError: (e) => toast.error(errDetail(e, "Requisition refused")),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "reserve" }) =>
      apiPost<Soldier>(`/squad/${id}/status`, { status }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["squad"] });
      toast(s.status === "reserve" ? `${s.name} sent to the reserve — frozen, safe from the line` : `${s.name} is back in the line`);
    },
    onError: (e) => toast.error(errDetail(e, "Assignment refused")),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#8D9A83]">Replacement depot</p>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-[#F0F5EB]">THE BARRACKS</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
          {emergency && (
            <Badge variant="outline" className="border-[#5C2626] font-mono text-[#E24A4A]" data-testid="emergency-badge">
              <Siren size={12} className="mr-1" /> LINE EMPTY — NEXT HIRE IS FREE
            </Badge>
          )}
          {state && state.hire_discount > 0 && (
            <Badge variant="outline" className="border-[#2C3B24] font-mono text-[#5EB872]" data-testid="hire-discount-badge">
              {state.commander_rank} PULL: −{Math.round(state.hire_discount * 100)}% ON HIRES
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
          const price = state?.hire_costs[id] ?? spec.cost;
          const cost = emergency ? 0 : price;
          const affordable = state ? state.requisition >= cost : false;
          const dps = Math.round(spec.dmg / spec.fireInterval);
          return (
            <Card key={id} data-testid={`requisition-card-${id}`} className="border-[#2E3628] bg-[#1A1D17] transition-colors duration-150 hover:border-[#E5A93C]">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="font-heading text-lg tracking-wider text-[#F0F5EB]">{spec.label.toUpperCase()}</CardTitle>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8D9A83]">
                      {spec.role} · {spec.weapon}
                    </p>
                  </div>
                  <Badge variant="outline" className="border-[#5C4A1E] font-mono text-[#E5A93C]" data-testid={`hire-cost-${id}`}>
                    {cost === 0 ? "FREE" : `${price} RP`}
                    {cost > 0 && price < spec.cost && <s className="ml-1 text-[#8D9A83]">{spec.cost}</s>}
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
                  {hire.isPending ? "PAPERWORK…" : emergency ? "CONSCRIPT — FREE" : `HIRE — ${price} RP`}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-[#2E3628] bg-[#1A1D17]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-heading text-lg tracking-wider text-[#F0F5EB]">
              <Shield size={16} className="text-[#E5A93C]" /> DEPLOYMENT SQUAD
              <span className="ml-auto font-mono text-xs text-[#8D9A83]" data-testid="squad-capacity">
                {active.length}/{maxSquad}
              </span>
            </CardTitle>
            <p className="font-mono text-[10px] text-[#8D9A83]">
              These men fight the next operation. Survive it and each is promoted — sharper aim, faster reactions.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {active.map((s) => (
              <SoldierRow
                key={s.id}
                s={s}
                onOpen={() => setDossier(s)}
                onBench={() => setStatus.mutate({ id: s.id, status: "reserve" })}
              />
            ))}
            {squad && active.length === 0 && <p className="font-mono text-xs text-[#E24A4A]">Nobody stands in the line.</p>}
            {!squad && <p className="font-mono text-xs text-[#5A664F]">Roster offline…</p>}
          </CardContent>
        </Card>

        <Card className="border-[#2E3628] bg-[#141A1C]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-heading text-lg tracking-wider text-[#F0F5EB]">
              <Snowflake size={16} className="text-[#4ECDC4]" /> RESERVE — FROZEN
              <span className="ml-auto font-mono text-xs text-[#8D9A83]">{reserve.length}</span>
            </CardTitle>
            <p className="font-mono text-[10px] text-[#8D9A83]">
              Safe from the line. Reserve men gain no experience and no promotions until they are redeployed.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {reserve.map((s) => (
              <SoldierRow
                key={s.id}
                s={s}
                frozen
                onOpen={() => setDossier(s)}
                onDeploy={() => setStatus.mutate({ id: s.id, status: "active" })}
                deployDisabled={active.length >= maxSquad}
              />
            ))}
            {squad && reserve.length === 0 && (
              <p className="font-mono text-xs text-[#75826F]">The reserve is empty. Bench a veteran to keep him safe.</p>
            )}
            {!squad && <p className="font-mono text-xs text-[#5A664F]">Roster offline…</p>}
            <Link to="/" data-testid="barracks-back-btn" className={buttonVariants({ variant: "outline", size: "sm", className: "w-full" })}>
              BACK TO THE WAR ROOM
            </Link>
          </CardContent>
        </Card>
      </div>

      <Dialog open={dossier !== null} onOpenChange={(o) => !o && setDossier(null)}>
        <DialogContent className="max-w-lg border-[#2E3628] bg-[#1A1D17]" data-testid="soldier-dossier">
          {dossier && <Dossier s={dossier} commanderBonus={state?.combat_bonus ?? 0} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Dossier({ s, commanderBonus }: { s: Soldier; commanderBonus: number }) {
  const spec = UNIT_TYPES[s.type];
  const now = levelBonus(s.level, commanderBonus);
  const base = levelBonus(0, 0);
  const aimGain = Math.round((1 - now.spreadMult) * 100);
  const reactGain = Math.round((1 - now.reaction / base.reaction) * 100);
  return (
    <>
      <DialogHeader>
        <div className="flex gap-4">
          <Portrait seed={s.portrait_seed} type={s.type} level={s.level} size={88} testid="dossier-portrait" />
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8D9A83]">
              Service record · {s.status === "reserve" ? "Reserve (frozen)" : "Deployed"}
            </p>
            <DialogTitle className="font-heading text-2xl font-bold tracking-tight text-[#F0F5EB]">
              {s.rank} {s.name}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs text-[#E5A93C]">
              {spec.label} · {s.unit || "Replacement depot"}
            </DialogDescription>
            <p className="mt-1 font-mono text-[11px] text-[#8D9A83]">
              "{s.quirk}" · {s.hometown} · {s.kills} kills · {s.missions} ops
            </p>
          </div>
        </div>
      </DialogHeader>

      <div className="space-y-3">
        <div className="flex gap-1" data-testid="dossier-rank-ladder">
          {RANKS.map((r, i) => (
            <div
              key={r}
              className={`flex-1 border px-1 py-1 text-center font-mono text-[9px] ${
                i < s.level
                  ? "border-[#5C4A1E] bg-[#2A2210] text-[#C68B45]"
                  : i === s.level
                    ? "border-[#E5A93C] bg-[#3A2B0E] text-[#FFD97D]"
                    : "border-[#2E3628] text-[#5A664F]"
              }`}
            >
              {r}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 font-mono text-xs">
          <div className="border border-[#2E3628] p-2">
            <p className="text-[9px] uppercase tracking-[0.2em] text-[#8D9A83]">Aim</p>
            <p className="text-[#5EB872]" data-testid="dossier-aim">+{aimGain}% tighter</p>
          </div>
          <div className="border border-[#2E3628] p-2">
            <p className="text-[9px] uppercase tracking-[0.2em] text-[#8D9A83]">Response time</p>
            <p className="text-[#5EB872]" data-testid="dossier-reaction">
              {now.reaction.toFixed(2)}s ({reactGain > 0 ? `−${reactGain}%` : "rookie"})
            </p>
          </div>
        </div>
        <div className="border border-[#2E3628] p-2">
          <p className="mb-1.5 text-[9px] font-mono uppercase tracking-[0.2em] text-[#8D9A83]">Decorations</p>
          <MedalList medals={s.medals ?? []} testid="dossier-medals" />
        </div>
        <p className="font-mono text-[12px] leading-relaxed text-[#B9C2B3]" data-testid="dossier-backstory">
          {s.backstory}
        </p>
      </div>
    </>
  );
}

function SoldierRow({
  s,
  frozen,
  onOpen,
  onBench,
  onDeploy,
  deployDisabled,
}: {
  s: Soldier;
  frozen?: boolean;
  onOpen: () => void;
  onBench?: () => void;
  onDeploy?: () => void;
  deployDisabled?: boolean;
}) {
  return (
    <div
      data-testid={`soldier-card-${s.id}`}
      className={`flex items-center justify-between gap-3 border px-2.5 py-2 ${
        frozen ? "border-[#24363A] bg-[#18222A]" : "border-[#2E3628] bg-[#22271E]"
      }`}
    >
      <button onClick={onOpen} className="flex min-w-0 items-center gap-3 text-left" data-testid={`open-dossier-${s.id}`}>
        <Portrait
          seed={s.portrait_seed}
          type={s.type}
          level={s.level}
          size={40}
          className={frozen ? "opacity-80 saturate-50" : ""}
        />
        <span className="min-w-0">
          <span className="block truncate font-mono text-[13px] font-semibold text-[#EDEDE2]">
            {s.rank} {s.name}
          </span>
          <span className="block truncate font-mono text-[10px] text-[#8D9A83]">
            {UNIT_TYPES[s.type].label} · "{s.quirk}" · {s.kills} kills · {s.missions} ops
            {frozen && <span className="text-[#4ECDC4]"> · FROZEN</span>}
          </span>
          <RibbonRack medals={s.medals ?? []} testid={`soldier-ribbons-${s.id}`} />
        </span>
      </button>
      {onBench && (
        <Button data-testid={`demote-btn-${s.id}`} variant="outline" size="xs" onClick={onBench} className="shrink-0 font-mono text-[10px]">
          <ArrowDownToLine size={12} className="mr-1" /> RESERVE
        </Button>
      )}
      {onDeploy && (
        <Button
          data-testid={`promote-btn-${s.id}`}
          variant="outline"
          size="xs"
          onClick={onDeploy}
          disabled={deployDisabled}
          className="shrink-0 border-[#E5A93C] font-mono text-[10px] text-[#E5A93C]"
        >
          <ArrowUpToLine size={12} className="mr-1" /> DEPLOY
        </Button>
      )}
    </div>
  );
}
