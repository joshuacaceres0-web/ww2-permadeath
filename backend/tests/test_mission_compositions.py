"""Mission compositions: more MGs and more troops in the beach defense.

Wave 1 fields 3 MG42 nests on every mission (was 2), and every wave
carries one more volks than before, so the beach defense is thicker
and the reinforcements are bigger too. Totals: 31/33/38/46.

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


def test_wave_1_fields_three_mg42_nests_on_every_mission():
    for m in mission_list():
        nests = sum(e.count for e in m.enemies if e.type == "mg42" and e.wave == 1)
        assert nests == 3, (m.id, nests)


def test_mission_totals():
    assert wave_counts("op_01") == {1: 11, 2: 9, 3: 11}   # 31
    assert wave_counts("op_02") == {1: 11, 2: 10, 3: 12}  # 33
    assert wave_counts("op_03") == {1: 13, 2: 13, 3: 12}  # 38
    assert wave_counts("op_04") == {1: 12, 2: 17, 3: 17}  # 46


def test_every_wave_has_volks():
    # The extra troops are volks, the basic grunt, in every wave.
    for m in mission_list():
        for wave in (1, 2, 3):
            assert any(e.type == "volks" and e.wave == wave for e in m.enemies), (m.id, wave)
