import asyncio
import logging
from typing import Any, Optional

import yfinance as yf

from utils.cache import SimpleCache

logger = logging.getLogger(__name__)

# ── 기업 기초정보 (주식평가 핵심 지표) ──────────────────────────────────────────
_fundamentals_cache = SimpleCache()

_FUND_KEYS = (
    "name", "currency", "market_cap", "market_cap_display", "per", "forward_per",
    "pbr", "eps", "bps", "dividend_yield", "roe", "week52_high", "week52_low",
    "sector", "industry", "summary",
)


def _empty_fundamentals() -> dict[str, Any]:
    return {k: None for k in _FUND_KEYS}


def _safe_num(v: Any) -> Optional[float]:
    try:
        if v is None:
            return None
        f = float(v)
        return f if f == f else None  # NaN 제외
    except (ValueError, TypeError):
        return None


def _parse_num_str(v: Any) -> Optional[float]:
    """'25.62배', '12,372원', '0.53%' 등에서 숫자만 추출."""
    if v is None:
        return None
    import re
    m = re.search(r"-?[\d,]+(?:\.\d+)?", str(v))
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def _parse_market_cap(disp: Optional[str]) -> Optional[float]:
    """'1,853조 2,703억' → 숫자(원)."""
    if not disp:
        return None
    import re
    total = 0.0
    found = False
    jo = re.search(r"([\d,]+)\s*조", disp)
    eok = re.search(r"([\d,]+)\s*억", disp)
    if jo:
        total += float(jo.group(1).replace(",", "")) * 1e12
        found = True
    if eok:
        total += float(eok.group(1).replace(",", "")) * 1e8
        found = True
    if not found:
        n = _parse_num_str(disp)
        return n
    return total


_NAVER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Referer": "https://m.stock.naver.com/",
}


async def _fetch_fundamentals_naver(code: str) -> dict[str, Any]:
    """네이버 모바일 stock integration API — 한국 종목 기초정보 (안정적)."""
    import httpx
    url = f"https://m.stock.naver.com/api/stock/{code}/integration"
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(url, headers=_NAVER_HEADERS, timeout=8)
            d = r.json()
    except Exception as e:
        logger.warning(f"naver fundamentals failed for {code}: {e}")
        return {}

    infos = {it.get("code"): it.get("value") for it in (d.get("totalInfos") or [])}
    if not infos:
        return {}

    eps = _parse_num_str(infos.get("eps"))
    bps = _parse_num_str(infos.get("bps"))
    # ROE는 integration에 없음 → EPS/BPS 기반 근사치
    roe = round(eps / bps * 100, 2) if (eps and bps) else None

    industry = None
    ici = d.get("industryCompareInfo") or {}
    if isinstance(ici, dict):
        industry = ici.get("industryName") or ici.get("industryCodeName") or ici.get("name")

    result = _empty_fundamentals()
    result.update({
        "name": d.get("stockName"),
        "currency": "KRW",
        "market_cap": _parse_market_cap(infos.get("marketValue")),
        "market_cap_display": infos.get("marketValue"),
        "per": _parse_num_str(infos.get("per")),
        "forward_per": _parse_num_str(infos.get("cnsPer")),
        "pbr": _parse_num_str(infos.get("pbr")),
        "eps": eps,
        "bps": bps,
        "dividend_yield": _parse_num_str(infos.get("dividendYieldRatio")),
        "roe": roe,
        "week52_high": _parse_num_str(infos.get("highPriceOf52Weeks")),
        "week52_low": _parse_num_str(infos.get("lowPriceOf52Weeks")),
        "sector": industry,
        "summary": (d.get("description") or "")[:500] or None,
    })
    return result


def _fetch_fundamentals_yf_sync(ticker: str) -> dict[str, Any]:
    """해외 종목 폴백 (yfinance .info — Yahoo rate limit 시 빈 값)."""
    try:
        t = yf.Ticker(ticker)
        info = t.info or {}
    except Exception as e:
        logger.warning(f"yf fundamentals failed for {ticker}: {e}")
        info = {}

    dy = _safe_num(info.get("dividendYield"))
    if dy is not None and dy < 1:
        dy = dy * 100
    roe = _safe_num(info.get("returnOnEquity"))
    if roe is not None and abs(roe) < 1:
        roe = roe * 100

    result = _empty_fundamentals()
    result.update({
        "name": info.get("longName") or info.get("shortName"),
        "currency": info.get("currency"),
        "market_cap": _safe_num(info.get("marketCap")),
        "per": _safe_num(info.get("trailingPE")),
        "forward_per": _safe_num(info.get("forwardPE")),
        "pbr": _safe_num(info.get("priceToBook")),
        "eps": _safe_num(info.get("trailingEps")),
        "bps": _safe_num(info.get("bookValue")),
        "dividend_yield": dy,
        "roe": roe,
        "week52_high": _safe_num(info.get("fiftyTwoWeekHigh")),
        "week52_low": _safe_num(info.get("fiftyTwoWeekLow")),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "summary": (info.get("longBusinessSummary") or "")[:500] or None,
    })
    return result


def _has_fund_data(d: dict[str, Any]) -> bool:
    return any(d.get(k) is not None for k in ("market_cap", "per", "pbr", "eps"))


async def fetch_stock_fundamentals(ticker: str) -> dict[str, Any]:
    """기업 기초정보 — 한국 종목은 네이버, 해외는 yfinance. 1일 캐시."""
    cache_key = f"fundamentals:{ticker}"
    cached = await _fundamentals_cache.get(cache_key)
    if cached is not None:
        return cached

    code = ticker.split(".")[0]
    is_kr = ticker.endswith(".KS") or ticker.endswith(".KQ") or (code.isdigit() and len(code) == 6)

    result = _empty_fundamentals()
    if is_kr:
        result = await _fetch_fundamentals_naver(code)
    if not _has_fund_data(result):
        # 한국 종목 네이버 실패 or 해외 종목 → yfinance 폴백
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _fetch_fundamentals_yf_sync, ticker)

    has_data = _has_fund_data(result)
    await _fundamentals_cache.set(cache_key, result, ttl_seconds=86400 if has_data else 600)
    return result
