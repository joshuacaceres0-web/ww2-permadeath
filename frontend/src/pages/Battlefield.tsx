import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pause, Play, Flag, Skull } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import BattleCanvas from "@/components/game/BattleCanvas";
import SquadDock from "@/components/game/SquadDock";
import CombatLog from "@/components/game/CombatLog";
import TouchControls from "@/components/game/TouchControls";
import { Shield } from "lucide-react";
import Portrait from "@/components/Portrait";
import { apiGet, apiPost, saveId } from "@/lib/api";
import type { BattleResult, GameState, Mission, Soldier } from "@/lib/types";
import { GameEngine, type BattleReport, type HudSnapshot, type Variant } from "@/game/engine";
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
  const [variant, setVariant] = useState<Variant>("");
  const [touch] = useState(
    () => typeof window !== "undefined" && (window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 1024)
  );

  const { data: state } = useQuery({ queryKey: ["state"], queryFn: () => apiGet<GameState>("/state"), retry: false });
  const { data: missions } = useQuery({ queryKey: ["missions"], queryFn: () => apiGet<Mission[]>("/missions"), retry: false });
  const { data: squad } = useQuery({ queryKey: ["squad"], queryFn: () => apiGet<Soldier[]>("/squad"), retry: false });

  const liveMission = missions && state ? missions.find((m) => m.index === state.mission_index) : undefined;
  const activeSquad = (squad ?? []).filter((s) => s.status === "active");
  // Freeze what was deployed: after the report files, the campaign moves on underneath us.
  const [deployed, setDeployed] = useState<{ mission: Mission; squad: Soldier[] } | null>(null);
  useEffect(() => {
    if (!deployed && liveMission && activeSquad.length && !state?.campaign_complete) {
      setDeployed({ mission: liveMission, squad: activeSquad });
    }
  }, [deployed, liveMission, activeSquad, state?.campaign_complete]);
  const mission = deployed?.mission ?? liveMission;

  const onHud = useCallback((h: HudSnapshot) => setHud(h), []);

  const hudRef = useRef<HudSnapshot | null>(null);
  hudRef.current = hud;

  const fileReport = useMutation({
    mutationFn: (r: BattleReport) => apiPost<BattleResult>("/battle/complete", reportBody(r)),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["state"] });
      qc.invalidateQueries({ queryKey: ["squad"] });
      qc.invalidateQueries({ queryKey: ["memorial"] });
      for (const p of res.promotions) toast.success(`Field promotion — ${p}`);
      for (const m of res.medals_awarded) toast(`🎖 Decorated: ${m}`);
      if (res.commander_promoted) toast.success(`You have been promoted to ${res.commander_rank}. New privileges unlocked.`);
      if (res.memorial_names.length) toast(`${res.memorial_names.length} name(s) added to the Memorial Wall.`);
    },
    onError: () => toast.error("The report didn't reach division — tap RETRY"),
  });

  // Battle over -> file the report immediately (permadeath can't be dodged by closing the tab).
  useEffect(() => {
    if (hud && hud.state !== "active" && !endedRef.current) {
      endedRef.current = true;
      const r = engineRef.current?.getReport() ?? null;
      setReport(r);
      if (r) fileReport.mutate(r);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hud]);

  // Leaving mid-battle (navigation or closing the tab) counts as a retreat — the dead stay dead.
  useEffect(() => {
    const retreatBeacon = () => {
      const h = hudRef.current;
      const eng = engineRef.current;
      if (!eng || !h || h.briefing || endedRef.current) return;
      endedRef.current = true;
      eng.retreat();
      const r = eng.getReport();
      if (!r) return;
      void fetch("/api/battle/complete", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", "X-Save-Id": saveId() },
        body: JSON.stringify(reportBody(r)),
      }).then(() => {
        qc.invalidateQueries({ queryKey: ["state"] });
        qc.invalidateQueries({ queryKey: ["squad"] });
        qc.invalidateQueries({ queryKey: ["memorial"] });
      });
    };
    window.addEventListener("pagehide", retreatBeacon);
    return () => {
      window.removeEventListener("pagehide", retreatBeacon);
      retreatBeacon();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state?.campaign_complete && !deployed) {
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

  if (!deployed && activeSquad.length === 0) {
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

  if (mission.terrain === "dday" && !variant) {
    return (
      <Shell>
        <div className="w-full max-w-3xl space-y-4 p-4" data-testid="dday-choice">
          <div className="text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#8D9A83]">6 June 1944 · Normandy</p>
            <h1 className="font-heading text-3xl font-bold tracking-tight text-[#F0F5EB]">HOW DOES YOUR SQUAD GO IN?</h1>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {([
              ["beach", "BEACH LANDING", "Omaha · Dog Green sector", "Wade in from the Higgins boat under fire. Steel hedgehogs for cover on the sand, then climb the bluffs through one of three draws. The squad starts together."],
              ["airborne", "AIRBORNE DROP", "Behind the Atlantic Wall · night", "Jump from a C-47 in the dark. Your men land scattered across the hedgerow fields — closer to the objective, but alone until you regroup them."],
            ] as const).map(([v, title, sub, body]) => (
              <button
                key={v}
                data-testid={`dday-choice-${v}`}
                onClick={() => setVariant(v)}
                className="group border border-[#2E3628] bg-[#1A1D17] p-5 text-left hover:border-[#E5A93C]"
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#E5A93C]">{sub}</p>
                <h2 className="mt-1 font-heading text-2xl font-bold tracking-tight text-[#F0F5EB]">{title}</h2>
                <p className="mt-2 font-mono text-[12px] leading-relaxed text-[#A2B29A]">{body}</p>
                <span className="mt-4 inline-block border border-[#E5A93C] px-3 py-1 font-mono text-xs text-[#E5A93C] group-hover:bg-[#E5A93C] group-hover:text-[#141108]">
                  CHOOSE ▸
                </span>
              </button>
            ))}
          </div>
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
            data-testid="take-cover-btn"
            variant="outline"
            size="xs"
            className="hidden sm:inline-flex"
            onClick={() => engineRef.current?.takeCover()}
            disabled={hud?.briefing || hud?.state !== "active"}
          >
            <Shield size={12} className="mr-1" /> COVER (C)
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
          key={mission.id + variant}
          mission={mission}
          variant={variant}
          squad={deployed?.squad ?? activeSquad}
          commanderBonus={state?.combat_bonus ?? 0}
          onHud={onHud}
          engineRef={engineRef}
        />

        <div className="absolute right-3 top-3 z-10 hidden md:block">
          <CombatLog log={hud?.log ?? []} />
        </div>

        {/* Order hints */}
        {touch ? (
          <div className="pointer-events-none absolute left-2 top-2 z-10 border border-[#2E3628] bg-[#0D0F0C]/80 px-2 py-1 font-mono text-[10px] text-[#A2B29A]">
            TAP A SOLDIER TO SELECT · TAP GROUND/ENEMY TO ORDER · DRAG TO SCROLL
          </div>
        ) : (
          <div className="pointer-events-none absolute bottom-2 left-3 z-10 font-mono text-[10px] tracking-[0.12em] text-[#5A664F]">
            LMB DRAG: SELECT · RMB: MOVE / ATTACK · SHIFT+RMB: QUEUE · WASD: SCROLL · 1-8: SOLDIER · Q: ABILITY · C: COVER · SPACE: PAUSE
          </div>
        )}
        {touch && hud && !hud.briefing && hud.state === "active" && (
          <TouchControls engineRef={engineRef} paused={hud.paused} disabled={false} />
        )}
        <div
          data-testid="terrain-legend"
          className="pointer-events-none absolute bottom-7 left-3 z-10 hidden gap-3 lg:flex border border-[#2E3628] bg-[#0D0F0C]/85 px-2.5 py-1.5 font-mono text-[10px] text-[#A2B29A]"
        >
          <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full border border-[#0C1607] bg-[#3F6A28] align-middle" />HEDGEROW — blocks men &amp; bullets</span>
          <span><span className="mr-1 inline-block h-2.5 w-3 rounded-full bg-[#5C4A30] align-middle" />GAP — walk through</span>
          <span><span className="mr-1 inline-block h-2.5 w-2.5 bg-[#5A3A2A] align-middle" />BUILDING</span>
          <span>✕ HEDGEHOG</span>
          <span><span className="mr-1 inline-block h-2 w-3 rounded-full bg-[#8A7A52] align-middle" />SANDBAGS / RUINS / WRECKS — cover</span>
          <span className="text-[#4ECDC4]">◆ IN COVER</span>
          <span className="text-[#A0B4D2]">○ 2ND PLATOON (AI)</span>
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
                {(deployed?.squad ?? activeSquad).map((s, i) => (
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
                    const dead = (deployed?.squad ?? []).find((s) => s.id === f.soldierId);
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
                      const a = (deployed?.squad ?? []).find((x) => x.id === s.soldierId);
                      return `${a?.name ?? "?"} (${s.kills} kills)`;
                    })
                    .join(" · ") || "—"}
                </p>
              </div>

              <Button
                data-testid="debrief-return-btn"
                size="lg"
                className="mt-5 w-full"
                onClick={() => (fileReport.isError ? fileReport.mutate(report) : navigate("/"))}
                disabled={fileReport.isPending}
              >
                {fileReport.isPending
                  ? "FILING THE REPORT…"
                  : fileReport.isError
                    ? "RETRY FILING THE REPORT"
                    : "REPORT FILED — RETURN TO HQ"}
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

function reportBody(r: BattleReport) {
  const stats = (x: { damageTaken: number; healed: number; heavyKills: number; officerKills: number }) => ({
    damage_taken: x.damageTaken,
    healed: x.healed,
    heavy_kills: x.heavyKills,
    officer_kills: x.officerKills,
  });
  return {
    mission_id: r.missionId,
    victory: r.victory,
    duration_sec: r.durationSec,
    fallen: r.fallen.map((f) => ({ soldier_id: f.soldierId, cause: f.cause, kills: f.kills, ...stats(f) })),
    survivors: r.survivors.map((v) => ({ soldier_id: v.soldierId, kills: v.kills, ...stats(v) })),
  };
}
