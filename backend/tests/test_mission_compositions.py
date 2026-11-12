"""Mission compositions: more MGs and more troops in the beach defense.

Wave 1 fields 3 MG42 nests on every mission, and every wave carries
extra volks. Overlord's beach defense is heavier still, at Josh's
direction after a 5/5-alive AUTO win in 156s looked too easy: 9 MG42
nests and 3 mortars in wave 1 (6 nests and 2 mortars at the
shoreline, the rest scattered east), plus a thicker trench garrison.
Totals: 43/33/38/46.

Pure unit test — no live backend needed, no fixtures used.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

from lib.missions import mission_list


def wave_counts(mission_id):
    m = next(x for x in mission_list() if x.id == mission_id)
    waves = {}
    for e in m.enemies:
        waves[e.wave] = waves.get(e.wave, 0) + e.count
    return waves


def test_wave_1_mg42_nests():
    # Overlord's beach defense fields 9 nests in wave 1; the other
    # missions field 3 each.
    for m in mission_list():
        nests = sum(e.count for e in m.enemies if e.type == "mg42" and e.wave == 1)
        assert nests == (9 if m.id == "op_01" else 3), (m.id, nests)


def test_overlord_wave_1_mortars():
    m = next(x for x in mission_list() if x.id == "op_01")
    mortars = sum(e.count for e in m.enemies if e.type == "mortar" and e.wave == 1)
    assert mortars == 3


def test_mission_totals():
    assert wave_counts("op_01") == {1: 23, 2: 9, 3: 11}   # 43
    assert wave_counts("op_02") == {1: 11, 2: 10, 3: 12}  # 33
    assert wave_counts("op_03") == {1: 13, 2: 13, 3: 12}  # 38
    assert wave_counts("op_04") == {1: 12, 2: 17, 3: 17}  # 46


def test_every_wave_has_volks():
    # The extra troops are volks, the basic grunt, in every wave.
    for m in mission_list():
        for wave in (1, 2, 3):
            assert any(e.type == "volks" and e.wave == wave for e in m.enemies), (m.id, wave)
