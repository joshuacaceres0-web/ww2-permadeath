import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Cross, MapPin, Medal } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { apiGet } from "@/lib/api";
import type { Decor, MemorialEntry } from "@/lib/types";
import { UNIT_TYPES } from "@/game/data";
import Portrait from "@/components/Portrait";
import Graveyard from "@/components/memorial/Graveyard";
import { MedalList } from "@/components/Medals";

function Story({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      {text.split("\n\n").map((p, i) => (
        <p key={i} className={`font-mono text-[11.5px] leading-relaxed ${i === 0 ? "text-[#B9C2B3]" : "text-[#E0B8B0]"}`}>
          {p}
        </p>
      ))}
    </div>
  );
}

export default function Memorial() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: entries } = useQuery({
    queryKey: ["memorial"],
    queryFn: () => apiGet<MemorialEntry[]>("/memorial"),
    retry: false,
  });
  const { data: decor } = useQuery({
    queryKey: ["decor"],
    queryFn: () => apiGet<Decor[]>("/graveyard/decor"),
    retry: false,
  });

  const selected = (entries ?? []).find((e) => e.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <div className="border border-[#2E3628] bg-[#0E100D] p-8 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#75826F]">The price of the line</p>
        <h1 className="mt-2 font-heading text-4xl font-bold tracking-tight text-[#F3F7EE]">THE WALL OF HONOR</h1>
        <p className="mx-auto mt-3 max-w-xl font-mono text-[13px] leading-relaxed text-[#D5DCD0]">
          Every soldier who fell under your command, forever. No resets bring them back — not victory,
          not a new campaign. This is what hardcore means.
        </p>
        <p className="mt-4 font-mono text-sm text-[#C68B45]" data-testid="memorial-count">
          {entries ? `${entries.length} FALLEN RECORDED` : "READING THE ROLL…"}
        </p>
      </div>

      <Graveyard entries={entries ?? []} decor={decor ?? []} selectedId={selectedId} onSelect={setSelectedId} />

      {selected && (
        <div className="flex gap-4 border border-[#5C4A1E] bg-[#15130D] p-4" data-testid="grave-plaque">
          <Portrait seed={selected.portrait_seed} type={selected.type} size={72} fallen />
          <div className="min-w-0 space-y-1.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C68B45]">Here lies</p>
            <h3 className="font-heading text-xl font-bold tracking-wide text-[#F3F7EE]">
              {selected.rank} {selected.name}
            </h3>
            <Story text={selected.story} />
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-3 font-heading text-2xl font-bold tracking-tight text-[#F3F7EE]">THE FALLEN</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {(entries ?? []).map((e) => {
            const isSel = e.id === selectedId;
            return (
              <article
                key={e.id}
                id={`wall-${e.id}`}
                data-testid={`memorial-entry-${e.id}`}
                className={`relative border bg-[#0E100D] p-5 transition-colors duration-150 ${
                  isSel ? "border-[#C68B45]" : "border-[#2E3628] hover:border-[#5C2626]"
                }`}
              >
                <span className="stamp-kia absolute right-4 top-4 px-2 py-0.5 font-mono text-[10px] font-bold">K.I.A.</span>
                <div className="flex gap-4">
                  <Portrait
                    seed={e.portrait_seed}
                    type={e.type}
                    size={64}
                    fallen
                    testid={`memorial-portrait-${e.id}`}
                  />
                  <div className="min-w-0 pr-14">
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#75826F]">
                      {e.died_at.slice(0, 10)} · {e.mission_code}
                    </p>
                    <h3 className="mt-1 font-heading text-xl font-bold tracking-wide text-[#F3F7EE]">
                      {e.rank} {e.name}
                    </h3>
                    <p className="font-mono text-xs text-[#C68B45]">
                      {UNIT_TYPES[e.type].label}
                      {e.unit ? ` · ${e.unit}` : ""}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-5 font-mono text-xs text-[#D5DCD0]">
                  <span className="flex items-center gap-1.5">
                    <Medal size={13} className="text-[#C68B45]" /> {e.kills} confirmed
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Cross size={13} className="text-[#75826F]" /> {e.missions_survived} ops survived
                  </span>
                  {e.hometown && <span className="text-[#75826F]">{e.hometown}</span>}
                </div>
                <div className="mt-3">
                  <MedalList medals={e.medals ?? []} testid={`memorial-medals-${e.id}`} />
                </div>
                <div className="mt-3 border-t border-[#2E3628] pt-3" data-testid={`memorial-story-${e.id}`}>
                  <Story text={e.story || `Fell to ${e.cause}.`} />
                </div>
                <button
                  data-testid={`memorial-locate-${e.id}`}
                  onClick={() => {
                    setSelectedId(e.id);
                    document.querySelector('[data-testid="graveyard"]')?.scrollIntoView({ behavior: "smooth" });
                  }}
                  className="mt-3 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[#75826F] hover:text-[#E5A93C]"
                >
                  <MapPin size={12} /> {e.grave_x === null ? "Not yet laid to rest — use the tray above" : "Find his grave"}
                </button>
              </article>
            );
          })}
        </div>
        {entries && entries.length === 0 && (
          <div className="border border-dashed border-[#2E3628] p-10 text-center font-mono text-sm text-[#75826F]">
            The wall is bare. Long may it stay that way.
          </div>
        )}
      </div>

      <p className="text-center font-mono text-[10px] leading-relaxed text-[#5A664F]">
        Soldiers' stories are fiction, composed from details in real first-hand accounts — Library of Congress
        Veterans History Project interviews, D-Day letters home, Ranger and Big Red One memoirs, Hürtgen Forest
        oral histories.
      </p>

      <div className="text-center">
        <Link to="/" data-testid="memorial-back-btn" className={buttonVariants({ variant: "outline", size: "sm" })}>
          BACK TO THE WAR ROOM
        </Link>
      </div>
    </div>
  );
}
