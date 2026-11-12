"""Kill RP: every squad kill pays 10 RP, win or lose; a win adds the
mission reward on top.

Pure unit test — no live backend needed, no fixtures used.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

from lib.missions import KILL_RP, MISSIONS, battle_reward


def test_kill_pays_ten_rp_win_or_lose():
    assert KILL_RP == 10
    assert battle_reward(250, False, 1) == 10
    assert battle_reward(250, True, 1) == 260


def test_win_adds_mission_reward_on_top():
    assert battle_reward(250, True, 15) == 400
    assert battle_reward(400, True, 15) == 550
    assert battle_reward(650, True, 15) == 800
    assert battle_reward(1000, True, 15) == 1150


def test_loss_pays_kill_rp_only():
    assert battle_reward(250, False, 15) == 150
    assert battle_reward(1000, False, 15) == 150
    assert battle_reward(250, False, 20) == 200


def test_loot_from_supply_crates_adds_on_top():
    assert battle_reward(250, True, 15, 50) == 450
    assert battle_reward(250, False, 15, 25) == 175
    assert battle_reward(250, False, 0, 50) == 50
    assert battle_reward(250, True, 0, 0) == 250


def test_no_kills_no_rp_on_a_loss():
    assert battle_reward(250, False, 0) == 0
    assert battle_reward(250, True, 0) == 250


def test_more_kills_means_more_rp():
    for m in MISSIONS:
        assert battle_reward(m["reward"], False, 10) < battle_reward(m["reward"], False, 20)
        assert battle_reward(m["reward"], True, 10) < battle_reward(m["reward"], True, 20)
        assert battle_reward(m["reward"], False, 10) < battle_reward(m["reward"], True, 10)
