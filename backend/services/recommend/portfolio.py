"""포트폴리오 섹터 비중 계산 + 한국 종목 티커 맵."""

from sqlalchemy import select

from models.database import AsyncSessionLocal, Portfolio, StockMaster
from services.recommend.sectors import _industry_to_sector, _infer_sector_from_name


async def get_portfolio_sectors() -> dict[str, float]:
    """포트폴리오 섹터 비중 계산 (yfinance 미사용, avg_price 기반)"""
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Portfolio))
        holdings = result.scalars().all()

        if not holdings:
            return {}

        # StockMaster에서 industry 일괄 조회
        tickers = [h.ticker for h in holdings]
        sm_result = await session.execute(
            select(StockMaster).where(StockMaster.ticker.in_(tickers))
        )
        sm_map: dict[str, StockMaster] = {r.ticker: r for r in sm_result.scalars().all()}

        total_value = 0.0
        sector_values: dict[str, float] = {}
        to_update: list[tuple[Portfolio, str]] = []

        for holding in holdings:
            value = holding.avg_price * holding.quantity
            total_value += value

            # 섹터 결정 우선순위: DB 저장값 → StockMaster industry → 이름 추론 → 기본값
            sector = holding.sector
            if not sector:
                sm = sm_map.get(holding.ticker)
                if sm and sm.industry:
                    sector = _industry_to_sector(sm.industry)
            if not sector:
                sector = _infer_sector_from_name(holding.name or "")
            if not sector:
                sector = "기타"

            # 섹터 추론값을 DB에 저장 (sector 미설정 종목만)
            if not holding.sector and sector != "기타":
                to_update.append((holding, sector))

            sector_values[sector] = sector_values.get(sector, 0.0) + value

        # 추론된 섹터 일괄 저장
        if to_update:
            for holding, sector in to_update:
                holding.sector = sector
            await session.commit()

        if total_value == 0:
            return {}

        return {sector: (value / total_value) * 100 for sector, value in sector_values.items()}


async def _get_korean_ticker_map() -> dict[str, str]:
    """StockMaster KR 종목: code → canonical_ticker (예: "035420" → "035420.KS")"""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(StockMaster).where(StockMaster.market == "KR")
        )
        rows = result.scalars().all()
    return {r.ticker.split(".")[0].upper(): r.ticker for r in rows}
