import asyncio
import logging
from datetime import timedelta
from typing import Optional

import yfinance as yf
from sqlalchemy import and_, select

from models.database import AsyncSessionLocal, StockPrice
from utils.cache import SimpleCache
from utils.korean_market import is_market_open
from utils.timeutil import utcnow

logger = logging.getLogger(__name__)

# In-memory price cache: short TTL during market hours, longer off-hours
_price_cache = SimpleCache()


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
    since = utcnow() - timedelta(days=7)
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
