"""Eight commander ranks (2nd Lt. to Maj. Gen.), one per radio call:
Rally Call 1, reinforcements 2, supply drop 3, air recon 4, mortar
strike 5, smoke screen 6, artillery 7, tank support 8."""
from lib.gen import COMMANDER_RANKS, commander_level


def test_eight_ranks():
    assert len(COMMANDER_RANKS) == 8
    assert COMMANDER_RANKS[0] == "2nd Lt."
    assert COMMANDER_RANKS[-1] == "Maj. Gen."


def test_commander_level_reaches_8():
    assert commander_level(0) == 1
    assert commander_level(13) == 7
    assert commander_level(14) == 8
    assert commander_level(999) == 8
