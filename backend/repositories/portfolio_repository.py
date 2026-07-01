"""Data-access layer for the portfolio router.

``PortfolioRepository`` wraps an ``AsyncSession`` and encapsulates every
SQLAlchemy query that ``routers/portfolio.py`` previously ran inline.  Query
semantics (filters, ordering, limits) and transaction boundaries (commit /
refresh) match the router exactly — this is a behavior-preserving relocation.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import Account, Portfolio, StockMaster


class PortfolioRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list(self, account_name: Optional[str] = None) -> list[Portfolio]:
        """Holdings for the summary endpoint, optionally filtered by account name.

        Mirrors the ``GET /summary`` query: join to ``Account`` and filter by
        ``Account.name`` when ``account_name`` is given, otherwise all holdings.
        """
        if account_name is not None:
            stmt = (
                select(Portfolio)
                .join(Account, Portfolio.account_id == Account.id)
                .where(Account.name == account_name)
            )
        else:
            stmt = select(Portfolio)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def list_all_ordered(self) -> list[Portfolio]:
        """All holdings ordered by ``created_at`` descending (list endpoint)."""
        result = await self.db.execute(
            select(Portfolio).order_by(Portfolio.created_at.desc())
        )
        return list(result.scalars().all())

    async def get(self, holding_id: int) -> Optional[Portfolio]:
        """Single holding by id, or ``None``."""
        result = await self.db.execute(
            select(Portfolio).where(Portfolio.id == holding_id)
        )
        return result.scalar_one_or_none()

    async def add(self, holding: Portfolio) -> Portfolio:
        """Persist a new holding (add + commit + refresh)."""
        self.db.add(holding)
        await self.db.commit()
        await self.db.refresh(holding)
        return holding

    async def update(self, holding: Portfolio) -> Portfolio:
        """Flush field mutations already applied by the caller (commit + refresh)."""
        await self.db.commit()
        await self.db.refresh(holding)
        return holding

    async def delete(self, holding: Portfolio) -> None:
        """Remove a holding (delete + commit)."""
        await self.db.delete(holding)
        await self.db.commit()

    async def list_accounts(self) -> list[Account]:
        """All accounts (used to build the id -> account map)."""
        result = await self.db.execute(select(Account))
        return list(result.scalars().all())

    async def find_stock_master_by_prefix(self, ticker: str) -> Optional[StockMaster]:
        """StockMaster whose ticker starts with ``{ticker}.`` (first match).

        Backs ``_resolve_yf_ticker``'s KIS-code -> Yahoo-ticker lookup.
        """
        result = await self.db.execute(
            select(StockMaster).where(StockMaster.ticker.like(f"{ticker}.%")).limit(1)
        )
        return result.scalar_one_or_none()
