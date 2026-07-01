"""Gemini 키 로테이션 + RPM/RPD 사용량 상태.

공유 가변 상태(요청 카운터·키 목록·쿨다운)는 이 모듈에만 존재한다.
다른 gemini 하위 모듈은 이 모듈을 import 하여 동일한 상태 인스턴스를 사용한다.
"""

import logging
import time
from collections import deque
from datetime import date
from typing import Optional

logger = logging.getLogger(__name__)

GEMINI_MODEL = "gemini-2.5-flash"

# 무료 티어 제한 (키 1개 기준) - gemini-2.5-flash free tier 실측 기준
RPM_LIMIT = 10
RPD_LIMIT = 1500
BATCH_SIZE = 10       # 요약 배치 크기
GROUP_BATCH = 80      # 그룹핑 배치 크기 (제목만 전송이므로 크게 가능)

SECTORS = [
    "IT/반도체", "금융", "에너지", "바이오/헬스케어",
    "소비재", "산업재", "통신", "유틸리티", "부동산", "소재",
]

# ── 다중 키 로테이션 ──────────────────────────────────────────────────────────
_api_keys: list[str] = []   # configure()로 설정
_key_index: int = 0         # 라운드-로빈 인덱스 (정규작업용)

# 마지막 키는 LLM(플래너 챗 등 사용자 요청) 전용으로 예약
# 정규 작업(뉴스 요약 등)은 앞쪽 키들만 사용

# ── 사용량 추적 (인메모리) ────────────────────────────────────────────────────
_request_times: deque = deque()
_daily_requests = 0
_daily_tokens_in = 0
_daily_tokens_out = 0
_daily_date: Optional[date] = None
_failed_total = 0
_rate_limited_until: float = 0.0        # 이 시각(epoch)까지 모든 Gemini 호출 차단
_llm_key_exhausted_until: float = 0.0  # LLM 전용 키 429 쿨다운 (플래너 챗 즉시 Groq fallback용)
_RATE_LIMIT_COOLDOWN = 300              # 연속 429 시 5분 쿨다운
_LLM_KEY_COOLDOWN = 3600               # LLM 키 429 시 1시간 쿨다운


def configure(api_key: str, model: str = "gemini-2.5-flash", extra_keys: list[str] | None = None) -> None:
    global GEMINI_MODEL, _api_keys, _key_index
    GEMINI_MODEL = model
    keys = [k for k in ([api_key] + (extra_keys or [])) if k]
    _api_keys = keys
    _key_index = 0
    logger.info(f"Gemini configured: {len(_api_keys)} key(s), model={GEMINI_MODEL}")


def _next_key() -> str:
    """정규 작업용 키 라운드-로빈 (키가 3개 이상이면 마지막 키 제외)"""
    global _key_index
    if not _api_keys:
        return ""
    bg_keys = _api_keys[:-1] if len(_api_keys) > 1 else _api_keys
    key = bg_keys[_key_index % len(bg_keys)]
    _key_index = (_key_index + 1) % len(bg_keys)
    return key


def _llm_key() -> str:
    """LLM(사용자 요청) 전용 키 — 마지막 키 우선, 없으면 라운드-로빈"""
    if not _api_keys:
        return ""
    return _api_keys[-1]


def _reset_daily_if_needed() -> None:
    global _daily_requests, _daily_tokens_in, _daily_tokens_out, _daily_date
    today = date.today()
    if _daily_date != today:
        _daily_requests = 0
        _daily_tokens_in = 0
        _daily_tokens_out = 0
        _daily_date = today


def _rpm_current() -> int:
    now = time.time()
    while _request_times and now - _request_times[0] > 60:
        _request_times.popleft()
    return len(_request_times)


async def _wait_for_rate_limit() -> None:
    """RPM 한도 도달 시 대기 (키 수 × 15 RPM 합산)"""
    import asyncio
    while True:
        now = time.time()
        while _request_times and now - _request_times[0] > 60:
            _request_times.popleft()
        effective_rpm = RPM_LIMIT * max(1, len(_api_keys))
        if len(_request_times) < effective_rpm - 1:
            break
        wait = 60 - (now - _request_times[0]) + 0.5
        logger.info(f"Gemini rate limit: waiting {wait:.1f}s ({len(_api_keys)} keys, {effective_rpm} RPM)")
        await asyncio.sleep(wait)


def get_usage_stats() -> dict:
    _reset_daily_if_needed()
    rpm = _rpm_current()
    now_ts = time.time()
    rate_limited = now_ts < _rate_limited_until
    return {
        "model": GEMINI_MODEL,
        "rpm_used": rpm,
        "rpm_limit": RPM_LIMIT,
        "rpm_remaining": max(0, RPM_LIMIT - rpm),
        "rpd_used": _daily_requests,
        "rpd_limit": RPD_LIMIT,
        "rpd_remaining": max(0, RPD_LIMIT - _daily_requests),
        "tokens_in_today": _daily_tokens_in,
        "tokens_out_today": _daily_tokens_out,
        "failed_total": _failed_total,
        "rate_limited": rate_limited,
        "rate_limit_seconds_remaining": max(0, int(_rate_limited_until - now_ts)),
    }
