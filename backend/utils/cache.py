"""Simple async in-memory cache with TTL support."""

import asyncio
import logging
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)


class SimpleCache:
    """Thread-safe in-memory cache with TTL support using asyncio.Lock."""

    def __init__(self) -> None:
        self._store: dict[str, tuple[Any, float]] = {}  # key -> (value, expire_at)
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Optional[Any]:
        async with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            value, expire_at = entry
            if expire_at and time.monotonic() > expire_at:
                del self._store[key]
                return None
            return value

    async def set(self, key: str, value: Any, ttl_seconds: float = 60.0) -> None:
        async with self._lock:
            expire_at = time.monotonic() + ttl_seconds if ttl_seconds > 0 else 0.0
            self._store[key] = (value, expire_at)

    async def clear(self, key: Optional[str] = None) -> None:
        async with self._lock:
            if key is not None:
                self._store.pop(key, None)
            else:
                self._store.clear()

    async def _evict_expired(self) -> int:
        """Remove all expired entries. Returns number of evicted entries."""
        now = time.monotonic()
        async with self._lock:
            expired_keys = [k for k, (_, exp) in self._store.items() if exp and now > exp]
            for k in expired_keys:
                del self._store[k]
        return len(expired_keys)
