import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownToLine, ArrowUpToLine, Package, Shield, Siren, Snowflake } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import type { GameState, Soldier, UnitTypeId } from "@/lib/types";
import { EQUIP_SLOTS, GUN_DEFS, ITEM_BY_ID, ITEM_DEFS, RANKS, UNIT_TYPES, UPGRADE_CAP, UPGRADE_COST, UPGRADE_TRACKS, isCowardQuirk, levelBonus } from "@/game/data";

const gunLine = (id: string) => {
  const g = GUN_DEFS[id];
  return g ? `DMG ${g.dmg} · RNG ${g.range} · MAG ${g.magSize} · RLD ${g.reloadTime}s` : null;
};
import Portrait from "@/components/Portrait";
import { MedalList, RibbonRack } from "@/components/Medals";
import { useMusic } from "@/game/music";

const UNIT_ORDER: UnitTypeId[] = ["rifleman", "medic", "mg", "sniper", "at", "radioman", "recon", "engineer"];

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
  useMusic("barracks"); // Swing in the Barracks v2, looped; stops on leaving.
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

  const upgrade = useMutation({
    mutationFn: ({ id, track }: { id: string; track: string }) =>
      apiPost<Soldier>("/squad/upgrade", { soldier_id: id, track }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["squad"] });
      toast(`${s.name} trains up — the upgrade is his for life.`);
    },
    onError: (e) => toast.error(errDetail(e, "Training refused")),
  });

  const equip = useMutation({
    mutationFn: ({ id, item }: { id: string; item: string }) =>
      apiPost<Soldier>("/squad/equip", { soldier_id: id, item }),
    onSuccess: (_s, v) => {
      qc.invalidateQueries({ queryKey: ["squad"] });
      qc.invalidateQueries({ queryKey: ["state"] });
      toast(`${ITEM_BY_ID[v.item]?.label ?? v.item} issued.`);
    },
    onError: (e) => toast.error(errDetail(e, "Issue refused")),
  });

  const unequip = useMutation({
    mutationFn: ({ id, item }: { id: string; item: string }) =>
      apiPost<Soldier>("/squad/unequip", { soldier_id: id, item }),
    onSuccess: (_s, v) => {
      qc.invalidateQueries({ queryKey: ["squad"] });
      qc.invalidateQueries({ queryKey: ["state"] });
      toast(`${ITEM_BY_ID[v.item]?.label ?? v.item} back in stores.`);
    },
    onError: (e) => toast.error(errDetail(e, "Return refused")),
  });

  const buyItem = useMutation({
    mutationFn: (item: string) => apiPost<GameState>("/inventory/buy", { item }),
    onSuccess: (_s, item) => {
      qc.invalidateQueries({ queryKey: ["state"] });
      toast(`${ITEM_BY_ID[item]?.label ?? item} added to stores.`);
    },
    onError: (e) => toast.error(errDetail(e, "Purchase refused")),
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
            {!squad && <p className="font-mono text-xs text-[#5A664F]">Roster loading…</p>}
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
            {!squad && <p className="font-mono text-xs text-[#5A664F]">Roster loading…</p>}
            <Link to="/war-room" data-testid="barracks-back-btn" className={buttonVariants({ variant: "outline", size: "sm", className: "w-full" })}>
              BACK TO THE WAR ROOM
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Squad stores (Barracks update) */}
      <Card className="border-[#2E3628] bg-[#1A1D17]" data-testid="stores-panel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-heading text-lg tracking-wider text-[#F0F5EB]">
            <Package size={16} className="text-[#E5A93C]" /> SQUAD STORES
            <span className="ml-auto font-mono text-xs text-[#8D9A83]" data-testid="stores-total">
              {Object.values(state?.inventory ?? {}).reduce((n, c) => n + c, 0)} pieces
            </span>
          </CardTitle>
          <p className="font-mono text-[10px] leading-relaxed text-[#8D9A83]">
            Gear and earned headgear: found in battlefield crates, awarded for victories, or bought with requisition. Guns are loot only, found and never sold, and a carried gun replaces a man's class weapon while he has it.
            Open a man's dossier to issue him up to {EQUIP_SLOTS} pieces. Stores belong to the squad: what sits here survives.
            What a man carries into battle is lost with him if he falls — his gear, his upgrades, all of it.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {ITEM_DEFS.map((d) => {
              const count = state?.inventory?.[d.id] ?? 0;
              const affordable = state ? state.requisition >= d.price : false;
              return (
                <div key={d.id} className="flex flex-col border border-[#2E3628] bg-[#22271E] p-2.5" data-testid={`store-item-${d.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-mono text-xs font-semibold text-[#EDEDE2]">{d.label}</p>
                    <Badge variant="outline" className="shrink-0 border-[#5C4A1E] font-mono text-[9px] text-[#E5A93C]">
                      {d.kind === "gun" ? "GUN" : d.kind === "headgear" ? "HEADGEAR" : "GEAR"}
                    </Badge>
                  </div>
                  <p className="mt-1 flex-1 font-mono text-[10px] leading-relaxed text-[#A2B29A]">{d.blurb}</p>
                  {gunLine(d.id) && (
                    <p className="mt-1 font-mono text-[10px] text-[#E5A93C]" data-testid={`gun-stats-${d.id}`}>{gunLine(d.id)}</p>
                  )}
                  {d.restrict && (
                    <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.15em] text-[#75826F]">
                      {d.restrict.map((t) => UNIT_TYPES[t].label).join(" / ")} only
                    </p>
                  )}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] text-[#8D9A83]" data-testid={`store-count-${d.id}`}>
                      IN STORES: <span className={count > 0 ? "text-[#5EB872]" : "text-[#75826F]"}>{count}</span>
                    </span>
                    {d.kind === "gun" ? (
                      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#C68B45]" data-testid={`found-only-${d.id}`}>
                        Found only
                      </span>
                    ) : (
                      <Button
                        data-testid={`buy-btn-${d.id}`}
                        variant={affordable ? "default" : "outline"}
                        size="xs"
                        className="font-mono text-[10px]"
                        disabled={!affordable || buyItem.isPending}
                        onClick={() => buyItem.mutate(d.id)}
                      >
                        BUY — {d.price} RP
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dossier !== null} onOpenChange={(o) => !o && setDossier(null)}>
        <DialogContent className="max-w-lg border-[#2E3628] bg-[#1A1D17]" data-testid="soldier-dossier">
          {dossier && (
            <Dossier
              s={soldiers.find((x) => x.id === dossier.id) ?? dossier}
              commanderBonus={state?.combat_bonus ?? 0}
              inventory={state?.inventory ?? {}}
              busy={upgrade.isPending || equip.isPending || unequip.isPending}
              onUpgrade={(track) => upgrade.mutate({ id: dossier.id, track })}
              onEquip={(item) => equip.mutate({ id: dossier.id, item })}
              onUnequip={(item) => unequip.mutate({ id: dossier.id, item })}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Dossier({
  s,
  commanderBonus,
  inventory,
  busy,
  onUpgrade,
  onEquip,
  onUnequip,
}: {
  s: Soldier;
  commanderBonus: number;
  inventory: Record<string, number>;
  busy: boolean;
  onUpgrade: (track: string) => void;
  onEquip: (item: string) => void;
  onUnequip: (item: string) => void;
}) {
  const spec = UNIT_TYPES[s.type];
  const now = levelBonus(s.level, commanderBonus);
  const base = levelBonus(0, 0);
  const aimGain = Math.round((1 - now.spreadMult) * 100);
  const reactGain = Math.round((1 - now.reaction / base.reaction) * 100);
  return (
    <>
      <DialogHeader>
        <div className="flex gap-4">
          <Portrait seed={s.portrait_seed} type={s.type} level={s.level} size={88} testid="dossier-portrait" equipment={s.equipment} />
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
            {isCowardQuirk(s.quirk) && (
              <p className="mt-1 font-mono text-[11px] text-[#E5A93C]" data-testid="dossier-coward-warning">
                Coward: when his morale goes he may run for the edge. If he flees, the round ends — bench him if you cannot afford that.
              </p>
            )}
          </div>
        </div>
      </DialogHeader>

      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-1 sm:grid-cols-7" data-testid="dossier-rank-ladder">
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

        <div className="border border-[#2E3628] p-2" data-testid="dossier-upgrades">
          <div className="mb-1.5 flex items-baseline justify-between">
            <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#8D9A83]">Field upgrades — his own, earned in battle</p>
            <p className="font-mono text-[11px] text-[#E5A93C]" data-testid="dossier-points">
              {s.points} pts
            </p>
          </div>
          <div className="space-y-1">
            {UPGRADE_TRACKS.map((t) => {
              const lvl = s.upgrades?.[t.id] ?? 0;
              const capped = lvl >= UPGRADE_CAP;
              const canTrain = !capped && s.points >= UPGRADE_COST && !busy;
              return (
                <div key={t.id} className="flex items-center gap-2 font-mono text-[11px]" data-testid={`upgrade-row-${t.id}`}>
                  <span className="w-24 shrink-0 text-[#E3E7DC]">{t.label}</span>
                  <span className="flex gap-0.5">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className={`inline-block h-2 w-3 ${i < lvl ? "bg-[#E5A93C]" : "bg-[#2E3628]"}`} />
                    ))}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[10px] text-[#8D9A83]">{t.per}</span>
                  <Button
                    data-testid={`upgrade-btn-${t.id}`}
                    variant="outline"
                    size="xs"
                    className="shrink-0 font-mono text-[9px]"
                    disabled={!canTrain}
                    onClick={() => onUpgrade(t.id)}
                  >
                    {capped ? "MAX" : `TRAIN — ${UPGRADE_COST}`}
                  </Button>
                </div>
              );
            })}
          </div>
          <p className="mt-1.5 font-mono text-[9px] leading-relaxed text-[#75826F]">
            2 points for surviving a battle, 1 more per 2 kills, up to 4 a battle. Upgrades die with the man.
          </p>
        </div>

        <div className="border border-[#2E3628] p-2" data-testid="dossier-equipment">
          <p className="mb-1.5 text-[9px] font-mono uppercase tracking-[0.2em] text-[#8D9A83]">
            Carried — {s.equipment?.length ?? 0} of {EQUIP_SLOTS} slots
          </p>
          <div className="space-y-1">
            {(s.equipment ?? []).map((item) => (
              <div key={item} className="flex items-center justify-between gap-2 border border-[#5C4A1E] bg-[#2A2210] px-2 py-1 font-mono text-[11px]" data-testid={`carried-${item}`}>
                <span className="text-[#FFD97D]">{ITEM_BY_ID[item]?.label ?? item}</span>
                <Button
                  data-testid={`unequip-btn-${item}`}
                  variant="outline"
                  size="xs"
                  className="font-mono text-[9px]"
                  disabled={busy}
                  onClick={() => onUnequip(item)}
                >
                  RETURN
                </Button>
              </div>
            ))}
            {Array.from({ length: Math.max(0, EQUIP_SLOTS - (s.equipment?.length ?? 0)) }).map((_, i) => (
              <div key={i} className="border border-dashed border-[#2E3628] px-2 py-1 font-mono text-[10px] text-[#5A664F]">
                Empty slot
              </div>
            ))}
          </div>
          <p className="mb-1 mt-2 text-[9px] font-mono uppercase tracking-[0.2em] text-[#8D9A83]">From stores</p>
          <div className="space-y-1">
            {ITEM_DEFS.filter((d) => (inventory[d.id] ?? 0) > 0).map((d) => {
              const carried = (s.equipment ?? []).includes(d.id);
              const restricted = d.restrict ? !d.restrict.includes(s.type) : false;
              const full = (s.equipment?.length ?? 0) >= EQUIP_SLOTS;
              const gunClash = d.kind === "gun" && (s.equipment ?? []).some((x) => ITEM_BY_ID[x]?.kind === "gun");
              const headClash = d.kind === "headgear" && (s.equipment ?? []).some((x) => ITEM_BY_ID[x]?.kind === "headgear");
              const reason = carried ? "Carried" : restricted ? `${d.restrict!.map((t) => UNIT_TYPES[t].label).join(" / ")} only` : gunClash ? "Carries a gun" : headClash ? "Wears headgear" : full ? "Slots full" : null;
              return (
                <div key={d.id} className="flex items-center justify-between gap-2 font-mono text-[11px]">
                  <span className="min-w-0 truncate text-[#E3E7DC]">
                    {d.label} <span className="text-[#75826F]">× {inventory[d.id]}</span>
                    {gunLine(d.id) && <span className="block text-[9px] text-[#8D9A83]">{gunLine(d.id)}</span>}
                  </span>
                  <Button
                    data-testid={`equip-btn-${d.id}`}
                    variant="outline"
                    size="xs"
                    className="shrink-0 font-mono text-[9px]"
                    disabled={busy || reason !== null}
                    onClick={() => onEquip(d.id)}
                  >
                    {reason ?? "ISSUE"}
                  </Button>
                </div>
              );
            })}
            {ITEM_DEFS.every((d) => (inventory[d.id] ?? 0) === 0) && (
              <p className="font-mono text-[10px] text-[#75826F]">Stores are empty. Crates, victories and the buy buttons below restock them.</p>
            )}
          </div>
          <p className="mt-1.5 font-mono text-[9px] leading-relaxed text-[#75826F]">
            What he carries shows on him in battle — and if he falls, it is lost with him.
          </p>
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
          equipment={s.equipment}
          className={frozen ? "opacity-80 saturate-50" : ""}
        />
        <span className="min-w-0">
          <span className="block truncate font-mono text-[13px] font-semibold text-[#EDEDE2]">
            {s.rank} {s.name}
          </span>
          <span className="block truncate font-mono text-[10px] text-[#8D9A83]">
            {UNIT_TYPES[s.type].label} · "{s.quirk}" · {s.kills} kills · {s.missions} ops
            {s.points > 0 && <span className="text-[#E5A93C]"> · {s.points} pts</span>}
            {(s.equipment?.length ?? 0) > 0 && <span className="text-[#C68B45]"> · {s.equipment.length} carried</span>}
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
