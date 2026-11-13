"""Graveyard layout — the game's, not the player's (Josh, 2026-11-12).

Graves land on their own: when a man falls, the company lays his
stone in the memorial ground in the order the men fell. A grave
that already has a position is NEVER moved by assignment (the
seeded stones, and any stone a player placed under the old
system, keep their ground). Only entries with no position get
one, filled in fall order.

Decorations belong to a man, not to the open field: a tribute's
position is derived from his grave plus a per-kind offset, with
repeat tributes of the same kind stacking in a small fan so
they do not sit exactly on top of each other.

Pure functions over plain dicts — unit-testable without a server.
"""

from typing import Dict, List, Optional, Tuple

# Field coordinates are fractions of the graveyard field (0..1).
COLS = 10
X0, DX = 0.07, 0.093
Y0, DY = 0.28, 0.15
# Two stones closer than this on BOTH axes count as stacked.
MIN_DX, MIN_DY = 0.06, 0.09

FIELD_X = (0.03, 0.97)
FIELD_Y = (0.16, 0.97)


def slot(index: int) -> Tuple[float, float]:
    """The index-th plot in the burial rows, west to east, row by row."""
    return (X0 + (index % COLS) * DX, Y0 + (index // COLS) * DY)


def _collides(x: float, y: float, placed: List[Tuple[float, float]]) -> bool:
    return any(abs(x - px) < MIN_DX and abs(y - py) < MIN_DY for px, py in placed)


def assign_graves(entries: List[dict]) -> Dict[str, Tuple[float, float]]:
    """Positions for the entries that have none.

    `entries` are memorial docs in fall order (insertion order:
    seeded stones first, then battle by battle, each battle's
    fallen in the order they fell). Returns {entry_id: (x, y)}
    for entries whose grave_x/grave_y are missing; entries that
    already rest somewhere are left exactly where they are.
    """
    placed: List[Tuple[float, float]] = [
        (e["grave_x"], e["grave_y"])
        for e in entries
        if e.get("grave_x") is not None and e.get("grave_y") is not None
    ]
    out: Dict[str, Tuple[float, float]] = {}
    for i, e in enumerate(entries):
        if e.get("grave_x") is not None and e.get("grave_y") is not None:
            continue
        # Start from this man's own place in the fall order and
        # walk forward until the plot is clear of every stone
        # already down (seeded, player-placed, or just assigned).
        idx = i
        x, y = slot(idx)
        while _collides(x, y, placed):
            idx += 1
            x, y = slot(idx)
        out[e["id"]] = (x, y)
        placed.append((x, y))
    return out


# Where a tribute sits relative to its man's stone (field
# fractions): flowers at the foot of the stone, the wreath
# against it, the candle beside it, the flag standing off.
DECOR_OFFSETS = {
    "poppies": (-0.035, 0.012),
    "roses": (0.035, 0.012),
    "lilies": (-0.018, 0.026),
    "wreath": (0.0, 0.03),
    "candle": (0.02, 0.028),
    "flag": (0.045, -0.018),
}


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def decor_position(
    grave_x: float, grave_y: float, kind: str, same_kind_count: int
) -> Tuple[float, float]:
    """Field position for the (same_kind_count)-th tribute of
    `kind` on the grave at (grave_x, grave_y). Repeats fan out in
    a 3-wide stack so a second bunch of poppies sits beside the
    first instead of inside it."""
    dx, dy = DECOR_OFFSETS.get(kind, (0.0, 0.02))
    col = same_kind_count % 3
    row = same_kind_count // 3
    x = _clamp(grave_x + dx + (col - 1) * 0.016, *FIELD_X)
    y = _clamp(grave_y + dy + row * 0.014, *FIELD_Y)
    return (x, y)


def grave_of(entry: dict) -> Optional[Tuple[float, float]]:
    if entry.get("grave_x") is None or entry.get("grave_y") is None:
        return None
    return (entry["grave_x"], entry["grave_y"])
