"""Data-access layer for the settings router.

``SettingsRepository`` wraps an ``AsyncSession`` and encapsulates the raw
SQLAlchemy reads/writes over ``AppSettings`` that ``routers/settings.py``
previously ran inline.  The DEFAULT_SETTINGS merge / (de)serialization logic
stays in the router; only the raw DB access lives here.  Transaction
boundaries match the router exactly — this is a behavior-preserving relocation.
"""

from __future__ import annotations

import json
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import AppSettings


class SettingsRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_all(self) -> dict:
        """All persisted settings merged over ``DEFAULT_SETTINGS``.

        Preserves ``get_all_settings``' exact transformation: start from a copy
        of the defaults, then overlay each DB row (JSON-decoding its value, or
        falling back to the raw string on decode failure).
        """
        from routers.settings import DEFAULT_SETTINGS

        result = await self.db.execute(select(AppSettings))
        rows = result.scalars().all()
        cfg = dict(DEFAULT_SETTINGS)
        for row in rows:
            try:
                cfg[row.key] = json.loads(row.value)
            except Exception:
                cfg[row.key] = row.value
        return cfg

    async def get(self, key: str) -> Optional[AppSettings]:
        """Single settings row by key, or ``None``."""
        result = await self.db.execute(
            select(AppSettings).where(AppSettings.key == key)
        )
        return result.scalar_one_or_none()

    async def upsert(self, key: str, serialized_value: str) -> None:
        """Insert or update a settings row.  Does NOT commit (caller commits)."""
        row = await self.get(key)
        if row:
            row.value = serialized_value
        else:
            self.db.add(AppSettings(key=key, value=serialized_value))

    async def commit(self) -> None:
        """Flush the pending upserts (single transaction point)."""
        await self.db.commit()
