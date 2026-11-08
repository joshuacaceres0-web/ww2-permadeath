"""Bug reproduction: concurrent first-touch requests on a brand-new save id can double-seed
the founding squad, because lib/state.py get_state()/seed_squad() and routers/campaign.py
wipe_everything() use a check-then-insert pattern with no lock: a GET /state that
self-heals a never-before-seen save races a POST /campaign/wipe (which unconditionally
re-seeds) and both end up inserting the 7-man founding squad. Reproduced directly against
the running server with plain concurrent HTTP calls on never-before-seen save ids -- this
mirrors a real player's first page load (which fires /state) landing at the same instant as
a reset. 100% reproducible in this harness run; see also test_tscheck_state_race_on_wipe.py
for the companion GET /state 500.
"""

import asyncio

import httpx

BASE = "http://localhost:8001/api"


def _client(save_id: str) -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=BASE, timeout=30.0, headers={"X-Save-Id": save_id})


async def _race_once(save_id: str) -> set[str]:
    async with _client(save_id) as a, _client(save_id) as b:
        await asyncio.gather(
            a.get("/state"),
            b.post("/campaign/wipe", json={"confirm": "RESET"}),
        )
    async with _client(save_id) as c:
        squad = (await c.get("/squad")).json()
    names = [s["name"] for s in squad]
    return {n for n in names if names.count(n) > 1}


async def test_concurrent_first_touch_does_not_duplicate_founding_squad():
    # A single pair rarely lands in the exact gap; run several fresh save ids concurrently
    # (mirrors real traffic) so the window is actually hit at least once.
    results = await asyncio.gather(
        *(_race_once(f"tscheck-firsttouch-squadrace-{i}") for i in range(12))
    )
    bad = {f"save-{i}": dups for i, dups in enumerate(results) if dups}
    assert not bad, f"Founding squad was double-seeded by a first-touch race: {bad}"
