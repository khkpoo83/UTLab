"""Structured logging with correlation-id propagation.

- correlation_id lives in a contextvar so it survives across await points
  within a single request/job and is picked up by every log record.
- Two output formats, selected by the LOG_FORMAT env var:
    console (default) — human-readable, includes [cid] — friendly for
                        `docker-compose logs` grepping.
    json              — one JSON object per line — friendly for aggregators.
- Configured via dictConfig with disable_existing_loggers=False so app,
  service and scheduler loggers keep emitting (see the alembic fileConfig
  trap noted in the migration work).
"""

from __future__ import annotations

import json
import logging
import logging.config
import os
import uuid
from contextvars import ContextVar

# "-" means "no correlation id in scope" (e.g. startup, before any request).
_correlation_id: ContextVar[str] = ContextVar("correlation_id", default="-")


def new_correlation_id(prefix: str = "") -> str:
    """Generate, set and return a fresh correlation id for the current context."""
    cid = uuid.uuid4().hex[:12]
    if prefix:
        cid = f"{prefix}:{cid}"
    _correlation_id.set(cid)
    return cid


def set_correlation_id(cid: str) -> None:
    _correlation_id.set(cid or "-")


def get_correlation_id() -> str:
    return _correlation_id.get()


class _CorrelationIdFilter(logging.Filter):
    """Inject the current correlation id onto every record as `cid`."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.cid = _correlation_id.get()
        return True


class _JsonFormatter(logging.Formatter):
    """Render each record as a single-line JSON object."""

    # Attributes that are part of the standard LogRecord and therefore not
    # treated as caller-supplied `extra` fields.
    _RESERVED = frozenset(
        logging.LogRecord("", 0, "", 0, "", (), None).__dict__.keys()
    ) | {"cid", "message", "asctime", "taskName"}

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "cid": getattr(record, "cid", "-"),
            "msg": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        # Surface any structured extras passed via logger.info(..., extra={...}).
        for key, value in record.__dict__.items():
            if key not in self._RESERVED and not key.startswith("_"):
                payload[key] = value
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging() -> None:
    """Install handlers/formatters for the whole process. Idempotent."""
    log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    log_format = os.getenv("LOG_FORMAT", "console").lower()

    if log_format == "json":
        formatter: dict = {"()": _JsonFormatter}
    else:
        formatter = {
            "format": "%(asctime)s %(levelname)s %(name)s [%(cid)s]: %(message)s",
        }

    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "filters": {
                "correlation_id": {"()": _CorrelationIdFilter},
            },
            "formatters": {
                "default": formatter,
            },
            "handlers": {
                "console": {
                    "class": "logging.StreamHandler",
                    "formatter": "default",
                    "filters": ["correlation_id"],
                },
            },
            "root": {
                "level": log_level,
                "handlers": ["console"],
            },
            # uvicorn ships its own handlers; route them through ours so
            # correlation ids and format stay consistent (no double lines).
            "loggers": {
                "uvicorn": {"handlers": ["console"], "level": log_level, "propagate": False},
                "uvicorn.error": {"handlers": ["console"], "level": log_level, "propagate": False},
                "uvicorn.access": {"handlers": ["console"], "level": "WARNING", "propagate": False},
            },
        }
    )
