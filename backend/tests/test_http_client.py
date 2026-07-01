"""Per-host circuit breaker in utils.http_client."""

import utils.http_client as hc
from utils.http_client import _CB_FAIL_THRESHOLD, _CB_RESET_TIMEOUT, _CircuitBreaker


def test_breaker_opens_after_threshold():
    cb = _CircuitBreaker("example.com")
    for _ in range(_CB_FAIL_THRESHOLD - 1):
        cb.record_failure()
    assert cb.state == "closed"
    assert cb.allow() is True
    cb.record_failure()  # threshold reached
    assert cb.state == "open"
    assert cb.allow() is False


def test_success_resets_failures():
    cb = _CircuitBreaker("example.com")
    cb.record_failure()
    cb.record_failure()
    cb.record_success()
    assert cb.fails == 0
    assert cb.state == "closed"


def test_open_transitions_to_half_open_after_timeout(monkeypatch):
    t = {"now": 1000.0}
    monkeypatch.setattr(hc.time, "monotonic", lambda: t["now"])
    cb = _CircuitBreaker("example.com")
    for _ in range(_CB_FAIL_THRESHOLD):
        cb.record_failure()
    assert cb.state == "open"
    assert cb.allow() is False  # still inside cool-off

    t["now"] += _CB_RESET_TIMEOUT + 0.1
    assert cb.allow() is True   # probe allowed
    assert cb.state == "half_open"


def test_half_open_success_closes():
    cb = _CircuitBreaker("example.com")
    cb.state = "half_open"
    cb.record_success()
    assert cb.state == "closed"
    assert cb.fails == 0


def test_half_open_failure_reopens(monkeypatch):
    monkeypatch.setattr(hc.time, "monotonic", lambda: 5.0)
    cb = _CircuitBreaker("example.com")
    cb.state = "half_open"
    cb.record_failure()
    assert cb.state == "open"
    assert cb.opened_at == 5.0


async def test_request_skips_when_circuit_open(monkeypatch):
    # Force the breaker for this host open; _request must return None without
    # ever constructing an httpx client.
    breaker = hc._breaker_for("http://down.example/x")
    breaker.state = "open"
    breaker.opened_at = 10_000_000.0  # far future so cool-off never elapses
    monkeypatch.setattr(hc.time, "monotonic", lambda: 0.0)

    called = {"hit": False}

    class _Boom:
        def __init__(self, *a, **k):
            called["hit"] = True

    monkeypatch.setattr(hc.httpx, "AsyncClient", _Boom)

    result = await hc.async_get("http://down.example/x")
    assert result is None
    assert called["hit"] is False
