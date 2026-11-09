// How to Play: the loop in plain words.
import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";

const STEPS: Array<{ n: string; title: string; body: string }> = [
  { n: "01", title: "Lead a 5-man squad", body: "You command five soldiers. Each has a name, a rank and a job — rifleman, medic, machine gunner, sniper or bazooka. Keep them alive and they get better." },
  { n: "02", title: "Spend RP to hire", body: "Winning battles earns Requisition Points (RP). Spend RP in the Barracks to hire replacements when men are lost. Protect your best men by sending them to the reserve." },
  { n: "03", title: "Deploy into battle", body: "Pick the next operation in the War Room and deploy. Battles play in real time — pause any time to give orders, take cover behind sandbags and ruins, and call in reinforcements by radio." },
  { n: "04", title: "The fallen are gone for good", body: "A soldier who dies is lost for good. His name, story and medals go on the Memorial, where you can lay a tombstone and flowers for him." },
];

export default function HowToPlay() {
  return (
    <div className="min-h-svh bg-[#0D0F0C] px-5 py-8 text-[#E3E7DC] sm:px-12" data-testid="how-to-play">
      <div className="mx-auto max-w-2xl">
        <Link to="/" data-testid="how-to-play-back-btn" className={buttonVariants({ variant: "outline", size: "sm" })}>
          ◂ START MENU
        </Link>
        <h1 className="mt-6 font-[Silkscreen] text-3xl font-bold text-[#F0F5EB] sm:text-4xl" style={{ textShadow: "3px 3px 0 #050605" }}>
          HOW TO PLAY
        </h1>
        <p className="mt-2 font-mono text-sm text-[#A2B29A]">Four things to know before you ship out.</p>
        <ol className="mt-6 space-y-3">
          {STEPS.map((s) => (
            <li key={s.n} className="flex gap-4 border border-[#2E3628] bg-[#1A1D17] p-4" data-testid={`how-step-${s.n}`}>
              <span className="font-[Silkscreen] text-2xl text-[#E5A93C]">{s.n}</span>
              <div>
                <h2 className="font-[Silkscreen] text-sm tracking-wider text-[#F0F5EB] sm:text-base">{s.title.toUpperCase()}</h2>
                <p className="mt-1 font-mono text-sm leading-relaxed text-[#C9D1BF]">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-6 font-mono text-xs text-[#5A664F]">
          Desktop: drag to select, right-click to move or attack, Space to pause. Phone: tap to select and order, on-screen buttons for everything else.
        </p>
      </div>
    </div>
  );
}
