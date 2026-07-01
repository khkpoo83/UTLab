"""Data-access layer for the accounts router.

``AccountRepository`` wraps an ``AsyncSession`` and encapsulates every
SQLAlchemy query that ``routers/accounts.py`` previously ran inline.  Query
semantics (ordering) and transaction boundaries (commit / refresh) match the
router exactly — this is a behavior-preserving relocation.

The account-delete path also clears ``Portfolio.account_id`` for the account's
holdings and removes the account within a *single* transaction (one ``commit``),
exactly as the router did.  That cross-entity bulk update lives here (rather
than in ``PortfolioRepository``) to preserve the single transaction point.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import Account, Portfolio


class AccountRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_all_ordered(self) -> list[Account]:
        """All accounts ordered by ``created_at`` ascending (list endpoint)."""
        result = await self.db.execute(select(Account).order_by(Account.created_at))
        return list(result.scalars().all())

    async def get(self, account_id: int) -> Optional[Account]:
        """Single account by id, or ``None``."""
        result = await self.db.execute(
            select(Account).where(Account.id == account_id)
        )
        return result.scalar_one_or_none()

    async def add(self, account: Account) -> Account:
        """Persist a new account (add + commit + refresh)."""
        self.db.add(account)
        await self.db.commit()
        await self.db.refresh(account)
        return account

    async def update(self, account: Account) -> Account:
        """Flush field mutations already applied by the caller (commit + refresh)."""
        await self.db.commit()
        await self.db.refresh(account)
        return account

    async def delete_with_holdings_detached(self, account: Account) -> None:
        """Clear holdings' ``account_id`` then delete the account (single commit).

        Mirrors the delete endpoint: first null out ``Portfolio.account_id`` for
        every holding referencing this account, then delete the account — all in
        one transaction.
        """
        await self.db.execute(
            update(Portfolio)
            .where(Portfolio.account_id == account.id)
            .values(account_id=None)
        )
        await self.db.delete(account)
        await self.db.commit()
