import asyncio
import logging
from typing import Optional

import requests
from sqlalchemy import select

from models.database import AsyncSessionLocal, MarketIndex
from utils.timeutil import utcnow

logger = logging.getLogger(__name__)

INDICES = [
    {"symbol": "^KS11", "name": "KOSPI",  "yahoo_symbol": "%5EKS11", "naver_code": "KOSPI"},
    {"symbol": "^KQ11", "name": "KOSDAQ", "yahoo_symbol": "%5EKQ11", "naver_code": "KOSDAQ"},
    {"symbol": "^GSPC", "name": "S&P500", "yahoo_symbol": "%5EGSPC"},
    {"symbol": "^IXIC", "name": "NASDAQ", "yahoo_symbol": "%5EIXIC"},
    {"symbol": "^DJI",  "name": "DOW",    "yahoo_symbol": "%5EDJI"},
    {"symbol": "^SOX",  "name": "SOX",    "yahoo_symbol": "%5ESOX"},
]

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
}

_NAVER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://finance.naver.com",
    "Accept": "application/json",
}


def _fetch_naver_index_sync(naver_code: str) -> Optional[dict]:
    """Naver Finance 모바일 API로 국내 지수 조회 (KOSPI/KOSDAQ)"""
    try:
        url = f"https://m.stock.naver.com/api/index/{naver_code}/price"
        r = requests.get(url, headers=_NAVER_HEADERS, timeout=10)
        r.raise_for_status()
        data = r.json()
        if not data:
            return None
        today = data[0]
        price = float(today["closePrice"].replace(",", ""))
        change = float(today["compareToPreviousClosePrice"].replace(",", ""))
        change_pct = round(float(today["fluctuationsRatio"]), 2)
        return {"price": price, "change": change, "change_pct": change_pct}
    except Exception as e:
        logger.warning(f"Naver index fetch failed for {naver_code}: {e}")
    return None


def _fetch_yahoo_index_sync(yahoo_symbol: str, display_symbol: str) -> Optional[dict]:
    """Yahoo Finance HTTP API (직접 호출, yfinance 라이브러리 사용 안 함)"""
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_symbol}?interval=1d&range=2d"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
        }
        r = requests.get(url, headers=headers, timeout=15)
        r.raise_for_status()
        data = r.json()
        result = data.get("chart", {}).get("result", [])
        if not result:
            return None
        meta = result[0].get("meta", {})
        closes = result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
        closes = [c for c in closes if c is not None]

        # closes 배열 우선: 마지막=현재, 직전=전일 종가 (가장 신뢰성 높음)
        if len(closes) >= 2:
            price = closes[-1]
            prev = closes[-2]
            change = price - prev
            change_pct = round(change / prev * 100, 2) if prev else 0.0
            return {"price": float(price), "change": float(change), "change_pct": change_pct}

        # closes 1개뿐이면 meta 값으로 전일 종가 산출
        price = meta.get("regularMarketPrice") or (closes[-1] if closes else None)
        prev_close = meta.get("previousClose") or meta.get("chartPreviousClose")
        if price and prev_close:
            change = price - prev_close
            change_pct = round(change / prev_close * 100, 2) if prev_close else 0.0
            return {"price": float(price), "change": float(change), "change_pct": change_pct}
    except Exception as e:
        logger.warning(f"Yahoo HTTP index fetch failed for {yahoo_symbol}: {e}")
    return None


def _fetch_index_sync(idx_info: dict) -> Optional[dict]:
    """단일 지수 현재가 조회 — 국내(KOSPI/KOSDAQ)는 Naver, 해외는 Yahoo"""
    symbol = idx_info["symbol"]

    # 국내 지수: Naver API 우선
    if idx_info.get("naver_code"):
        result = _fetch_naver_index_sync(idx_info["naver_code"])
        if result:
            return {"symbol": symbol, **result}
        # Naver 실패 시 Yahoo fallback
        logger.warning(f"Naver failed for {symbol}, falling back to Yahoo")

    result = _fetch_yahoo_index_sync(idx_info["yahoo_symbol"], symbol)
    if result:
        return {"symbol": symbol, **result}
    return None


async def fetch_indices() -> list[dict]:
    loop = asyncio.get_event_loop()
    tasks = [
        loop.run_in_executor(None, _fetch_index_sync, idx)
        for idx in INDICES
    ]
    raw_results = await asyncio.gather(*tasks, return_exceptions=True)

    results = []
    for idx_info, raw in zip(INDICES, raw_results):
        if isinstance(raw, Exception) or raw is None:
            results.append({
                "symbol": idx_info["symbol"],
                "name": idx_info["name"],
                "price": None,
                "change": None,
                "change_pct": None,
                "updated_at": utcnow().isoformat(),
            })
        else:
            results.append({
                "symbol": raw["symbol"],
                "name": idx_info["name"],
                "price": raw["price"],
                "change": raw["change"],
                "change_pct": raw["change_pct"],
                "updated_at": utcnow().isoformat(),
            })

    async with AsyncSessionLocal() as session:
        for item in results:
            existing = await session.execute(
                select(MarketIndex).where(MarketIndex.symbol == item["symbol"])
            )
            row = existing.scalar_one_or_none()
            if row:
                row.price = item["price"]
                row.change = item["change"]
                row.change_pct = item["change_pct"]
                row.updated_at = utcnow()
            else:
                mi = MarketIndex(
                    symbol=item["symbol"],
                    name=item["name"],
                    price=item["price"],
                    change=item["change"],
                    change_pct=item["change_pct"],
                    updated_at=utcnow(),
                )
                session.add(mi)
        await session.commit()

    return results


async def get_cached_indices() -> list[dict]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(MarketIndex))
        rows = result.scalars().all()

    if not rows:
        return await fetch_indices()

    return [
        {
            "symbol": row.symbol,
            "name": row.name,
            "price": row.price,
            "change": row.change,
            "change_pct": row.change_pct,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
        for row in rows
    ]


def _fetch_yahoo_index_history_sync(yahoo_symbol: str) -> list[dict]:
    """Yahoo Finance HTTP API로 지수 30일 히스토리"""
    try:
        url = (
            f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_symbol}"
            f"?interval=1d&range=1mo"
        )
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
        }
        r = requests.get(url, headers=headers, timeout=15)
        r.raise_for_status()
        data = r.json()
        result = data.get("chart", {}).get("result", [])
        if not result:
            return []
        timestamps = result[0].get("timestamp", [])
        closes = result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
        results = []
        for ts, close in zip(timestamps, closes):
            if close is not None and ts is not None:
                results.append({"time": int(ts), "close": float(close)})
        return results
    except Exception as e:
        logger.warning(f"Yahoo index history failed for {yahoo_symbol}: {e}")
        return []


def _fetch_index_history_sync(symbol: str) -> list[dict]:
    """지수 히스토리"""
    idx_info = next((i for i in INDICES if i["symbol"] == symbol), None)
    if not idx_info:
        return []
    return _fetch_yahoo_index_history_sync(idx_info["yahoo_symbol"])


async def fetch_index_history(symbol: str) -> list[dict]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _fetch_index_history_sync, symbol)


def _fetch_intraday_sync(symbol: str) -> list[dict]:
    """Yahoo Finance 당일 5분봉 인트라데이 데이터"""
    idx_info = next((i for i in INDICES if i["symbol"] == symbol), None)
    if not idx_info:
        return []
    # Use yahoo_symbol if available, else encode the symbol
    yahoo_sym = idx_info.get("yahoo_symbol") or symbol.replace("^", "%5E")
    try:
        url = (
            f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_sym}"
            f"?interval=5m&range=1d"
        )
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
        }
        r = requests.get(url, headers=headers, timeout=15)
        r.raise_for_status()
        data = r.json()
        result = data.get("chart", {}).get("result", [])
        if not result:
            return []
        timestamps = result[0].get("timestamp", [])
        closes = result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
        out = []
        for ts, c in zip(timestamps, closes):
            if c is not None and ts is not None:
                out.append({"time": int(ts), "close": float(c)})
        return out
    except Exception as e:
        logger.warning(f"Intraday fetch failed for {symbol}: {e}")
        return []


async def fetch_index_intraday(symbol: str) -> list[dict]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _fetch_intraday_sync, symbol)
