// Pixel-art graveyard sprites (SVG, crisp edges).
import type { DecorKind } from "@/lib/types";

type Px = [number, number, number, number, string]; // x, y, w, h, color

const SPRITES: Record<DecorKind | "tombstone" | "cross", { w: number; h: number; px: Px[] }> = {
  tombstone: {
    w: 12,
    h: 14,
    px: [
      [3, 0, 6, 1, "#9AA095"],
      [2, 1, 8, 1, "#9AA095"],
      [1, 2, 10, 10, "#8A9085"],
      [2, 2, 1, 10, "#A9AFA3"],
      [9, 2, 2, 10, "#6F756B"],
      [4, 4, 4, 1, "#4E544A"],
      [5, 3, 2, 4, "#4E544A"],
      [3, 8, 6, 1, "#5E645A"],
      [3, 10, 5, 1, "#5E645A"],
      [0, 12, 12, 2, "#3A3A2E"],
    ],
  },
  cross: {
    w: 10,
    h: 14,
    px: [
      [4, 0, 2, 12, "#E9E6DA"],
      [1, 3, 8, 2, "#E9E6DA"],
      [5, 0, 1, 12, "#B9B6AA"],
      [0, 12, 10, 2, "#3A3A2E"],
    ],
  },
  poppies: {
    w: 10,
    h: 8,
    px: [
      [1, 4, 1, 4, "#3E6B2E"],
      [5, 3, 1, 5, "#3E6B2E"],
      [8, 5, 1, 3, "#3E6B2E"],
      [0, 2, 3, 2, "#D0312D"],
      [1, 2, 1, 1, "#1A1410"],
      [4, 1, 3, 2, "#E0423A"],
      [5, 1, 1, 1, "#1A1410"],
      [7, 4, 3, 2, "#C92A26"],
    ],
  },
  roses: {
    w: 10,
    h: 8,
    px: [
      [2, 4, 1, 4, "#2F5A26"],
      [6, 3, 1, 5, "#2F5A26"],
      [1, 2, 3, 2, "#A3192E"],
      [2, 2, 1, 1, "#D6455A"],
      [5, 1, 3, 2, "#B21F36"],
      [6, 1, 1, 1, "#E0566B"],
      [7, 5, 2, 1, "#3E7A30"],
    ],
  },
  lilies: {
    w: 10,
    h: 8,
    px: [
      [3, 4, 1, 4, "#4A7A36"],
      [6, 3, 1, 5, "#4A7A36"],
      [1, 2, 4, 2, "#F2EFE4"],
      [3, 2, 1, 1, "#E5C14C"],
      [5, 1, 4, 2, "#F2EFE4"],
      [6, 1, 1, 1, "#E5C14C"],
    ],
  },
  wreath: {
    w: 12,
    h: 12,
    px: [
      [3, 0, 6, 2, "#2F5A26"],
      [1, 2, 2, 8, "#2F5A26"],
      [9, 2, 2, 8, "#2F5A26"],
      [3, 10, 6, 2, "#2F5A26"],
      [2, 1, 1, 1, "#3E7A30"],
      [9, 1, 1, 1, "#3E7A30"],
      [4, 0, 1, 1, "#C93B3B"],
      [10, 5, 1, 1, "#C93B3B"],
      [1, 6, 1, 1, "#C93B3B"],
      [5, 9, 2, 3, "#B21F36"],
    ],
  },
  candle: {
    w: 6,
    h: 10,
    px: [
      [2, 0, 2, 2, "#FFD97D"],
      [2, 1, 1, 1, "#E5803C"],
      [2, 2, 2, 1, "#2A2418"],
      [1, 3, 4, 6, "#EDE6D3"],
      [1, 3, 1, 6, "#FFFFFF"],
      [0, 9, 6, 1, "#5A5A3A"],
    ],
  },
  flag: {
    w: 10,
    h: 12,
    px: [
      [0, 0, 1, 12, "#6B5B3F"],
      [1, 0, 9, 1, "#B22234"],
      [1, 1, 9, 1, "#F2EFE4"],
      [1, 2, 9, 1, "#B22234"],
      [1, 3, 9, 1, "#F2EFE4"],
      [1, 4, 9, 1, "#B22234"],
      [1, 0, 4, 3, "#3C3B6E"],
      [2, 1, 1, 1, "#F2EFE4"],
    ],
  },
};

export type SpriteKind = keyof typeof SPRITES;

export function spriteSize(kind: SpriteKind, scale: number) {
  const s = SPRITES[kind];
  return { w: s.w * scale, h: s.h * scale };
}

export default function Sprite({ kind, scale = 4, className = "" }: { kind: SpriteKind; scale?: number; className?: string }) {
  const s = SPRITES[kind];
  return (
    <svg
      width={s.w * scale}
      height={s.h * scale}
      viewBox={`0 0 ${s.w} ${s.h}`}
      shapeRendering="crispEdges"
      className={className}
      aria-hidden="true"
    >
      {s.px.map(([x, y, w, h, c], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill={c} />
      ))}
    </svg>
  );
}
