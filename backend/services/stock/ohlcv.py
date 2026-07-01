import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any

import yfinance as yf
from sqlalchemy import and_, select

from models.database import AsyncSessionLocal, StockPrice
from utils.timeutil import utcnow

logger = logging.getLogger(__name__)


def _fetch_ohlcv_sync(ticker: str, period: str) -> list[dict[str, Any]]:
    is_kr = ticker.endswith(".KS") or ticker.endswith(".KQ")  # noqa: F841  (pre-existing unused var, preserved verbatim)

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


_OHLCV_HTTP_PARAMS = {
    "1d": ("1d", "2m"),
    "1w": ("5d", "15m"),
    "1m": ("1mo", "1d"),
    "3m": ("3mo", "1d"),
    "1y": ("1y", "1d"),
}


async def _fetch_ohlcv_http(ticker: str, period: str) -> list[dict[str, Any]]:
    """Yahoo Finance chart HTTP API 직접 호출 (yf 라이브러리 차단 시 폴백).

    본화면 스파크라인과 동일한 query1 chart 엔드포인트를 사용해 안정성 확보.
    """
    import httpx
    yf_range, interval = _OHLCV_HTTP_PARAMS.get(period, ("3mo", "1d"))
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
        f"?interval={interval}&range={yf_range}"
    )
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
    }
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(url, headers=headers, timeout=8)
            result = r.json().get("chart", {}).get("result", [])
            if not result:
                return []
            res0 = result[0]
            timestamps: list = res0.get("timestamp", []) or []
            quote = (res0.get("indicators", {}).get("quote", [{}]) or [{}])[0]
            opens = quote.get("open", []) or []
            highs = quote.get("high", []) or []
            lows = quote.get("low", []) or []
            closes = quote.get("close", []) or []
            volumes = quote.get("volume", []) or []
            out: list[dict[str, Any]] = []
            for i, ts in enumerate(timestamps):
                def _at(arr: list, idx: int):
                    v = arr[idx] if idx < len(arr) else None
                    return float(v) if v is not None else None
                c = _at(closes, i)
                if c is None:
                    continue
                out.append({
                    "time": int(ts),
                    "open": _at(opens, i),
                    "high": _at(highs, i),
                    "low": _at(lows, i),
                    "close": c,
                    "volume": _at(volumes, i),
                })
            return out
    except Exception as e:
        logger.warning(f"_fetch_ohlcv_http failed for {ticker}: {e}")
        return []


async def fetch_ohlcv(ticker: str, period: str) -> list[dict[str, Any]]:
    # httpx 직접 호출이 yfinance 라이브러리보다 ~10배 빠르므로 우선 시도,
    # 빈 결과(차단 등)면 yfinance로 폴백.
    data = await _fetch_ohlcv_http(ticker, period)
    if not data:
        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(None, _fetch_ohlcv_sync, ticker, period)
    return data


async def _fetch_ohlcv_http_range(
    ticker: str, period1: int, period2: int, interval: str = "1d"
) -> list[dict[str, Any]]:
    """Yahoo Finance chart HTTP API를 period1~period2(unix초) 구간으로 호출.

    왼쪽 끝 lazy-load(과거 데이터 추가 조회)용. _fetch_ohlcv_http와 동일 파싱.
    """
    import httpx
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
        f"?interval={interval}&period1={period1}&period2={period2}"
    )
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
    }
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(url, headers=headers, timeout=8)
            result = r.json().get("chart", {}).get("result", [])
            if not result:
                return []
            res0 = result[0]
            timestamps: list = res0.get("timestamp", []) or []
            quote = (res0.get("indicators", {}).get("quote", [{}]) or [{}])[0]
            opens = quote.get("open", []) or []
            highs = quote.get("high", []) or []
            lows = quote.get("low", []) or []
            closes = quote.get("close", []) or []
            volumes = quote.get("volume", []) or []
            out: list[dict[str, Any]] = []
            for i, ts in enumerate(timestamps):
                def _at(arr: list, idx: int):
                    v = arr[idx] if idx < len(arr) else None
                    return float(v) if v is not None else None
                c = _at(closes, i)
                if c is None:
                    continue
                out.append({
                    "time": int(ts),
                    "open": _at(opens, i),
                    "high": _at(highs, i),
                    "low": _at(lows, i),
                    "close": c,
                    "volume": _at(volumes, i),
                })
            return out
    except Exception as e:
        logger.warning(f"_fetch_ohlcv_http_range failed for {ticker}: {e}")
        return []


async def save_ohlcv(ticker: str, data: list[dict[str, Any]]) -> None:
    if not data:
        return
    cutoff_date = utcnow() - timedelta(days=90)

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
                    StockPrice.is_summary == False,  # noqa: E712  (SQLAlchemy filter, preserved verbatim)
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
                        StockPrice.is_summary == True,  # noqa: E712  (SQLAlchemy filter, preserved verbatim)
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


# before 청크 조회 시 기간별 (interval, 청크 폭) — 주말/휴장 공백에도 데드락 안 되게 폭을 넉넉히
_BEFORE_PARAMS = {
    "1d": ("2m", 3),
    "1w": ("15m", 10),
    "1m": ("1d", 180),
    "3m": ("1d", 180),
    "1y": ("1d", 365),
}
