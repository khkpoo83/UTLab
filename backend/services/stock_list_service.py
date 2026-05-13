"""
KRX 전 종목 목록 수집 및 DB 캐싱 서비스.
하루 1회 FinanceDataReader로 KOSPI/KOSDAQ/KONEX/ETF 전 종목을 가져와 stock_master 테이블에 저장.
검색은 항상 DB에서 수행 (yfinance API 호출 없이 빠르게 응답).
"""
import asyncio
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import select, delete, or_, func

from models.database import StockMaster, AsyncSessionLocal

logger = logging.getLogger(__name__)

# 단축 별칭 → 정식 종목명 매핑 (부분 입력 지원)
STOCK_ALIASES: dict[str, str] = {
    "엔솔": "LG에너지솔루션",
    "엘솔": "LG에너지솔루션",
    "엘지에너지": "LG에너지솔루션",
    "하이닉스": "SK하이닉스",
    "삼바": "삼성바이오로직스",
    "삼전": "삼성전자",
    "카뱅": "카카오뱅크",
    "카페": "카카오페이",
    "에코비엠": "에코프로비엠",
    "네이버": "NAVER",
    "현대자동차": "현대차",
    "포스코": "POSCO홀딩스",
    "엔씨": "엔씨소프트",
    "펄": "펄어비스",
    "에이피": "아모레퍼시픽",
    "아모레": "아모레퍼시픽",
    "신한": "신한지주",
    "kb": "KB금융",
    "하나": "하나금융지주",
    "현대차": "현대차",
    "gst": "GST",
}

# 미국 주요 종목 고정 목록 (DB에 항상 유지)
US_STOCKS = [
    {"ticker": "AAPL", "name": "Apple", "exchange": "NASDAQ"},
    {"ticker": "MSFT", "name": "Microsoft", "exchange": "NASDAQ"},
    {"ticker": "NVDA", "name": "NVIDIA", "exchange": "NASDAQ"},
    {"ticker": "GOOGL", "name": "Alphabet", "exchange": "NASDAQ"},
    {"ticker": "GOOG", "name": "Alphabet Class C", "exchange": "NASDAQ"},
    {"ticker": "AMZN", "name": "Amazon", "exchange": "NASDAQ"},
    {"ticker": "META", "name": "Meta", "exchange": "NASDAQ"},
    {"ticker": "TSLA", "name": "Tesla", "exchange": "NASDAQ"},
    {"ticker": "AVGO", "name": "Broadcom", "exchange": "NASDAQ"},
    {"ticker": "AMD", "name": "AMD", "exchange": "NASDAQ"},
    {"ticker": "INTC", "name": "Intel", "exchange": "NASDAQ"},
    {"ticker": "NFLX", "name": "Netflix", "exchange": "NASDAQ"},
    {"ticker": "QCOM", "name": "Qualcomm", "exchange": "NASDAQ"},
    {"ticker": "ASML", "name": "ASML Holding", "exchange": "NASDAQ"},
    {"ticker": "JPM", "name": "JPMorgan Chase", "exchange": "NYSE"},
    {"ticker": "V", "name": "Visa", "exchange": "NYSE"},
    {"ticker": "MA", "name": "Mastercard", "exchange": "NYSE"},
    {"ticker": "BAC", "name": "Bank of America", "exchange": "NYSE"},
    {"ticker": "SPY", "name": "SPDR S&P 500 ETF", "exchange": "NYSE"},
    {"ticker": "QQQ", "name": "Invesco QQQ ETF", "exchange": "NASDAQ"},
]


def _fetch_kr_stocks_kind() -> list[dict]:
    """KIND(한국거래소 기업공시) API로 KOSPI/KOSDAQ/KONEX 전 종목 수집 (동기)"""
    import re
    import requests

    url = "http://kind.krx.co.kr/corpgeneral/corpList.do"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Referer": "http://kind.krx.co.kr/",
    }
    params = {"method": "download", "searchType": "13"}  # 전체 상장법인

    try:
        r = requests.get(url, params=params, headers=headers, timeout=30)
        r.raise_for_status()
        text = r.content.decode("euc-kr", errors="replace")
    except Exception as e:
        logger.error(f"KIND request failed: {e}")
        return []

    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", text, re.DOTALL)
    if not rows:
        logger.warning("KIND: no <tr> rows found in response")
        return []

    stocks: list[dict] = []
    market_map = {
        "코스닥": (".KQ", "KOSDAQ"),
        "코넥스": (".KQ", "KONEX"),
        "유가":   (".KS", "KOSPI"),   # 유가증권 = KOSPI
    }

    for row in rows:
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.DOTALL)
        cells = [re.sub(r"<[^>]+>", "", c).strip() for c in cells]
        if len(cells) < 3:
            continue
        name, market_raw, code = cells[0], cells[1], cells[2]
        if not name or not code:
            continue

        # 시장명 매핑 (접두어 매칭)
        suffix, exchange = None, None
        for key, (sfx, exch) in market_map.items():
            if key in market_raw:
                suffix, exchange = sfx, exch
                break
        if suffix is None:
            continue  # 알 수 없는 시장 스킵

        ticker = f"{code.zfill(6)}{suffix}"
        stocks.append({"ticker": ticker, "name": name, "exchange": exchange, "market": "KR"})

    logger.info(f"KIND fetch done: {len(stocks)} stocks")
    return stocks


def _fetch_etf_fdr() -> list[dict]:
    """FinanceDataReader로 한국 ETF 목록 수집"""
    try:
        import FinanceDataReader as fdr
        df = fdr.StockListing("ETF/KR")
        if df is None or df.empty:
            return []
        code_col = next((c for c in ["Symbol", "Code"] if c in df.columns), None)
        name_col = next((c for c in ["Name"] if c in df.columns), None)
        if not code_col or not name_col:
            return []
        stocks = []
        for _, row in df.iterrows():
            symbol = str(row[code_col]).strip().zfill(6)
            name = str(row[name_col]).strip()
            if symbol and name and name != "nan":
                stocks.append({"ticker": f"{symbol}.KS", "name": name, "exchange": "ETF", "market": "KR"})
        logger.info(f"fdr ETF/KR: {len(stocks)} ETFs")
        return stocks
    except Exception as e:
        logger.warning(f"fdr ETF/KR failed: {e}")
        return []


def _fetch_kr_stocks_sync() -> list[dict]:
    """KRX 전 종목 수집 — KIND API(주식) + fdr ETF"""
    stocks = _fetch_kr_stocks_kind()

    etfs = _fetch_etf_fdr()
    if etfs:
        # ETF는 KIND 목록에 없으므로 종목코드 기준 중복 제거 후 추가
        existing_tickers = {s["ticker"] for s in stocks}
        for etf in etfs:
            if etf["ticker"] not in existing_tickers:
                stocks.append(etf)
                existing_tickers.add(etf["ticker"])

    logger.info(f"Total KR stocks fetched: {len(stocks)}")
    return stocks


async def update_stock_list() -> int:
    """KRX 종목 목록을 갱신하여 DB에 저장. 반환: 총 저장 수"""
    loop = asyncio.get_event_loop()
    kr_stocks = await loop.run_in_executor(None, _fetch_kr_stocks_sync)

    if not kr_stocks:
        logger.warning("No KR stocks fetched. Keeping existing DB data.")
        return 0

    async with AsyncSessionLocal() as session:
        # KR 종목 전체 교체
        await session.execute(delete(StockMaster).where(StockMaster.market == "KR"))

        for s in kr_stocks:
            session.add(StockMaster(
                ticker=s["ticker"],
                name=s["name"],
                exchange=s["exchange"],
                market="KR",
                updated_at=datetime.utcnow(),
            ))

        # US 종목 upsert (없으면 추가, 있으면 유지)
        for s in US_STOCKS:
            existing = await session.execute(
                select(StockMaster).where(StockMaster.ticker == s["ticker"])
            )
            if not existing.scalar_one_or_none():
                session.add(StockMaster(
                    ticker=s["ticker"],
                    name=s["name"],
                    exchange=s["exchange"],
                    market="US",
                    updated_at=datetime.utcnow(),
                ))

        await session.commit()

    total = len(kr_stocks) + len(US_STOCKS)
    logger.info(f"Stock list updated: {len(kr_stocks)} KR + {len(US_STOCKS)} US = {total} total")
    return total


async def update_stock_industries() -> int:
    """업종 정보 업데이트 — 네이버 API 제거로 현재 skip, 기존 DB 데이터 유지"""
    logger.info("update_stock_industries: skipped (naver API removed)")
    return 0


async def get_stock_count() -> int:
    """DB에 저장된 종목 수 반환"""
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(func.count(StockMaster.id)))
        return result.scalar() or 0


async def search_stocks_db(query: str, limit: int = 20) -> list[dict]:
    """DB에서 종목 검색 (종목명 or 티커 부분 매칭)"""
    q = query.strip()
    if not q:
        return []

    q_lower = q.lower()
    # 공백 제거 버전도 검색 (예: "코스닥150" → "코스닥 150" 매칭)
    q_nospace = q_lower.replace(" ", "")

    # 별칭 확장: "엔솔" → "LG에너지솔루션" 도 검색
    search_terms: list[str] = [q_lower]
    if q_nospace != q_lower:
        search_terms.append(q_nospace)
    for alias, real_name in STOCK_ALIASES.items():
        if alias in q_lower or q_lower in alias:
            search_terms.append(real_name.lower())

    async with AsyncSessionLocal() as session:
        seen: set[str] = set()
        results: list[dict] = []

        for term in search_terms:
            ticker_upper = term.upper()
            # 공백 제거 버전: DB 이름의 공백을 제거하여 비교하기 위한 term
            term_nospace = term.replace(" ", "")

            stmt = (
                select(StockMaster)
                .where(
                    or_(
                        StockMaster.name.contains(term),       # 이름 포함 (Korean)
                        func.lower(StockMaster.name).contains(term),  # 대소문자 무시
                        # 공백 제거 비교: "TIGER코스닥150" 검색 시 "TIGER 코스닥 150" 매칭
                        func.replace(func.lower(StockMaster.name), ' ', '').contains(term_nospace),
                        StockMaster.ticker.startswith(ticker_upper),   # 티커 prefix
                        func.lower(StockMaster.ticker).contains(term.replace(".", "")),  # 티커 코드만
                    )
                )
                .order_by(StockMaster.name)
                .limit(limit * 3)
            )
            rows = (await session.execute(stmt)).scalars().all()

            for row in rows:
                if row.ticker not in seen:
                    seen.add(row.ticker)
                    results.append({
                        "ticker": row.ticker,
                        "name": row.name,
                        "exchange": row.exchange,
                    })
                if len(results) >= limit:
                    break

            if len(results) >= limit:
                break

    # DB에 없으면 yfinance로 미국 주식 검색 폴백
    if not results and len(q) >= 2:
        import yfinance as yf
        try:
            t = yf.Ticker(q.upper())
            info = t.info
            if info.get("longName") or info.get("shortName"):
                name = info.get("longName") or info.get("shortName", q)
                exchange = info.get("exchange", "")
                results.append({"ticker": q.upper(), "name": name, "exchange": exchange})
        except Exception:
            pass

    return results[:limit]
