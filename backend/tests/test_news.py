"""News router list endpoint with and without date param against seeded rows."""

from datetime import datetime

import pytest_asyncio


@pytest_asyncio.fixture
async def seed_news():
    """Seed two news rows on different KST days.

    published_at is stored as naive UTC (as the app does).  2026-06-15 09:00
    KST == 2026-06-15 00:00 UTC; 2026-06-16 09:00 KST == 2026-06-16 00:00 UTC.
    """
    from models.database import AsyncSessionLocal, News

    rows = [
        News(
            title="뉴스 A (15일)",
            url="https://example.com/a",
            url_hash="hash-a",
            source="test",
            published_at=datetime(2026, 6, 15, 0, 0, 0),  # 15일 09:00 KST
            sector="반도체",
            status="done",
        ),
        News(
            title="뉴스 B (16일)",
            url="https://example.com/b",
            url_hash="hash-b",
            source="test",
            published_at=datetime(2026, 6, 16, 0, 0, 0),  # 16일 09:00 KST
            sector="2차전지",
            status="pending",
        ),
    ]
    async with AsyncSessionLocal() as session:
        session.add_all(rows)
        await session.commit()
    return rows


async def test_news_requires_auth(client, seed_user):
    resp = await client.get("/api/news")
    assert resp.status_code == 401


async def test_list_news_no_date(client, auth_headers, seed_news):
    resp = await client.get("/api/news", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    assert len(body["items"]) == 2
    titles = {i["title"] for i in body["items"]}
    assert titles == {"뉴스 A (15일)", "뉴스 B (16일)"}


async def test_list_news_with_date_filter(client, auth_headers, seed_news):
    # only the 15일 KST row should match
    resp = await client.get("/api/news", params={"date": "2026-06-15"}, headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["title"] == "뉴스 A (15일)"


async def test_list_news_date_no_match(client, auth_headers, seed_news):
    resp = await client.get("/api/news", params={"date": "2020-01-01"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


async def test_list_news_sector_filter(client, auth_headers, seed_news):
    resp = await client.get("/api/news", params={"sector": "반도체"}, headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["sector"] == "반도체"
