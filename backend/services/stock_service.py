import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any, Optional
from functools import partial

import yfinance as yf
from sqlalchemy import select, delete, and_
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import StockPrice, AsyncSessionLocal
from utils.cache import SimpleCache
from utils.korean_market import is_market_open

logger = logging.getLogger(__name__)

# In-memory price cache: short TTL during market hours, longer off-hours
_price_cache = SimpleCache()

KOREAN_STOCKS = [  # 레거시 폴백 (DB 없을 때)
    # KOSPI 대형주
    {"ticker": "005930.KS", "name": "삼성전자", "exchange": "KOSPI"},
    {"ticker": "000660.KS", "name": "SK하이닉스", "exchange": "KOSPI"},
    {"ticker": "373220.KS", "name": "LG에너지솔루션", "exchange": "KOSPI"},
    {"ticker": "035420.KS", "name": "NAVER", "exchange": "KOSPI"},
    {"ticker": "005380.KS", "name": "현대차", "exchange": "KOSPI"},
    {"ticker": "051910.KS", "name": "LG화학", "exchange": "KOSPI"},
    {"ticker": "006400.KS", "name": "삼성SDI", "exchange": "KOSPI"},
    {"ticker": "068270.KS", "name": "셀트리온", "exchange": "KOSPI"},
    {"ticker": "035720.KS", "name": "카카오", "exchange": "KOSPI"},
    {"ticker": "000270.KS", "name": "기아", "exchange": "KOSPI"},
    {"ticker": "105560.KS", "name": "KB금융", "exchange": "KOSPI"},
    {"ticker": "055550.KS", "name": "신한지주", "exchange": "KOSPI"},
    {"ticker": "096770.KS", "name": "SK이노베이션", "exchange": "KOSPI"},
    {"ticker": "003550.KS", "name": "LG", "exchange": "KOSPI"},
    {"ticker": "066570.KS", "name": "LG전자", "exchange": "KOSPI"},
    {"ticker": "003490.KS", "name": "대한항공", "exchange": "KOSPI"},
    {"ticker": "017670.KS", "name": "SK텔레콤", "exchange": "KOSPI"},
    {"ticker": "030200.KS", "name": "KT", "exchange": "KOSPI"},
    {"ticker": "086790.KS", "name": "하나금융지주", "exchange": "KOSPI"},
    {"ticker": "032830.KS", "name": "삼성생명", "exchange": "KOSPI"},
    {"ticker": "018260.KS", "name": "삼성에스디에스", "exchange": "KOSPI"},
    {"ticker": "011200.KS", "name": "HMM", "exchange": "KOSPI"},
    {"ticker": "009150.KS", "name": "삼성전기", "exchange": "KOSPI"},
    {"ticker": "028260.KS", "name": "삼성물산", "exchange": "KOSPI"},
    {"ticker": "034730.KS", "name": "SK", "exchange": "KOSPI"},
    {"ticker": "012330.KS", "name": "현대모비스", "exchange": "KOSPI"},
    {"ticker": "033780.KS", "name": "KT&G", "exchange": "KOSPI"},
    {"ticker": "010950.KS", "name": "S-Oil", "exchange": "KOSPI"},
    {"ticker": "207940.KS", "name": "삼성바이오로직스", "exchange": "KOSPI"},
    {"ticker": "036570.KS", "name": "엔씨소프트", "exchange": "KOSPI"},
    {"ticker": "251270.KS", "name": "넷마블", "exchange": "KOSPI"},
    {"ticker": "090430.KS", "name": "아모레퍼시픽", "exchange": "KOSPI"},
    {"ticker": "000100.KS", "name": "유한양행", "exchange": "KOSPI"},
    {"ticker": "010130.KS", "name": "고려아연", "exchange": "KOSPI"},
    {"ticker": "047050.KS", "name": "포스코인터내셔널", "exchange": "KOSPI"},
    {"ticker": "005490.KS", "name": "POSCO홀딩스", "exchange": "KOSPI"},
    {"ticker": "024110.KS", "name": "기업은행", "exchange": "KOSPI"},
    {"ticker": "078930.KS", "name": "GS", "exchange": "KOSPI"},
    {"ticker": "000810.KS", "name": "삼성화재", "exchange": "KOSPI"},
    {"ticker": "001570.KS", "name": "금양", "exchange": "KOSPI"},
    {"ticker": "352820.KS", "name": "하이브", "exchange": "KOSPI"},
    {"ticker": "259960.KS", "name": "크래프톤", "exchange": "KOSPI"},
    {"ticker": "316140.KS", "name": "우리금융지주", "exchange": "KOSPI"},
    {"ticker": "139480.KS", "name": "이마트", "exchange": "KOSPI"},
    {"ticker": "009830.KS", "name": "한화솔루션", "exchange": "KOSPI"},
    {"ticker": "010140.KS", "name": "삼성중공업", "exchange": "KOSPI"},
    {"ticker": "042660.KS", "name": "한화오션", "exchange": "KOSPI"},
    {"ticker": "329180.KS", "name": "HD현대중공업", "exchange": "KOSPI"},
    {"ticker": "267250.KS", "name": "HD현대", "exchange": "KOSPI"},
    {"ticker": "009540.KS", "name": "HD한국조선해양", "exchange": "KOSPI"},
    {"ticker": "000720.KS", "name": "현대건설", "exchange": "KOSPI"},
    {"ticker": "011170.KS", "name": "롯데케미칼", "exchange": "KOSPI"},
    {"ticker": "004020.KS", "name": "현대제철", "exchange": "KOSPI"},
    {"ticker": "161390.KS", "name": "한국타이어앤테크놀로지", "exchange": "KOSPI"},
    {"ticker": "000080.KS", "name": "하이트진로", "exchange": "KOSPI"},
    {"ticker": "021240.KS", "name": "코웨이", "exchange": "KOSPI"},
    {"ticker": "403900.KS", "name": "하나투어", "exchange": "KOSPI"},
    # KOSDAQ
    {"ticker": "247540.KQ", "name": "에코프로비엠", "exchange": "KOSDAQ"},
    {"ticker": "086520.KQ", "name": "에코프로", "exchange": "KOSDAQ"},
    {"ticker": "196170.KQ", "name": "알테오젠", "exchange": "KOSDAQ"},
    {"ticker": "263750.KQ", "name": "펄어비스", "exchange": "KOSDAQ"},
    {"ticker": "112040.KQ", "name": "위메이드", "exchange": "KOSDAQ"},
    {"ticker": "041510.KQ", "name": "에스엠", "exchange": "KOSDAQ"},
    {"ticker": "035900.KQ", "name": "JYP Ent.", "exchange": "KOSDAQ"},
    {"ticker": "122870.KQ", "name": "와이지엔터테인먼트", "exchange": "KOSDAQ"},
    {"ticker": "293490.KQ", "name": "카카오게임즈", "exchange": "KOSDAQ"},
    {"ticker": "145020.KQ", "name": "휴젤", "exchange": "KOSDAQ"},
    {"ticker": "091990.KQ", "name": "셀트리온헬스케어", "exchange": "KOSDAQ"},
    {"ticker": "028300.KQ", "name": "HLB", "exchange": "KOSDAQ"},
    {"ticker": "950130.KQ", "name": "엑스플러스", "exchange": "KOSDAQ"},
    {"ticker": "214150.KQ", "name": "클래시스", "exchange": "KOSDAQ"},
    {"ticker": "039030.KQ", "name": "이오테크닉스", "exchange": "KOSDAQ"},
    {"ticker": "036830.KQ", "name": "솔브레인홀딩스", "exchange": "KOSDAQ"},
    {"ticker": "054040.KQ", "name": "한국컴퓨터", "exchange": "KOSDAQ"},
    {"ticker": "240810.KQ", "name": "원익IPS", "exchange": "KOSDAQ"},
    # 카카오뱅크, 카카오페이
    {"ticker": "323410.KS", "name": "카카오뱅크", "exchange": "KOSPI"},
    {"ticker": "377300.KS", "name": "카카오페이", "exchange": "KOSPI"},
    # 미국 주요 ETF/종목
    {"ticker": "AAPL", "name": "Apple", "exchange": "NASDAQ"},
    {"ticker": "MSFT", "name": "Microsoft", "exchange": "NASDAQ"},
    {"ticker": "NVDA", "name": "NVIDIA", "exchange": "NASDAQ"},
    {"ticker": "GOOGL", "name": "Alphabet", "exchange": "NASDAQ"},
    {"ticker": "AMZN", "name": "Amazon", "exchange": "NASDAQ"},
    {"ticker": "META", "name": "Meta", "exchange": "NASDAQ"},
    {"ticker": "TSLA", "name": "Tesla", "exchange": "NASDAQ"},
]


async def search_stocks(query: str) -> list[dict[str, str]]:
    """DB 기반 종목 검색. DB가 비어있으면 레거시 정적 목록으로 폴백."""
    from services.stock_list_service import search_stocks_db, get_stock_count
    count = await get_stock_count()
    if count > 0:
        return await search_stocks_db(query)

    # DB 미초기화 시 레거시 정적 목록 검색
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _legacy_search_sync, query)


def _legacy_search_sync(query: str) -> list[dict[str, str]]:
    """레거시: 정적 목록 검색 (DB 초기화 전 폴백용)"""
    q = query.lower().strip()
    results = []
    seen: set[str] = set()
    for stock in KOREAN_STOCKS:
        if q in stock["name"].lower() or q in stock["ticker"].lower():
            if stock["ticker"] not in seen:
                seen.add(stock["ticker"])
                results.append(stock)
        if len(results) >= 20:
            break
    return results


def _fetch_price_detail_sync(ticker: str) -> Optional[dict]:
    """현재가 + 당일 등락금액/등락률 한번에 반환.
    한국주식: KIS 잔고 캐시 있으면 즉시 반환 (day_change는 /portfolio 배치에서 처리)
    미국주식: yfinance
    반환: {"price": float, "day_change": float|None, "day_change_pct": float|None} or None
    """
    is_kr = ticker.endswith(".KS") or ticker.endswith(".KQ")

    if is_kr:
        code = ticker.split(".")[0]
        try:
            from services.kis_service import get_kis_service
            cached = get_kis_service().get_cached_price(code)
            if cached:
                # KIS 캐시에 현재가 있으면 yfinance 완전 스킵 — day_change는 배치에서
                return {"price": cached["price"], "day_change": None, "day_change_pct": None}
        except RuntimeError:
            pass  # KIS 미설정
        except Exception as e:
            logger.debug(f"KIS cache lookup failed for {ticker}: {e}")
        # KIS 캐시 없으면 yfinance 폴백
        try:
            t = yf.Ticker(ticker)
            hist = t.history(period="2d")
            if len(hist) >= 2:
                prev_close = float(hist["Close"].iloc[-2])
                current = float(hist["Close"].iloc[-1])
                change = current - prev_close
                change_pct = round(change / prev_close * 100, 2) if prev_close else 0.0
                return {"price": current, "day_change": round(change, 2), "day_change_pct": change_pct}
        except Exception as e:
            logger.debug(f"fetch_price_detail kr yfinance failed for {ticker}: {e}")
        return None

    # 미국 주식: yfinance
    try:
        t = yf.Ticker(ticker)
        info = t.info
        price = info.get("currentPrice") or info.get("regularMarketPrice")
        if price:
            change = float(info.get("regularMarketChange") or 0)
            change_pct = float(info.get("regularMarketChangePercent") or 0)
            return {"price": float(price), "day_change": round(change, 4), "day_change_pct": round(change_pct, 2)}
        hist = t.history(period="2d")
        if len(hist) >= 2:
            curr = float(hist["Close"].iloc[-1])
            prev_p = float(hist["Close"].iloc[-2])
            ch = curr - prev_p
            return {"price": curr, "day_change": round(ch, 4), "day_change_pct": round(ch / prev_p * 100, 2) if prev_p else 0.0}
    except Exception as e:
        logger.warning(f"fetch_price_detail yfinance failed for {ticker}: {e}")
    return None


async def fetch_price_detail(ticker: str) -> Optional[dict]:
    """price, day_change, day_change_pct 비동기 조회 (캐시 적용)"""
    cache_key = f"price_detail:{ticker}"
    cached = await _price_cache.get(cache_key)
    if cached is not None:
        return cached

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, _fetch_price_detail_sync, ticker)

    if result:
        ttl = 60.0 if is_market_open() else 300.0
        await _price_cache.set(cache_key, result, ttl_seconds=ttl)

    return result


async def fetch_current_price(ticker: str) -> Optional[float]:
    """기존 호환성 유지 — fetch_price_detail에서 price만 추출"""
    detail = await fetch_price_detail(ticker)
    return detail["price"] if detail else None


def _fetch_ohlcv_sync(ticker: str, period: str) -> list[dict[str, Any]]:
    is_kr = ticker.endswith(".KS") or ticker.endswith(".KQ")

    period_map = {
        "1d": ("1d", "2m"),
        "1w": ("5d", "15m"),
        "1m": ("1mo", "1d"),
        "3m": ("3mo", "1d"),
        "1y": ("1y", "1d"),
    }
    yf_period, interval = period_map.get(period, ("3mo", "1d"))
    try:
        t = yf.Ticker(ticker)
        hist = t.history(period=yf_period, interval=interval)
        if hist.empty:
            return []
        results = []
        for dt, row in hist.iterrows():
            if hasattr(dt, "to_pydatetime"):
                ts = int(dt.to_pydatetime().timestamp())
            else:
                ts = int(dt.timestamp())
            results.append({
                "time": ts,
                "open": float(row["Open"]) if row["Open"] == row["Open"] else None,
                "high": float(row["High"]) if row["High"] == row["High"] else None,
                "low": float(row["Low"]) if row["Low"] == row["Low"] else None,
                "close": float(row["Close"]) if row["Close"] == row["Close"] else None,
                "volume": float(row["Volume"]) if row["Volume"] == row["Volume"] else None,
            })
        return results
    except Exception as e:
        logger.warning(f"fetch_ohlcv failed for {ticker}: {e}")
        return []


async def fetch_ohlcv(ticker: str, period: str) -> list[dict[str, Any]]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _fetch_ohlcv_sync, ticker, period)


async def save_ohlcv(ticker: str, data: list[dict[str, Any]]) -> None:
    if not data:
        return
    cutoff_date = datetime.utcnow() - timedelta(days=90)

    async with AsyncSessionLocal() as session:
        for item in data:
            try:
                dt = datetime.fromtimestamp(item["time"])
                existing = await session.execute(
                    select(StockPrice).where(
                        and_(StockPrice.ticker == ticker, StockPrice.date == dt)
                    )
                )
                existing_row = existing.scalar_one_or_none()
                if existing_row:
                    existing_row.open = item.get("open")
                    existing_row.high = item.get("high")
                    existing_row.low = item.get("low")
                    existing_row.close = item.get("close")
                    existing_row.volume = item.get("volume")
                else:
                    sp = StockPrice(
                        ticker=ticker,
                        date=dt,
                        open=item.get("open"),
                        high=item.get("high"),
                        low=item.get("low"),
                        close=item.get("close"),
                        volume=item.get("volume"),
                        is_summary=False,
                    )
                    session.add(sp)
            except Exception as e:
                logger.warning(f"save_ohlcv item error: {e}")
        await session.commit()

    await compress_old_data(ticker, cutoff_date)


async def compress_old_data(ticker: str, cutoff_date: datetime) -> None:
    async with AsyncSessionLocal() as session:
        old_rows_result = await session.execute(
            select(StockPrice).where(
                and_(
                    StockPrice.ticker == ticker,
                    StockPrice.date < cutoff_date,
                    StockPrice.is_summary == False,
                )
            ).order_by(StockPrice.date)
        )
        old_rows = old_rows_result.scalars().all()

        if not old_rows:
            return

        monthly: dict[str, list[StockPrice]] = {}
        for row in old_rows:
            key = row.date.strftime("%Y-%m")
            monthly.setdefault(key, []).append(row)

        for month_key, rows in monthly.items():
            closes = [r.close for r in rows if r.close is not None]
            opens = [r.open for r in rows if r.open is not None]
            highs = [r.high for r in rows if r.high is not None]
            lows = [r.low for r in rows if r.low is not None]
            volumes = [r.volume for r in rows if r.volume is not None]

            existing_summary = await session.execute(
                select(StockPrice).where(
                    and_(
                        StockPrice.ticker == ticker,
                        StockPrice.date == rows[0].date.replace(day=1),
                        StockPrice.is_summary == True,
                    )
                )
            )
            existing_s = existing_summary.scalar_one_or_none()

            summary_date = rows[0].date.replace(day=1)
            if existing_s:
                existing_s.open = opens[0] if opens else None
                existing_s.high = max(highs) if highs else None
                existing_s.low = min(lows) if lows else None
                existing_s.close = closes[-1] if closes else None
                existing_s.volume = sum(volumes) / len(volumes) if volumes else None
            else:
                summary = StockPrice(
                    ticker=ticker,
                    date=summary_date,
                    open=opens[0] if opens else None,
                    high=max(highs) if highs else None,
                    low=min(lows) if lows else None,
                    close=closes[-1] if closes else None,
                    volume=sum(volumes) / len(volumes) if volumes else None,
                    is_summary=True,
                )
                session.add(summary)

            for row in rows:
                await session.delete(row)

        await session.commit()


def _ts_to_date_str(ts: int) -> str:
    """Unix timestamp → 'YYYY-MM-DD' 변환 (KST 보정: +9h 후 UTC date 추출)"""
    from datetime import timezone
    # 네이버/yfinance는 naive datetime.timestamp() 사용 → KST 기준 ts
    # +9h 보정하면 실제 거래일 날짜를 정확히 얻음
    import datetime as _dt
    utc_adj = _dt.datetime.utcfromtimestamp(ts + 9 * 3600)
    return utc_adj.strftime("%Y-%m-%d")


async def get_chart_data(ticker: str, period: str) -> list[dict[str, Any]]:
    now = datetime.utcnow()
    period_delta = {
        "1d": timedelta(days=1),
        "1w": timedelta(weeks=1),
        "1m": timedelta(days=30),
        "3m": timedelta(days=90),
        "1y": timedelta(days=365),
    }
    since = now - period_delta.get(period, timedelta(days=90))

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(StockPrice)
            .where(
                and_(StockPrice.ticker == ticker, StockPrice.date >= since)
            )
            .order_by(StockPrice.date)
        )
        rows = result.scalars().all()

    if not rows:
        live_data = await fetch_ohlcv(ticker, period)
        if live_data:
            await save_ohlcv(ticker, live_data)
        # Unix timestamp → "YYYY-MM-DD" 변환 후 반환
        return [
            {**d, "time": _ts_to_date_str(d["time"])}
            for d in live_data
        ]

    return [
        {
            "time": row.date.strftime("%Y-%m-%d"),  # DB date → 날짜 문자열 직접 변환
            "open": row.open,
            "high": row.high,
            "low": row.low,
            "close": row.close,
            "volume": row.volume,
        }
        for row in rows
    ]


async def _fetch_sparkline_yahoo(ticker: str) -> list[float]:
    """Yahoo Finance HTTP API로 5일 스파크라인 비동기 조회"""
    import httpx
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=5d"
    headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(url, headers=headers, timeout=6)
            result = r.json().get("chart", {}).get("result", [])
            if not result:
                return []
            closes = result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
            return [float(c) for c in closes if c is not None]
    except Exception:
        return []


async def get_sparkline(ticker: str) -> list[float]:
    """5일 스파크라인 — DB 캐시 우선, 없으면 Yahoo HTTP"""
    since = datetime.utcnow() - timedelta(days=7)
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(StockPrice)
            .where(and_(StockPrice.ticker == ticker, StockPrice.date >= since))
            .order_by(StockPrice.date.desc())
            .limit(5)
        )
        rows = result.scalars().all()
        if rows:
            closes = [r.close for r in reversed(rows) if r.close is not None]
            if closes:
                return closes

    return await _fetch_sparkline_yahoo(ticker)
