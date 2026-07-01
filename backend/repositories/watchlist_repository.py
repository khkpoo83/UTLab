"""Data-access layer for the watchlist router.

``WatchlistRepository`` wraps an ``AsyncSession`` and encapsulates every
SQLAlchemy query that ``routers/watchlist.py`` previously ran inline (over
``Watchlist`` and the recent-``Recommendation`` lookup).  Query semantics
(filters, ordering) and transaction boundaries (commit / refresh) match the
router exactly — this is a behavior-preserving relocation.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import Recommendation, Watchlist


class WatchlistRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_all_ordered(self) -> list[Watchlist]:
        """All watchlist items ordered by ``created_at`` descending."""
        result = await self.db.execute(
            select(Watchlist).order_by(Watchlist.created_at.desc())
        )
        return list(result.scalars().all())

    async def recent_recommended_tickers(self, cutoff: datetime) -> set[str]:
        """Set of recommendation tickers created on/after ``cutoff``.

        Mirrors the list endpoint's recent-recommendation lookup exactly.
        """
        result = await self.db.execute(
            select(Recommendation.ticker).where(Recommendation.created_at >= cutoff)
        )
        return {row[0] for row in result.fetchall()}

    async def get(self, item_id: int) -> Optional[Watchlist]:
        """Single watchlist item by id, or ``None``."""
        result = await self.db.execute(
            select(Watchlist).where(Watchlist.id == item_id)
        )
        return result.scalar_one_or_none()

    async def add(self, item: Watchlist) -> Watchlist:
        """Persist a new watchlist item (add + commit + refresh)."""
        self.db.add(item)
        await self.db.commit()
        await self.db.refresh(item)
        return item

    async def update(self, item: Watchlist) -> Watchlist:
        """Flush field mutations already applied by the caller (commit + refresh)."""
        await self.db.commit()
        await self.db.refresh(item)
        return item

    async def delete(self, item: Watchlist) -> None:
        """Remove a watchlist item (delete + commit)."""
        await self.db.delete(item)
        await self.db.commit()
