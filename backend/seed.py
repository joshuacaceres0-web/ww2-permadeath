"""Seed the campaign: idempotent, run manually with `cd /app/backend && python seed.py`."""

import asyncio

from lib.db import ensure_indexes
from lib.state import seed_all


async def main() -> None:
    await ensure_indexes()
    await seed_all()
    print("Seed complete: game state, founding squad, and memorial are in place.")


if __name__ == "__main__":
    asyncio.run(main())
