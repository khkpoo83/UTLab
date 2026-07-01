"""추천 결과 조회 (캐시 포함) + 최신 뉴스 제목 헬퍼."""

import asyncio
import logging

from sqlalchemy import String, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import AsyncSessionLocal, News, Portfolio, Recommendation
from services.recommend.cache import _RECOMMEND_CACHE_KEY, _RECOMMEND_TTL, _recommend_cache
from services.recommend.sectors import _infer_sector_from_name

logger = logging.getLogger(__name__)


async def _get_latest_news_title(session: AsyncSession, ticker: str, name: str) -> str | None:
    """종목의 최신 뉴스 제목 1개 조회"""
    try:
        # ticker 기준 (related_stocks JSON에 포함)
        result = await session.execute(
            select(News.title)
            .where(News.status == "done")
            .where(News.related_stocks.cast(String).contains(ticker))
            .order_by(News.published_at.desc())
            .limit(1)
        )
        row = result.scalar_one_or_none()
        if row:
            return row
        # 종목명 기준 fallback
        if name and name != ticker:
            result2 = await session.execute(
                select(News.title)
                .where(News.status == "done")
                .where(News.title.contains(name))
                .order_by(News.published_at.desc())
                .limit(1)
            )
            return result2.scalar_one_or_none()
    except Exception as e:
        logger.debug(f"_get_latest_news_title failed for {ticker}: {e}")
    return None


async def get_recommendations() -> list[dict]:
    # Check cache first
    cached = await _recommend_cache.get(_RECOMMEND_CACHE_KEY)
    if cached is not None:
        return cached

    # 포트폴리오 + 추천 동시 조회
    async def _fetch_holdings():
        async with AsyncSessionLocal() as session:
            portfolio_result = await session.execute(select(Portfolio))
            return portfolio_result.scalars().all()

    async def _fetch_recs():
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(Recommendation).order_by(
                    Recommendation.sector,
                    Recommendation.news_count.desc(),
                )
            )
            return result.scalars().all()

    holdings, rows = await asyncio.gather(_fetch_holdings(), _fetch_recs())

    portfolio_tickers = {h.ticker for h in holdings}

    sector_groups: dict[str, list[dict]] = {}
    seen_tickers: set[str] = set()

    # 최신 뉴스 제목 — 병렬 조회 (N+1 개선)
    all_tickers_names: list[tuple[str, str]] = []
    for row in rows:
        all_tickers_names.append((row.ticker, row.name or row.ticker))
    for h in holdings:
        if h.ticker not in {r.ticker for r in rows}:
            all_tickers_names.append((h.ticker, h.name or h.ticker))

    async with AsyncSessionLocal() as session:
        news_titles = await asyncio.gather(
            *(_get_latest_news_title(session, ticker, name) for ticker, name in all_tickers_names),
            return_exceptions=True,
        )
    latest_news_map: dict[str, str | None] = {
        ticker: (title if isinstance(title, str) else None)
        for (ticker, _), title in zip(all_tickers_names, news_titles)
    }

    # 1) AI 분석 완료 추천 종목만 표시 (ai_session 있는 것만)
    rows = [r for r in rows if r.ai_session is not None]

    for row in rows:
        sector = row.sector or "기타"
        is_portfolio = row.ticker in portfolio_tickers
        seen_tickers.add(row.ticker)
        sector_groups.setdefault(sector, []).append({
            "id": row.id,
            "ticker": row.ticker,
            "name": row.name,
            "sector": row.sector,
            "sector_weight": row.sector_weight,
            "news_count": row.news_count,
            "latest_price": row.latest_price,
            "change_pct": row.change_pct,
            "strength": row.strength,
            "is_portfolio": is_portfolio,
            "source": "portfolio" if is_portfolio else "news",
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "latest_news_title": latest_news_map.get(row.ticker),
            "reason": row.reason,
            "confidence": row.confidence,
            "ai_session": row.ai_session,
            "entry_price": row.entry_price,
            "entry_range_low": row.entry_range_low,
            "entry_range_high": row.entry_range_high,
            "target_price": row.target_price,
            "target_return_pct": row.target_return_pct,
            "stop_loss_price": row.stop_loss_price,
            "stop_loss_pct": row.stop_loss_pct,
            "technical_summary": row.technical_summary,
            "generated_at": row.generated_at.isoformat() if row.generated_at else None,
            "community_sentiment": row.community_sentiment,
            "political_theme": row.political_theme,
            "political_weight": row.political_weight,
        })

    # 2) 추천에 없는 포트폴리오 종목 추가
    for h in holdings:
        if h.ticker in seen_tickers:
            continue
        sector = h.sector or _infer_sector_from_name(h.name or "") or "기타"
        sector_groups.setdefault(sector, []).append({
            "id": None,
            "ticker": h.ticker,
            "name": h.name,
            "sector": sector,
            "sector_weight": 0.0,
            "news_count": 0,
            "latest_price": h.avg_price,
            "change_pct": None,
            "strength": "watch",
            "is_portfolio": True,
            "source": "portfolio",
            "created_at": None,
            "latest_news_title": latest_news_map.get(h.ticker),
            "reason": None,
            "confidence": None,
            "ai_session": None,
            "entry_price": None,
            "entry_range_low": None,
            "entry_range_high": None,
            "target_price": None,
            "target_return_pct": None,
            "stop_loss_price": None,
            "stop_loss_pct": None,
            "technical_summary": None,
            "generated_at": None,
            "community_sentiment": None,
            "political_theme": None,
            "political_weight": None,
        })

    result_list = []
    for sector, items in sector_groups.items():
        # 섹터 weight: 추천 종목에서 가져오거나 0
        rec_items = [i for i in items if i.get("source") == "news"]
        sector_weight = rec_items[0]["sector_weight"] if rec_items else 0
        result_list.append({
            "sector": sector,
            "sector_weight": sector_weight,
            "items": items,
        })

    result_list.sort(key=lambda x: x["sector_weight"])

    # Cache the result
    await _recommend_cache.set(_RECOMMEND_CACHE_KEY, result_list, ttl_seconds=_RECOMMEND_TTL)

    return result_list
