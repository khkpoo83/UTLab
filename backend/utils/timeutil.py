from datetime import datetime, timezone


def utcnow() -> datetime:
    """Naive UTC now — drop-in replacement for the deprecated datetime.utcnow().

    Returns a tz-naive datetime in UTC (identical value to datetime.utcnow()),
    so existing naive-datetime comparisons and SQLite columns keep working.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)
