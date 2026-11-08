import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pause, Play, Flag, Skull } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import BattleCanvas from "@/components/game/BattleCanvas";
import SquadDock from "@/components/game/SquadDock";
import CombatLog from "@/components/game/CombatLog";
import Portrait from "@/components/Portrait";
import { apiGet, apiPost } from "@/lib/api";
import type { BattleResult, GameState, Mission, Soldier } from "@/lib/types";
import { GameEngine, type BattleReport, type HudSnapshot } from "@/game/engine";
import { UNIT_TYPES } from "@/game/data";

const mmss = (t: number) =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export default function Battlefield() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const engineRef = useRef<GameEngine | null>(null);
  const endedRef = useRef(false);
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [report, setReport] = useState<BattleReport | null>(null);

  const { data: state } = useQuery({ queryKey: ["state"], queryFn: () => apiGet<GameState>("/state"), retry: false });
  const { data: missions } = useQuery({ queryKey: ["missions"], queryFn: () => apiGet<Mission[]>("/missions"), retry: false });
  const { data: squad } = useQuery({ queryKey: ["squad"], queryFn: () => apiGet<Soldier[]>("/squad"), retry: false });

  const mission = missions && state ? missions.find((m) => m.index === state.mission_index) : undefined;
  const activeSquad = (squad ?? []).filter((s) => s.status === "active");

  const onHud = useCallback((h: HudSnapshot) => setHud(h), []);

  useEffect(() => {
    if (hud && hud.state !== "active" && !endedRef.current) {
      endedRef.current = true;
      setReport(engineRef.current?.getReport() ?? null);
    }
  }, [hud]);

  const fileReport = useMutation({
    mutationFn: (r: BattleReport) =>
      apiPost<BattleResult>("/battle/complete", {
        mission_id: r.missionId,
        victory: r.victory,
        duration_sec: r.durationSec,
        fallen: r.fallen.map((f) => ({ soldier_id: f.soldierId, cause: f.cause, kills: f.kills })),
        survivors: r.survivors.map((s) => ({ soldier_id: s.soldierId, kills: s.kills })),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["state"] });
      qc.invalidateQueries({ queryKey: ["squad"] });
      qc.invalidateQueries({ queryKey: ["memorial"] });
      for (const p of res.promotions) toast.success(`Field promotion — ${p}`);
      if (res.commander_promoted) toast.success(`You have been promoted to ${res.commander_rank}. New privileges unlocked.`);
      if (res.memorial_names.length) toast(`${res.memorial_names.length} name(s) added to the Memorial Wall.`);
      navigate("/");
    },
    onError: () => toast.error("The report didn't reach division — try again"),
  });

  if (state?.campaign_complete) {
    return (
      <Shell>
        <div className="mx-auto max-w-lg border border-[#2E3628] bg-[#1A1D17] p-8 text-center">
          <h1 className="font-heading text-3xl font-bold tracking-tight text-[#5EB872]">
            THE CAMPAIGN IS WON
          </h1>
          <p className="mt-3 font-mono text-sm leading-relaxed text-[#A2B29A]">
            From the bocage to the Hürtgen — the line held. Start a new campaign from the
            war room; the memorial keeps its dead either way.
          </p>
          <Link
            to="/"
            data-testid="campaign-complete-back-btn"
            className={buttonVariants({ variant: "default", size: "sm", className: "mt-6" })}
          >
            RETURN TO THE WAR ROOM
          </Link>
        </div>
      </Shell>
    );
  }

  if (!mission) {
    return (
      <Shell>
        <div className="mx-auto max-w-lg border border-[#2E3628] bg-[#1A1D17] p-8 text-center font-mono text-sm text-[#A2B29A]">
          The wire to division is down — no operation loaded. Retry shortly from the war room.
        </div>
      </Shell>
    );
  }

  if (activeSquad.length === 0) {
    return (
      <Shell>
        <div className="mx-auto max-w-lg border border-[#2E3628] bg-[#1A1D17] p-8 text-center">
          <h1 className="font-heading text-2xl font-bold tracking-tight text-[#E24A4A]">
            NO MEN FIT FOR DUTY
          </h1>
          <p className="mt-3 font-mono text-sm leading-relaxed text-[#A2B29A]">
            The deployment squad is empty and the dead do not return. Hire replacements
            in the barracks — the next conscription is on the government.
          </p>
          <Link
            to="/barracks"
            data-testid="no-squad-barracks-btn"
            className={buttonVariants({ variant: "default", size: "sm", className: "mt-6" })}
          >
            TO THE BARRACKS
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* CRT status bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[#2E3628] bg-[#0D0F0C] px-4 py-2 font-mono text-xs">
        <span className="font-heading text-sm font-bold tracking-wider text-[#F0F5EB]">
          {mission.code}
        </span>
        <span className="text-[#8D9A83]" data-testid="battle-timer">
          T+{mmss(hud?.elapsed ?? 0)}
        </span>
        <span className="text-[#4ECDC4]" data-testid="battle-wave">
          WAVE {hud?.wave ?? 1}/{hud?.waves ?? 1}
        </span>
        <span className="text-[#E24A4A]" data-testid="battle-hostiles">
          HOSTILES {hud?.enemiesAlive ?? "—"}
        </span>
        {hud?.paused && !hud.briefing && (
          <span
            className="animate-amber-pulse border border-[#E5A93C] bg-[#3A2B0E] px-2 py-0.5 font-bold tracking-[0.2em] text-[#FFD97D]"
            data-testid="paused-banner"
          >
            TACTICAL PAUSE ENGAGED
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            data-testid="tactical-pause-btn"
            variant="outline"
            size="xs"
            onClick={() => engineRef.current?.togglePause()}
            disabled={hud?.briefing || hud?.state !== "active"}
          >
            {hud?.paused ? <Play size={12} className="mr-1" /> : <Pause size={12} className="mr-1" />}
            {hud?.paused ? "RESUME" : "PAUSE (SPACE)"}
          </Button>
          <Button
            data-testid="retreat-btn"
            variant="destructive"
            size="xs"
            onClick={() => engineRef.current?.retreat()}
            disabled={hud?.briefing || hud?.state !== "active"}
          >
            <Flag size={12} className="mr-1" /> RETREAT
          </Button>
        </div>
      </div>

      {/* Battlefield */}
      <div className="scanlines relative min-h-0 flex-1 overflow-hidden bg-[#080A08]">
        <BattleCanvas
          key={mission.id}
          mission={mission}
          squad={activeSquad}
          commanderBonus={state?.combat_bonus ?? 0}
          onHud={onHud}
          engineRef={engineRef}
        />

        <div className="absolute right-3 top-3 z-10">
          <CombatLog log={hud?.log ?? []} />
        </div>

        {/* Order hints */}
        <div className="pointer-events-none absolute bottom-2 left-3 z-10 font-mono text-[10px] tracking-[0.12em] text-[#5A664F]">
          LMB DRAG: SELECT · RMB: MOVE / ATTACK · SHIFT+RMB: QUEUE · 1-5: SOLDIER · Q: ABILITY · SPACE: PAUSE
        </div>

        {/* Briefing overlay */}
        {hud?.briefing && hud.state === "active" && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0D0F0C]/80 p-6">
            <div
              className="max-w-xl border border-[#2E3628] bg-[#1A1D17] p-6"
              data-testid="briefing-panel"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#8D9A83]">
                Operation orders · {mission.location}
              </p>
              <h2 className="mt-1 font-heading text-2xl font-bold tracking-tight text-[#F0F5EB]">
                {mission.code}
              </h2>
              <p className="mt-3 font-mono text-[13px] leading-relaxed text-[#A2B29A]">
                {mission.brief}
              </p>
              <div className="mt-4 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {activeSquad.map((s, i) => (
                  <div
                    key={s.id}
                    data-testid={`briefing-soldier-${i}`}
                    className="flex items-center justify-between gap-2 border border-[#2E3628] bg-[#22271E] px-2 py-1.5 font-mono text-[11px]"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-[#EDEDE2]">
                      <Portrait seed={s.portrait_seed} type={s.type} level={s.level} size={24} />
                      <span className="truncate">
                        {i + 1} · {s.rank} {s.name}
                      </span>
                    </span>
                    <span className="shrink-0 text-[#E5A93C]">{UNIT_TYPES[s.type].label}</span>
                  </div>
                ))}
              </div>
              <Button
                data-testid="engage-btn"
                size="lg"
                className="mt-5 w-full"
                onClick={() => engineRef.current?.begin()}
              >
                BEGIN THE ASSAULT
              </Button>
            </div>
          </div>
        )}

        {/* Debrief overlay */}
        {hud && hud.state !== "active" && report && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0D0F0C]/85 p-6">
            <div
              className="max-w-lg border border-[#2E3628] bg-[#1A1D17] p-6"
              data-testid="debrief-panel"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#8D9A83]">
                After-action report · T+{mmss(report.durationSec)}
              </p>
              <h2
                className={`mt-1 font-heading text-3xl font-bold tracking-tight ${
                  report.victory ? "text-[#5EB872]" : "text-[#E24A4A]"
                }`}
              >
                {report.victory ? "VICTORY SECURED" : "MISSION FAILED"}
              </h2>

              {report.victory && (
                <p className="mt-2 font-mono text-sm text-[#E5A93C]" data-testid="debrief-reward">
                  +{mission.reward} requisition points wired to the division account
                </p>
              )}

              <div className="mt-4 space-y-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8D9A83]">
                  Casualties — gone for good
                </p>
                {report.fallen.length === 0 ? (
                  <p className="border border-[#2E3628] bg-[#22271E] p-2 font-mono text-xs text-[#5EB872]" data-testid="debrief-no-casualties">
                    Every man walks off the field. A rare day.
                  </p>
                ) : (
                  report.fallen.map((f, i) => {
                    const dead = (squad ?? []).find((s) => s.id === f.soldierId);
                    return (
                      <div
                        key={i}
                        data-testid={`debrief-fallen-${i}`}
                        className="flex items-center justify-between border border-[#5C2626] bg-[#221512] px-3 py-2 font-mono text-xs"
                      >
                        <span className="flex items-center gap-2 text-[#F0B4B4]">
                          <Skull size={13} /> {dead ? `${dead.name}` : "Unknown soldier"}
                        </span>
                        <span className="text-[#B88080]">
                          {f.cause} · {f.kills} kills
                        </span>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="mt-3 space-y-1">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8D9A83]">
                  Survivors
                </p>
                <p className="font-mono text-xs text-[#A2B29A]" data-testid="debrief-survivors">
                  {report.survivors
                    .map((s) => {
                      const a = (squad ?? []).find((x) => x.id === s.soldierId);
                      return `${a?.name ?? "?"} (${s.kills} kills)`;
                    })
                    .join(" · ") || "—"}
                </p>
              </div>

              <Button
                data-testid="debrief-return-btn"
                size="lg"
                className="mt-5 w-full"
                onClick={() => fileReport.mutate(report)}
                disabled={fileReport.isPending}
              >
                {fileReport.isPending ? "FILING THE REPORT…" : "FILE REPORT & RETURN TO HQ"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Squad command dock */}
      <div className="border-t border-[#2E3628] bg-[#0D0F0C]">
        <SquadDock
          hud={
            hud ?? {
              elapsed: 0,
              paused: false,
              briefing: true,
              state: "active",
              units: [],
              selectedIds: [],
              enemiesAlive: 0,
              wave: 1,
              waves: 1,
              aimUnitId: null,
              log: [],
            }
          }
          onSelect={(id) => engineRef.current?.selectUnit(id)}
          onAbility={(id) => engineRef.current?.startAim(id)}
        />
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      {children}
    </div>
  );
}
