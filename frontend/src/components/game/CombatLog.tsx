import type { LogLine } from "@/game/engine";

const COLORS: Record<LogLine["kind"], string> = {
  info: "text-[#A2B29A]",
  kill: "text-[#E5A93C]",
  death: "text-[#E24A4A]",
  wave: "text-[#4ECDC4]",
  win: "text-[#5EB872]",
  lose: "text-[#E24A4A]",
};

export default function CombatLog({ log }: { log: LogLine[] }) {
  const mmss = (t: number) =>
    `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  return (
    <div
      data-testid="combat-log"
      className="pointer-events-none w-72 space-y-1 border border-[#2E3628] bg-[#0D0F0C]/85 p-2.5 font-mono text-[11px] leading-relaxed"
    >
      <div className="text-[10px] uppercase tracking-[0.2em] text-[#7A8A70]">Field radio — net 7</div>
      {log.map((l, i) => (
        <div key={i} className={COLORS[l.kind]}>
          [{mmss(l.t)}] {l.text}
        </div>
      ))}
      {log.length === 0 && <div className="text-[#4A5344]">— net silent —</div>}
    </div>
  );
}
