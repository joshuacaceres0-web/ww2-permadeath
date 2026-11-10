import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Crosshair } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { buttonVariants } from "@/components/ui/button";
import { apiGet } from "@/lib/api";
import type { GameState } from "@/lib/types";
import { cn } from "@/lib/utils";
import { onMenuClick } from "@/game/sfx";

// Menu blips on these screens (battle has its own sounds).
const MENU_SOUND_PATHS = ["/war-room", "/memorial"];

const NAV = [
  { to: "/war-room", label: "WAR ROOM", testid: "nav-link-war-room" },
  { to: "/barracks", label: "BARRACKS", testid: "nav-link-barracks" },
  { to: "/memorial", label: "MEMORIAL", testid: "nav-link-memorial" },
];

export default function Layout() {
  const { pathname } = useLocation();
  const inGame = pathname === "/game";
  const { data: state } = useQuery({
    queryKey: ["state"],
    queryFn: () => apiGet<GameState>("/state"),
    retry: false,
  });

  return (
    <div
      className="flex min-h-svh flex-col bg-[#121411] text-[#E3E7DC]"
      onClickCapture={MENU_SOUND_PATHS.includes(pathname) ? onMenuClick : undefined}
    >
      <header className={cn("sticky top-0 z-40 border-b border-[#2E3628] bg-[#121411]/95 backdrop-blur", inGame && "short:hidden")}>
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <Link to="/war-room" className="flex items-center gap-2.5" data-testid="brand-link">
            <span className="flex h-8 w-8 items-center justify-center border border-[#E5A93C] text-[#E5A93C]">
              <Crosshair size={16} strokeWidth={2.4} />
            </span>
            <span className="leading-none">
              <span className="block font-heading text-lg font-bold tracking-wider text-[#F0F5EB]">
                VANGUARD '44
              </span>
              <span className="block font-mono text-[9px] uppercase tracking-[0.3em] text-[#8D9A83]">
                Permafrost · The Sacrifice Division
              </span>
            </span>
          </Link>

          <nav className="ml-6 hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                data-testid={n.testid}
                className={({ isActive }) =>
                  cn(
                    "border border-transparent px-3 py-1.5 font-mono text-xs tracking-[0.18em] transition-colors duration-150",
                    isActive
                      ? "border-[#2E3628] bg-[#1A1D17] text-[#E5A93C]"
                      : "text-[#8D9A83] hover:border-[#2E3628] hover:text-[#E3E7DC]"
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div
              data-testid="commander-chip"
              className="hidden border border-[#2E3628] bg-[#1A1D17] px-3 py-1.5 text-right font-mono sm:block"
              title="Your rank as commander"
            >
              <span className="block text-[9px] uppercase tracking-[0.2em] text-[#8D9A83]">Commander</span>
              <span className="block max-w-40 truncate text-sm font-semibold text-[#F0F5EB]">
                {state ? `${state.commander_rank} ${state.commander_name}` : "—"}
              </span>
            </div>
            <div
              data-testid="requisition-chip"
              className="border border-[#2E3628] bg-[#1A1D17] px-3 py-1.5 text-right font-mono"
              title="Requisition points"
            >
              <span className="block text-[9px] uppercase tracking-[0.2em] text-[#8D9A83]">
                Requisition
              </span>
              <span className="block text-sm font-semibold text-[#E5A93C]">
                {state ? `${state.requisition} RP` : "— RP"}
              </span>
            </div>
            <Link
              to="/game"
              data-testid="quick-deploy-btn"
              className={buttonVariants({ variant: "default", size: "sm" })}
            >
              DEPLOY
            </Link>
          </div>
        </div>
      </header>

      <main
        className={
          inGame
            ? "flex min-h-0 flex-1 flex-col"
            : "mx-auto w-full max-w-7xl flex-1 px-4 py-6"
        }
      >
        <Outlet />
      </main>

      {!inGame && (
        <footer className="border-t border-[#2E3628] px-4 py-3">
          <div className="mx-auto flex max-w-7xl items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-[#5A664F]">
            <span>49°18'N 0°22'W · SHAEF GRID 7-KILO</span>
            <span>All communications encoded — field cipher 7</span>
          </div>
        </footer>
      )}

      {/* Mobile nav */}
      {!inGame && (
        <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[#2E3628] bg-[#121411] md:hidden">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              data-testid={`${n.testid}-mobile`}
              className={({ isActive }) =>
                cn(
                  "flex-1 py-3 text-center font-mono text-[10px] tracking-[0.18em]",
                  isActive ? "bg-[#1A1D17] text-[#E5A93C]" : "text-[#8D9A83]"
                )
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      )}

      <Toaster />
    </div>
  );
}
