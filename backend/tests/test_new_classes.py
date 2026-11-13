"""Recon and Engineer are hireable classes (Josh, 2026-11-12).

The backend is the money: UNIT_COSTS prices them and the
UnitType literal admits them, so a hire request validates and
make_soldier can build one.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from lib.gen import make_soldier
from lib.missions import UNIT_COSTS


def test_costs_priced():
    assert UNIT_COSTS["recon"] == 180
    assert UNIT_COSTS["engineer"] == 170


def test_make_soldier_builds_both():
    for t in ("recon", "engineer"):
        s = make_soldier(t)
        assert s["type"] == t
        assert s["status"] == "reserve"
