// Interactive pixel campaign map: four operations on the road from the beaches to the
// Hürtgen, a route line, Memorial poppies, and a briefing panel (Deploy on the Active op only).
// Read-only: never mutates the save.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Flame, Medal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GameState, MemorialEntry, Mission } from "@/lib/types";
import { ENEMY_TYPES } from "@/game/data";
import { OP_POS, REGIONS, ROUTE, TOWNS, UNKNOWN_GROUND, campaignMapImage } from "./mapArt";

type Status = "SECURED" | "ACTIVE" | "LOCKED";

interface Props {
  missions: Mission[];
  state: GameState | undefined;
  memorial: MemorialEntry[];
  canDeploy: boolean;
  onDeploy: () => void;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function statusOf(m: Mission, state: GameState | undefined): Status {
  if (!state) return "LOCKED";
  if (state.campaign_complete || m.index < state.mission_index) return "SECURED";
  return m.index === state.mission_index ? "ACTIVE" : "LOCKED";
}

const shortName = (code: string) => code.replace(/^OPERATION\s+/, "");

// Tiny pixel icons (crisp rects).
function PixelIcon({ kind }: { kind: "flag" | "lock" | "star" }) {
  const rects: Array<[number, number, number, number, string]> =
    kind === "flag"
      ? [[2, 1, 1, 9, "#E3E7DC"], [3, 1, 5, 2, "#5EB872"], [3, 3, 4, 2, "#4A9A5C"]]
      : kind === "lock"
        ? [[3, 1, 4, 1, "#8D9A83"], [2, 2, 1, 3, "#8D9A83"], [7, 2, 1, 3, "#8D9A83"], [1, 5, 8, 5, "#5A664F"], [4, 6, 2, 2, "#1A1D17"]]
        : [[4, 0, 2, 2, "#FFD97D"], [2, 2, 6, 2, "#FFD97D"], [3, 4, 4, 2, "#E5A93C"], [2, 6, 2, 2, "#E5A93C"], [6, 6, 2, 2, "#E5A93C"]];
  return (
    <svg viewBox="0 0 10 10" width="14" height="14" shapeRendering="crispEdges" aria-hidden>
      {rects.map(([x, y, w, h, c], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill={c} />
      ))}
    </svg>
  );
}

function Poppy() {
  return (
    <svg viewBox="0 0 7 8" width="100%" height="100%" shapeRendering="crispEdges" aria-hidden>
      <rect x="3" y="4" width="1" height="4" fill="#3E5A2A" />
      <rect x="1" y="1" width="5" height="3" fill="#C8302A" />
      <rect x="2" y="0" width="3" height="5" fill="#C8302A" />
      <rect x="1" y="1" width="1" height="1" fill="#E24A4A" />
      <rect x="3" y="2" width="1" height="1" fill="#141108" />
    </svg>
  );
}

export default function CampaignMap({ missions, state, memorial, canDeploy, onDeploy }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [poppyId, setPoppyId] = useState<string | null>(null);
  const img = useMemo(() => campaignMapImage(), []);
  const ops = useMemo(() => [...missions].sort((a, b) => a.index - b.index), [missions]);

  // Each fallen man → a poppy in a stable cluster around the operation he died in.
  const poppies = useMemo(() => {
    const byCode = new Map(ops.map((m) => [m.code, m.index]));
    return memorial.map((f) => {
      const idx = byCode.get(f.mission_code);
      const [cx, cy] = idx !== undefined && OP_POS[idx] ? OP_POS[idx] : UNKNOWN_GROUND;
      const h = hash(f.id + f.name);
      const ang = Math.PI * (1.05 + ((h % 180) / 180) * 0.9); // arc above the marker, clear of its label
      const rad = 0.055 + ((h >>> 9) % 100) / 100 * 0.03;
      return { f, known: idx !== undefined, x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad * 1.4, delay: (h % 7) * 0.2 };
    });
  }, [memorial, ops]);
  const unknown = poppies.filter((p) => !p.known).length;

  const open = ops.find((m) => m.id === openId) ?? null;
  const openStatus = open ? statusOf(open, state) : null;
  const poppy = poppies.find((p) => p.f.id === poppyId) ?? null;
  const frontier = state ? (state.campaign_complete ? ops.length - 1 : state.mission_index) : 0;

  return (
    <div className="grid gap-3 md:grid-cols-[1fr_260px]" data-testid="campaign-map">
      <div className="relative w-full self-start overflow-hidden border-2 border-[#2A2616] bg-[#1C2A2C] shadow-[4px_4px_0_0_rgba(0,0,0,0.6)]">
        <div className="relative aspect-[16/10] w-full">
          <img
            src={img}
            alt="Field map: Normandy to the Hürtgen Forest"
            className="absolute inset-0 h-full w-full select-none [image-rendering:pixelated]"
            draggable={false}
            data-testid="campaign-map-image"
          />

          {/* Route line: fought ground solid, road ahead dashed & dim. */}
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 160 100" preserveAspectRatio="none" shapeRendering="crispEdges" aria-hidden>
            {ROUTE.map((seg, i) => {
              const d = seg.map(([x, y], k) => `${k ? "L" : "M"}${x * 160} ${y * 100}`).join(" ");
              const fought = i < frontier;
              return fought ? (
                <path key={i} d={d} fill="none" stroke="#E5A93C" strokeWidth="1.1" pathLength={100} className="map-route-draw" data-testid={`route-seg-${i}-fought`} />
              ) : (
                <path key={i} d={d} fill="none" stroke="rgba(227,231,220,0.45)" strokeWidth="0.8" strokeDasharray="2 2" className="map-route-fade" data-testid={`route-seg-${i}-ahead`} />
              );
            })}
          </svg>

          {/* Region + town labels (stencil). */}
          {REGIONS.map((r) => (
            <span
              key={r.name}
              className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-[Silkscreen] tracking-[0.25em] ${
                r.size === "lg" ? "text-[9px] text-[#C9B98A]/60 sm:text-[12px]" : "text-[7px] text-[#2A2616]/80 sm:text-[10px]"
              }`}
              style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%` }}
            >
              {r.name}
            </span>
          ))}
          {TOWNS.map((t) => (
            <span
              key={t.name}
              className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap font-[Silkscreen] text-[6px] text-[#1E1A10] sm:text-[8px]"
              style={{ left: `${t.x * 100}%`, top: `calc(${t.y * 100}% + ${t.dy === -1 ? "-14px" : "5px"})` }}
            >
              {t.name}
            </span>
          ))}

          {/* Poppies for the fallen. */}
          {poppies.map((p) => (
            <button
              key={p.f.id}
              data-testid={`map-poppy-${p.f.id}`}
              aria-label={`${p.f.rank} ${p.f.name}`}
              onClick={() => setPoppyId(p.f.id === poppyId ? null : p.f.id)}
              className="map-poppy absolute z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 p-0.5 sm:h-5 sm:w-5"
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, animationDelay: `${p.delay}s` }}
            >
              <Poppy />
            </button>
          ))}
          {unknown > 0 && (
            <span
              className="pointer-events-none absolute -translate-x-1/2 font-[Silkscreen] text-[7px] text-[#E24A4A] sm:text-[9px]"
              style={{ left: `${UNKNOWN_GROUND[0] * 100}%`, top: `calc(${UNKNOWN_GROUND[1] * 100}% + 12px)` }}
              data-testid="map-unknown-ground"
            >
              UNKNOWN GROUND
            </span>
          )}

          {/* Operation markers. */}
          {ops.map((m) => {
            const st = statusOf(m, state);
            const [x, y] = OP_POS[m.index] ?? [0.5, 0.5];
            return (
              <button
                key={m.id}
                data-testid={`map-op-${m.id}`}
                data-status={st}
                onClick={() => {
                  setOpenId(m.id);
                  setPoppyId(null);
                }}
                className="group absolute z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center border-2 shadow-[2px_2px_0_0_#050605] transition-transform duration-100 group-active:translate-x-px group-active:translate-y-px sm:h-9 sm:w-9 ${
                    st === "ACTIVE"
                      ? "animate-pixel-blink border-[#FFD97D] bg-[#3A2B0E]"
                      : st === "SECURED"
                        ? "border-[#5EB872] bg-[#17271A]"
                        : "border-[#5A664F] bg-[#1A1D17] opacity-70 grayscale"
                  } ${openId === m.id ? "outline-2 outline-offset-2 outline-[#4ECDC4]" : ""}`}
                >
                  <PixelIcon kind={st === "ACTIVE" ? "star" : st === "SECURED" ? "flag" : "lock"} />
                </span>
                <span
                  className={`mt-0.5 whitespace-nowrap border border-[#050605] px-1 font-[Silkscreen] text-[6px] leading-tight sm:text-[8px] ${
                    st === "ACTIVE" ? "bg-[#E5A93C] text-[#141108]" : st === "SECURED" ? "bg-[#17271A] text-[#5EB872]" : "bg-[#1A1D17] text-[#8D9A83]"
                  }`}
                >
                  {m.index + 1}·{shortName(m.code).split(" ").slice(-1)[0]}
                </span>
              </button>
            );
          })}

          {/* Poppy details. */}
          {poppy && (
            <div
              data-testid="map-poppy-card"
              className="absolute z-30 w-48 -translate-x-1/2 border-2 border-[#5C2626] bg-[#0D0F0C]/95 p-2 font-mono text-[11px] shadow-[3px_3px_0_0_#000]"
              style={{ left: `${Math.min(0.85, Math.max(0.15, poppy.x)) * 100}%`, top: `calc(${Math.min(0.7, poppy.y) * 100}% + 14px)` }}
            >
              <button className="absolute right-1 top-1 text-[#8D9A83]" onClick={() => setPoppyId(null)} data-testid="map-poppy-close" aria-label="Close">
                <X size={12} />
              </button>
              <p className="pr-4 font-semibold text-[#F0B4B4]" data-testid="map-poppy-name">
                {poppy.f.rank} {poppy.f.name}
              </p>
              <p className="text-[#B88080]" data-testid="map-poppy-cause">{poppy.f.cause}</p>
              <p className="text-[10px] text-[#8D9A83]">{poppy.known ? poppy.f.mission_code : "Unknown ground"}</p>
              <Link to="/memorial" className="mt-1 inline-block text-[10px] text-[#E5A93C] underline" data-testid="map-poppy-memorial-link">
                READ ON THE MEMORIAL ▸
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Briefing: beside the map on desktop, bottom sheet on phones. */}
      {open && openStatus ? (
        <Briefing
          mission={open}
          status={openStatus}
          fallen={memorial.filter((f) => f.mission_code === open.code).length}
          canDeploy={canDeploy}
          onDeploy={onDeploy}
          onClose={() => setOpenId(null)}
        />
      ) : (
        <div className="hidden border-2 border-[#2E3628] bg-[#121411] p-4 font-mono text-xs text-[#8D9A83] md:block" data-testid="map-hint">
          Tap an operation on the map to read its orders. Poppies mark where your men fell.
          <div className="mt-3 space-y-1.5 text-[11px]">
            <p className="flex items-center gap-2"><PixelIcon kind="star" /> ACTIVE — deploy from here</p>
            <p className="flex items-center gap-2"><PixelIcon kind="flag" /> SECURED</p>
            <p className="flex items-center gap-2"><PixelIcon kind="lock" /> LOCKED</p>
            <p className="flex items-center gap-2"><span className="h-3.5 w-3.5"><Poppy /></span> A fallen soldier</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Briefing({
  mission,
  status,
  fallen,
  canDeploy,
  onDeploy,
  onClose,
}: {
  mission: Mission;
  status: Status;
  fallen: number;
  canDeploy: boolean;
  onDeploy: () => void;
  onClose: () => void;
}) {
  const waves = useMemo(() => {
    const m = new Map<number, Mission["enemies"]>();
    for (const e of mission.enemies) m.set(e.wave, [...(m.get(e.wave) ?? []), e]);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [mission]);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={onClose} aria-hidden />
      <aside
        data-testid="map-briefing"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[75svh] overflow-y-auto border-t-2 border-[#2E3628] bg-[#1A1D17] p-4 shadow-[0_-4px_0_0_rgba(0,0,0,0.5)] md:static md:z-auto md:max-h-none md:border-2 md:shadow-[3px_3px_0_0_rgba(0,0,0,0.55)]"
      >
        <div className="flex items-start justify-between gap-2">
          <p
            className={`font-mono text-[10px] tracking-[0.2em] ${status === "ACTIVE" ? "text-[#E5A93C]" : status === "SECURED" ? "text-[#5EB872]" : "text-[#8D9A83]"}`}
            data-testid="map-briefing-status"
          >
            {status === "ACTIVE" ? "▸ ACTIVE" : status === "SECURED" ? "■ SECURED" : "□ LOCKED"} · OP {mission.index + 1}/4
          </p>
          <button onClick={onClose} className="text-[#8D9A83] hover:text-[#E3E7DC]" data-testid="map-briefing-close" aria-label="Close briefing">
            <X size={14} />
          </button>
        </div>
        <h3 className="mt-1 font-heading text-xl font-bold leading-tight text-[#F0F5EB]" data-testid="map-briefing-code">
          {mission.code}
        </h3>
        <p className="font-mono text-xs text-[#E5A93C]">{mission.location}</p>
        <div className="mt-2 flex flex-wrap gap-2 font-mono text-[11px]">
          <span className="border border-[#5C2626] px-1.5 text-[#E24A4A]" data-testid="map-briefing-threat">{mission.difficulty}</span>
          <span className="flex items-center gap-1 text-[#E3E7DC]" data-testid="map-briefing-reward">
            <Medal size={12} className="text-[#E5A93C]" /> {mission.reward} RP
          </span>
          <span className="text-[#F0B4B4]" data-testid="map-briefing-fallen">✝ {fallen} fell here</span>
        </div>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[#8D9A83]">Objective</p>
        <p className="font-mono text-xs text-[#E3E7DC]">{mission.objective}</p>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[#8D9A83]">Enemy intel</p>
        <div className="mt-1 space-y-1" data-testid="map-briefing-intel">
          {waves.map(([w, specs]) => (
            <p key={w} className="font-mono text-[11px] text-[#A2B29A]">
              <span className="text-[#4ECDC4]">W{w}</span> {specs.map((e) => `${ENEMY_TYPES[e.type].label} ×${e.count}`).join(" · ")}
            </p>
          ))}
        </div>
        {status === "ACTIVE" ? (
          <Button data-testid="map-deploy-btn" size="lg" className="mt-4 w-full" onClick={onDeploy} disabled={!canDeploy}>
            <Flame size={15} className="mr-2" /> DEPLOY
          </Button>
        ) : (
          <p className="mt-4 border border-[#2E3628] p-2 text-center font-mono text-[11px] text-[#8D9A83]" data-testid="map-briefing-readonly">
            {status === "SECURED" ? "Ground already taken — it cannot be fought again." : "Locked — secure the operations before it first."}
          </p>
        )}
        {status === "ACTIVE" && !canDeploy && (
          <p className="mt-1 font-mono text-[11px] text-[#E24A4A]">No men fit for duty — hire in the barracks.</p>
        )}
      </aside>
    </>
  );
}
