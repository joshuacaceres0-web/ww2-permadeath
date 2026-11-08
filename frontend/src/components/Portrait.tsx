// Retro pixel service portrait, drawn deterministically from a seed (16×16 grid, SVG).
import { useMemo } from "react";
import type { UnitTypeId } from "@/lib/types";

type Grid = (string | null)[][];

function rngFrom(seed: number) {
  let s = seed | 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SKINS = [
  ["#F1C9A5", "#D9A77E"],
  ["#E8B48A", "#C98F63"],
  ["#D39A6A", "#B07A4E"],
  ["#A86F45", "#8A5634"],
  ["#7A4B2C", "#5E3820"],
];
const HAIR = ["#2B1D12", "#4A3020", "#6B4A2B", "#A0773F", "#1A1410", "#8C5A2E"];
const BGS = ["#3A3426", "#2F3326", "#3B2F24", "#2A2E2A", "#36301F"];
const HELMET = ["#4E5D3C", "#55603F", "#4A5638"];

function paint(grid: Grid, rows: number[], c0: number, c1: number, color: string) {
  for (const r of rows) for (let c = c0; c <= c1; c++) grid[r][c] = color;
}

function buildGrid(seed: number, type: UnitTypeId, level: number): Grid {
  const rnd = rngFrom(seed);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const g: Grid = Array.from({ length: 16 }, () => Array<string | null>(16).fill(null));

  const bg = pick(BGS);
  const [skin, shade] = pick(SKINS);
  const hair = pick(HAIR);
  const uniform = "#4B5233";
  const helmetColor = pick(HELMET);
  const headgear = type === "sniper" && rnd() < 0.5 ? "cap" : rnd() < 0.18 ? "cap" : "helmet";

  paint(g, [...Array(16).keys()], 0, 15, bg);

  // Shoulders + collar.
  paint(g, [13], 3, 12, uniform);
  paint(g, [14, 15], 1, 14, uniform);
  g[13][7] = "#6E7250";
  g[13][8] = "#6E7250";
  // Neck.
  paint(g, [12], 6, 9, shade);
  // Face.
  paint(g, [6, 7, 8, 9, 10], 4, 11, skin);
  paint(g, [11], 5, 10, skin);
  g[7][3] = skin;
  g[8][3] = shade;
  g[7][12] = skin;
  g[8][12] = shade;
  // Brows, eyes, nose, mouth.
  g[7][5] = hair;
  g[7][6] = hair;
  g[7][9] = hair;
  g[7][10] = hair;
  g[8][6] = "#1A1410";
  g[8][9] = "#1A1410";
  if (rnd() < 0.5) {
    g[8][5] = "#E9E4D6";
    g[8][10] = "#E9E4D6";
  }
  g[9][7] = shade;
  g[9][8] = shade;
  const grin = rnd() < 0.3;
  paint(g, [10], grin ? 6 : 7, grin ? 9 : 8, "#7A3E30");

  // Character extras.
  if (rnd() < 0.25) paint(g, [10], 6, 9, hair); // moustache
  if (rnd() < 0.35) {
    // stubble
    for (const [r, c] of [[11, 5], [11, 7], [11, 9], [10, 5], [10, 10], [11, 10]]) if (rnd() < 0.7) g[r][c] = shade;
  }
  if (rnd() < 0.15) {
    g[8][10] = "#C98A86";
    g[9][10] = "#C98A86";
  } // scar
  if (rnd() < 0.2) {
    g[10][10] = "#EDE6D3";
    g[10][11] = "#EDE6D3";
    g[10][12] = "#E5803C";
  } // cigarette
  if (rnd() < 0.12) {
    paint(g, [8], 5, 10, "#2A2418");
    g[8][6] = "#9DB0B0";
    g[8][9] = "#9DB0B0";
  } // glasses

  if (headgear === "helmet") {
    paint(g, [2], 5, 10, helmetColor);
    paint(g, [3], 4, 11, helmetColor);
    paint(g, [4], 3, 12, helmetColor);
    paint(g, [5], 2, 13, "#3B472C"); // rim
    g[6][4] = hair;
    g[6][11] = hair;
    for (let i = 0; i < 4; i++) g[2 + Math.floor(rnd() * 3)][4 + Math.floor(rnd() * 8)] = "#64704A"; // netting
    if (rnd() < 0.6) {
      g[9][4] = "#3A2E1E";
      g[10][4] = "#3A2E1E";
      g[9][11] = "#3A2E1E";
      g[10][11] = "#3A2E1E";
    } // chin strap
    if (type === "medic") {
      paint(g, [2, 3, 4], 6, 8, "#EDEDE2");
      g[3][6] = "#C93B3B";
      g[3][7] = "#C93B3B";
      g[3][8] = "#C93B3B";
      g[2][7] = "#C93B3B";
      g[4][7] = "#C93B3B";
    }
  } else {
    paint(g, [5], 4, 11, hair);
    paint(g, [4], 4, 10, "#5A5A3A");
    paint(g, [3], 5, 9, "#5A5A3A");
  }

  // Rank stripes on the shoulder — one per two promotions, gold.
  const stripes = Math.min(3, Math.ceil(level / 2));
  for (let i = 0; i < stripes; i++) {
    g[14 + (i % 2)][2 + Math.floor(i / 2)] = "#E5A93C";
  }
  // Specialty pip.
  const pip: Record<UnitTypeId, string> = {
    rifleman: "#8D9A83",
    medic: "#EDEDE2",
    mg: "#E24A4A",
    sniper: "#4ECDC4",
    at: "#E5A93C",
  };
  g[15][12] = pip[type];
  g[15][13] = pip[type];
  return g;
}

interface Props {
  seed: number;
  type: UnitTypeId;
  level?: number;
  size?: number;
  fallen?: boolean;
  className?: string;
  testid?: string;
}

export default function Portrait({ seed, type, level = 0, size = 56, fallen = false, className = "", testid }: Props) {
  const grid = useMemo(() => buildGrid(seed, type, level), [seed, type, level]);
  return (
    <svg
      data-testid={testid}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={`shrink-0 border border-[#2E3628] ${className}`}
      style={fallen ? { filter: "grayscale(1) sepia(0.35) contrast(1.05) brightness(0.85)" } : undefined}
      aria-hidden="true"
    >
      {grid.map((row, r) =>
        row.map((c, col) => (c ? <rect key={`${r}-${col}`} x={col} y={r} width={1} height={1} fill={c} /> : null))
      )}
    </svg>
  );
}
