"""Criterion: More enemy types — scharfschutze, mortar, fallschirmjager appear in missions.

Pure API/data criterion: GET /api/missions must include these three newer enemy types
somewhere across the mission list, and specifically op_01 wave 2 must include the
Scharfschütze sniper (matches the War Room enemy-intel expectation for the current op).
"""

import httpx


def test_missions_include_new_enemy_types(client: httpx.Client):
    resp = client.get("/missions")
    assert resp.status_code == 200, resp.text
    missions = resp.json()
    assert len(missions) > 0

    all_enemy_types = set()
    for m in missions:
        for e in m.get("enemies", []):
            all_enemy_types.add(e["type"])

    for expected in ("scharfschutze", "mortar", "fallschirmjager"):
        assert expected in all_enemy_types, (expected, all_enemy_types)

    op_01 = next(m for m in missions if m["id"] == "op_01")
    wave2 = [e for e in op_01["enemies"] if e["wave"] == 2]
    wave2_types = {e["type"] for e in wave2}
    assert "scharfschutze" in wave2_types, (
        "op_01 wave 2 should include the Scharfschütze sniper",
        wave2,
    )
