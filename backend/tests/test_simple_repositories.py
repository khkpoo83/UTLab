"""Unit tests for the five relocated repositories — direct-session round-trips.

Mirrors ``tests/test_portfolio_repository.py``: uses the shared file-backed test
DB via ``AsyncSessionLocal`` and the ``_schema`` fixture (see conftest.py).  One
focused CRUD/read round-trip per repository, covering the primary create ->
get/list -> update/delete flow.
"""

from datetime import datetime, timedelta

import pytest

from models.database import (
    Account,
    AsyncSessionLocal,
    InvestmentMark,
    Memo,
    Portfolio,
    Recommendation,
    User,
    UserProfile,
    Watchlist,
)
from repositories.account_repository import AccountRepository
from repositories.investment_mark_repository import InvestmentMarkRepository
from repositories.memo_repository import MemoRepository
from repositories.profile_repository import ProfileRepository
from repositories.watchlist_repository import WatchlistRepository
from utils.timeutil import utcnow


# --------------------------------------------------------------------------- #
# MemoRepository
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_memo_repository_roundtrip(_schema):
    async with AsyncSessionLocal() as session:
        repo = MemoRepository(session)

        memo = await repo.add(Memo(title="장기투자 메모", body="삼성전자", color="#fef08a"))
        assert memo.id is not None

        fetched = await repo.get(memo.id)
        assert fetched is not None
        assert fetched.title == "장기투자 메모"

        # list + title filter
        await repo.add(Memo(title="다른 제목"))
        assert len(await repo.list()) == 2
        filtered = await repo.list("장기")
        assert [m.title for m in filtered] == ["장기투자 메모"]

        # update
        fetched.body = "수정됨"
        await repo.update(fetched)
        assert (await repo.get(memo.id)).body == "수정됨"

        # delete
        await repo.delete(fetched)
        assert await repo.get(memo.id) is None


@pytest.mark.asyncio
async def test_memo_repository_list_desc_by_created_at(_schema):
    async with AsyncSessionLocal() as session:
        repo = MemoRepository(session)
        for i in range(3):
            await repo.add(Memo(title=f"m{i}"))
        rows = await repo.list()
        created = [r.created_at for r in rows]
        assert created == sorted(created, reverse=True)


# --------------------------------------------------------------------------- #
# WatchlistRepository
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_watchlist_repository_roundtrip(_schema):
    async with AsyncSessionLocal() as session:
        repo = WatchlistRepository(session)

        item = await repo.add(
            Watchlist(ticker="005930.KS", name="삼성전자", exchange="KOSPI")
        )
        assert item.id is not None

        fetched = await repo.get(item.id)
        assert fetched is not None
        assert fetched.ticker == "005930.KS"

        assert len(await repo.list_all_ordered()) == 1

        fetched.name = "삼성전자우"
        await repo.update(fetched)
        assert (await repo.get(item.id)).name == "삼성전자우"

        await repo.delete(fetched)
        assert await repo.get(item.id) is None


@pytest.mark.asyncio
async def test_watchlist_recent_recommended_tickers(_schema):
    async with AsyncSessionLocal() as session:
        repo = WatchlistRepository(session)
        now = utcnow()

        session.add(Recommendation(ticker="RECENT", name="r1", created_at=now))
        session.add(
            Recommendation(ticker="OLD", name="r2", created_at=now - timedelta(days=30))
        )
        await session.commit()

        cutoff = now - timedelta(days=7)
        tickers = await repo.recent_recommended_tickers(cutoff)
        assert "RECENT" in tickers
        assert "OLD" not in tickers


# --------------------------------------------------------------------------- #
# AccountRepository
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_account_repository_roundtrip(_schema):
    async with AsyncSessionLocal() as session:
        repo = AccountRepository(session)

        acc = await repo.add(Account(name="주계좌", color="#3B82F6"))
        assert acc.id is not None

        assert (await repo.get(acc.id)).name == "주계좌"
        assert len(await repo.list_all_ordered()) == 1

        acc.name = "부계좌"
        await repo.update(acc)
        assert (await repo.get(acc.id)).name == "부계좌"


@pytest.mark.asyncio
async def test_account_delete_detaches_holdings(_schema):
    async with AsyncSessionLocal() as session:
        repo = AccountRepository(session)
        acc = await repo.add(Account(name="삭제대상"))

        holding = Portfolio(
            ticker="A", name="a", avg_price=1.0, quantity=1.0, account_id=acc.id
        )
        session.add(holding)
        await session.commit()
        await session.refresh(holding)

        await repo.delete_with_holdings_detached(acc)

        assert await repo.get(acc.id) is None
        await session.refresh(holding)
        assert holding.account_id is None


# --------------------------------------------------------------------------- #
# InvestmentMarkRepository
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_investment_mark_repository_roundtrip(_schema):
    async with AsyncSessionLocal() as session:
        repo = InvestmentMarkRepository(session)

        mark = await repo.add(InvestmentMark(date="2026-03-15", title="매수"))
        assert mark.id is not None

        assert (await repo.get(mark.id)).title == "매수"

        # second transaction point (mutate + bare commit)
        mark.google_event_id = "evt-123"
        await repo.commit()
        assert (await repo.get(mark.id)).google_event_id == "evt-123"

        await repo.delete(mark)
        assert await repo.get(mark.id) is None


@pytest.mark.asyncio
async def test_investment_mark_list_date_range_ordered(_schema):
    async with AsyncSessionLocal() as session:
        repo = InvestmentMarkRepository(session)
        for d in ("2026-01-10", "2026-02-10", "2026-03-10"):
            await repo.add(InvestmentMark(date=d, title=f"e-{d}"))

        # ordered ascending by date
        assert [m.date for m in await repo.list()] == [
            "2026-01-10",
            "2026-02-10",
            "2026-03-10",
        ]

        # bounded
        bounded = await repo.list(from_date="2026-02-01", to_date="2026-02-28")
        assert [m.date for m in bounded] == ["2026-02-10"]


# --------------------------------------------------------------------------- #
# ProfileRepository
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_profile_repository_roundtrip(_schema):
    async with AsyncSessionLocal() as session:
        repo = ProfileRepository(session)

        user = User(username="profileuser", hashed_password="x")
        session.add(user)
        await session.commit()
        await session.refresh(user)

        # none until created
        assert await repo.get_by_user_id(user.id) is None

        profile = await repo.add(
            UserProfile(user_id=user.id, profile_icon="👤", retire_age=60)
        )
        assert profile.id is not None

        fetched = await repo.get_by_user_id(user.id)
        assert fetched is not None
        assert fetched.retire_age == 60

        fetched.retire_age = 65
        await repo.update(fetched)
        assert (await repo.get_by_user_id(user.id)).retire_age == 65
