from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import and_, select

from models.database import AsyncSessionLocal, StockPrice
from services.stock.ohlcv import (
    _BEFORE_PARAMS,
    _fetch_ohlcv_http_range,
    fetch_ohlcv,
    save_ohlcv,
)
from utils.cache import SimpleCache
from utils.korean_market import is_market_open

# 분봉 차트 라이브 결과 캐시 (드로어 재오픈/기간 토글 시 재조회 방지)
_intraday_cache = SimpleCache()


def _ts_to_date_str(ts: int) -> str:
    """Unix timestamp → 'YYYY-MM-DD' 변환 (KST 보정: +9h 후 UTC date 추출)"""
    # 네이버/yfinance는 naive datetime.timestamp() 사용 → KST 기준 ts
    # +9h 보정하면 실제 거래일 날짜를 정확히 얻음
    import datetime as _dt
    from datetime import timezone  # noqa: F401  (pre-existing unused import, preserved verbatim)
    utc_adj = _dt.datetime.utcfromtimestamp(ts + 9 * 3600)
    return utc_adj.strftime("%Y-%m-%d")


# 분봉(2m/15m) 기간 — 일봉 캐시(StockPrice)와 분리해서 다룬다
_INTRADAY_PERIODS = {"1d", "1w"}


def _aggregate_daily(series: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """같은 날짜('YYYY-MM-DD')에 봉이 여러 개면 하루 1봉으로 합쳐 고유 시간축을 보장한다.

    lightweight-charts의 setData()는 '오름차순 + 고유' time을 요구한다. 과거 분봉이
    StockPrice에 섞여 들어가 날짜가 중복되면 차트 렌더가 실패하므로
    시가=첫값 / 고가=max / 저가=min / 종가=마지막값 / 거래량=합 으로 집계한다.
    """
    by_date: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for d in series:
        t = d["time"]
        cur = by_date.get(t)
        if cur is None:
            by_date[t] = {
                "time": t,
                "open": d.get("open"),
                "high": d.get("high"),
                "low": d.get("low"),
                "close": d.get("close"),
                "volume": d.get("volume") or 0,
            }
            order.append(t)
            continue
        if cur["open"] is None:
            cur["open"] = d.get("open")
        h, l = d.get("high"), d.get("low")  # noqa: E741  (pre-existing ambiguous name, preserved verbatim)
        if h is not None:
            cur["high"] = h if cur["high"] is None else max(cur["high"], h)
        if l is not None:
            cur["low"] = l if cur["low"] is None else min(cur["low"], l)
        if d.get("close") is not None:
            cur["close"] = d["close"]
        cur["volume"] = (cur["volume"] or 0) + (d.get("volume") or 0)
    order.sort()
    return [by_date[t] for t in order]


def _intraday_series(live: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """분봉(1d/1w): unix 타임스탬프를 시간축으로 유지(날짜 문자열로 뭉개지 않음).

    같은 ts 중복은 마지막 값으로 dedupe 후 오름차순 정렬 → 고유·오름차순 보장.
    """
    by_ts: dict[int, dict[str, Any]] = {}
    for d in live:
        ts = int(d["time"])
        by_ts[ts] = {
            "time": ts,
            "open": d.get("open"),
            "high": d.get("high"),
            "low": d.get("low"),
            "close": d.get("close"),
            "volume": d.get("volume"),
        }
    return [by_ts[ts] for ts in sorted(by_ts)]


async def get_chart_data(ticker: str, period: str) -> list[dict[str, Any]]:
    # 분봉(1d/1w)은 DB 캐시를 읽지도 쓰지도 않는다 — 분봉을 StockPrice에 저장하면
    # 일봉 조회 시 날짜가 중복돼 차트가 깨진다. 라이브 + unix 시간축, 짧은 메모리 캐시.
    if period in _INTRADAY_PERIODS:
        cache_key = f"intraday:{ticker}:{period}"
        cached = await _intraday_cache.get(cache_key)
        if cached is not None:
            return cached
        series = _intraday_series(await fetch_ohlcv(ticker, period))
        if series:
            await _intraday_cache.set(
                cache_key, series, ttl_seconds=60.0 if is_market_open() else 600.0
            )
        return series

    now = datetime.utcnow()
    period_delta = {
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
        # Unix timestamp → "YYYY-MM-DD" 변환 후 날짜별 집계
        return _aggregate_daily(
            [{**d, "time": _ts_to_date_str(d["time"])} for d in live_data]
        )

    return _aggregate_daily([
        {
            "time": row.date.strftime("%Y-%m-%d"),  # DB date → 날짜 문자열 직접 변환
            "open": row.open,
            "high": row.high,
            "low": row.low,
            "close": row.close,
            "volume": row.volume,
        }
        for row in rows
    ])


async def get_chart_data_before(
    ticker: str, before: int, period: str = "3m"
) -> list[dict[str, Any]]:
    """before(unix초) 이전의 봉 청크 조회 — 차트 왼쪽 끝 lazy-load용.

    DB에 저장하지 않고 Yahoo HTTP를 직접 호출(과거 일봉은 compress 대상이라 DB 오염 방지).
    일봉 기간은 'YYYY-MM-DD' 문자열, 분봉(1d/1w)은 unix초 시간축으로 get_chart_data와 동일.
    """
    interval, days = _BEFORE_PARAMS.get(period, ("1d", 180))
    period1 = before - days * 86400
    raw = await _fetch_ohlcv_http_range(ticker, period1, before, interval)
    # before 시각 이전 막대만, 시간 오름차순 유지
    out = [d for d in raw if d["time"] < before]
    out.sort(key=lambda d: d["time"])
    if interval == "1d":
        return _aggregate_daily([{**d, "time": _ts_to_date_str(d["time"])} for d in out])
    return _intraday_series(out)
