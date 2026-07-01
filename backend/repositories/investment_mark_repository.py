"""Data-access layer for the investment-marks router.

``InvestmentMarkRepository`` wraps an ``AsyncSession`` and encapsulates every
SQLAlchemy query over ``InvestmentMark`` that ``routers/investment_marks.py``
previously ran inline.  Query semantics (date filters, ordering) and
transaction boundaries (commit / refresh) match the router exactly — this is a
behavior-preserving relocation.

The ``calendar_service`` / ``mark_sync`` service calls stay in the router; only
the ``InvestmentMark`` data access moves here.  ``create_mark`` commits twice
(once after insert, again after stamping the GCal ids) — the repo exposes both
``add`` and a bare ``commit`` to preserve those exact transaction points.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import InvestmentMark


class InvestmentMarkRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list(
        self,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
    ) -> list[InvestmentMark]:
        """Marks ordered by ``date``, optionally bounded by from/to date strings.

        Mirrors the list endpoint: build ``[date >= from_date, date <= to_date]``
        conditions for whichever bounds are provided and ``and_``-combine them.
        """
        conditions = []
        if from_date:
            conditions.append(InvestmentMark.date >= from_date)
        if to_date:
            conditions.append(InvestmentMark.date <= to_date)

        stmt = select(InvestmentMark).order_by(InvestmentMark.date)
        if conditions:
            stmt = stmt.where(and_(*conditions))

        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def get(self, mark_id: int) -> Optional[InvestmentMark]:
        """Single mark by id, or ``None``."""
        result = await self.db.execute(
            select(InvestmentMark).where(InvestmentMark.id == mark_id)
        )
        return result.scalar_one_or_none()

    async def add(self, mark: InvestmentMark) -> InvestmentMark:
        """Persist a new mark (add + commit + refresh)."""
        self.db.add(mark)
        await self.db.commit()
        await self.db.refresh(mark)
        return mark

    async def commit(self) -> None:
        """Flush caller-applied field mutations (second transaction point)."""
        await self.db.commit()

    async def delete(self, mark: InvestmentMark) -> None:
        """Remove a mark (delete + commit)."""
        await self.db.delete(mark)
        await self.db.commit()
