"""Unit tests for NewsRepository and SettingsRepository — direct-session round-trips.

Uses the same test DB as the rest of the suite via ``AsyncSessionLocal`` and
the ``_schema`` fixture (see conftest.py).  Mirrors tests/test_portfolio_repository.py.
"""

import json

import pytest

from models.database import AppSettings, AsyncSessionLocal, News
from repositories.news_repository import NewsRepository
from repositories.settings_repository import SettingsRepository


@pytest.mark.asyncio
async def test_news_get_and_count_by_status(_schema):
    async with AsyncSessionLocal() as session:
        session.add_all([
            News(title="a", url="u1", url_hash="h1", source="t", status="pending"),
            News(title="b", url="u2", url_hash="h2", source="t", status="pending"),
            News(title="c", url="u3", url_hash="h3", source="t", status="done"),
        ])
        await session.commit()

    async with AsyncSessionLocal() as session:
        repo = NewsRepository(session)
        assert await repo.count_by_status("pending") == 2
        assert await repo.count_by_status("done") == 1
        assert await repo.count_by_status("summarizing") == 0


@pytest.mark.asyncio
async def test_news_get_returns_row_and_none(_schema):
    async with AsyncSessionLocal() as session:
        n = News(title="x", url="ux", url_hash="hx", source="t", status="done")
        session.add(n)
        await session.commit()
        await session.refresh(n)
        nid = n.id

    async with AsyncSessionLocal() as session:
        repo = NewsRepository(session)
        fetched = await repo.get(nid)
        assert fetched is not None
        assert fetched.title == "x"
        assert await repo.get(999999) is None


@pytest.mark.asyncio
async def test_settings_upsert_get_all_roundtrip(_schema):
    async with AsyncSessionLocal() as session:
        repo = SettingsRepository(session)

        # insert new + commit
        await repo.upsert("stock_interval_minutes", json.dumps(45))
        await repo.commit()

        # get() returns the raw AppSettings row
        row = await repo.get("stock_interval_minutes")
        assert row is not None
        assert isinstance(row, AppSettings)
        assert json.loads(row.value) == 45

        # get_all merges over DEFAULT_SETTINGS with JSON decoding
        cfg = await repo.get_all()
        assert cfg["stock_interval_minutes"] == 45
        # untouched default still present
        from routers.settings import DEFAULT_SETTINGS
        assert cfg["ai_summary_max_items"] == DEFAULT_SETTINGS["ai_summary_max_items"]

        # update existing key (upsert on existing row)
        await repo.upsert("stock_interval_minutes", json.dumps(30))
        await repo.commit()
        cfg2 = await repo.get_all()
        assert cfg2["stock_interval_minutes"] == 30

        # missing key -> None
        assert await repo.get("no_such_key") is None
