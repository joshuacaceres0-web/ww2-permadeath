"""Radio call costs: a rookie radioman (level 0) pays the full base
cost, a veteran (level 6) pays 30% less (5% per level). The frontend
uses the same formula and the same rounding, so the menu's number is
the number the backend takes.

Pure unit test — no live backend needed, no fixtures used.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

from lib.missions import RADIO_SUPPORT_COST, radio_cost


def test_base_costs():
    assert RADIO_SUPPORT_COST == {
        "supply": 10,
        "recon": 10,
        "mortar": 20,
        "smoke": 15,
        "artillery": 30,
        "tank": 60,
    }


def test_discount_per_level():
    assert radio_cost(30, 0) == 30
    assert radio_cost(30, 1) == 29
    assert radio_cost(30, 2) == 27
    assert radio_cost(30, 6) == 21
    assert radio_cost(60, 6) == 42
    assert radio_cost(10, 6) == 7
    assert radio_cost(15, 6) == 11
    assert radio_cost(25, 6) == 18


def test_rounding_matches_the_frontend():
    # 30 * 0.95 = 28.5 — rounds half up to 29, like JS Math.round
    # (Python's round() would banker's-round it to 28).
    assert radio_cost(30, 1) == 29
    assert radio_cost(50, 1) == 48  # 47.5 -> 48
