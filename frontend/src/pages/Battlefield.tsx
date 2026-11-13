import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pause, Play, Flag, Skull } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import BattleCanvas from "@/components/game/BattleCanvas";
import ReplayViewer from "@/components/game/ReplayViewer";
import SquadDock from "@/components/game/SquadDock";
import ItemIcon from "@/components/ItemIcon";
import TouchControls, { FORMATIONS } from "@/components/game/TouchControls";
import ReinforceMenu, { REINFORCEMENTS } from "@/components/game/ReinforceMenu";
import { PANEL, PANEL_BTN, PANEL_BTN_ACTIVE, PANEL_LABEL, PANEL_REST, PANEL_SOLID } from "@/components/game/panel";
import { RotateCw, Shield } from "lucide-react";
import Portrait from "@/components/Portrait";
import { ApiError, apiGet, apiPost, fileBattleBeacon } from "@/lib/api";
import { loadSettings, resolveTouchControls } from "@/lib/settings";
import type { BattleResult, GameState, Mission, ReinforceOut, ReinforcementKind, Soldier } from "@/lib/types";
import { GameEngine, type BattleReplay, type BattleReport, type HudSnapshot, type RadioSupportKind, type Variant } from "@/game/engine";
import { ITEM_BY_ID, UNIT_TYPES, KILL_RP, battleReward, isCowardQuirk } from "@/game/data";
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
  // Full-map view (Josh, 2026-11-12): a paused look only. It
  // hides every control sitting on top of the map and zooms
  // the engine out to the whole 4000x1350 map while the
  // battle stays paused; BACK TO LEADER resumes into the
  // camera's hard lock on the team leader. There is no live
  // free-camera mode.
  const [fullMap, setFullMap] = useState(false);
  const toggleFullMap = () => {
    const next = !fullMap;
    setFullMap(next);
    engineRef.current?.setFitMap(next);
  };
  const [variant, setVariant] = useState<Variant>("");
  // Esc battle menu (Josh, 2026-11-12): the old top bar is gone;
  // the battlefield is the whole screen and Esc (or the phone
  // MENU button) opens the pause menu that holds the rest.
  const [escOpen, setEscOpen] = useState(false);
  const [escConfirm, setEscConfirm] = useState<null | "settings" | "quit">(null);
  // Briefing leader pick: the player names his team leader; the
  // most experienced man is the default.
  const [leaderPick, setLeaderPick] = useState<string | null>(null);
  useEffect(() => {
    if (leaderPick) engineRef.current?.setLeaderPick(leaderPick);
  }, [leaderPick, hud?.briefing]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!hud || hud.briefing || hud.state !== "active") return;
      setEscOpen((open) => {
        if (open) engineRef.current?.setPaused(false);
        else engineRef.current?.setPaused(true);
        return !open;
      });
      setEscConfirm(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hud]);
  useEffect(() => {
    if (hud && hud.state !== "active") setEscOpen(false);
  }, [hud]);
  const closeEsc = (resume: boolean) => {
    setEscOpen(false);
    setEscConfirm(null);
    if (resume) engineRef.current?.setPaused(false);
  };
  // The Settings CONTROLS pick (auto / phone / computer) decides
  // which control set this battle shows, so touch and desktop
  // controls never mix on one screen. Auto keeps the old guess.
  const [touch] = useState(
    () =>
      typeof window !== "undefined" &&
      resolveTouchControls(loadSettings().controls, window.matchMedia("(pointer: coarse)").matches, window.innerWidth < 1024)
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
  // Fullscreen takeover: one request path for the rotate prompt,
  // BEGIN THE ASSAULT and the FULLSCREEN button. On touch it also
  // tries the landscape lock. iPhone Safari refuses element
  // fullscreen (no lock either) — the catch keeps it a quiet no-op
  // there, and the rotate prompt / home-screen app covers it.
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    const on = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const enterFullscreen = () => {
    const el = document.documentElement;
    const lock = () => {
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      return o?.lock ? o.lock("landscape") : Promise.reject(new Error("no lock"));
    };
    (el.requestFullscreen ? el.requestFullscreen() : Promise.resolve())
      .then(() => (touch ? lock() : undefined))
      .catch(() => {
        /* iOS / desktop: no orientation lock — the rotate prompt covers it */
      });
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    enterFullscreen();
  };
  const goLandscape = () => {
    if (!touch) return;
    enterFullscreen();
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
  // The briefing default: the most experienced man deployed,
  // same order the engine uses (rank, then level, then kills).
  const RANK_LADDER = ["Pvt.", "Pfc.", "Cpl.", "Sgt.", "S/Sgt.", "T/Sgt.", "1st Sgt."];
  const defaultLeaderId = (() => {
    let best: Soldier | null = null;
    for (const sol of deployed?.squad ?? activeSquad) {
      if (!best) { best = sol; continue; }
      const ra = RANK_LADDER.indexOf(sol.rank), rb = RANK_LADDER.indexOf(best.rank);
      if (ra !== rb) { if (ra > rb) best = sol; continue; }
      if (sol.level !== best.level) { if (sol.level > best.level) best = sol; continue; }
      if (sol.kills !== best.kills) { if (sol.kills > best.kills) best = sol; continue; }
    }
    return best?.id ?? null;
  })();
  const effectiveLeaderId = leaderPick ?? defaultLeaderId;

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

  // Radio support: check the engine gates first, then charge the
  // discounted RP on the backend, then fire the call. The backend is
  // the money — it checks the radio is up and deducts the RP — and
  // the engine is the rules (level, cooldown, once-per-battle).
  // Fire a support call in the engine; shared by the paid path
  // and the code book's free one.
  const fireSupport = (kind: RadioSupportKind): boolean => {
    const e = engineRef.current;
    if (!e) return false;
    if (kind === "artillery") return e.callArtillery();
    if (kind === "supply") return e.callSupplyDrop();
    if (kind === "recon") return e.callRecon();
    if (kind === "mortar") return e.callMortarStrike();
    if (kind === "smoke") return e.callSmokeScreen();
    return e.callTank();
  };

  const radioSupport = useMutation({
    mutationFn: (kind: RadioSupportKind) =>
      apiPost<{ kind: string; cost: number; requisition: number }>("/battle/radio-support", { mission_id: mission?.id, kind }),
    onSuccess: (res) => {
      fireSupport(res.kind as RadioSupportKind);
      qc.setQueryData<GameState>(["state"], (old) => (old ? { ...old, requisition: res.requisition } : old));
      toast.success(`${res.kind} called in — ${res.cost} RP spent (${res.requisition} RP left)`);
    },
    onError: (e) =>
      toast.error(e instanceof ApiError && e.status === 402 ? "Not enough requisition for that call" : "Radio is dead — try again"),
  });
  const callSupport = (kind: RadioSupportKind) => {
    const e = engineRef.current;
    if (!e || !e.canSupport(kind)) return;
    // The Code Book (radioman class item): the first paid call
    // of the battle is covered — no backend charge at all. If
    // the covered call cannot fire after all, the book keeps
    // its page for the next one.
    if (e.codeBookCovers()) {
      if (fireSupport(kind)) toast.success(`${kind} called in — the code book covered it (0 RP)`);
      else e.refundFreeCall();
      return;
    }
    if ((state?.requisition ?? 0) < (hud?.supportCost?.[kind] ?? 0)) return;
    radioSupport.mutate(kind);
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
      void fileBattleBeacon(reportBody(r, battleIdRef.current)).then(() => {
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
      <div className="flex min-h-0 flex-1 flex-col short:flex-row">
      {/* Battlefield */}
      <div className="scanlines relative min-h-0 flex-1 overflow-hidden bg-[#080A08]">
        <BattleCanvas
          key={mission.id + variant}
          mission={mission}
          variant={variant}
          squad={deployed?.squad ?? activeSquad}
          commanderBonus={state?.combat_bonus ?? 0}
          commanderLevel={state?.commander_level ?? 1}
          onHud={onHud}
          engineRef={engineRef}
        />

        {/* The battlefield owns the screen now. What stays on it:
            a tiny status line, the live controls in the corner
            (orders, formation, radio, cover, pause), and on touch
            one MENU button. Everything else lives in the Esc
            menu. The old in-battle hints and the terrain legend
            moved to the briefing. */}
        {!fullMap && !hud?.briefing && (
          <div className={`pointer-events-none absolute left-2 top-2 z-10 flex flex-wrap items-center gap-x-2.5 px-2 py-1 font-mono text-[10px] ${PANEL}`} data-testid="battle-status">
            <span className="font-bold tracking-wider text-[#F0F5EB]">{mission.code}</span>
            <span className="text-[#E5A93C]" data-testid="battle-rp">{state?.requisition ?? "—"} RP</span>
            <span className="text-[#8D9A83]" data-testid="battle-timer">T+{mmss(hud?.elapsed ?? 0)}</span>
            <span className="text-[#4ECDC4]" data-testid="battle-wave">WAVE {hud?.wave ?? 1}/{hud?.waves ?? 1}</span>
            <span className="text-[#E24A4A]" data-testid="battle-hostiles">HOSTILES {hud?.enemiesAlive ?? "—"}</span>
            <span className={hud?.radioLive ? "text-[#5EB872]" : "text-[#E24A4A]"} data-testid="radio-status" title={hud?.radioLive ? "Radioman alive, radio support is up" : "No radioman, radio support is down"}>
              RADIO {hud?.radioLive ? "● LIVE" : "✕ DOWN"}
            </span>
            <span className={hud?.enemyRadioLive ? "text-[#E24A4A]" : "text-[#5EB872]"} data-testid="enemy-radio-status">
              FOE {hud?.enemyRadioLive ? "● LIVE" : "✕ DOWN"}
            </span>
            {hud?.paused && (
              <span className="font-bold tracking-[0.2em] text-[#FFD97D]" data-testid="paused-banner">❚❚ PAUSED</span>
            )}
          </div>
        )}
        {hud?.retreating && hud?.state === "active" && (
          <div
            data-testid="retreat-banner"
            className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 border border-[#B3402E] bg-[#2A0E08]/85 px-4 py-2 text-center shadow-[0_2px_12px_rgba(0,0,0,0.5)]"
          >
            <div className="font-mono text-[12px] font-bold tracking-[0.2em] text-[#FF8A70]">RETREATING — AUTO</div>
            <div className="mt-0.5 font-mono text-[10px] tracking-wider text-[#E3E7DC]">
              Your squad is falling back on its own. Control is gone until the battle is filed.
            </div>
          </div>
        )}
        {touch && !fullMap && !hud?.briefing && hud?.state === "active" && (
          <button
            data-testid="esc-menu-btn"
            onClick={() => { engineRef.current?.setPaused(true); setEscOpen(true); }}
            className={`absolute right-2 top-2 z-20 px-3 py-2 font-mono text-[11px] tracking-wider text-[#E3E7DC] ${PANEL} ${PANEL_REST}`}
          >
            ☰ MENU
          </button>
        )}
        {!fullMap && !hud?.briefing && hud?.state === "active" && (
          <button
            data-testid="fullscreen-btn"
            onClick={toggleFullscreen}
            className={`absolute right-2 z-20 px-3 py-2 font-mono text-[11px] tracking-wider text-[#E3E7DC] ${touch ? "top-14" : "top-2"} ${PANEL} ${PANEL_REST}`}
          >
            {isFs ? "⛶ EXIT FULLSCREEN" : "⛶ FULLSCREEN"}
          </button>
        )}
        {!touch && !fullMap && !hud?.briefing && hud?.state === "active" && (
          <div className={`absolute bottom-2 right-2 z-20 flex flex-col gap-1.5 p-1.5 ${PANEL} ${PANEL_REST}`} data-testid="battle-controls">
            <div className="flex items-center gap-1" data-testid="order-controls" title="Squad orders: your men follow the leader under the order given">
              {([
                ["attack", "ATTACK", "1"],
                ["defend", "DEFEND", "2"],
                ["formup", "FORM UP", "3"],
              ] as const).map(([id, label, key]) => (
                <button
                  key={id}
                  data-testid={`order-${id}`}
                  onClick={() => engineRef.current?.setSquadOrder(id)}
                  className={`px-2 py-1.5 text-[10px] ${PANEL_BTN} ${(hud?.squadOrder ?? "formup") === id ? PANEL_BTN_ACTIVE : ""}`}
                >
                  {label} <span className="opacity-60">{key}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1 border-t border-[#2E3628] pt-1.5">
              {!touch && (
                <div className="flex items-center gap-1" data-testid="formation-picker" title="Formation (F)">
                  {FORMATIONS.map((f) => (
                    <button
                      key={f.id}
                      data-testid={`formation-${f.id}`}
                      onClick={() => engineRef.current?.setFormation(f.id)}
                      className={`px-1.5 py-1 text-[10px] ${PANEL_BTN} ${(hud?.formation ?? "wedge") === f.id ? PANEL_BTN_ACTIVE : ""}`}
                    >
                      {f.glyph} {f.label}
                    </button>
                  ))}
                </div>
              )}
              <ReinforceMenu
                rp={state?.requisition ?? 0}
                left={hud?.reinforcementsLeft ?? 3}
                disabled={hud?.state !== "active"}
                pending={reinforce.isPending}
                radioLive={hud?.radioLive ?? false}
                commanderLevel={state?.commander_level ?? 1}
                supportCd={hud?.supportCd ?? { artillery: 0, supply: 0, recon: 0, mortar: 20, smoke: 0, tank: 0, rally: 0 }}
                tankUsed={hud?.tankUsed ?? false}
                supportCost={hud?.supportCost ?? { artillery: 30, supply: 10, recon: 10, mortar: 20, smoke: 15, tank: 60 }}
                reinforceCost={hud?.reinforceCost ?? { rifle: 15, heavy: 25 }}
                onCall={callIn}
                onSupport={callSupport}
                onRally={() => engineRef.current?.callRally()}
                placement="up"
              />
              <button
                data-testid="take-cover-btn"
                onClick={() => engineRef.current?.takeCover()}
                title="Leader takes cover (C)"
                className={`flex items-center px-2 py-1.5 text-[10px] ${PANEL_BTN}`}
              >
                <Shield size={12} className="mr-1" /> COVER
              </button>
              <button
                data-testid="tactical-pause-btn"
                onClick={() => engineRef.current?.togglePause()}
                className={`flex items-center px-2 py-1.5 text-[10px] ${PANEL_BTN}`}
              >
                {hud?.paused ? <Play size={12} className="mr-1" /> : <Pause size={12} className="mr-1" />}
                {hud?.paused ? "RESUME" : "PAUSE"}
              </button>
            </div>
          </div>
        )}
        {escOpen && !hud?.briefing && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#0D0F0C]/80 p-4" data-testid="esc-menu">
            <div className={`w-full max-w-sm p-4 ${PANEL_SOLID}`}>
              <p className={PANEL_LABEL}>Battle menu</p>
              <h3 className="mt-1 font-heading text-xl font-bold text-[#F0F5EB]">{mission.code} — PAUSED</h3>
              <div className="mt-4 flex flex-col gap-2">
                <Button data-testid="esc-resume" onClick={() => closeEsc(true)}>RESUME</Button>
                <Button data-testid="esc-fullmap" variant="outline" onClick={() => { toggleFullMap(); closeEsc(false); }}>
                  FULL MAP — PAUSED LOOK
                </Button>
                <div className="flex items-center justify-between border-t border-[#2E3628] pt-2">
                  <span className={PANEL_LABEL}>REINFORCE / RADIO</span>
                  <ReinforceMenu
                    rp={state?.requisition ?? 0}
                    left={hud?.reinforcementsLeft ?? 3}
                    disabled={hud?.state !== "active"}
                    pending={reinforce.isPending}
                    radioLive={hud?.radioLive ?? false}
                    commanderLevel={state?.commander_level ?? 1}
                    supportCd={hud?.supportCd ?? { artillery: 0, supply: 0, recon: 0, mortar: 20, smoke: 0, tank: 0, rally: 0 }}
                    tankUsed={hud?.tankUsed ?? false}
                    supportCost={hud?.supportCost ?? { artillery: 30, supply: 10, recon: 10, mortar: 20, smoke: 15, tank: 60 }}
                    reinforceCost={hud?.reinforceCost ?? { rifle: 15, heavy: 25 }}
                    onCall={callIn}
                    onSupport={callSupport}
                    onRally={() => engineRef.current?.callRally()}
                  />
                </div>
                <Button
                  data-testid="esc-retreat"
                  variant="destructive"
                  disabled={hud?.retreating}
                  onClick={() => { closeEsc(false); engineRef.current?.setPaused(false); engineRef.current?.retreat(); }}
                >
                  <Flag size={12} className="mr-1" /> {hud?.retreating ? "RETREATING — CONTROL IS GONE" : "RETREAT — SQUAD FALLS BACK ON ITS OWN"}
                </Button>
                {escConfirm ? (
                  <div className="border border-[#E5A93C] bg-[#3A2B0E] p-2.5" data-testid="esc-confirm">
                    <p className="font-mono text-[11px] leading-relaxed text-[#FFD97D]">
                      Leave this battle? It has not been filed, so the campaign will not count it.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="destructive" data-testid="esc-confirm-leave" onClick={() => navigate(escConfirm === "settings" ? "/settings" : "/war-room")}>
                        LEAVE
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEscConfirm(null)}>STAY</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button className="flex-1" variant="outline" data-testid="esc-settings" onClick={() => setEscConfirm("settings")}>SETTINGS</Button>
                    <Button className="flex-1" variant="outline" data-testid="esc-quit" onClick={() => setEscConfirm("quit")}>QUIT TO WAR ROOM</Button>
                  </div>
                )}
                <p className="mt-1 text-center font-mono text-[10px] text-[#8D9A83]">ESC closes this menu</p>
              </div>
            </div>
          </div>
        )}

        {touch && !fullMap && (!hud || hud.state === "active") && (
          <TouchControls
            engineRef={engineRef}
            paused={hud?.paused ?? false}
            disabled={!!hud?.briefing || hud?.state !== "active"}
            formation={hud?.formation ?? "wedge"}
            squadOrder={hud?.squadOrder ?? "formup"}
            radioSlot={(
              <ReinforceMenu
                rp={state?.requisition ?? 0}
                left={hud?.reinforcementsLeft ?? 3}
                disabled={!!hud?.briefing || hud?.state !== "active"}
                pending={reinforce.isPending}
                radioLive={hud?.radioLive ?? false}
                commanderLevel={state?.commander_level ?? 1}
                supportCd={hud?.supportCd ?? { artillery: 0, supply: 0, recon: 0, mortar: 20, smoke: 0, tank: 0, rally: 0 }}
                tankUsed={hud?.tankUsed ?? false}
                supportCost={hud?.supportCost ?? { artillery: 30, supply: 10, recon: 10, mortar: 20, smoke: 15, tank: 60 }}
                reinforceCost={hud?.reinforceCost ?? { rifle: 15, heavy: 25 }}
                onCall={callIn}
                onSupport={callSupport}
                onRally={() => engineRef.current?.callRally()}
                align="left"
              />
            )}
          />
        )}

        {fullMap && (
          <button
            data-testid="show-controls-btn"
            onClick={() => { toggleFullMap(); engineRef.current?.setPaused(false); }}
            className={`absolute bottom-3 right-3 z-20 px-3 py-2 font-mono text-[11px] tracking-wider text-[#4ECDC4] ${PANEL} ${PANEL_REST}`}
          >
            BACK TO LEADER
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
              <div className="mt-4 border border-[#E5A93C]/50 bg-[#3A2B0E]/40 px-3 py-2" data-testid="leader-pick">
                <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#E5A93C]">Team leader — pick who you drive</p>
                <p className="mt-1 font-mono text-[11px] leading-relaxed text-[#A2B29A]">
                  {touch ? (
                    <>
                      You control the leader: the left stick moves him, the FIRE ring shoots, ABILITY uses
                      his ability. The rest of the squad follows him under your orders: ATTACK, DEFEND,
                      FORM UP, and the formation button. If he falls, the next most experienced man takes over.
                    </>
                  ) : (
                    <>
                      You control the leader: WASD moves him, left click shoots, right click (or Q) uses his
                      ability. The rest of the squad follows him under your orders: 1 ATTACK, 2 DEFEND,
                      3 FORM UP, with F for formation. If he falls, the next most experienced man takes over.
                    </>
                  )}
                </p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                {(deployed?.squad ?? activeSquad).map((s, i) => {
                  const picked = effectiveLeaderId === s.id;
                  return (
                    <button
                      key={s.id}
                      data-testid={`briefing-soldier-${i}`}
                      onClick={() => setLeaderPick(s.id)}
                      className={`flex items-center justify-between gap-2 border px-2 py-1.5 text-left font-mono text-[11px] transition-colors duration-150 ${
                        picked ? "border-[#E5A93C] bg-[#3A2B0E]" : "border-[#2E3628] bg-[#22271E] hover:border-[#E5A93C]"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2 text-[#EDEDE2]">
                        <Portrait seed={s.portrait_seed} type={s.type} level={s.level} size={24} />
                        <span className="truncate">
                          {s.rank} {s.name}
                          <span className="block text-[10px] text-[#8D9A83]">Lv {s.level} · {s.kills} kills</span>
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[#E5A93C]">{UNIT_TYPES[s.type].label}</span>
                        {picked && <span className="block text-[9px] tracking-wider text-[#FFD97D]">★ LEADER</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 grid gap-1 font-mono text-[10px] leading-relaxed text-[#8D9A83]" data-testid="briefing-legend">
                <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full border border-[#0C1607] bg-[#3F6A28] align-middle" />HEDGEROW — blocks men &amp; bullets, gaps walk through</span>
                <span><span className="mr-1 inline-block h-2 w-3 rounded-full bg-[#8A7A52] align-middle" />SANDBAGS / CRATES — LIGHT cover, breaks under fire · RUINS / WRECKS / BUILDINGS — HEAVY cover</span>
                <span><span className="mr-1 inline-block h-2.5 w-4 bg-[#2E2114] align-middle ring-1 ring-[#6B5232]" />TRENCH — BEST cover in the game, fight from inside · ✕ HEDGEHOG — slows the landing force</span>
                <span><span className="text-[#4ECDC4]">◆</span> IN COVER — teal light, <span className="text-[#E5A93C]">gold heavy</span>, <span className="text-[#7A5A2E]">brown trench</span> · <span className="text-[#A0B4D2]">○ 2ND PLATOON (AI)</span></span>
                <span>ESC opens the battle menu: full map, reinforcements, retreat, settings, quit. Radio support stays on the RADIO button in the corner, no menu needed mid-fight.</span>
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

              {(() => {
                const kills =
                  report.fallen.reduce((n, f) => n + f.kills, 0) +
                  report.deserted.reduce((n, f) => n + f.kills, 0) +
                  report.survivors.reduce((n, v) => n + v.kills, 0);
                const earned = battleReward(mission.reward, report.victory, kills, report.lootRp);
                const lootPart = report.lootRp > 0 ? ` + ${report.lootRp} from supply crates` : "";
                return (
                  <p className="mt-2 font-mono text-sm text-[#E5A93C]" data-testid="debrief-reward">
                    {report.victory
                      ? `+${earned} requisition points (${mission.reward} mission reward + ${kills * KILL_RP} for ${kills} kills${lootPart})`
                      : `+${earned} requisition points for ${kills} kills, win or lose${lootPart}`}
                  </p>
                );
              })()}

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

              {report.deserted.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8D9A83]">
                    Deserted — broke and ran, gone from the roster
                  </p>
                  {report.deserted.map((f, i) => {
                    const gone = (deployed?.squad ?? []).find((s) => s.id === f.soldierId);
                    return (
                      <div
                        key={i}
                        data-testid={`debrief-deserted-${i}`}
                        className="flex items-center justify-between border border-[#5C4A26] bg-[#221A12] px-3 py-2 font-mono text-xs"
                      >
                        <span className="flex items-center gap-2 text-[#E5C98A]">
                          <Flag size={13} /> {gone ? `${gone.name}` : "Unknown soldier"}
                        </span>
                        <span className="text-[#B8A078]">
                          {f.cause} · {f.kills} kills
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

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

              {fileReport.data && (
                <div className="mt-3 space-y-1" data-testid="debrief-earned">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#8D9A83]">
                    Earned — the Barracks ledger
                  </p>
                  {report.survivors
                    .filter((s) => (fileReport.data!.points_gained[s.soldierId] ?? 0) > 0)
                    .map((s) => {
                      const a = (deployed?.squad ?? []).find((x) => x.id === s.soldierId);
                      return (
                        <p key={s.soldierId} className="font-mono text-xs text-[#E5A93C]" data-testid={`debrief-points-${s.soldierId}`}>
                          {a?.name ?? "?"} +{fileReport.data!.points_gained[s.soldierId]} upgrade pts
                        </p>
                      );
                    })}
                  {fileReport.data.items_gained.map((g, i) => (
                    <p key={i} className="flex items-center gap-2 font-mono text-xs text-[#5EB872]" data-testid={`debrief-item-${i}`}>
                      <ItemIcon id={g.item} size={26} plate={false} />
                      <span>Stores +1: {ITEM_BY_ID[g.item]?.label ?? g.item} ({g.source === "loot" ? "from a battlefield crate" : "victory award"})</span>
                    </p>
                  ))}
                  {fileReport.data.gear_lost.length > 0 && (
                    <p className="font-mono text-xs text-[#E24A4A]" data-testid="debrief-gear-lost">
                      Lost with the fallen: {fileReport.data.gear_lost.map((item) => ITEM_BY_ID[item]?.label ?? item).join(", ")}
                    </p>
                  )}
                </div>
              )}

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
                reloading: false,
                coward: isCowardQuirk(soldier.quirk),
                abilityCd: 0,
                abilityCdMax: UNIT_TYPES[soldier.type].ability.cd,
                kills: soldier.kills,
                alive: true,
                diedAt: null,
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
              radioLive: false,
              supportCd: { artillery: 0, supply: 0, recon: 0, mortar: 0, smoke: 0, tank: 0, rally: 0 },
              tankUsed: false,
              supportCost: { artillery: 30, supply: 10, recon: 10, mortar: 20, smoke: 15, tank: 60 },
              reinforceCost: { rifle: 15, heavy: 25 },
              enemyRadioLive: false,
              autoBattle: false,
              retreating: false,
              leaderId: null,
              squadOrder: "formup" as const,
              teamA: [],
              teamB: [],
            }
          }
          onSelect={(id) => engineRef.current?.focusUnit(id)}
          onAbility={(id) => engineRef.current?.startAim(id)}
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
    deserted: r.deserted.map((f) => ({ soldier_id: f.soldierId, cause: f.cause, kills: f.kills, ...stats(f) })),
    loot_rp: r.lootRp,
    loot_item: r.lootItem ?? undefined,
    survivors: r.survivors.map((v) => ({ soldier_id: v.soldierId, kills: v.kills, ...stats(v) })),
  };
}
