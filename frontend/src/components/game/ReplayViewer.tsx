import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { BattleReplay } from "@/game/engine";

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

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const sx = cv.width / replay.mapW;
    const sy = cv.height / replay.mapH;
    let raf = 0;
    let last = 0;
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
      // Trees, ruins and every other obstacle, exactly where the
      // engine put them: trees green, ruins grey stone, buildings
      // brown, hedgerows dark green, wrecks / hedgehogs / pillboxes
      // dark steel, crates and bushes tan.
      for (const o of replay.obstacles ?? []) {
        const x = o.x * sx;
        const y = o.y * sy;
        const r = Math.max(3, o.r * sx);
        if (o.kind === "tree") {
          ctx.fillStyle = "#2D5222";
          ctx.beginPath();
          ctx.arc(x, y, r, 0, 7);
          ctx.fill();
          ctx.fillStyle = "#7CFC66";
          ctx.beginPath();
          ctx.arc(x, y, r * 0.45, 0, 7);
          ctx.fill();
        } else if (o.kind === "ruin") {
          ctx.fillStyle = "#8C877A";
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
          ctx.strokeStyle = "#2A2824";
          ctx.strokeRect(x - r, y - r, r * 2, r * 2);
        } else if (o.kind === "building") {
          ctx.fillStyle = "#5A3A2A";
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
        } else if (o.kind === "hedgerow") {
          ctx.fillStyle = "#2C4A1C";
          ctx.beginPath();
          ctx.arc(x, y, r, 0, 7);
          ctx.fill();
        } else if (o.kind === "crate" || o.kind === "bush") {
          ctx.fillStyle = "#6B5232";
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
        } else {
          ctx.fillStyle = "#3A3E30";
          ctx.beginPath();
          ctx.arc(x, y, r, 0, 7);
          ctx.fill();
        }
      }
      for (const u of f.units) {
        const x = u.x * sx;
        const y = u.y * sy;
        ctx.globalAlpha = u.alive ? 1 : 0.25;
        ctx.fillStyle = u.side === "axis" ? "#E24A4A" : u.npc ? "#4ECDC4" : "#7CFC66";
        ctx.beginPath();
        ctx.arc(x, y, u.side === "axis" ? 6 : 7, 0, 7);
        ctx.fill();
        if (u.side === "allies" && !u.npc && u.alive) {
          ctx.fillStyle = "#F0F5EB";
          ctx.font = "11px monospace";
          ctx.fillText(u.name.split(" ").pop() ?? "", x + 9, y + 4);
          ctx.fillStyle = "#333";
          ctx.fillRect(x - 10, y - 12, 20, 3);
          ctx.fillStyle = "#7CFC66";
          ctx.fillRect(x - 10, y - 12, 20 * Math.max(0, u.hp / u.maxHp), 3);
        }
        ctx.globalAlpha = 1;
      }
    };
    const tick = (ts: number) => {
      if (!playingRef.current) return;
      if (!last) last = ts;
      const dt = ((ts - last) / 1000) * speedRef.current;
      last = ts;
      const next = Math.min(replay.frames.length - 1, idxRef.current + dt / 0.5);
      idxRef.current = next;
      setIdx(Math.floor(next));
      draw(Math.floor(next));
      if (next >= replay.frames.length - 1) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    draw(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [replay]);

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
        <span className="ml-auto flex items-center gap-2">
          <Button data-testid="replay-play-btn" variant="outline" size="xs" onClick={() => setPlaying((p) => !p)}>
            {playing ? "PAUSE" : "PLAY"}
          </Button>
          <select
            data-testid="replay-speed"
            className="border border-[#2E3628] bg-[#1A1D17] px-1 py-0.5 text-xs text-[#E3E7DC]"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
          </select>
          <Button data-testid="replay-close-btn" variant="outline" size="xs" onClick={onClose}>
            CLOSE
          </Button>
        </span>
      </div>
      <input
        data-testid="replay-scrub"
        type="range"
        min={0}
        max={Math.max(0, replay.frames.length - 1)}
        value={idx}
        className="mt-3 w-full"
        onChange={(e) => {
          const v = Number(e.target.value);
          idxRef.current = v;
          setIdx(v);
        }}
      />
      <div className="mt-3 min-h-0 flex-1">
        <canvas ref={canvasRef} width={1200} height={675} className="h-full w-full border border-[#2E3628] bg-[#141a12]" />
      </div>
      <p className="mt-2 font-mono text-[11px] text-[#8D9A83]">
        <span className="text-[#7CFC66]">● Your squad</span> · <span className="text-[#4ECDC4]">● 2nd Platoon</span> ·{" "}
        <span className="text-[#E24A4A]">● Enemy</span> · Faded = dead
        <br />
        Obstacles: <span className="text-[#7CFC66]">● Tree</span> · <span className="text-[#B8B2A4]">■ Ruin</span> ·{" "}
        <span className="text-[#C08A5A]">■ Building</span> · <span className="text-[#5A8A3A]">● Hedgerow</span> ·{" "}
        <span className="text-[#9A9A8A]">● Wreck / steel</span>
      </p>
    </div>
  );
}
