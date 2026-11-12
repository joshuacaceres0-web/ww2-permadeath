import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { BattleReplay, ReplayObstacle } from "@/game/engine";

/** Ruin walls, hedgerows and buildings are built from overlapping
 * blocker circles on purpose, so a wall reads as one wall in the
 * game. Drawing every circle separately on the replay map made 169
 * overlapping pairs look like a mess. Merge any same-kind obstacles
 * that touch into one cluster and draw one shape per cluster. */
export function moraleBarColor(morale: number, broken: boolean): string {
  if (broken) return "#E24A4A";
  if (morale > 60) return "#7FB069";
  if (morale > 30) return "#E5A93C";
  return "#E24A4A";
}

export function mergeObstacles(obstacles: ReplayObstacle[]) {
  const parent = obstacles.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < obstacles.length; i++) {
    for (let j = i + 1; j < obstacles.length; j++) {
      const a = obstacles[i];
      const b = obstacles[j];
      if (a.kind !== b.kind) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map<number, ReplayObstacle[]>();
  obstacles.forEach((o, i) => {
    const g = groups.get(find(i)) ?? [];
    g.push(o);
    groups.set(find(i), g);
  });
  return [...groups.values()].map((g) => {
    const kind = g[0].kind;
    const minX = Math.min(...g.map((o) => o.x - o.r));
    const maxX = Math.max(...g.map((o) => o.x + o.r));
    const minY = Math.min(...g.map((o) => o.y - o.r));
    const maxY = Math.max(...g.map((o) => o.y + o.r));
    return { kind, x: (minX + maxX) / 2, y: (minY + maxY) / 2, r: Math.max((maxX - minX) / 2, (maxY - minY) / 2), w: maxX - minX, h: maxY - minY, count: g.length };
  });
}

/** Plays back the battle just fought, from the frames the engine
 * recorded every 0.5s. Green = your squad, teal = 2nd Platoon,
 * red = enemy, faded = dead. */
export default function ReplayViewer({ replay, onClose }: { replay: BattleReplay; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(2);
  const idxRef = useRef(0);
  const playingRef = useRef(true);
  const speedRef = useRef(2);
  idxRef.current = idx;
  playingRef.current = playing;
  speedRef.current = speed;

  const drawFrame = useCallback(
    (frameIdx: number) => {
      const cv = canvasRef.current;
      if (!cv) return;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      const sx = cv.width / replay.mapW;
      const sy = cv.height / replay.mapH;
      const draw = (frameIdx: number) => {
      const f = replay.frames[Math.min(frameIdx, replay.frames.length - 1)];
      if (!f) return;
      ctx.fillStyle = "#141a12";
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.strokeStyle = "#2E3628";
      for (let x = 0; x < cv.width; x += 100) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, cv.height);
        ctx.stroke();
      }
      for (let y = 0; y < cv.height; y += 100) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(cv.width, y);
        ctx.stroke();
      }
      ctx.fillStyle = "#E5A93C";
      ctx.font = "bold 16px monospace";
      ctx.fillText("REPLAY", 12, 24);
      // Trees, ruins and every other obstacle, merged so overlapping
      // pieces draw as one shape: trees green, ruins grey stone,
      // buildings brown, hedgerows dark green, wrecks / hedgehogs /
      // pillboxes dark steel, crates and bushes tan.
      for (const o of mergeObstacles(replay.obstacles ?? [])) {
        const x = o.x * sx;
        const y = o.y * sy;
        const r = Math.max(3, o.r * sx);
        const w = Math.max(3, (o.w * sx) / 2);
        const h = Math.max(3, (o.h * sy) / 2);
        if (o.kind === "tree") {
          ctx.fillStyle = "#2D5222";
          ctx.beginPath();
          ctx.arc(x, y, r, 0, 7);
          ctx.fill();
          ctx.fillStyle = "#7CFC66";
          ctx.beginPath();
          ctx.arc(x, y, r * 0.45, 0, 7);
          ctx.fill();
        } else if (o.kind === "ruin" || o.kind === "building" || o.kind === "crate" || o.kind === "bush") {
          ctx.fillStyle = o.kind === "ruin" ? "#8C877A" : o.kind === "building" ? "#5A3A2A" : "#6B5232";
          ctx.fillRect(x - w, y - h, w * 2, h * 2);
        } else if (o.kind === "hedgerow") {
          ctx.fillStyle = "#2C4A1C";
          ctx.beginPath();
          ctx.arc(x, y, r, 0, 7);
          ctx.fill();
        } else {
          ctx.fillStyle = "#3A3E30";
          ctx.beginPath();
          ctx.arc(x, y, r, 0, 7);
          ctx.fill();
        }
      }
      const prev = replay.frames[Math.max(0, frameIdx - 1)];
      const prevById = new Map(prev ? prev.units.map((pu) => [pu.id, pu]) : []);
      for (const u of f.units) {
        const x = u.x * sx;
        const y = u.y * sy;
        const morale = u.morale ?? 100;
        const broken = u.broken ?? false;
        const coverType = u.coverType ?? (u.cover ? "light" : null);
        const isMedic = u.medic ?? false;
        ctx.globalAlpha = u.alive ? 1 : 0.25;
        // Heal glow: his HP rose since the last frame, so a medic
        // patched him up — a green ring around the man.
        const healed = u.alive && (prevById.get(u.id)?.hp ?? u.hp) < u.hp;
        if (healed) {
          ctx.strokeStyle = "#7CFC66";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, 11, 0, 7);
          ctx.stroke();
        }
        ctx.fillStyle = u.side === "axis" ? "#E24A4A" : u.npc ? "#4ECDC4" : "#7CFC66";
        ctx.beginPath();
        ctx.arc(x, y, u.side === "axis" ? 6 : 7, 0, 7);
        ctx.fill();
        if (u.alive) {
          // Health bar above the man, for every side, not just the squad.
          ctx.fillStyle = "#0D0F0C";
          ctx.fillRect(x - 11, y - 15, 22, 4);
          ctx.fillStyle = u.side === "axis" ? "#E24A4A" : u.npc ? "#4ECDC4" : "#7CFC66";
          ctx.fillRect(x - 10, y - 14, 20 * Math.max(0, u.hp / u.maxHp), 2);
          // Morale bar directly under the health bar.
          ctx.fillStyle = "#0D0F0C";
          ctx.fillRect(x - 11, y - 10, 22, 4);
          ctx.fillStyle = moraleBarColor(morale, broken);
          ctx.fillRect(x - 10, y - 9, 20 * Math.max(0, morale / 100), 2);
          // Directional cover shield, same colours as the live game:
          // teal for light cover, gold for heavy.
          if (coverType) {
            ctx.fillStyle = "#0D0F0C";
            ctx.fillRect(x - 17, y - 2, 6, 6);
            ctx.fillStyle = coverType === "heavy" ? "#E5A93C" : "#4ECDC4";
            ctx.fillRect(x - 16, y - 1, 4, 4);
          }
          // Medic cross above the bars, both sides.
          if (isMedic) {
            ctx.fillStyle = "#F0F5EB";
            ctx.fillRect(x - 4, y - 26, 8, 8);
            ctx.fillStyle = "#E24A4A";
            ctx.fillRect(x - 1, y - 25, 2, 6);
            ctx.fillRect(x - 3, y - 23, 6, 2);
          }
          if (broken) {
            ctx.fillStyle = "#E24A4A";
            ctx.font = "bold 9px monospace";
            ctx.fillText("BROKEN", x + 9, y + 14);
          }
        }
        if (u.side === "allies" && !u.npc && u.alive) {
          ctx.fillStyle = "#F0F5EB";
          ctx.font = "11px monospace";
          ctx.fillText(u.name.split(" ").pop() ?? "", x + 9, y + 4);
        }
        ctx.globalAlpha = 1;
      }
    };
      draw(frameIdx);
    },
    [replay],
  );

  // Draw whenever the frame changes, including while paused: scrubbing
  // the slider while paused must still show the frame you scrubbed to.
  useEffect(() => {
    drawFrame(idx);
  }, [idx, replay, drawFrame]);

  // Playback loop. This effect re-runs when play/pause flips, so
  // pressing PLAY after a pause actually restarts the loop. The old
  // loop lived in the mount-only effect and died on the first pause:
  // tick() returned early without scheduling another frame, and
  // nothing ever started it again, so PLAY looked dead.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = 0;
    const tick = (ts: number) => {
      if (!last) last = ts;
      const dt = ((ts - last) / 1000) * speedRef.current;
      last = ts;
      const next = Math.min(replay.frames.length - 1, idxRef.current + dt / 0.5);
      idxRef.current = next;
      setIdx(Math.floor(next));
      if (next >= replay.frames.length - 1) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, replay]);

  const frame = replay.frames[Math.min(idx, replay.frames.length - 1)];
  const squadAlive = frame ? frame.units.filter((u) => u.side === "allies" && !u.npc && u.alive).length : 0;
  const foesAlive = frame ? frame.units.filter((u) => u.side === "axis" && u.alive).length : 0;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-[#0D0F0C]/95 p-4" data-testid="replay-viewer">
      <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
        <span className="font-heading text-sm font-bold tracking-wider text-[#F0F5EB]">BATTLE REPLAY — {replay.mission}</span>
        <span className="text-[#E5A93C]">T+{(frame?.t ?? 0).toFixed(1)}s</span>
        <span className="text-[#4ECDC4]">WAVE {frame?.wave ?? 1}</span>
        <span className="text-[#A2B29A]">
          Squad alive {squadAlive}/5 · Enemies alive {foesAlive} · {replay.result.toUpperCase()}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <Button data-testid="replay-play-btn" variant="outline" size="lg" className="h-11 px-4" onClick={() => setPlaying((p) => !p)}>
            {playing ? "❚❚ PAUSE" : "▶ PLAY"}
          </Button>
          <Button
            data-testid="replay-restart-btn"
            variant="outline"
            size="lg"
            className="h-11 px-4"
            onClick={() => {
              idxRef.current = 0;
              setIdx(0);
              setPlaying(true);
            }}
          >
            ↺ RESTART
          </Button>
          <span className="flex items-center gap-1" data-testid="replay-speed">
            {[1, 2, 4].map((s) => (
              <Button
                key={s}
                data-testid={`replay-speed-${s}`}
                variant="outline"
                size="lg"
                className={`h-11 min-w-11 px-2 ${speed === s ? "border-[#E5A93C] text-[#E5A93C]" : ""}`}
                onClick={() => setSpeed(s)}
              >
                {s}x
              </Button>
            ))}
          </span>
          <Button data-testid="replay-close-btn" variant="outline" size="lg" className="h-11 px-4" onClick={onClose}>
            CLOSE
          </Button>
        </span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className="shrink-0 font-mono text-[11px] text-[#8D9A83]">T+0s</span>
        <input
          data-testid="replay-scrub"
          type="range"
          min={0}
          max={Math.max(0, replay.frames.length - 1)}
          value={idx}
          className="h-8 w-full accent-[#E5A93C]"
          onChange={(e) => {
            const v = Number(e.target.value);
            idxRef.current = v;
            setIdx(v);
          }}
        />
        <span className="shrink-0 font-mono text-[11px] text-[#8D9A83]">
          T+{(replay.frames[replay.frames.length - 1]?.t ?? 0).toFixed(0)}s
        </span>
      </div>
      <div className="mt-3 flex min-h-0 flex-1 items-center justify-center">
        <canvas ref={canvasRef} width={1200} height={675} className="aspect-video h-full w-full border border-[#2E3628] bg-[#141a12] object-contain" />
      </div>
      <p className="mt-2 font-mono text-[11px] leading-relaxed text-[#8D9A83]">
        <span className="text-[#7CFC66]">● Your squad</span> · <span className="text-[#4ECDC4]">● 2nd Platoon</span> ·{" "}
        <span className="text-[#E24A4A]">● Enemy</span> · Faded = dead
        <br />
        Bars above each man: health on top, morale below it (green holds, amber wavers, red about to break, BROKEN = fell back).{" "}
        <span className="text-[#F0F5EB]">✚ Medic</span> · <span className="text-[#4ECDC4]">■ Light cover</span> ·{" "}
        <span className="text-[#E5A93C]">■ Heavy cover</span> · <span className="text-[#7CFC66]">○ Healed this frame</span>
        <br />
        Obstacles: <span className="text-[#7CFC66]">● Tree</span> · <span className="text-[#B8B2A4]">■ Ruin</span> ·{" "}
        <span className="text-[#C08A5A]">■ Building</span> · <span className="text-[#5A8A3A]">● Hedgerow</span> ·{" "}
        <span className="text-[#9A9A8A]">● Wreck / steel</span>
      </p>
    </div>
  );
}
