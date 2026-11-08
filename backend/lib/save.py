"""Per-browser save slots.

Every request carries an `X-Save-Id` header (frontend stores a random id in localStorage;
legacy/default = "main", which owns the original save). A middleware puts it in a contextvar,
and `S.<collection>` transparently scopes every query and insert to that save.
"""

import asyncio
import re
from contextvars import ContextVar

from lib.db import db

current_save: ContextVar[str] = ContextVar("current_save", default="main")


def sid() -> str:
    return current_save.get()


def clean_save_id(raw: str | None) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "", raw or "")[:48] or "main"


_locks: dict[str, "asyncio.Lock"] = {}


def save_lock() -> "asyncio.Lock":
    """Serialises create/wipe of one save (single uvicorn process)."""
    key = sid()
    if key not in _locks:
        _locks[key] = asyncio.Lock()
    return _locks[key]


class _Scoped:
    def __init__(self, name: str):
        self._c = db[name]

    def _f(self, flt: dict | None = None) -> dict:
        return {**(flt or {}), "save_id": sid()}

    def find(self, flt: dict | None = None, *a, **k):
        return self._c.find(self._f(flt), *a, **k)

    async def find_one(self, flt: dict | None = None, *a, **k):
        return await self._c.find_one(self._f(flt), *a, **k)

    async def count_documents(self, flt: dict | None = None):
        return await self._c.count_documents(self._f(flt))

    async def insert_one(self, doc: dict):
        doc["save_id"] = sid()
        return await self._c.insert_one(doc)

    async def insert_many(self, docs: list[dict]):
        for d in docs:
            d["save_id"] = sid()
        return await self._c.insert_many(docs)

    async def update_one(self, flt: dict, upd: dict, **k):
        return await self._c.update_one(self._f(flt), upd, **k)

    async def update_many(self, flt: dict, upd: dict, **k):
        return await self._c.update_many(self._f(flt), upd, **k)

    async def delete_one(self, flt: dict):
        return await self._c.delete_one(self._f(flt))

    async def delete_many(self, flt: dict | None = None):
        return await self._c.delete_many(self._f(flt))


class _Namespace:
    soldiers = _Scoped("soldiers")
    memorial = _Scoped("memorial")
    graveyard_decor = _Scoped("graveyard_decor")
    game_state = _Scoped("game_state")


S = _Namespace()


async def migrate_legacy() -> None:
    """Pre-slot documents all belong to the original save, "main"."""
    for name in ("soldiers", "memorial", "graveyard_decor", "game_state"):
        await db[name].update_many({"save_id": {"$exists": False}}, {"$set": {"save_id": "main"}})
    try:
        await db.game_state.drop_index("id")  # was unique on id alone; now unique per save
    except Exception:
        pass
