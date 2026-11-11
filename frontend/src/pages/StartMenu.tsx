// Start menu: first screen on load. Continue / New Game / How to Play / Memorial.
// Read-only except when New Game is confirmed (full campaign wipe).
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import StartScene from "@/components/StartScene";
import { onMenuClick } from "@/game/sfx";
import { useMusic } from "@/game/music";
import { apiGet, apiPost } from "@/lib/api";
import type { GameState, SaveSummary } from "@/lib/types";

const item =
  "pixel-btn group flex w-full items-center justify-between gap-3 border-2 px-4 py-3 text-left font-[Silkscreen] text-sm tracking-wider transition-colors duration-100 sm:text-base";

export default function StartMenu() {
  useMusic("menu"); // Letters Home, looped; stops on leaving the menu.
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { data: save, isLoading, isError } = useQuery({
    queryKey: ["save-summary"],
    queryFn: () => apiGet<SaveSummary>("/save/summary"),
  });

  const newGame = useMutation({
    mutationFn: () => apiPost<GameState>("/campaign/wipe", { confirm: "RESET" }),
    onSuccess: async () => {
      setConfirmOpen(false);
      await qc.invalidateQueries();
      toast.success("New campaign begun. Fresh squad reporting.");
      navigate("/war-room");
    },
    onError: () => toast.error("Couldn't start a new campaign — nothing was changed. Try again."),
  });

  const hasSave = !!save?.exists;

  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden bg-[#0D0F0C] text-[#E3E7DC]" data-testid="start-menu" onClickCapture={onMenuClick}>
      <StartScene />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(13,15,12,0.92)_0%,rgba(13,15,12,0.7)_45%,rgba(13,15,12,0.15)_100%)]" />

      <main className="relative z-10 flex flex-1 flex-col justify-center px-5 py-10 sm:px-12">
        <div className="max-w-md">
          <p className="font-[Silkscreen] text-[10px] tracking-[0.35em] text-[#E5A93C]">EUROPEAN THEATRE · 1944</p>
          <h1
            className="mt-2 whitespace-nowrap font-[Silkscreen] text-[clamp(26px,8.6vw,72px)] font-bold leading-none text-[#F0F5EB]"
            style={{ textShadow: "4px 4px 0 #050605, 0 0 0 #000" }}
            data-testid="start-title"
          >
            VANGUARD<span className="text-[#E5A93C]">'44</span>
          </h1>
          <p className="mt-3 font-[Silkscreen] text-xs tracking-[0.18em] text-[#A2B29A] sm:text-sm" data-testid="start-subtitle">
            PERMAFROST, THE SACRIFICE DIVISION
          </p>

          <nav className="mt-8 space-y-2.5" aria-label="Start menu">
            <button
              data-testid="menu-continue"
              disabled={!hasSave}
              onClick={() => navigate("/war-room")}
              className={`${item} ${
                hasSave
                  ? "border-[#E5A93C] bg-[#3A2B0E]/90 text-[#FFD97D] hover:bg-[#4A3812]"
                  : "cursor-not-allowed border-[#2E3628] bg-[#1A1D17]/80 text-[#5A664F]"
              }`}
            >
              <span>▸ CONTINUE</span>
              {!isLoading && !hasSave && (
                <span className="font-mono text-xs normal-case tracking-normal text-[#5A664F]" data-testid="menu-continue-empty">
                  {isError ? "Save unreachable" : "No campaign yet"}
                </span>
              )}
            </button>
            <button
              data-testid="menu-new-game"
              onClick={() => setConfirmOpen(true)}
              className={`${item} border-[#2E3628] bg-[#1A1D17]/90 text-[#E3E7DC] hover:border-[#E5A93C] hover:text-[#FFD97D]`}
            >
              <span>▸ NEW GAME</span>
            </button>
            <Link
              to="/how-to-play"
              data-testid="menu-how-to-play"
              className={`${item} border-[#2E3628] bg-[#1A1D17]/90 text-[#E3E7DC] hover:border-[#4ECDC4] hover:text-[#4ECDC4]`}
            >
              <span>▸ HOW TO PLAY</span>
            </Link>
            <Link
              to="/settings"
              data-testid="menu-settings"
              className={`${item} border-[#2E3628] bg-[#1A1D17]/90 text-[#E3E7DC] hover:border-[#4ECDC4] hover:text-[#4ECDC4]`}
            >
              <span>▸ SETTINGS</span>
            </Link>
            <Link
              to="/memorial"
              data-testid="menu-memorial"
              className={`${item} border-[#2E3628] bg-[#1A1D17]/90 text-[#E3E7DC] hover:border-[#E24A4A] hover:text-[#F0B4B4]`}
            >
              <span>▸ MEMORIAL</span>
              <span className="font-mono text-xs tracking-normal text-[#B88080]">✝</span>
            </Link>
          </nav>
        </div>
      </main>

      {hasSave && save && (
        <footer
          className="relative z-10 flex flex-wrap gap-x-5 gap-y-1 border-t-2 border-[#2E3628] bg-[#0D0F0C]/95 px-5 py-2.5 font-mono text-xs text-[#A2B29A] sm:px-12"
          data-testid="start-footer"
        >
          <span data-testid="footer-operation">
            <span className="text-[#5A664F]">OP </span>
            <span className="text-[#E3E7DC]">
              {save.campaign_complete ? "CAMPAIGN COMPLETE" : `${save.mission_index + 1}/4 · ${save.mission_code ?? "—"}`}
            </span>
          </span>
          <span data-testid="footer-rp">
            <span className="text-[#5A664F]">RP </span>
            <span className="text-[#E5A93C]">{save.requisition}</span>
          </span>
          <span data-testid="footer-squad">
            <span className="text-[#5A664F]">SQUAD </span>
            {save.squad_size} men
          </span>
          <span data-testid="footer-fallen">
            <span className="text-[#5A664F]">FALLEN </span>
            <span className="text-[#E24A4A]">{save.fallen}</span>
          </span>
          {save.last_battle && (
            <span className="w-full border-t border-[#2E3628] pt-1.5" data-testid="footer-last-battle">
              <span className="text-[#5A664F]">LAST BATTLE </span>
              <span className="text-[#E3E7DC]">{save.last_battle.mission_code}</span>{" "}
              <span
                className={save.last_battle.victory ? "font-[Silkscreen] text-[#5EB872]" : "font-[Silkscreen] text-[#E24A4A]"}
                data-testid="footer-last-result"
              >
                {save.last_battle.victory ? "VICTORY" : "DEFEAT"}
              </span>
              <span className="block text-[#B88080]" data-testid="footer-last-fallen">
                {save.last_battle.fallen.length
                  ? `✝ Fell: ${save.last_battle.fallen.join(", ")}`
                  : "No men lost."}
              </span>
            </span>
          )}
        </footer>
      )}

      <Dialog open={confirmOpen} onOpenChange={(o) => !newGame.isPending && setConfirmOpen(o)}>
        <DialogContent showCloseButton={false} className="border-2 border-[#5C2626] bg-[#1A1D17] text-[#E3E7DC]" data-testid="new-game-dialog">
          <DialogHeader>
            <DialogTitle className="font-[Silkscreen] text-lg text-[#F0B4B4]">NEW CAMPAIGN</DialogTitle>
            <DialogDescription className="font-mono text-sm text-[#E3E7DC]" data-testid="new-game-warning">
              Start a new campaign? Your current squad, RP, and Memorial will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={newGame.isPending} data-testid="new-game-cancel">
              CANCEL
            </Button>
            <Button variant="destructive" onClick={() => newGame.mutate()} disabled={newGame.isPending} data-testid="new-game-confirm">
              {newGame.isPending ? "ERASING…" : "CONFIRM"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
