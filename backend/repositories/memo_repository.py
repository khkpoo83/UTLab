"""Data-access layer for the memo router.

``MemoRepository`` wraps an ``AsyncSession`` and encapsulates every SQLAlchemy
query that ``routers/memo.py`` previously ran inline.  Query semantics (filters,
ordering) and transaction boundaries (commit / refresh) match the router
exactly — this is a behavior-preserving relocation.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import Memo


class MemoRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list(self, q: str = "") -> list[Memo]:
        """Memos ordered by ``created_at`` descending, optionally title-filtered.

        Mirrors the list endpoint: when ``q`` is truthy, filter to titles
        containing ``q``.
        """
        stmt = select(Memo).order_by(desc(Memo.created_at))
        if q:
            stmt = stmt.where(Memo.title.contains(q))
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def get(self, memo_id: int) -> Optional[Memo]:
        """Single memo by primary key, or ``None``."""
        return await self.db.get(Memo, memo_id)

    async def add(self, memo: Memo) -> Memo:
        """Persist a new memo (add + commit + refresh)."""
        self.db.add(memo)
        await self.db.commit()
        await self.db.refresh(memo)
        return memo

    async def update(self, memo: Memo) -> Memo:
        """Flush field mutations already applied by the caller (commit + refresh)."""
        await self.db.commit()
        await self.db.refresh(memo)
        return memo

    async def delete(self, memo: Memo) -> None:
        """Remove a memo (delete + commit)."""
        await self.db.delete(memo)
        await self.db.commit()
