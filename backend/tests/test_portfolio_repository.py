"""Unit tests for PortfolioRepository — direct-session round-trips.

Uses the same in-memory/file test DB as the rest of the suite via
``AsyncSessionLocal`` and the ``_schema`` fixture (see conftest.py).
"""

import pytest

from models.database import Account, AsyncSessionLocal, Portfolio, StockMaster
from repositories.portfolio_repository import PortfolioRepository


@pytest.mark.asyncio
async def test_add_get_update_delete_roundtrip(_schema):
    async with AsyncSessionLocal() as session:
        repo = PortfolioRepository(session)

        # add
        holding = Portfolio(
            ticker="005930.KS", name="삼성전자", avg_price=70000.0, quantity=10.0
        )
        added = await repo.add(holding)
        assert added.id is not None

        # get
        fetched = await repo.get(added.id)
        assert fetched is not None
        assert fetched.ticker == "005930.KS"
        assert fetched.quantity == 10.0

        # update (mutation-in-caller, then repo commits/refreshes)
        fetched.quantity = 25.0
        updated = await repo.update(fetched)
        assert updated.quantity == 25.0
        assert (await repo.get(added.id)).quantity == 25.0

        # delete
        await repo.delete(fetched)
        assert await repo.get(added.id) is None


@pytest.mark.asyncio
async def test_get_missing_returns_none(_schema):
    async with AsyncSessionLocal() as session:
        repo = PortfolioRepository(session)
        assert await repo.get(999999) is None


@pytest.mark.asyncio
async def test_list_all_ordered_desc_by_created_at(_schema):
    async with AsyncSessionLocal() as session:
        repo = PortfolioRepository(session)
        for i in range(3):
            await repo.add(
                Portfolio(ticker=f"T{i}", name=f"n{i}", avg_price=1.0, quantity=1.0)
            )
        rows = await repo.list_all_ordered()
        assert len(rows) == 3
        created = [r.created_at for r in rows]
        assert created == sorted(created, reverse=True)


@pytest.mark.asyncio
async def test_list_filters_by_account_name(_schema):
    async with AsyncSessionLocal() as session:
        repo = PortfolioRepository(session)
        acc = Account(name="주계좌")
        session.add(acc)
        await session.commit()
        await session.refresh(acc)

        await repo.add(
            Portfolio(
                ticker="A", name="a", avg_price=1.0, quantity=1.0, account_id=acc.id
            )
        )
        await repo.add(Portfolio(ticker="B", name="b", avg_price=1.0, quantity=1.0))

        # filtered
        filtered = await repo.list(account_name="주계좌")
        assert [h.ticker for h in filtered] == ["A"]

        # unfiltered returns all
        assert len(await repo.list(None)) == 2

        # list_accounts sees the account
        assert any(a.id == acc.id for a in await repo.list_accounts())


@pytest.mark.asyncio
async def test_find_stock_master_by_prefix(_schema):
    async with AsyncSessionLocal() as session:
        repo = PortfolioRepository(session)
        session.add(StockMaster(ticker="005930.KS", name="삼성전자", exchange="KOSPI"))
        await session.commit()

        row = await repo.find_stock_master_by_prefix("005930")
        assert row is not None
        assert row.ticker == "005930.KS"

        assert await repo.find_stock_master_by_prefix("999999") is None
