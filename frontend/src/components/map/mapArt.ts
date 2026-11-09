// Stylised wartime field map, Normandy → Hürtgen, painted smooth then crushed to pixel art.
// All coordinates are normalised (0..1) on a 16:10 sheet; the overlay uses the same space.
import { pixelize } from "@/game/sprites";

export const MAP_PX_W = 240;
export const MAP_PX_H = 150;
const SCALE = 4; // paint at 4x, then pixelize down to MAP_PX_W x MAP_PX_H

type Pt = [number, number];

// Coastline, clockwise from the south-west corner (land is everything inside).
const LAND: Pt[] = [
  [0, 1], [0, 0.8], [0.04, 0.76], [0.06, 0.66], [0.05, 0.52], [0.045, 0.4], [0.06, 0.3],
  [0.08, 0.24], [0.12, 0.25], [0.16, 0.23], [0.175, 0.3], [0.18, 0.4], [0.19, 0.47],
  [0.215, 0.5], [0.25, 0.48], [0.3, 0.475], [0.35, 0.485], [0.39, 0.5], [0.42, 0.515],
  [0.435, 0.47], [0.47, 0.42], [0.52, 0.35], [0.56, 0.27], [0.6, 0.2], [0.635, 0.14],
  [0.7, 0.1], [0.76, 0.06], [0.8, 0.03], [0.83, 0], [1, 0], [1, 1],
];

const SEINE: Pt[] = [[0.56, 0.72], [0.53, 0.66], [0.5, 0.64], [0.48, 0.58], [0.45, 0.56], [0.43, 0.52]];
const MEUSE: Pt[] = [[0.8, 0.98], [0.79, 0.8], [0.81, 0.64], [0.79, 0.5], [0.82, 0.36], [0.84, 0.2], [0.86, 0.04]];
const RHINE: Pt[] = [[0.99, 0.96], [0.975, 0.7], [0.985, 0.48], [0.96, 0.3], [0.955, 0.12], [0.97, 0]];
const BORDER: Pt[] = [[0.84, 1], [0.86, 0.78], [0.85, 0.6], [0.87, 0.46], [0.86, 0.32], [0.88, 0.18], [0.87, 0]];

const FORESTS: Array<{ x: number; y: number; r: number; dark?: boolean }> = [
  { x: 0.905, y: 0.44, r: 0.055, dark: true }, // Hürtgen
  { x: 0.84, y: 0.58, r: 0.07 }, // Ardennes
  { x: 0.62, y: 0.82, r: 0.05 },
  { x: 0.3, y: 0.78, r: 0.05 },
  { x: 0.12, y: 0.42, r: 0.035 },
];

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let cached: string | null = null;

/** PNG data URL of the pixel map (cached for the session). */
export function campaignMapImage(): string {
  if (cached) return cached;
  const W = MAP_PX_W * SCALE;
  const H = MAP_PX_H * SCALE;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const rng = mulberry(1944);
  const P = (p: Pt): Pt => [p[0] * W, p[1] * H];
  const path = (pts: Pt[], close = false) => {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(...P(p)) : g.moveTo(...P(p))));
    if (close) g.closePath();
  };

  // Sea: dark slate with wave flecks.
  g.fillStyle = "#1C2A2C";
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = rng() < 0.5 ? "rgba(70,96,96,0.35)" : "rgba(10,18,20,0.4)";
    g.fillRect(rng() * W, rng() * H * 0.7, 6 + rng() * 10, 3);
  }

  // Surf band + land.
  path(LAND, true);
  g.strokeStyle = "rgba(150,170,150,0.45)";
  g.lineWidth = 14;
  g.stroke();
  g.fillStyle = "#77714C";
  g.fill();
  g.save();
  path(LAND, true);
  g.clip();
  // Parchment-olive mottling and coffee stains.
  for (let i = 0; i < 520; i++) {
    const x = rng() * W;
    const y = rng() * H;
    g.fillStyle = rng() < 0.5 ? "rgba(98,92,58,0.35)" : "rgba(140,128,86,0.25)";
    g.beginPath();
    g.arc(x, y, 6 + rng() * 26, 0, Math.PI * 2);
    g.fill();
  }
  for (const [sx, sy, sr] of [[0.68, 0.72, 0.09], [0.34, 0.9, 0.06], [0.95, 0.85, 0.07]] as const) {
    const grad = g.createRadialGradient(sx * W, sy * H, sr * W * 0.6, sx * W, sy * H, sr * W);
    grad.addColorStop(0, "rgba(90,70,40,0.15)");
    grad.addColorStop(0.85, "rgba(80,58,30,0.35)");
    grad.addColorStop(1, "rgba(80,58,30,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  }
  // Forests: clusters of dark tree blobs.
  for (const f of FORESTS) {
    for (let i = 0; i < 70; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * f.r * W;
      g.fillStyle = f.dark ? (rng() < 0.5 ? "#2E3A22" : "#3A4A2A") : rng() < 0.5 ? "#4A5632" : "#56603A";
      g.beginPath();
      g.arc(f.x * W + Math.cos(a) * r, f.y * H + Math.sin(a) * r * 0.8, 6 + rng() * 6, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Bocage: hedgerow ticks across Normandy.
  g.strokeStyle = "rgba(58,74,40,0.7)";
  g.lineWidth = 3;
  for (let i = 0; i < 90; i++) {
    const x = (0.08 + rng() * 0.32) * W;
    const y = (0.52 + rng() * 0.3) * H;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rng() - 0.5) * 30, y + (rng() - 0.5) * 16);
    g.stroke();
  }
  // Map grid.
  g.strokeStyle = "rgba(40,34,20,0.18)";
  g.lineWidth = 2;
  for (let x = W / 12; x < W; x += W / 12) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H);
    g.stroke();
  }
  for (let y = H / 8; y < H; y += H / 8) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  g.restore();

  // Coast outline.
  path(LAND, true);
  g.strokeStyle = "#2A2616";
  g.lineWidth = 5;
  g.stroke();

  // Rivers.
  for (const r of [SEINE, MEUSE, RHINE]) {
    path(r);
    g.strokeStyle = "#2E4A50";
    g.lineWidth = r === RHINE ? 9 : 7;
    g.stroke();
    g.strokeStyle = "#4E7478";
    g.lineWidth = 3;
    g.stroke();
  }
  // German border: dash-dot.
  path(BORDER);
  g.setLineDash([18, 8, 4, 8]);
  g.strokeStyle = "rgba(90,30,24,0.85)";
  g.lineWidth = 4;
  g.stroke();
  g.setLineDash([]);

  // Town dots.
  for (const t of TOWNS) {
    g.fillStyle = "#1E1A10";
    g.fillRect(t.x * W - 7, t.y * H - 7, 14, 14);
    g.fillStyle = "#C9B98A";
    g.fillRect(t.x * W - 3, t.y * H - 3, 6, 6);
  }

  cached = pixelize(c, SCALE).toDataURL("image/png");
  return cached;
}

export const TOWNS: Array<{ name: string; x: number; y: number; dx?: number; dy?: number }> = [
  { name: "CHERBOURG", x: 0.115, y: 0.27, dy: -1 },
  { name: "CAEN", x: 0.37, y: 0.6 },
  { name: "LE HAVRE", x: 0.44, y: 0.47, dy: -1 },
  { name: "PARIS", x: 0.56, y: 0.73 },
  { name: "CALAIS", x: 0.63, y: 0.16, dy: -1 },
  { name: "ANTWERP", x: 0.75, y: 0.16 },
  { name: "BRUSSELS", x: 0.74, y: 0.3 },
  { name: "AACHEN", x: 0.925, y: 0.32, dy: -1 },
];

export const REGIONS: Array<{ name: string; x: number; y: number; size?: "lg" }> = [
  { name: "ENGLISH CHANNEL", x: 0.3, y: 0.2, size: "lg" },
  { name: "FRANCE", x: 0.4, y: 0.9, size: "lg" },
  { name: "BELGIUM", x: 0.7, y: 0.44 },
  { name: "GERMANY", x: 0.94, y: 0.78 },
  { name: "NORMANDY", x: 0.27, y: 0.78 },
];

// Operation markers by mission index (stylised real places).
export const OP_POS: Pt[] = [
  [0.33, 0.5], // Omaha / Normandy beaches
  [0.105, 0.33], // Valognes
  [0.2, 0.64], // Carentan
  [0.905, 0.44], // Hürtgen Forest
];

// Route waypoints between op i and op i+1 (the long road east goes via Paris & Belgium).
export const ROUTE: Pt[][] = [
  [OP_POS[0], [0.22, 0.46], OP_POS[1]],
  [OP_POS[1], [0.12, 0.5], OP_POS[2]],
  [OP_POS[2], [0.36, 0.66], [0.55, 0.68], [0.7, 0.52], [0.8, 0.46], OP_POS[3]],
];

export const UNKNOWN_GROUND: Pt = [0.08, 0.9];
