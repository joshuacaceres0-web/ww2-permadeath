import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Cross, Medal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { apiGet } from "@/lib/api";
import type { MemorialEntry } from "@/lib/types";
import { UNIT_TYPES } from "@/game/data";

export default function Memorial() {
  const { data: entries } = useQuery({
    queryKey: ["memorial"],
    queryFn: () => apiGet<MemorialEntry[]>("/memorial"),
    retry: false,
  });

  return (
    <div className="space-y-6">
      <div className="border border-[#2E3628] bg-[#0E100D] p-8 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#75826F]">
          The price of the line
        </p>
        <h1 className="mt-2 font-heading text-4xl font-bold tracking-tight text-[#F3F7EE]">
          THE WALL OF HONOR
        </h1>
        <p className="mx-auto mt-3 max-w-xl font-mono text-[13px] leading-relaxed text-[#D5DCD0]">
          Every soldier who fell under your command, forever. No resets bring them back —
          not victory, not a new campaign. This is what hardcore means.
        </p>
        <p className="mt-4 font-mono text-sm text-[#C68B45]" data-testid="memorial-count">
          {entries ? `${entries.length} FALLEN RECORDED` : "READING THE ROLL…"}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(entries ?? []).map((e) => (
          <article
            key={e.id}
            data-testid={`memorial-entry-${e.id}`}
            className="relative border border-[#2E3628] bg-[#0E100D] p-5 transition-colors duration-150 hover:border-[#5C2626]"
          >
            <span className="stamp-kia absolute right-4 top-4 px-2 py-0.5 font-mono text-[10px] font-bold">
              K.I.A.
            </span>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#75826F]">
              {e.died_at.slice(0, 10)} · {e.mission_code}
            </p>
            <h2 className="mt-2 font-heading text-xl font-bold tracking-wide text-[#F3F7EE]">
              {e.rank} {e.name}
            </h2>
            <p className="font-mono text-xs text-[#C68B45]">
              {UNIT_TYPES[e.type].label} · {UNIT_TYPES[e.type].weapon}
            </p>
            <div className="mt-3 flex gap-5 font-mono text-xs text-[#D5DCD0]">
              <span className="flex items-center gap-1.5">
                <Medal size={13} className="text-[#C68B45]" /> {e.kills} confirmed
              </span>
              <span className="flex items-center gap-1.5">
                <Cross size={13} className="text-[#75826F]" /> {e.missions_survived} ops survived
              </span>
            </div>
            <p className="mt-3 border-t border-[#2E3628] pt-3 font-mono text-[11px] leading-relaxed text-[#B88080]">
              Fell to {e.cause}.
            </p>
          </article>
        ))}
      </div>

      {entries && entries.length === 0 && (
        <div className="border border-dashed border-[#2E3628] p-10 text-center font-mono text-sm text-[#75826F]">
          The wall is bare. Long may it stay that way.
        </div>
      )}

      <div className="text-center">
        <Link to="/" data-testid="memorial-back-btn" className={buttonVariants({ variant: "outline", size: "sm" })}>
          BACK TO THE WAR ROOM
        </Link>
      </div>
    </div>
  );
}
