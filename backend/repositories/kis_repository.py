"""Data-access layer for the KIS router.

``KisRepository`` wraps an ``AsyncSession`` and encapsulates every SQLAlchemy
query that ``routers/kis.py`` previously ran inline over ``AppSettings``,
``StockMaster`` and ``DepositEvent``.  Query semantics (where/like/order/limit)
and transaction boundaries (commit) match the router exactly — this is a
behavior-preserving relocation.

Only the router's OWN direct SQLAlchemy access is relocated here.  The JSON
encode/decode of alias/color values, and all delegated ``kis_service`` /
``kis_sync_service`` / ``deposit_service`` / ``stock_service`` logic, stay in
the router untouched.
"""

from __future__ import annotations

from typing import Optional, Sequence

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import AppSettings, DepositEvent, StockMaster


class KisRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    # -- AppSettings (kis_aliases / kis_colors) ---------------------------
    async def get_setting(self, key: str) -> Optional[AppSettings]:
        """Single ``AppSettings`` row by key, or ``None``.

        Mirrors ``_load_aliases`` / ``_load_colors`` / the update endpoints'
        lookup (``select(AppSettings).where(key == ...)`` →
        ``scalar_one_or_none``).  The caller keeps ownership of JSON decode.
        """
        result = await self.db.execute(
            select(AppSettings).where(AppSettings.key == key)
        )
        return result.scalar_one_or_none()

    async def upsert_setting(self, key: str, serialized_value: str) -> None:
        """Insert or update a settings row.  Does NOT commit (caller commits).

        Mirrors ``update_aliases`` / ``update_colors``: update ``value`` on an
        existing row, else ``add`` a new ``AppSettings(key=, value=)``.
        """
        row = await self.get_setting(key)
        if row:
            row.value = serialized_value
        else:
            self.db.add(AppSettings(key=key, value=serialized_value))

    async def commit(self) -> None:
        """Single transaction point (matches the router's ``session.commit()``)."""
        await self.db.commit()

    # -- StockMaster (portfolio name/sector lookup) -----------------------
    async def find_stock_master(
        self, tickers: Sequence[str]
    ) -> Sequence[StockMaster]:
        """``StockMaster`` rows whose ticker starts with any ``<code>.``.

        Mirrors ``get_kis_portfolio``'s lookup:
        ``select(StockMaster).where(or_(*[ticker.like(f"{t}.%") ...]))``.
        With an empty ``tickers`` list the router never runs the query, so we
        return an empty list without touching the DB.
        """
        if not tickers:
            return []
        result = await self.db.execute(
            select(StockMaster).where(
                or_(*[StockMaster.ticker.like(f"{t}.%") for t in tickers])
            )
        )
        return result.scalars().all()

    # -- DepositEvent (input/output history) ------------------------------
    async def list_deposit_events(self, account_no: str) -> Sequence[DepositEvent]:
        """Deposit events, newest first, capped at 500.

        Mirrors ``get_deposit_history``: ``account_no == "TOTAL"`` returns all
        rows ordered by ``date`` descending (limit 500); any other value adds a
        ``where(account_no == ...)`` filter.
        """
        if account_no == "TOTAL":
            q = await self.db.execute(
                select(DepositEvent).order_by(DepositEvent.date.desc()).limit(500)
            )
        else:
            q = await self.db.execute(
                select(DepositEvent)
                .where(DepositEvent.account_no == account_no)
                .order_by(DepositEvent.date.desc())
                .limit(500)
            )
        return q.scalars().all()
