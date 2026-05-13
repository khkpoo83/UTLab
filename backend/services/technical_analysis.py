"""기술적 분석 서비스 - OHLCV 데이터 기반 지표 계산"""
import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select

from models.database import StockPrice, AsyncSessionLocal

logger = logging.getLogger(__name__)


def _fetch_ohlcv_external_sync(ticker: str, days: int) -> list[dict]:
    """DB에 데이터 없을 때 yfinance에서 OHLCV 조회"""
    try:
        import yfinance as yf
        t = yf.Ticker(ticker)
        hist = t.history(period="6mo", interval="1d")
        if hist.empty:
            return []
        return [
            {
                "close": float(row["Close"]),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "volume": float(row["Volume"]) if row["Volume"] == row["Volume"] else None,
            }
            for _, row in hist.iterrows()
            if row["Close"] == row["Close"]
        ]
    except Exception as e:
        logger.warning(f"yfinance OHLCV failed for {ticker}: {e}")
        return []


async def get_ohlcv(ticker: str, days: int = 120) -> list[dict]:
    """StockPrice DB에서 OHLCV 데이터 조회, 없으면 네이버/yfinance 폴백"""
    cutoff = datetime.utcnow() - timedelta(days=days)
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(StockPrice)
            .where(
                StockPrice.ticker == ticker,
                StockPrice.date >= cutoff,
                StockPrice.is_summary == False,  # 일봉 (monthly summary는 False)
            )
            .order_by(StockPrice.date.asc())
        )
        rows = result.scalars().all()

    db_data = [
        {
            "date": r.date.strftime("%Y-%m-%d"),
            "open": r.open,
            "high": r.high,
            "low": r.low,
            "close": r.close,
            "volume": r.volume,
        }
        for r in rows
        if r.close is not None
    ]
    if db_data:
        return db_data

    # DB에 데이터 없으면 외부 API 폴백
    import asyncio
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _fetch_ohlcv_external_sync, ticker, days)


def _sma(values: list[float], period: int) -> Optional[float]:
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def _rsi(closes: list[float], period: int = 14) -> Optional[float]:
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i - 1]
        gains.append(max(diff, 0))
        losses.append(max(-diff, 0))
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


def _macd(closes: list[float]) -> dict:
    """MACD(12,26,9) 계산. 데이터 부족 시 None 반환"""
    def ema(data: list[float], period: int) -> list[float]:
        if not data:
            return []
        k = 2 / (period + 1)
        result = [data[0]]
        for v in data[1:]:
            result.append(v * k + result[-1] * (1 - k))
        return result

    if len(closes) < 35:
        return {"macd": None, "signal": None, "histogram": None}

    ema12 = ema(closes, 12)
    ema26 = ema(closes, 26)
    macd_line = [a - b for a, b in zip(ema12[25:], ema26[25:])]
    signal_line = ema(macd_line, 9)
    hist = macd_line[-1] - signal_line[-1] if signal_line else None
    return {
        "macd": round(macd_line[-1], 2) if macd_line else None,
        "signal": round(signal_line[-1], 2) if signal_line else None,
        "histogram": round(hist, 2) if hist is not None else None,
    }


def _volume_trend(volumes: list[float], period: int = 5) -> str:
    """최근 거래량 추세: increasing/decreasing/neutral"""
    if len(volumes) < period * 2:
        return "neutral"
    recent = sum(volumes[-period:]) / period
    prev = sum(volumes[-period * 2: -period]) / period
    if prev == 0:
        return "neutral"
    ratio = recent / prev
    if ratio > 1.2:
        return "increasing"
    if ratio < 0.8:
        return "decreasing"
    return "neutral"


def _support_resistance(highs: list[float], lows: list[float], closes: list[float]) -> dict:
    """최근 20일 기준 지지/저항 추정"""
    if len(closes) < 20:
        return {"support": None, "resistance": None}
    recent_lows = sorted(lows[-20:])
    recent_highs = sorted(highs[-20:], reverse=True)
    support = sum(recent_lows[:5]) / 5
    resistance = sum(recent_highs[:5]) / 5
    return {"support": round(support, 0), "resistance": round(resistance, 0)}


async def analyze_ticker(ticker: str) -> dict:
    """단일 종목 기술적 분석 - Gemini 프롬프트용 구조화된 요약 반환"""
    data = await get_ohlcv(ticker, days=120)

    if not data:
        return {"ticker": ticker, "available": False, "reason": "no_data"}

    closes = [d["close"] for d in data]
    highs = [d["high"] for d in data if d["high"]]
    lows = [d["low"] for d in data if d["low"]]
    volumes = [d["volume"] for d in data if d["volume"]]

    current = closes[-1]
    ma5 = _sma(closes, 5)
    ma20 = _sma(closes, 20)
    ma60 = _sma(closes, 60)
    rsi = _rsi(closes)
    macd_data = _macd(closes)
    vol_trend = _volume_trend(volumes)
    sr = _support_resistance(highs, lows, closes)

    # MA 배열 판단
    ma_bullish = None
    if ma5 and ma20 and ma60:
        ma_bullish = ma5 > ma20 > ma60

    # 52주 고점 대비 위치
    week52_high = max(closes[-252:]) if len(closes) >= 252 else max(closes)
    week52_low = min(closes[-252:]) if len(closes) >= 252 else min(closes)
    position_pct = round((current - week52_low) / (week52_high - week52_low) * 100, 1) if week52_high != week52_low else 50

    return {
        "ticker": ticker,
        "available": True,
        "current_price": current,
        "ma5": round(ma5, 0) if ma5 else None,
        "ma20": round(ma20, 0) if ma20 else None,
        "ma60": round(ma60, 0) if ma60 else None,
        "ma_bullish": ma_bullish,
        "rsi": rsi,
        "macd": macd_data,
        "volume_trend": vol_trend,
        "support": sr["support"],
        "resistance": sr["resistance"],
        "week52_high": round(week52_high, 0),
        "week52_low": round(week52_low, 0),
        "week52_position_pct": position_pct,
        "data_days": len(data),
    }
