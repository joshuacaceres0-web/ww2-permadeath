import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pause, Play, Flag, Skull } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import BattleCanvas from "@/components/game/BattleCanvas";
import ReplayViewer from "@/components/game/ReplayViewer";
import SquadDock from "@/components/game/SquadDock";
import CombatLog from "@/components/game/CombatLog";
import TouchControls, { FORMATIONS } from "@/components/game/TouchControls";
import ReinforceMenu, { REINFORCEMENTS } from "@/components/game/ReinforceMenu";
import { RotateCw, Shield } from "lucide-react";
import Portrait from "@/components/Portrait";
import { ApiError, apiGet, apiPost, saveId } from "@/lib/api";
import type { BattleResult, GameState, Mission, ReinforceOut, ReinforcementKind, Soldier } from "@/lib/types";
import { GameEngine, type BattleReplay, type BattleReport, type HudSnapshot, type Variant } from "@/game/engine";
import { UNIT_TYPES } from "@/game/data";
import { useMusic } from "@/game/music";

const mmss = (t: number) =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export default function Battlefield() {
  useMusic(null); // No music in battle: any menu / War Room / Barracks / Memorial track stops here.
  const navigate = useNavigate();
  const qc = useQueryClient();
  const engineRef = useRef<GameEngine | null>(null);
  const endedRef = useRef(false);
  // One id per deployment: the backend files a battle_id only once, so a
  // retry, a pagehide beacon racing the hud effect, or a reload can never
  // file the same battle twice (that is how Battles Lost went 1->3 before
  // a battle was fought, then 3->5 for one defeat).
  const battleIdRef = useRef<string | null>(null);
  const newBattleId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `battle-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [report, setReport] = useState<BattleReport | null>(null);
  const [replay, setReplay] = useState<BattleReplay | null>(null);
  const [showReplay, setShowReplay] = useState(false);
  // Full-map view: hides every control sitting on top of the map and
  // zooms the engine out to the whole 2400x1350 map, so the full
  // battlefield is visible at once. The top bar stays, with a
  // SHOW CONTROLS button to get back.
  const [fullMap, setFullMap] = useState(false);
  const toggleFullMap = () => {
    const next = !fullMap;
    setFullMap(next);
    engineRef.current?.setFitMap(next);
  };
  const [variant, setVariant] = useState<Variant>("");
  const [touch] = useState(
    () => typeof window !== "undefined" && (window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 1024)
  );

  // Phones play the battle sideways: try to lock landscape, otherwise ask them to rotate.
  const [portrait, setPortrait] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(orientation: portrait)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const on = () => setPortrait(mq.matches);
    mq.addEventListener("change", on);
    return () => {
      mq.removeEventListener("change", on);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  const goLandscape = () => {
    if (!touch) return;
    const el = document.documentElement;
    const lock = () => {
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      return o?.lock ? o.lock("landscape") : Promise.reject(new Error("no lock"));
    };
    (el.requestFullscreen ? el.requestFullscreen() : Promise.resolve())
      .then(lock)
      .catch(() => {
        /* iOS / desktop: no orientation lock — the rotate prompt covers it */
      });
  };

  const { data: state } = useQuery({ queryKey: ["state"], queryFn: () => apiGet<GameState>("/state"), retry: 2 });
  const { data: missions } = useQuery({ queryKey: ["missions"], queryFn: () => apiGet<Mission[]>("/missions"), retry: 2 });
  const { data: squad } = useQuery({ queryKey: ["squad"], queryFn: () => apiGet<Soldier[]>("/squad"), retry: 2 });

  const liveMission = missions && state ? missions.find((m) => m.index === state.mission_index) : undefined;
  const activeSquad = (squad ?? []).filter((s) => s.status === "active");
  // Freeze what was deployed: after the report files, the campaign moves on underneath us.
  const [deployed, setDeployed] = useState<{ mission: Mission; squad: Soldier[] } | null>(null);
  useEffect(() => {
    if (!deployed && liveMission && activeSquad.length && !state?.campaign_complete) {
      battleIdRef.current = newBattleId();
      setDeployed({ mission: liveMission, squad: activeSquad });
    }
  }, [deployed, liveMission, activeSquad, state?.campaign_complete]);
  const mission = deployed?.mission ?? liveMission;

  // The old rotate prompt was a fixed full-screen overlay (z-50) that
  // covered every control the moment a battle started in portrait, and
  // its GO FULLSCREEN button often did nothing — so on a phone the
  // controls simply looked gone. It is now a dismissible banner at the
  // top of the battlefield: the battle pauses while it is up, and
  // PLAY PORTRAIT ANYWAY dismisses it and resumes with the touch
  // controls visible.
  const [rotateDismissed, setRotateDismissed] = useState(false);
  const mustRotate = touch && portrait && !!hud && !hud.briefing && hud.state === "active" && !rotateDismissed;
  useEffect(() => {
    if (mustRotate) engineRef.current?.setPaused(true);
    else if (rotateDismissed) engineRef.current?.setPaused(false);
  }, [mustRotate, rotateDismissed]);

  const reinforce = useMutation({
    mutationFn: (kind: ReinforcementKind) =>
      apiPost<ReinforceOut>("/battle/reinforce", { mission_id: mission?.id, kind }),
    onSuccess: (res) => {
      engineRef.current?.spawnReinforcements(res.kind);
      qc.setQueryData<GameState>(["state"], (old) => (old ? { ...old, requisition: res.requisition } : old));
      const r = REINFORCEMENTS.find((x) => x.kind === res.kind);
      toast.success(`${r?.label ?? "Team"} inbound — ${res.cost} RP spent (${res.requisition} RP left)`);
    },
    onError: (e) =>
      toast.error(e instanceof ApiError && e.status === 402 ? "Not enough requisition for that team" : "Radio is dead — try again"),
  });
  const callIn = (kind: ReinforcementKind) => {
    if (!engineRef.current?.canReinforce()) return;
    reinforce.mutate(kind);
  };

  const onHud = useCallback((h: HudSnapshot) => setHud(h), []);

  const hudRef = useRef<HudSnapshot | null>(null);
  hudRef.current = hud;

  const fileReport = useMutation({
    mutationFn: (r: BattleReport) => apiPost<BattleResult>("/battle/complete", reportBody(r, battleIdRef.current)),
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
  // Only pagehide files it, never unmount cleanup: the old cleanup called
  // retreatBeacon() on every unmount, so a React remount or a navigation
  // away from a battle that had not started yet still filed a defeat.
  // And a battle that never started (elapsed 0 — still in briefing, or
  // stuck at the rotate screen before BEGIN THE ASSAULT) files nothing:
  // deployments stuck at the rotate screen used to count as lost battles.
  useEffect(() => {
    const retreatBeacon = () => {
      const h = hudRef.current;
      const eng = engineRef.current;
      if (!eng || !h || h.briefing || (h.elapsed ?? 0) <= 0 || endedRef.current) return;
      endedRef.current = true;
      eng.retreat();
      const r = eng.getReport();
      if (!r) return;
      void fetch("/api/battle/complete", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", "X-Save-Id": saveId() },
        body: JSON.stringify(reportBody(r, battleIdRef.current)),
      }).then(() => {
        qc.invalidateQueries({ queryKey: ["state"] });
        qc.invalidateQueries({ queryKey: ["squad"] });
        qc.invalidateQueries({ queryKey: ["memorial"] });
      });
    };
    window.addEventListener("pagehide", retreatBeacon);
    return () => {
      window.removeEventListener("pagehide", retreatBeacon);
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
            to="/war-room"
            data-testid="campaign-complete-back-btn"
            className={buttonVariants({ variant: "default", size: "sm", className: "mt-6" })}
          >
            RETURN TO THE WAR ROOM
          </Link>
        </div>
      </Shell>
    );
  }

  if (!deployed && (!squad || !state || !missions)) {
    return (
      <Shell>
        <p className="animate-pixel-blink font-mono text-sm text-[#8D9A83]" data-testid="battle-loading">
          RAISING DIVISION ON THE WIRE…
        </p>
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
    <div className="flex min-h-0 flex-1 flex-col short:h-svh">
      {/* Rotate prompt: in-flow at the top, never absolute — the old
          absolute banner had no positioned ancestor, so it overlaid
          the status bar and covered RADIO / PAUSE / COVER / RETREAT
          while mustRotate was up. In-flow it pushes the status bar
          down instead of covering it, and PLAY PORTRAIT ANYWAY
          dismisses it. */}
      {mustRotate && (
        <div
          data-testid="rotate-prompt"
          className="flex flex-wrap items-center justify-center gap-3 border-b border-[#E5A93C] bg-[#0D0F0C]/95 px-4 py-3 text-center"
        >
          <RotateCw size={20} className="animate-spin-slow shrink-0 text-[#E5A93C]" />
          <p className="font-mono text-xs leading-relaxed text-[#E3E7DC]">
            <span className="font-bold text-[#F0F5EB]">TURN YOUR PHONE SIDEWAYS</span> — the battle plays in
            landscape and is paused until you rotate.
          </p>
          <Button data-testid="rotate-lock-btn" variant="outline" size="sm" onClick={goLandscape}>
            GO FULLSCREEN SIDEWAYS
          </Button>
          <Button
            data-testid="rotate-play-portrait-btn"
            variant="outline"
            size="sm"
            onClick={() => setRotateDismissed(true)}
          >
            PLAY PORTRAIT ANYWAY
          </Button>
        </div>
      )}
      {/* CRT status bar — two clear rows instead of one crowded wrap:
          row 1 is the battle status, row 2 is the controls. */}
      <div className="border-b border-[#2E3628] bg-[#0D0F0C] font-mono text-xs short:py-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5">
        <span className="font-heading text-sm font-bold tracking-wider text-[#F0F5EB] short:hidden">
          {mission.code}
        </span>
        <span className="text-[#E5A93C]" data-testid="battle-rp">
          {state?.requisition ?? "—"} RP
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
        {hud?.autoBattle && !hud.briefing && (
          <span
            className="border border-[#E5A93C] bg-[#3A2B0E] px-2 py-0.5 font-bold tracking-[0.2em] text-[#FFD97D]"
            data-testid="auto-battle-banner"
          >
            AUTO BATTLE ON — SQUAD FIGHTING ON ITS OWN
          </span>
        )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-[#2E3628] px-4 py-1.5">
        <Button
          data-testid="auto-battle-btn"
          variant="outline"
          size="xs"
          onClick={() => engineRef.current?.toggleAutoBattle()}
          disabled={hud?.briefing || hud?.state !== "active"}
          className={hud?.autoBattle ? "border-[#E5A93C] bg-[#3A2B0E] text-[#FFD97D]" : ""}
          title="Auto Battle: the squad fights on its own. Tap again, or give any order, to take command."
        >
          {hud?.autoBattle ? "AUTO ON" : "AUTO"}
        </Button>
        <Button
          data-testid="full-map-btn"
          variant="outline"
          size="xs"
          onClick={toggleFullMap}
          disabled={hud?.briefing || hud?.state !== "active"}
          className={fullMap ? "border-[#4ECDC4] text-[#4ECDC4]" : ""}
          title="Full map: hide the controls on the map and zoom out to the whole battlefield"
        >
          {fullMap ? "SHOW CONTROLS" : "FULL MAP"}
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!touch && (
            <div className="flex items-center gap-0.5" data-testid="formation-picker" title="Formation (F)">
              {FORMATIONS.map((f) => (
                <button
                  key={f.id}
                  data-testid={`formation-${f.id}`}
                  onClick={() => engineRef.current?.setFormation(f.id)}
                  className={`border px-1.5 py-0.5 text-[10px] tracking-wider transition-colors duration-150 ${
                    (hud?.formation ?? "wedge") === f.id
                      ? "border-[#4ECDC4] text-[#4ECDC4]"
                      : "border-[#2E3628] text-[#8D9A83] hover:text-[#E3E7DC]"
                  }`}
                >
                  {f.glyph} {f.label}
                </button>
              ))}
            </div>
          )}
          <ReinforceMenu
            rp={state?.requisition ?? 0}
            left={hud?.reinforcementsLeft ?? 3}
            disabled={!!hud?.briefing || hud?.state !== "active"}
            pending={reinforce.isPending}
            onCall={callIn}
          />
          <Button
            data-testid="tactical-pause-btn"
            variant="outline"
            size="xs"
            onClick={() => engineRef.current?.togglePause()}
            disabled={hud?.briefing || hud?.state !== "active"}
          >
            {hud?.paused ? <Play size={12} className="mr-1" /> : <Pause size={12} className="mr-1" />}
            {hud?.paused ? "RESUME" : touch ? "PAUSE" : "PAUSE (SPACE)"}
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
      </div>

      <div className="flex min-h-0 flex-1 flex-col short:flex-row">
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

        {!fullMap && (
          <div className="absolute right-3 top-3 z-10 hidden md:block short:hidden">
            <CombatLog log={hud?.log ?? []} />
          </div>
        )}

        {/* Order hints */}
        {!fullMap && touch ? (
          <div className="pointer-events-none absolute left-2 top-2 z-10 border border-[#2E3628] bg-[#0D0F0C]/80 px-2 py-1 font-mono text-[10px] text-[#A2B29A]" data-testid="touch-hint">
            {hud?.touchBox
              ? "DRAG A BOX AROUND YOUR MEN"
              : "TAP SOLDIER: SELECT · TAP GROUND/ENEMY: ORDER · DRAG: SCROLL · HOLD+DRAG: BOX"}
          </div>
        ) : !fullMap ? (
          <div className="pointer-events-none absolute bottom-2 left-3 z-10 font-mono text-[10px] tracking-[0.12em] text-[#5A664F]">
            LMB DRAG: SELECT · RMB: MOVE / ATTACK · SHIFT+RMB: QUEUE · WASD: SCROLL · 1-5: SOLDIER · 6: ALPHA · 7: BRAVO · Q: ABILITY · C: COVER · F: FORMATION · SPACE: PAUSE
          </div>
        ) : null}
        {touch && !fullMap && (!hud || hud.state === "active") && (
          <TouchControls
            engineRef={engineRef}
            paused={hud?.paused ?? false}
            disabled={!!hud?.briefing || hud?.state !== "active"}
            formation={hud?.formation ?? "wedge"}
            touchBox={hud?.touchBox ?? false}
          />
        )}
        {!fullMap && (
        <div
          data-testid="terrain-legend"
          className="pointer-events-none absolute bottom-7 left-3 z-10 hidden gap-3 lg:flex border border-[#2E3628] bg-[#0D0F0C]/85 px-2.5 py-1.5 font-mono text-[10px] text-[#A2B29A]"
        >
          <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full border border-[#0C1607] bg-[#3F6A28] align-middle" />HEDGEROW — blocks men &amp; bullets</span>
          <span><span className="mr-1 inline-block h-2.5 w-3 rounded-full bg-[#5C4A30] align-middle" />GAP — walk through</span>
          <span><span className="mr-1 inline-block h-2.5 w-2.5 bg-[#5A3A2A] align-middle" />BUILDING</span>
          <span>✕ HEDGEHOG</span>
          <span><span className="mr-1 inline-block h-2 w-3 rounded-full bg-[#8A7A52] align-middle" />SANDBAGS / CRATES — LIGHT cover, breaks under fire</span>
          <span>RUINS / WRECKS / BUILDINGS — HEAVY cover</span>
          <span><span className="text-[#4ECDC4]">◆</span> IN COVER — teal light, <span className="text-[#E5A93C]">gold heavy</span></span>
          <span className="text-[#A0B4D2]">○ 2ND PLATOON (AI)</span>
        </div>
        )}

        {fullMap && (
          <button
            data-testid="show-controls-btn"
            onClick={toggleFullMap}
            className="absolute bottom-3 right-3 z-20 border border-[#4ECDC4] bg-[#0D0F0C]/90 px-3 py-2 font-mono text-[11px] tracking-wider text-[#4ECDC4]"
          >
            SHOW CONTROLS
          </button>
        )}

        {/* Briefing overlay */}
        {hud?.briefing && hud.state === "active" && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0D0F0C]/80 p-2 sm:p-6">
            <div
              className="flex max-h-full w-full max-w-xl flex-col border border-[#2E3628] bg-[#1A1D17]"
              data-testid="briefing-panel"
            >
              <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 short:p-3" data-testid="briefing-scroll">
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#8D9A83]">
                Operation orders · {mission.location}
              </p>
              <h2 className="mt-1 font-heading text-2xl font-bold tracking-tight text-[#F0F5EB]">
                {mission.code}
              </h2>
              <p className="mt-3 font-mono text-[13px] leading-relaxed text-[#A2B29A] short:text-[11px]">
                {mission.brief}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-1.5">
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
              </div>
              <div className="shrink-0 border-t border-[#2E3628] bg-[#1A1D17] p-3">
                <Button
                  data-testid="engage-btn"
                  size="lg"
                  className="w-full"
                  onClick={() => {
                    goLandscape();
                    engineRef.current?.begin();
                  }}
                >
                  BEGIN THE ASSAULT
                </Button>
                {touch && (
                  <p className="mt-1.5 text-center font-mono text-[10px] text-[#8D9A83]">
                    Turn your phone sideways — the battle plays in landscape
                  </p>
                )}
              </div>
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
                data-testid="debrief-replay-btn"
                variant="outline"
                size="lg"
                className="mt-3 w-full"
                onClick={() => {
                  setReplay(engineRef.current?.getReplay() ?? null);
                  setShowReplay(true);
                }}
              >
                WATCH REPLAY
              </Button>

              <Button
                data-testid="debrief-return-btn"
                size="lg"
                className="mt-5 w-full"
                onClick={() => (fileReport.isError ? fileReport.mutate(report) : navigate("/war-room"))}
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

        {/* Battle replay, recorded live during the battle */}
        {showReplay && replay && <ReplayViewer replay={replay} onClose={() => setShowReplay(false)} />}
      </div>

      {/* Squad command dock */}
      <div className="border-t border-[#2E3628] bg-[#0D0F0C] short:w-40 short:shrink-0 short:border-l short:border-t-0">
        <SquadDock
          hud={
            hud ?? {
              elapsed: 0,
              paused: false,
              briefing: true,
              state: "active",
              // Engine ids are assigned in squad order starting at 1,
              // so index+1 matches the engine's id for each man.
              units: (deployed?.squad ?? activeSquad).map((soldier, i) => ({
                id: i + 1,
                soldierId: soldier.id,
                name: soldier.name,
                rank: soldier.rank,
                level: soldier.level,
                type: soldier.type,
                hp: UNIT_TYPES[soldier.type].hp,
                maxHp: UNIT_TYPES[soldier.type].hp,
                suppression: 0,
                pinned: false,
                morale: 100,
                broken: false,
                abilityCd: 0,
                abilityCdMax: UNIT_TYPES[soldier.type].ability.cd,
                kills: soldier.kills,
                alive: true,
                orders: 0,
              })),
              selectedIds: [],
              enemiesAlive: 0,
              wave: 1,
              waves: 1,
              aimUnitId: null,
              log: [],
              formation: "wedge",
              touchBox: false,
              reinforcementsLeft: 3,
              autoBattle: false,
              teamA: [],
              teamB: [],
            }
          }
          onSelect={(id) => engineRef.current?.selectUnit(id)}
          onAbility={(id) => engineRef.current?.startAim(id)}
          onSplit={() => engineRef.current?.splitSquad()}
          onSelectTeam={(i) => engineRef.current?.selectTeam(i)}
          onMerge={() => engineRef.current?.mergeSquads()}
        />
      </div>
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

function reportBody(r: BattleReport, battleId: string | null) {
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
    battle_id: battleId ?? undefined,
    fallen: r.fallen.map((f) => ({ soldier_id: f.soldierId, cause: f.cause, kills: f.kills, ...stats(f) })),
    survivors: r.survivors.map((v) => ({ soldier_id: v.soldierId, kills: v.kills, ...stats(v) })),
  };
}
