import { useEffect, useRef } from "react";
import { GameEngine, type HudSnapshot, type Variant } from "@/game/engine";
import type { Mission, Soldier } from "@/lib/types";

interface Props {
  mission: Mission;
  squad: Soldier[];
  commanderBonus: number;
  variant: Variant;
  onHud: (h: HudSnapshot) => void;
  engineRef: { current: GameEngine | null };
}

// Mounts the canvas and owns the GameEngine lifecycle for exactly one battle.
export default function BattleCanvas({ mission, squad, commanderBonus, variant, onHud, engineRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef(onHud);
  hudRef.current = onHud;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new GameEngine(canvas, (h) => hudRef.current(h));
    engineRef.current = engine;
    engine.setup(
      mission,
      squad.map((s) => ({ id: s.id, name: s.name, type: s.type, rank: s.rank, level: s.level, medals: s.medals ?? [] })),
      commanderBonus,
      variant
    );
    engine.attach();
    if (import.meta.env.DEV) (window as unknown as { __vanguard?: GameEngine }).__vanguard = engine;

    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(canvas);

    return () => {
      ro.disconnect();
      engine.destroy();
      engineRef.current = null;
    };
    // One engine per mounted battle — mission/squad are stable for the mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      data-testid="battle-canvas"
      className="absolute inset-0 h-full w-full cursor-crosshair touch-none select-none [image-rendering:pixelated]"
    />
  );
}
