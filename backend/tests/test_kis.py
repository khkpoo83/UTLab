"""Tests for the KIS router (routers/kis.py) and its repository.

Two layers:

* HTTP characterization tests for the KIS-independent endpoints — the aliases
  and colors settings CRUD (``GET/PUT /api/kis/aliases``, ``GET/PUT
  /api/kis/colors``).  These are pure ``AppSettings`` reads/writes with no KIS
  / brokerage dependency, so they can be driven end-to-end through the ASGI
  client.  They pin the HTTP contract byte-for-byte across the repository
  refactor.

* Repository unit tests for ``KisRepository`` — direct-session round-trips over
  the test DB (via ``AsyncSessionLocal`` + ``_schema``).  These are the PRIMARY
  guard for the inline DB access behind the KIS-DEPENDENT endpoints
  (``StockMaster`` name lookup, ``DepositEvent`` history query), which cannot be
  characterization-tested without live KIS / brokerage data.
"""

from datetime import datetime

import pytest

from models.database import AppSettings, AsyncSessionLocal, DepositEvent, StockMaster
from repositories.kis_repository import KisRepository


# ---------------------------------------------------------------------------
# HTTP characterization — aliases (AppSettings key="kis_aliases")
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_get_aliases_default_empty(client, auth_headers):
    """Unset → GET returns an empty dict."""
    resp = await client.get("/api/kis/aliases", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {}


@pytest.mark.asyncio
async def test_put_get_aliases_round_trip(client, auth_headers):
    """PUT a dict body → echoed back → GET returns the same mapping."""
    body = {"12345678": "연금계좌", "87654321": "ISA"}
    put = await client.put("/api/kis/aliases", headers=auth_headers, json=body)
    assert put.status_code == 200, put.text
    assert put.json() == body

    get = await client.get("/api/kis/aliases", headers=auth_headers)
    assert get.status_code == 200
    assert get.json() == body


@pytest.mark.asyncio
async def test_put_aliases_update_existing(client, auth_headers):
    """A second PUT overwrites the stored value (single row upsert)."""
    await client.put("/api/kis/aliases", headers=auth_headers, json={"1": "a"})
    body2 = {"1": "b", "2": "c"}
    put2 = await client.put("/api/kis/aliases", headers=auth_headers, json=body2)
    assert put2.status_code == 200
    assert put2.json() == body2

    get = await client.get("/api/kis/aliases", headers=auth_headers)
    assert get.json() == body2

    # exactly one AppSettings row for the key (upsert, not insert-append)
    from sqlalchemy import select

    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                select(AppSettings).where(AppSettings.key == "kis_aliases")
            )
        ).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_aliases_requires_auth(client):
    """No bearer token → 401."""
    resp = await client.get("/api/kis/aliases")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# HTTP characterization — colors (AppSettings key="kis_colors")
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_get_colors_default_empty(client, auth_headers):
    resp = await client.get("/api/kis/colors", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {}


@pytest.mark.asyncio
async def test_put_get_colors_round_trip(client, auth_headers):
    body = {"12345678": "#ff0000", "87654321": "#00aaff"}
    put = await client.put("/api/kis/colors", headers=auth_headers, json=body)
    assert put.status_code == 200, put.text
    assert put.json() == body

    get = await client.get("/api/kis/colors", headers=auth_headers)
    assert get.status_code == 200
    assert get.json() == body


@pytest.mark.asyncio
async def test_put_colors_update_existing(client, auth_headers):
    await client.put("/api/kis/colors", headers=auth_headers, json={"1": "#111111"})
    body2 = {"1": "#222222"}
    put2 = await client.put("/api/kis/colors", headers=auth_headers, json=body2)
    assert put2.status_code == 200
    assert put2.json() == body2

    get = await client.get("/api/kis/colors", headers=auth_headers)
    assert get.json() == body2


@pytest.mark.asyncio
async def test_aliases_colors_independent_keys(client, auth_headers):
    """aliases and colors are stored under distinct keys — no cross-talk."""
    await client.put("/api/kis/aliases", headers=auth_headers, json={"1": "alias"})
    await client.put("/api/kis/colors", headers=auth_headers, json={"1": "#abcdef"})

    assert (await client.get("/api/kis/aliases", headers=auth_headers)).json() == {
        "1": "alias"
    }
    assert (await client.get("/api/kis/colors", headers=auth_headers)).json() == {
        "1": "#abcdef"
    }


# ---------------------------------------------------------------------------
# KisRepository unit tests — AppSettings get/upsert
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_repo_get_setting_missing_returns_none(_schema):
    async with AsyncSessionLocal() as session:
        repo = KisRepository(session)
        assert await repo.get_setting("kis_aliases") is None


@pytest.mark.asyncio
async def test_repo_upsert_setting_insert_then_update(_schema):
    """Insert then update-existing → exactly one row, value overwritten."""
    async with AsyncSessionLocal() as session:
        repo = KisRepository(session)
        await repo.upsert_setting("kis_aliases", '{"a": 1}')
        await repo.commit()

    async with AsyncSessionLocal() as session:
        repo = KisRepository(session)
        row = await repo.get_setting("kis_aliases")
        assert row is not None
        assert row.value == '{"a": 1}'

        await repo.upsert_setting("kis_aliases", '{"a": 2}')
        await repo.commit()

    from sqlalchemy import select

    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                select(AppSettings).where(AppSettings.key == "kis_aliases")
            )
        ).scalars().all()
    assert len(rows) == 1
    assert rows[0].value == '{"a": 2}'


# ---------------------------------------------------------------------------
# KisRepository unit tests — StockMaster name lookup
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_repo_find_stock_master_prefix_match(_schema):
    """``find_stock_master`` matches ``ticker LIKE '<code>.%'`` for each code."""
    async with AsyncSessionLocal() as session:
        session.add_all([
            StockMaster(ticker="005930.KS", name="삼성전자", exchange="KOSPI",
                        market="KR", industry="반도체"),
            StockMaster(ticker="000660.KS", name="SK하이닉스", exchange="KOSPI",
                        market="KR", industry="반도체"),
            StockMaster(ticker="035720.KS", name="카카오", exchange="KOSPI",
                        market="KR", industry="인터넷"),
        ])
        await session.commit()

    async with AsyncSessionLocal() as session:
        repo = KisRepository(session)
        rows = await repo.find_stock_master(["005930", "000660"])
        got = {r.ticker for r in rows}
    assert got == {"005930.KS", "000660.KS"}


@pytest.mark.asyncio
async def test_repo_find_stock_master_empty_input(_schema):
    """Empty ticker list → empty result, no query error."""
    async with AsyncSessionLocal() as session:
        repo = KisRepository(session)
        assert await repo.find_stock_master([]) == []


# ---------------------------------------------------------------------------
# KisRepository unit tests — DepositEvent history
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_repo_list_deposit_events_ordering_and_filter(_schema):
    """TOTAL → all rows date-desc; account_no → filtered date-desc."""
    async with AsyncSessionLocal() as session:
        session.add_all([
            DepositEvent(account_no="A", date="2026-01-01", amount=100.0,
                         remark="입금", balance_after=100.0),
            DepositEvent(account_no="A", date="2026-03-01", amount=-50.0,
                         remark="출금", balance_after=50.0),
            DepositEvent(account_no="B", date="2026-02-01", amount=200.0,
                         remark="입금", balance_after=200.0),
        ])
        await session.commit()

    async with AsyncSessionLocal() as session:
        repo = KisRepository(session)

        # TOTAL: all rows, date descending
        total = await repo.list_deposit_events("TOTAL")
        assert [r.date for r in total] == ["2026-03-01", "2026-02-01", "2026-01-01"]

        # account filter: only A's rows, date descending
        acc_a = await repo.list_deposit_events("A")
        assert {r.account_no for r in acc_a} == {"A"}
        assert [r.date for r in acc_a] == ["2026-03-01", "2026-01-01"]


@pytest.mark.asyncio
async def test_repo_list_deposit_events_limit(_schema):
    """The 500-row limit is applied."""
    async with AsyncSessionLocal() as session:
        session.add_all([
            DepositEvent(account_no="A", date="2026-01-01",
                         amount=float(i), remark="x", balance_after=None)
            for i in range(510)
        ])
        await session.commit()

    async with AsyncSessionLocal() as session:
        repo = KisRepository(session)
        rows = await repo.list_deposit_events("TOTAL")
    assert len(rows) == 500
