import { ART_H, ART_W, ITEM_ART, ITEM_ART_LEGEND } from "@/game/itemArt";

/**
 * The item's drawn model, rendered as crisp pixel SVG — the
 * same shape the player learns on the troop in battle, shown
 * in the Barracks inventory grid, the dossier, and the battle
 * debrief. Sits on a dark plate in the shared panel language.
 */
export default function ItemIcon({ id, size = 40, plate = true }: { id: string; size?: number; plate?: boolean }) {
  const rows = ITEM_ART[id];
  if (!rows) return null;
  const h = Math.round((size * ART_H) / ART_W);
  return (
    <svg
      data-testid={`item-icon-${id}`}
      viewBox={`0 0 ${ART_W} ${ART_H}`}
      width={size}
      height={h}
      shapeRendering="crispEdges"
      className={plate ? "shrink-0 border border-[#2E3628] bg-[#14160F]" : "shrink-0"}
      aria-hidden="true"
    >
      {rows.map((row, y) =>
        row.split("").map((ch, x) => {
          const fill = ITEM_ART_LEGEND[ch];
          return fill ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} /> : null;
        })
      )}
    </svg>
  );
}
