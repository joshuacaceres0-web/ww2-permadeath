// Pixel ribbon bars for real WWII decorations, with an optional legend list.
import { MEDALS, medalCounts } from "@/game/data";

export function Ribbon({ code, count = 1, scale = 1 }: { code: string; count?: number; scale?: number }) {
  const m = MEDALS[code];
  if (!m) return null;
  const w = 18 * scale;
  const h = 6 * scale;
  const sw = w / m.ribbon.length;
  return (
    <span className="relative inline-block" title={`${m.name}${count > 1 ? ` ×${count}` : ""} — ${m.bonus}`}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" className="block border border-[#0E100D]">
        {m.ribbon.map((c, i) => (
          <rect key={i} x={i * sw} y={0} width={sw + 0.5} height={h} fill={c} />
        ))}
        {count > 1 && <rect x={w / 2 - scale} y={h / 2 - scale} width={2 * scale} height={2 * scale} fill="#C68B45" />}
      </svg>
    </span>
  );
}

export function RibbonRack({ medals, scale = 1, testid }: { medals: string[]; scale?: number; testid?: string }) {
  const counts = medalCounts(medals);
  if (!counts.length) return null;
  return (
    <span data-testid={testid} className="inline-flex flex-wrap gap-0.5">
      {counts.map(([code, n]) => (
        <Ribbon key={code} code={code} count={n} scale={scale} />
      ))}
    </span>
  );
}

export function MedalList({ medals, testid }: { medals: string[]; testid?: string }) {
  const counts = medalCounts(medals);
  if (!counts.length)
    return (
      <p data-testid={testid} className="font-mono text-[11px] text-[#5A664F]">
        No decorations yet.
      </p>
    );
  return (
    <ul data-testid={testid} className="space-y-1">
      {counts.map(([code, n]) => (
        <li key={code} className="flex items-center gap-2 font-mono text-[11px]">
          <Ribbon code={code} count={n} scale={1.2} />
          <span className="text-[#EDEDE2]">
            {MEDALS[code].name}
            {n > 1 ? ` ×${n}` : ""}
          </span>
          <span className="text-[#5EB872]">{MEDALS[code].bonus}</span>
        </li>
      ))}
    </ul>
  );
}
