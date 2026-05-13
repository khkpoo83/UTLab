"""Korean stock market time utilities."""

from datetime import datetime
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")

_MARKET_OPEN_HOUR = 9
_MARKET_OPEN_MINUTE = 0
_MARKET_CLOSE_HOUR = 15
_MARKET_CLOSE_MINUTE = 30


def get_kst_now() -> datetime:
    """Return current datetime in KST (Asia/Seoul)."""
    return datetime.now(KST)


def is_trading_day() -> bool:
    """Return True if today is a weekday (Mon-Fri) in KST."""
    now = get_kst_now()
    return now.weekday() < 5  # 0=Mon ... 4=Fri


def is_market_open() -> bool:
    """Return True if the Korean stock market is currently open.

    Regular trading hours: weekdays 09:00-15:30 KST.
    """
    now = get_kst_now()
    if now.weekday() >= 5:
        return False
    open_minutes = _MARKET_OPEN_HOUR * 60 + _MARKET_OPEN_MINUTE
    close_minutes = _MARKET_CLOSE_HOUR * 60 + _MARKET_CLOSE_MINUTE
    current_minutes = now.hour * 60 + now.minute
    return open_minutes <= current_minutes < close_minutes
