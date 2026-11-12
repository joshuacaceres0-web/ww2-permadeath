import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Flame, Medal, Radio, Skull } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiGet, apiPost } from "@/lib/api";
import type { GameState, MemorialEntry, Mission, Soldier } from "@/lib/types";
import { ENEMY_TYPES, UNIT_TYPES } from "@/game/data";
import Portrait from "@/components/Portrait";
import CommanderCard from "@/components/CommanderCard";
import ResetEverything from "@/components/ResetEverything";
import { RibbonRack } from "@/components/Medals";
import CampaignMap from "@/components/map/CampaignMap";
import { useMusic } from "@/game/music";

const VIEW_KEY = "vanguard-warroom-view";

const THREAT_TEXT: Record<string, string> = {
  LOW: "text-[#8D9A83] border-[#3A4433]",
  MEDIUM: "text-[#E5A93C] border-[#5C4A1E]",
  HIGH: "text-[#E24A4A] border-[#5C2626]",
  EXTREME: "text-[#E24A4A] border-[#5C2626]",
  CRITICAL: "text-[#E24A4A] border-[#5C2626]",
};

export default function Home() {
  useMusic("war-room"); // Battle Drums, looped; stops on leaving the War Room.
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: state, isLoading: stateLoading, isError: stateError } = useQuery({ queryKey: ["state"], queryFn: () => apiGet<GameState>("/state"), retry: false });
  const { data: missions, isLoading: missionsLoading, isError: missionsError } = useQuery({ queryKey: ["missions"], queryFn: () => apiGet<Mission[]>("/missions"), retry: false });
  const { data: squad, isLoading: squadLoading } = useQuery({ queryKey: ["squad"], queryFn: () => apiGet<Soldier[]>("/squad"), retry: false });
  const { data: memorial } = useQuery({ queryKey: ["memorial"], queryFn: () => apiGet<MemorialEntry[]>("/memorial"), retry: false });
  const loading = stateLoading || missionsLoading;
  const loadFailed = stateError || missionsError;

  const [view, setView] = useState<"list" | "map">(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "map" ? "map" : "list";
    } catch {
      return "list";
    }
  });
  const pickView = (v: "list" | "map") => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode: choice lasts for this visit */
    }
  };

  const mission = missions && state ? missions.find((m) => m.index === state.mission_index) : undefined;
  const activeSquad = (squad ?? []).filter((s) => s.status === "active");

  const waves = useMemo(() => {
    if (!mission) return [] as Array<[number, Mission["enemies"]]>;
    const m = new Map<number, Mission["enemies"]>();
    for (const e of mission.enemies) {
      const arr = m.get(e.wave) ?? [];
      arr.push(e);
      m.set(e.wave, arr);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [mission]);

  const reset = useMutation({
    mutationFn: () => apiPost<GameState>("/campaign/reset"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["state"] });
      qc.invalidateQueries({ queryKey: ["squad"] });
      toast.success("Fresh campaign drawn up. The memorial remembers.");
    },
    onError: () => toast.error("Could not reset the campaign"),
  });

  const deploy = () => {
    if (!state) return;
    if (activeSquad.length === 0) {
      toast.error("No men fit for duty — hire replacements in the barracks");
      return;
    }
    navigate("/game");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2" data-testid="warroom-view-switch">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8D9A83]">Campaign view</span>
        {(["list", "map"] as const).map((v) => (
          <button
            key={v}
            data-testid={`warroom-view-${v}`}
            aria-pressed={view === v}
            onClick={() => pickView(v)}
            className={`border-2 px-3 py-1 font-[Silkscreen] text-[11px] shadow-[2px_2px_0_0_#050605] transition-colors duration-100 ${
              view === v ? "border-[#E5A93C] bg-[#E5A93C] text-[#141108]" : "border-[#2E3628] bg-[#1A1D17] text-[#A2B29A] hover:text-[#E3E7DC]"
            }`}
          >
            {v.toUpperCase()}
          </button>
        ))}
      </div>
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      {/* War theater */}
      <section className="space-y-4">
        <div className="scanlines relative overflow-hidden border border-[#2E3628] bg-[#1A1D17] p-6 pr-20 sm:pr-6">
          <div className="absolute right-4 top-4 rotate-6 border-2 border-double border-[#5C4A1E] px-2 py-0.5 font-mono text-[10px] tracking-[0.25em] text-[#E5A93C]/70">
            CLASSIFIED
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#8D9A83]">
            {state?.campaign_complete ? "Campaign concluded" : "Current operation"}
          </p>
          {state?.campaign_complete ? (
            <div className="mt-4 space-y-3">
              <h1 className="font-heading text-4xl font-bold tracking-tight text-[#5EB872]">
                GERMANY HAS SURRENDERED
              </h1>
              <p className="max-w-xl font-mono text-sm leading-relaxed text-[#A2B29A]">
                The division fought the line from the bocage to the Hürtgen. Every name on
                the memorial paid for it. The war is over for the living — the wall is forever.
              </p>
              <div className="flex gap-6 font-mono text-sm">
                <span className="text-[#E3E7DC]">
                  Battles won <span className="text-[#5EB872]">{state.battles_won}</span>
                </span>
                <span className="text-[#E3E7DC]">
                  Battles lost <span className="text-[#E24A4A]">{state.battles_lost}</span>
                </span>
                <span className="text-[#E3E7DC]">
                  Fallen <span className="text-[#E5A93C]">{memorial?.length ?? "—"}</span>
                </span>
              </div>
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  data-testid="restart-campaign-btn"
                  onClick={() => reset.mutate()}
                  disabled={reset.isPending}
                  className={buttonVariants({ variant: "default", size: "sm" })}
                >
                  START A NEW CAMPAIGN
                </button>
                <Link
                  to="/memorial"
                  data-testid="visit-memorial-btn"
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  VISIT THE MEMORIAL
                </Link>
              </div>
            </div>
          ) : mission ? (
            <div className="mt-3 space-y-4">
              <h1 className="font-heading text-3xl font-bold tracking-tight text-[#F0F5EB] md:text-4xl">
                {mission.code}
              </h1>
              <p className="font-mono text-sm text-[#E5A93C]">{mission.location}</p>
              <p className="max-w-2xl font-mono text-[13px] leading-relaxed text-[#A2B29A]">
                {mission.brief}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Badge
                  variant="outline"
                  className={`font-mono tracking-[0.15em] ${THREAT_TEXT[mission.difficulty] ?? "text-[#8D9A83]"}`}
                >
                  {mission.difficulty}
                </Badge>
                <span className="flex items-center gap-1.5 font-mono text-xs text-[#E3E7DC]">
                  <Medal size={13} className="text-[#E5A93C]" /> {mission.reward} RP on victory
                </span>
              </div>
              <div className="border border-[#2E3628] bg-[#121411] p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8D9A83]">
                  Objective
                </p>
                <p className="mt-1 font-mono text-sm text-[#E3E7DC]">{mission.objective}</p>
                <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-[#8D9A83]">
                  Enemy intel
                </p>
                <div className="mt-2 space-y-2" data-testid="enemy-intel">
                  {waves.map(([wave, specs]) => (
                    <div key={wave} className="flex flex-wrap items-center gap-2">
                      <span className="w-16 font-mono text-[10px] text-[#4ECDC4]">WAVE {wave}</span>
                      {specs.map((e, i) => (
                        <Badge
                          key={i}
                          variant="outline"
                          className={`font-mono text-[10px] ${THREAT_TEXT[ENEMY_TYPES[e.type].threat]}`}
                        >
                          {ENEMY_TYPES[e.type].label} ×{e.count}
                        </Badge>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button
                  data-testid="deploy-mission-btn"
                  size="lg"
                  onClick={deploy}
                  disabled={activeSquad.length === 0}
                >
                  <Flame size={16} className="mr-2" />
                  DEPLOY TO {mission.code.split(" ").slice(-1)[0]}
                </Button>
                {activeSquad.length === 0 && (
                  <span className="font-mono text-xs text-[#E24A4A]">
                    No men fit for duty — <Link to="/barracks" className="underline">the barracks</Link> is waiting
                  </span>
                )}
              </div>
            </div>
          ) : loading ? (
            <div className="mt-6 space-y-2" data-testid="war-room-loading">
              <p className="animate-pixel-blink font-heading text-2xl text-[#8D9A83]">Raising division on the wire…</p>
            </div>
          ) : loadFailed ? (
            <div className="mt-6 space-y-2" data-testid="war-room-error">
              <p className="font-heading text-2xl text-[#E24A4A]">Could not reach division</p>
              <p className="font-mono text-xs text-[#5A664F]">
                The wire is down. Reload the page to try again.
              </p>
            </div>
          ) : (
            <div className="mt-6 space-y-2" data-testid="war-room-loading">
              <p className="font-heading text-2xl text-[#8D9A83]">Raising division on the wire…</p>
            </div>
          )}
        </div>

        {/* Campaign progress */}
        <Card className="border-[#2E3628] bg-[#1A1D17]">
          <CardHeader>
            <CardTitle className="font-heading text-lg tracking-wider text-[#F0F5EB]">
              CAMPAIGN — NORMANDY TO THE HÜRTGEN
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {view === "map" && missions ? (
              <CampaignMap
                missions={missions}
                state={state}
                memorial={memorial ?? []}
                canDeploy={activeSquad.length > 0 && !state?.campaign_complete}
                onDeploy={deploy}
              />
            ) : (missions ?? []).map((m) => {
              const done = state ? m.index < state.mission_index : false;
              const current = state ? m.index === state.mission_index : false;
              return (
                <div
                  key={m.id}
                  data-testid={`campaign-mission-${m.id}`}
                  className={`flex items-center justify-between border px-3 py-2 font-mono text-xs ${
                    current
                      ? "border-[#E5A93C] bg-[#22271E] text-[#F0F5EB]"
                      : done
                        ? "border-[#2E3628] text-[#8D9A83]"
                        : "border-[#2E3628] text-[#5A664F]"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={current ? "text-[#E5A93C]" : done ? "text-[#5EB872]" : ""}>
                      {done ? "■ SECURED" : current ? "▸ ACTIVE" : "□ LOCKED"}
                    </span>
                    <span className="tracking-wide">{m.code}</span>
                  </span>
                  <span>{m.location.split(",").slice(-1)[0].trim()}</span>
                </div>
              );
            })}
            {!missions && (
              <p className="font-mono text-xs text-[#5A664F]">Raising division on the wire…</p>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Right rail */}
      <aside className="space-y-4">
        <CommanderCard state={state} />

        <Card className="border-[#2E3628] bg-[#1A1D17]">
          <CardHeader>
            <CardTitle className="font-heading text-lg tracking-wider text-[#F0F5EB]">
              SQUAD READINESS
              <span className="ml-2 font-mono text-xs text-[#8D9A83]">
                {activeSquad.length}/{state?.max_squad ?? 5}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {activeSquad.map((s) => (
              <div
                key={s.id}
                data-testid={`warroom-soldier-${s.id}`}
                className="flex items-center gap-3 border border-[#2E3628] bg-[#22271E] px-2.5 py-2"
              >
                <Portrait seed={s.portrait_seed} type={s.type} level={s.level} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-mono text-[13px] font-semibold text-[#EDEDE2]">
                      {s.rank} {s.name}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] tracking-[0.15em] text-[#E5A93C]">
                      {UNIT_TYPES[s.type].label.toUpperCase()}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 font-mono text-[10px] text-[#8D9A83]">
                    <span className="flex min-w-0 items-center gap-1.5 truncate">
                      <RibbonRack medals={s.medals ?? []} />"{s.quirk}" · {s.hometown}
                    </span>
                    <span className="shrink-0">
                      {s.kills} kills · {s.missions} ops
                    </span>
                  </div>
                </div>
              </div>
            ))}
            {squad && activeSquad.length === 0 && (
              <p className="font-mono text-xs text-[#E24A4A]">
                The line is empty. Hire men or hold nothing.
              </p>
            )}
            {!squad && <p className="font-mono text-xs text-[#5A664F]">{squadLoading ? "Raising division on the wire…" : "Could not reach division — reload to try again."}</p>}
            <Link
              to="/barracks"
              data-testid="open-barracks-btn"
              className={buttonVariants({ variant: "outline", size: "sm", className: "w-full" })}
            >
              OPEN THE BARRACKS
            </Link>
          </CardContent>
        </Card>

        <Card className="border-[#2E3628] bg-[#1A1D17]">
          <CardHeader>
            <CardTitle className="font-heading text-lg tracking-wider text-[#F0F5EB]">
              REQUISITION LEDGER
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 font-mono text-xs">
            <div className="border border-[#2E3628] p-3" data-testid="ledger-rp">
              <p className="text-[9px] uppercase tracking-[0.2em] text-[#8D9A83]">Requisition</p>
              <p className="mt-1 text-xl font-semibold text-[#E5A93C]">
                {state ? `${state.requisition}` : "—"} RP
              </p>
            </div>
            <div className="border border-[#2E3628] p-3" data-testid="ledger-casualties">
              <p className="text-[9px] uppercase tracking-[0.2em] text-[#8D9A83]">Fallen</p>
              <p className="mt-1 flex items-center gap-1.5 text-xl font-semibold text-[#E24A4A]">
                <Skull size={16} /> {memorial?.length ?? "—"}
              </p>
            </div>
            <div className="border border-[#2E3628] p-3" data-testid="ledger-won">
              <p className="text-[9px] uppercase tracking-[0.2em] text-[#8D9A83]">Battles won</p>
              <p className="mt-1 text-xl font-semibold text-[#5EB872]">{state?.battles_won ?? "—"}</p>
            </div>
            <div className="border border-[#2E3628] p-3" data-testid="ledger-lost">
              <p className="text-[9px] uppercase tracking-[0.2em] text-[#8D9A83]">Battles lost</p>
              <p className="mt-1 text-xl font-semibold text-[#E24A4A]">{state?.battles_lost ?? "—"}</p>
            </div>
            <p className="col-span-2 flex items-center gap-2 text-[10px] leading-relaxed text-[#5A664F]">
              <Radio size={12} /> Fallen soldiers never return. Spend the RP they earned.
            </p>
            <div className="col-span-2">
              <ResetEverything />
            </div>
          </CardContent>
        </Card>
      </aside>
    </div>
    </div>
  );
}
