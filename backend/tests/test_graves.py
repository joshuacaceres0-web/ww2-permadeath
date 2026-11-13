"""Graveyard layout (Josh, 2026-11-12): graves land on their own
in fall order; a grave that already has a position is never
moved; tributes sit by their man's stone.

Fixtures mirror the seeded stones every save starts with:
Dale Mercer at (0.2, 0.35) and Otis Crane at (0.38, 0.35) —
their positions must survive every assignment pass untouched.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib.graves import assign_graves, decor_position, slot  # noqa: E402

OTIS = {"id": "otis", "grave_x": 0.38, "grave_y": 0.35}
DALE = {"id": "dale", "grave_x": 0.2, "grave_y": 0.35}


def unplaced(i: int) -> dict:
    return {"id": f"m{i}", "grave_x": None, "grave_y": None}


def far_apart(a, b) -> bool:
    return not (abs(a[0] - b[0]) < 0.06 and abs(a[1] - b[1]) < 0.09)


def test_existing_graves_are_never_moved():
    entries = [dict(OTIS), dict(DALE), unplaced(2), unplaced(3)]
    out = assign_graves(entries)
    assert "otis" not in out and "dale" not in out
    assert set(out) == {"m2", "m3"}


def test_new_graves_do_not_stack_on_existing_or_each_other():
    entries = [dict(OTIS), dict(DALE)] + [unplaced(i) for i in range(2, 14)]
    out = assign_graves(entries)
    placed = [(OTIS["grave_x"], OTIS["grave_y"]), (DALE["grave_x"], DALE["grave_y"])]
    for pos in out.values():
        for other in placed:
            assert far_apart(pos, other), f"{pos} stacks on {other}"
        placed.append(pos)


def test_fall_order_is_kept_left_to_right_top_to_bottom():
    entries = [unplaced(i) for i in range(12)]
    out = assign_graves(entries)
    positions = [out[f"m{i}"] for i in range(12)]
    # Row-major: y never decreases as fall order advances, and
    # within a row x strictly increases.
    for prev, cur in zip(positions, positions[1:]):
        assert cur[1] >= prev[1]
        if cur[1] == prev[1]:
            assert cur[0] > prev[0]
    assert positions[0] == slot(0)


def test_slots_stay_in_the_field_for_a_long_campaign():
    entries = [unplaced(i) for i in range(40)]
    out = assign_graves(entries)
    for x, y in out.values():
        assert 0.0 <= x <= 1.0
        assert 0.16 <= y <= 0.97


def test_decor_sits_by_the_stone_and_stacks_outward():
    gx, gy = 0.4, 0.5
    first = decor_position(gx, gy, "poppies", 0)
    second = decor_position(gx, gy, "poppies", 1)
    flag = decor_position(gx, gy, "flag", 0)
    # Near the stone, not on it, and each kind in its own spot.
    for pos in (first, second, flag):
        assert abs(pos[0] - gx) < 0.08 and abs(pos[1] - gy) < 0.06
        assert pos != (gx, gy)
    assert first != second and first != flag
    # Everything stays inside the field even for an edge grave.
    edge = decor_position(0.97, 0.95, "flag", 5)
    assert 0.03 <= edge[0] <= 0.97 and 0.16 <= edge[1] <= 0.97
