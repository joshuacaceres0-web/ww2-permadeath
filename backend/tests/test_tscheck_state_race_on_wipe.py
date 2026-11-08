"""Bug reproduction: GET /api/state concurrent with POST /campaign/wipe on a brand-new
save id can 500 (lib/state.py get_state() races with campaign.wipe_everything's
delete_many + insert_one window -> state_out() indexes a None state).

This is a genuine race in the app, not a test artifact: reproduced directly against the
running server with plain concurrent HTTP calls on a never-before-seen save id.
"""

import asyncio

import httpx

BASE = "http://localhost:8001/api"


async def _wipe(save_id: str):
    async with httpx.AsyncClient(base_url=BASE, timeout=30.0, headers={"X-Save-Id": save_id}) as c:
        return await c.post("/campaign/wipe", json={"confirm": "RESET"})


async def _state(save_id: str):
    async with httpx.AsyncClient(base_url=BASE, timeout=30.0, headers={"X-Save-Id": save_id}) as c:
        return await c.get("/state")


async def test_state_survives_concurrent_wipe_on_fresh_save():
    """Fire GET /state and POST /campaign/wipe at the same instant on several brand-new
    save ids; GET /state must never 500 even if it races the wipe's recreate window."""
    failures = []
    for i in range(6):
        save_id = f"tscheck-staterace-{i}"
        wipe_resp, state_resp = await asyncio.gather(_wipe(save_id), _state(save_id))
        if state_resp.status_code != 200:
            failures.append((save_id, state_resp.status_code, state_resp.text[:200]))
        assert wipe_resp.status_code == 200, wipe_resp.text

    assert not failures, f"GET /api/state 500'd while racing POST /campaign/wipe on a fresh save: {failures}"
