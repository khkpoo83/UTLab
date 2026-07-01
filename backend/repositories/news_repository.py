"""Data-access layer for the news router.

``NewsRepository`` wraps an ``AsyncSession`` and encapsulates the SQLAlchemy
queries that ``routers/news.py`` previously ran inline.  Query semantics match
the router exactly — this is a behavior-preserving relocation.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import News


class NewsRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get(self, news_id: int) -> Optional[News]:
        """Single news row by id, or ``None`` (detail endpoint)."""
        result = await self.db.execute(select(News).where(News.id == news_id))
        return result.scalar_one_or_none()

    async def count_by_status(self, status: str) -> Optional[int]:
        """Count of news rows with the given ``status`` (queue-status endpoint)."""
        return await self.db.scalar(
            select(func.count(News.id)).where(News.status == status)
        )
