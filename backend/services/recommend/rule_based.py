"""규칙 기반 추천 재계산 (뉴스 빈도 카운트)."""

import asyncio
import logging
from collections import Counter
from datetime import timedelta

from sqlalchemy import delete, select

from models.database import AsyncSessionLocal, News, Recommendation, StockMaster
from services.recommend.cache import _RECOMMEND_CACHE_KEY, _recommend_cache
from services.recommend.portfolio import _get_korean_ticker_map, get_portfolio_sectors
from services.recommend.sectors import _industry_to_sector, _infer_sector_from_name
from utils.timeutil import utcnow

logger = logging.getLogger(__name__)


async def recalculate_recommendations(use_ai: bool = False, session_name: str = "evening") -> None:
    """추천 재계산. use_ai=True면 Gemini AI 사용(R1→R2→R3), False면 기존 규칙 기반."""
    if use_ai:
        # R1(후보 발굴)→R2(기술 검증)→R3(최종 선별) 순차 실행, 각 단계 실패 시 중단
        from services.recommend.ai_cycle import run_ai_r1, run_ai_r2, run_ai_r3
        if await run_ai_r1(session_name=session_name) and await run_ai_r2(session_name=session_name):
            await run_ai_r3(session_name=session_name)
    else:
        await _recalculate_rule_based()


async def _recalculate_rule_based() -> None:
    """기존 규칙 기반 추천 (뉴스 빈도 카운트)"""
    # Invalidate cache when recommendations are recalculated
    await _recommend_cache.clear(_RECOMMEND_CACHE_KEY)
    cutoff = utcnow() - timedelta(days=7)

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(News)
            .where(
                News.status == "done",
                News.created_at >= cutoff,
                News.related_stocks.isnot(None),
            )
        )
        recent_news = result.scalars().all()

    # 한국 종목 맵: code → canonical ticker (예: "035420" → "035420.KS")
    kr_ticker_map = await _get_korean_ticker_map()

    ticker_counts: Counter = Counter()
    ticker_news_sectors: dict[str, list[str]] = {}

    for news in recent_news:
        if not news.related_stocks:
            continue
        for ticker in news.related_stocks:
            if not ticker:
                continue
            ticker_str = str(ticker)
            ticker_code = ticker_str.split(".")[0].upper()

            # 한국 종목: canonical ticker로 정규화 (035420, 035420.TW 등 → 035420.KS)
            if ticker_code in kr_ticker_map:
                canonical = kr_ticker_map[ticker_code]
            elif ticker_str.endswith(".KS") or ticker_str.endswith(".KQ"):
                canonical = ticker_str  # suffix는 맞지만 DB에 없는 종목
            else:
                continue  # 한국 종목 아니면 스킵

            ticker_counts[canonical] += 1
            if news.sector:
                ticker_news_sectors.setdefault(canonical, []).append(news.sector)

    if not ticker_counts:
        return

    portfolio_sectors = await get_portfolio_sectors()

    top_tickers = [t for t, _ in ticker_counts.most_common(30)]

    # DB에서 이름 일괄 조회: 직접 조회 + 코드 기반 fallback
    async with AsyncSessionLocal() as session:
        master_result = await session.execute(
            select(StockMaster).where(StockMaster.ticker.in_(top_tickers))
        )
        rows = master_result.scalars().all()
        master_map: dict[str, StockMaster] = {r.ticker: r for r in rows}
        # 코드 기반 보조 맵 (suffix 없는 경우 대비)
        code_map: dict[str, StockMaster] = {r.ticker.split(".")[0].upper(): r for r in rows}

    # 가격 조회: 한국 주식은 Naver API, 미국은 yfinance history (rate limit 낮음)
    from services.stock_service import _fetch_price_detail_sync
    loop = asyncio.get_running_loop()
    price_results = await asyncio.gather(
        *[loop.run_in_executor(None, _fetch_price_detail_sync, t) for t in top_tickers],
        return_exceptions=True,
    )

    async with AsyncSessionLocal() as session:
        await session.execute(delete(Recommendation))
        await session.commit()

    recommendations = []
    for ticker, price_info in zip(top_tickers, price_results):
        master = master_map.get(ticker) or code_map.get(ticker.split(".")[0].upper())
        name = (master.name if master else None) or ticker

        # 이름을 해석할 수 없는 티커 (StockMaster에 없는 경우) 스킵
        if name == ticker:
            logger.debug(f"Skipping recommendation for unknown ticker: {ticker}")
            continue

        # 섹터: StockMaster industry → 이름 추론 → 뉴스 섹터 → 기타
        sector = None
        if master and master.industry:
            sector = _industry_to_sector(master.industry)
        if not sector:
            sector = _infer_sector_from_name(name)
        if not sector:
            sectors_from_news = ticker_news_sectors.get(ticker, [])
            if sectors_from_news:
                sector = Counter(sectors_from_news).most_common(1)[0][0]
        if not sector:
            sector = "기타"

        price = None
        change_pct = None
        if isinstance(price_info, dict) and price_info:
            price = price_info.get("price")
            change_pct = price_info.get("day_change_pct")

        sector_weight = portfolio_sectors.get(sector, 0.0)

        if sector_weight == 0:
            strength = "strong"
        elif sector_weight < 10:
            strength = "normal"
        else:
            strength = "watch"

        recommendations.append({
            "ticker": ticker,
            "name": name,
            "sector": sector,
            "sector_weight": sector_weight,
            "news_count": ticker_counts[ticker],
            "latest_price": price,
            "change_pct": change_pct,
            "strength": strength,
        })

    async with AsyncSessionLocal() as session:
        for rec in recommendations:
            r = Recommendation(**rec)
            session.add(r)
        await session.commit()

    logger.info(f"Recalculated {len(recommendations)} recommendations")
