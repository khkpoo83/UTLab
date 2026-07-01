"""Structured logging + correlation-id middleware."""

import json
import logging

import pytest

from utils.logging_config import (
    _CorrelationIdFilter,
    _JsonFormatter,
    get_correlation_id,
    new_correlation_id,
    set_correlation_id,
)


def test_new_correlation_id_sets_context():
    cid = new_correlation_id()
    assert cid == get_correlation_id()
    assert len(cid) == 12


def test_new_correlation_id_with_prefix():
    cid = new_correlation_id("job")
    assert cid.startswith("job:")
    assert get_correlation_id() == cid


def test_set_correlation_id_blank_falls_back_to_dash():
    set_correlation_id("")
    assert get_correlation_id() == "-"


def _record(msg="hi", **extra):
    rec = logging.LogRecord("t", logging.INFO, __file__, 1, msg, (), None)
    for k, v in extra.items():
        setattr(rec, k, v)
    return rec


def test_json_formatter_core_fields():
    set_correlation_id("abc123")
    rec = _record("hello")
    _CorrelationIdFilter().filter(rec)
    out = json.loads(_JsonFormatter().format(rec))
    assert out["level"] == "INFO"
    assert out["logger"] == "t"
    assert out["msg"] == "hello"
    assert out["cid"] == "abc123"
    assert "ts" in out


def test_json_formatter_surfaces_extra_fields():
    rec = _record("with extra", ticker="005930.KS", latency_ms=42)
    _CorrelationIdFilter().filter(rec)
    out = json.loads(_JsonFormatter().format(rec))
    assert out["ticker"] == "005930.KS"
    assert out["latency_ms"] == 42


def test_correlation_filter_defaults_to_dash():
    set_correlation_id("")
    rec = _record()
    _CorrelationIdFilter().filter(rec)
    assert rec.cid == "-"


@pytest.mark.asyncio
async def test_middleware_stamps_response_header(client):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    assert resp.headers.get("X-Request-ID")


@pytest.mark.asyncio
async def test_middleware_reuses_inbound_request_id(client):
    resp = await client.get("/api/health", headers={"X-Request-ID": "trace-xyz"})
    assert resp.headers.get("X-Request-ID") == "trace-xyz"
