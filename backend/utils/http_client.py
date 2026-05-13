"""Async HTTP client with retry logic and exponential backoff."""

import asyncio
import logging
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT = 30.0
_MAX_RETRIES = 3
_RETRY_STATUSES = {429, 500, 502, 503, 504}


async def async_get(
    url: str,
    *,
    headers: Optional[dict[str, str]] = None,
    params: Optional[dict[str, Any]] = None,
    timeout: float = _DEFAULT_TIMEOUT,
    max_retries: int = _MAX_RETRIES,
) -> Optional[httpx.Response]:
    """GET request with automatic retry on transient errors.

    Retries up to max_retries times with exponential backoff (1s, 2s, 4s).
    Returns the response on success, None on final failure.
    """
    for attempt in range(max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(url, headers=headers, params=params)
                if resp.status_code in _RETRY_STATUSES and attempt < max_retries:
                    wait = 2 ** attempt
                    logger.debug(
                        f"HTTP {resp.status_code} for {url} — retrying in {wait}s "
                        f"(attempt {attempt + 1}/{max_retries})"
                    )
                    await asyncio.sleep(wait)
                    continue
                return resp
        except (httpx.TimeoutException, httpx.ConnectError, httpx.RemoteProtocolError) as e:
            if attempt < max_retries:
                wait = 2 ** attempt
                logger.debug(f"Request error for {url}: {e} — retrying in {wait}s")
                await asyncio.sleep(wait)
            else:
                logger.warning(f"async_get failed after {max_retries + 1} attempts for {url}: {e}")
    return None


async def async_post(
    url: str,
    *,
    json: Optional[Any] = None,
    headers: Optional[dict[str, str]] = None,
    timeout: float = _DEFAULT_TIMEOUT,
    max_retries: int = _MAX_RETRIES,
) -> Optional[httpx.Response]:
    """POST request with automatic retry on transient errors."""
    for attempt in range(max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(url, json=json, headers=headers)
                if resp.status_code in _RETRY_STATUSES and attempt < max_retries:
                    wait = 2 ** attempt
                    logger.debug(
                        f"HTTP {resp.status_code} for {url} — retrying in {wait}s "
                        f"(attempt {attempt + 1}/{max_retries})"
                    )
                    await asyncio.sleep(wait)
                    continue
                return resp
        except (httpx.TimeoutException, httpx.ConnectError, httpx.RemoteProtocolError) as e:
            if attempt < max_retries:
                wait = 2 ** attempt
                logger.debug(f"Request error for {url}: {e} — retrying in {wait}s")
                await asyncio.sleep(wait)
            else:
                logger.warning(f"async_post failed after {max_retries + 1} attempts for {url}: {e}")
    return None
