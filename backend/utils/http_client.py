"""Async HTTP client with retry, exponential backoff and a per-host circuit breaker.

Retry handles transient blips (a single 503, a dropped connection). The
circuit breaker handles a host that is *durably* down: once it trips, calls to
that host fail fast (return None immediately) instead of every caller paying
the full retry budget, and one probe is allowed after a cool-off to recover.
"""

import asyncio
import logging
import time
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT = 30.0
_MAX_RETRIES = 3
_RETRY_STATUSES = {429, 500, 502, 503, 504}

# Circuit breaker tuning.
_CB_FAIL_THRESHOLD = 5      # consecutive failures before opening
_CB_RESET_TIMEOUT = 30.0    # seconds a host stays open before a probe is allowed


class _CircuitBreaker:
    """Per-host breaker: closed -> open (after N fails) -> half-open (probe) -> closed/open."""

    __slots__ = ("host", "fails", "state", "opened_at")

    def __init__(self, host: str):
        self.host = host
        self.fails = 0
        self.state = "closed"       # closed | open | half_open
        self.opened_at = 0.0

    def allow(self) -> bool:
        """Return True if a request may proceed right now."""
        if self.state == "open":
            if time.monotonic() - self.opened_at >= _CB_RESET_TIMEOUT:
                self.state = "half_open"
                logger.info(f"circuit half-open (probing) for {self.host}")
                return True
            return False
        # closed or half_open both allow the (single) request through
        return True

    def record_success(self) -> None:
        if self.state != "closed" or self.fails:
            logger.info(f"circuit closed for {self.host}")
        self.fails = 0
        self.state = "closed"

    def record_failure(self) -> None:
        # A failed probe re-opens immediately.
        if self.state == "half_open":
            self.state = "open"
            self.opened_at = time.monotonic()
            logger.warning(f"circuit re-opened for {self.host} (probe failed)")
            return
        self.fails += 1
        if self.fails >= _CB_FAIL_THRESHOLD and self.state != "open":
            self.state = "open"
            self.opened_at = time.monotonic()
            logger.warning(
                f"circuit opened for {self.host} after {self.fails} consecutive failures"
            )


_breakers: dict[str, _CircuitBreaker] = {}


def _breaker_for(url: str) -> _CircuitBreaker:
    host = httpx.URL(url).host or url
    breaker = _breakers.get(host)
    if breaker is None:
        breaker = _breakers[host] = _CircuitBreaker(host)
    return breaker


async def _request(
    method: str,
    url: str,
    *,
    headers: Optional[dict[str, str]],
    params: Optional[dict[str, Any]],
    json: Optional[Any],
    timeout: float,
    max_retries: int,
) -> Optional[httpx.Response]:
    breaker = _breaker_for(url)
    if not breaker.allow():
        logger.debug(f"circuit open — skipping {method} {url}")
        return None

    result: Optional[httpx.Response] = None
    for attempt in range(max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.request(
                    method, url, headers=headers, params=params, json=json
                )
                if resp.status_code in _RETRY_STATUSES and attempt < max_retries:
                    wait = 2 ** attempt
                    logger.debug(
                        f"HTTP {resp.status_code} for {url} — retrying in {wait}s "
                        f"(attempt {attempt + 1}/{max_retries})"
                    )
                    await asyncio.sleep(wait)
                    continue
                result = resp
                break
        except (httpx.TimeoutException, httpx.ConnectError, httpx.RemoteProtocolError) as e:
            if attempt < max_retries:
                wait = 2 ** attempt
                logger.debug(f"Request error for {url}: {e} — retrying in {wait}s")
                await asyncio.sleep(wait)
            else:
                logger.warning(
                    f"{method} failed after {max_retries + 1} attempts for {url}: {e}"
                )

    # A response we still got but whose code is a transient error counts as a
    # failure for breaker purposes; a clean response (even 4xx) is a success.
    if result is not None and result.status_code not in _RETRY_STATUSES:
        breaker.record_success()
    else:
        breaker.record_failure()
    return result


async def async_get(
    url: str,
    *,
    headers: Optional[dict[str, str]] = None,
    params: Optional[dict[str, Any]] = None,
    timeout: float = _DEFAULT_TIMEOUT,
    max_retries: int = _MAX_RETRIES,
) -> Optional[httpx.Response]:
    """GET with automatic retry + per-host circuit breaker.

    Returns the response on success, None on final failure (or when the host's
    circuit is open).
    """
    return await _request(
        "GET", url, headers=headers, params=params, json=None,
        timeout=timeout, max_retries=max_retries,
    )


async def async_post(
    url: str,
    *,
    json: Optional[Any] = None,
    headers: Optional[dict[str, str]] = None,
    timeout: float = _DEFAULT_TIMEOUT,
    max_retries: int = _MAX_RETRIES,
) -> Optional[httpx.Response]:
    """POST with automatic retry + per-host circuit breaker."""
    return await _request(
        "POST", url, headers=headers, params=None, json=json,
        timeout=timeout, max_retries=max_retries,
    )
