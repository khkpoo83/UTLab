"""HTTP middleware: correlation id + request logging."""

from __future__ import annotations

import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from utils.logging_config import new_correlation_id, set_correlation_id

logger = logging.getLogger("app.request")

_HEADER = "X-Request-ID"


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    """Attach a correlation id to every request and log its completion.

    - Reuses an inbound X-Request-ID header when a proxy/client supplies one,
      otherwise mints a fresh id. Either way it is echoed back on the response
      and stamped onto every log line emitted while handling the request.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        incoming = request.headers.get(_HEADER)
        if incoming:
            set_correlation_id(incoming)
            cid = incoming
        else:
            cid = new_correlation_id()

        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            dur_ms = (time.perf_counter() - start) * 1000
            logger.exception(
                "%s %s -> unhandled error (%.1fms)",
                request.method,
                request.url.path,
                dur_ms,
            )
            raise

        dur_ms = (time.perf_counter() - start) * 1000
        response.headers[_HEADER] = cid
        # Health checks are noisy; keep them at debug.
        level = logging.DEBUG if request.url.path == "/api/health" else logging.INFO
        logger.log(
            level,
            "%s %s -> %d (%.1fms)",
            request.method,
            request.url.path,
            response.status_code,
            dur_ms,
        )
        return response
