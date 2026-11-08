"""Pre-scaffolded pytest fixtures for the FastAPI backend.

Tests hit the live uvicorn process managed by supervisor (not an in-process ASGI app), so
the app under test is the same one the frontend and Playwright see. Do NOT re-create this
file — add app-specific fixtures below the marker at the bottom.
"""

import os

import httpx
import pytest
import pytest_asyncio

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8001")
API_URL = f"{BACKEND_URL}/api"


def api_url(path: str = "") -> str:
    """Absolute URL for an /api route: api_url("/status") -> http://localhost:8001/api/status."""
    return f"{API_URL}{path}"


@pytest.fixture(scope="session")
def backend_url() -> str:
    return BACKEND_URL


# CRITICAL_ISOLATION: the real player's save is save id "main". Every test client here
# MUST send a non-"main" X-Save-Id header so we never read/mutate/wipe the live campaign.
# The id is derived per-test-module (loadscope pins a module to one xdist worker) so two
# files running concurrently under `-n 2 --dist loadscope` never race on the same save.


@pytest.fixture
def client(request):
    """Sync httpx client rooted at /api — the default for endpoint tests.

    Always carries a test X-Save-Id header (never "main"), unique per test module so
    concurrent xdist workers don't collide. Tests needing a second save slot should build
    their own httpx.Client with an explicit different X-Save-Id header.

    Example:
        def test_status(client):
            assert client.get("/status").status_code == 200
    """
    save_id = f"tscheck-{request.module.__name__}"
    with httpx.Client(base_url=API_URL, timeout=30.0, headers={"X-Save-Id": save_id}) as c:
        yield c


@pytest_asyncio.fixture
async def aclient(request):
    """Async variant, for tests that also await motor/backend helpers directly."""
    save_id = f"tscheck-{request.module.__name__}"
    async with httpx.AsyncClient(
        base_url=API_URL, timeout=30.0, headers={"X-Save-Id": save_id}
    ) as c:
        yield c


# --- app-specific fixtures below this line ---
