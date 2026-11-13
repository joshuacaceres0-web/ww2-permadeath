// Start-menu backdrop: a dithered dusk sky over ruins, distant shell flashes and a squad
// marching past in silhouette — drawn at low res with the game's own soldier sprites.
import { useEffect, useRef } from "react";
import { SPR_H, SPR_W, sprite } from "@/game/sprites";

const W = 240;
const H = 135;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const SKY = ["#1A1C17", "#26281F", "#3A3422", "#5A4426", "#7A5228", "#8E5E2A"];

function backdrop(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  // Sky bands with ordered dither between them.
  for (let y = 0; y < H; y++) {
    const t = Math.min(1, y / (H * 0.72)) * (SKY.length - 1);
    for (let x = 0; x < W; x++) {
      const k = Math.floor(t) + ((t % 1) * 16 > BAYER[(y & 3) * 4 + (x & 3)] ? 1 : 0);
      g.fillStyle = SKY[Math.min(SKY.length - 1, k)];
      g.fillRect(x, y, 1, 1);
    }
  }
  // Ruined skyline.
  let seed = 44;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = "#15160F";
  for (let x = 0; x < W; ) {
    const w = 6 + Math.floor(rnd() * 14);
    const h = 8 + Math.floor(rnd() * 22);
    g.fillRect(x, 92 - h, w, h + 10);
    if (rnd() < 0.5) g.fillRect(x + 2, 92 - h - 4, 2, 4); // broken chimney
    for (let k = 0; k < 3; k++) if (rnd() < 0.5) g.clearRect(x + 1 + Math.floor(rnd() * (w - 2)), 92 - h, 2, 2);
    x += w + Math.floor(rnd() * 6);
  }
  // Church spire.
  g.fillRect(170, 50, 5, 42);
  g.fillRect(171, 44, 3, 6);
  g.fillRect(172, 40, 1, 4);
  // Ground: mud with dithered ridge, sandbags and wire.
  for (let y = 100; y < H; y++)
    for (let x = 0; x < W; x++) {
      g.fillStyle = (x + y) & 1 && y < 104 ? "#2A2718" : y > 120 ? "#1A1810" : "#24211A";
      g.fillRect(x, y, 1, 1);
    }
  for (let i = 0; i < 9; i++) {
    g.fillStyle = "#1E1A12";
    g.fillRect(14 + i * 6, 96, 7, 5);
    g.fillStyle = i & 1 ? "#6E6040" : "#5E5236";
    g.fillRect(15 + i * 6, 97, 5, 3);
  }
  g.fillStyle = "#3A3428";
  for (let x = 150; x < 236; x += 3) g.fillRect(x, 98 + ((x / 3) % 2), 2, 1);
  for (const x of [150, 178, 206, 234]) g.fillRect(x, 94, 1, 7);
  return c;
}

export default function StartScene() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const g = cv.getContext("2d")!;
    const bg = backdrop();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = 0;
    let frame = 0;
    const flashes: Array<{ x: number; t: number }> = [];
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 125) return; // stepped 8 fps, like an old console
      last = now;
      frame++;
      g.imageSmoothingEnabled = false;
      g.drawImage(bg, 0, 0);
      // Distant shell flashes behind the ruins.
      if (Math.random() < 0.08) flashes.push({ x: 20 + Math.random() * 200, t: 0 });
      for (const f of flashes) {
        const a = 1 - f.t / 4;
        g.fillStyle = `rgba(255,190,90,${0.5 * a})`;
        g.fillRect(f.x - 6 + f.t, 78 - f.t * 2, 12 - f.t * 2, 12);
        g.fillStyle = `rgba(255,240,200,${0.8 * a})`;
        g.fillRect(f.x - 1, 84 - f.t, 3, 3);
        f.t++;
      }
      for (let i = flashes.length - 1; i >= 0; i--) if (flashes[i].t > 4) flashes.splice(i, 1);
      // The squad marching right, walk cycle on the real soldier sprites.
      const types = [
        ["rifle", "us"],
        ["rifle", "us"],
        ["mg", "us"],
        ["none", "us-medic"],
        ["bazooka", "us"],
      ] as const;
      types.forEach(([weapon, head], i) => {
        const x = Math.floor(((reduce ? 60 : frame * 1.5) + i * 18) % (W + 120)) - 60;
        const f = (frame + i) % 4;
        const pose = f === 0 ? "walkA" : f === 1 ? "walkC" : f === 2 ? "walkB" : "walkD";
        const img = sprite("us", pose, weapon, head, false);
        g.drawImage(img, x, 104 - SPR_H + (f % 2 ? 0 : 1) + (i % 2), SPR_W, SPR_H);
      });
      // Drifting smoke.
      g.fillStyle = "rgba(40,38,30,0.35)";
      for (let k = 0; k < 6; k++) {
        const sx = (frame * 0.5 + k * 47) % (W + 40) - 20;
        g.fillRect(Math.floor(sx), 60 + ((k * 13) % 22), 18, 4);
      }
      if (reduce) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <canvas
      ref={ref}
      width={W}
      height={H}
      aria-hidden
      data-testid="start-scene"
      className="absolute inset-0 h-full w-full object-cover [image-rendering:pixelated]"
    />
  );
}
