"""Gemini API 호출 클라이언트 (텍스트 / 비전).

사용량 카운터·쿨다운 등 공유 가변 상태는 `rate_limit` 모듈에 단일 인스턴스로
존재하며, 여기서는 모듈 속성(`_rl.<name>`)으로 읽고 쓴다.
"""

import asyncio
import base64
import logging
import time
from typing import Optional

import httpx

from services.gemini import rate_limit as _rl

logger = logging.getLogger(__name__)


async def call_gemini(
    prompt: str,
    max_tokens: int = 1024,
    force_json_mime: bool = True,
    api_key: Optional[str] = None,
    disable_thinking: bool = False,
    use_llm_key: bool = False,
    system_prompt: Optional[str] = None,
    temperature: float = 0.1,
) -> Optional[str]:
    """Gemini API 단일 호출 (지수 백오프 재시도 포함)

    api_key: 특정 키 지정 시 해당 키 사용, None이면 라운드-로빈
    use_llm_key=True: LLM 전용 키(마지막 키) 우선 사용 — 플래너 챗 등 사용자 요청용
    force_json_mime=True: responseMimeType=application/json (깔끔한 JSON 보장)
    force_json_mime=False: 일반 텍스트 응답 (JSON 수동 파싱)
    disable_thinking=True: thinkingBudget=0 (구조적 JSON 작업 시 토큰 낭비 방지)
    system_prompt: 시스템 지시문 (Gemini systemInstruction 필드)
    temperature: 생성 온도 (기본 0.1, 결정론적 출력은 0.0)
    """
    if api_key is None:
        api_key = _rl._llm_key() if use_llm_key else _rl._next_key()
    if not api_key:
        logger.error("GEMINI_API_KEY not configured")
        return None

    now_ts = time.time()

    # LLM 전용 키 쿨다운 중이면 즉시 None 반환 → planner 에서 Groq 즉시 fallback
    if use_llm_key and now_ts < _rl._llm_key_exhausted_until:
        remaining = _rl._llm_key_exhausted_until - now_ts
        logger.warning(f"Gemini LLM key in cooldown: {remaining:.0f}s remaining, skipping → Groq")
        return None

    # 글로벌 쿨다운 중이면 즉시 None 반환 (연속 429 방어)
    # LLM 전용 키는 별도 키를 사용하므로 글로벌 쿨다운 무시하고 직접 시도
    if not use_llm_key and now_ts < _rl._rate_limited_until:
        remaining = _rl._rate_limited_until - now_ts
        logger.warning(f"Gemini globally rate-limited: {remaining:.0f}s remaining, skipping call")
        return None

    _rl._reset_daily_if_needed()

    if _rl._daily_requests >= _rl.RPD_LIMIT * max(1, len(_rl._api_keys)):
        logger.warning(f"Daily limit reached ({_rl.RPD_LIMIT * max(1, len(_rl._api_keys))} RPD combined)")
        return None

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{_rl.GEMINI_MODEL}:generateContent?key={api_key}"
    )
    gen_config: dict = {"temperature": temperature, "maxOutputTokens": max_tokens}
    if disable_thinking:
        gen_config["thinkingConfig"] = {"thinkingBudget": 0}
    if force_json_mime:
        gen_config["responseMimeType"] = "application/json"

    payload: dict = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": gen_config,
    }
    if system_prompt:
        payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}

    await _rl._wait_for_rate_limit()

    # 429 시 다른 키로 전환 후 재시도
    tried_keys: set[str] = {api_key}

    for attempt in range(4):
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(url, json=payload)

                if resp.status_code == 429:
                    try:
                        _reason = resp.json().get("error", {}).get("message", resp.text[:200])
                    except Exception:
                        _reason = resp.text[:200]
                    logger.warning(f"Gemini 429 reason: {_reason}")
                    if use_llm_key:
                        # LLM 전용 키 429: 재시도 없이 즉시 None 반환 → planner 에서 Groq 즉시 fallback
                        # 쿨다운 설정: 이후 LLM 요청은 Gemini 스킵
                        _rl._llm_key_exhausted_until = time.time() + _rl._LLM_KEY_COOLDOWN
                        logger.warning(f"Gemini LLM key 429: cooldown {_rl._LLM_KEY_COOLDOWN}s, returning None immediately → Groq")
                        _rl._failed_total += 1
                        return None
                    # BG 키: 미시도 키로 전환
                    available_keys = _rl._api_keys[:-1] if len(_rl._api_keys) > 1 else _rl._api_keys
                    alt_key = next((k for k in available_keys if k not in tried_keys), None)
                    if alt_key:
                        logger.info(f"Gemini 429 on key ...{api_key[-6:]}: switching to alt key ...{alt_key[-6:]}")
                        api_key = alt_key
                        tried_keys.add(api_key)
                        url = (
                            f"https://generativelanguage.googleapis.com/v1beta/models/"
                            f"{_rl.GEMINI_MODEL}:generateContent?key={api_key}"
                        )
                        continue
                    wait = 4 ** (attempt + 1)  # 4, 16, 64, 256초
                    logger.warning(f"Gemini 429 (all keys exhausted): waiting {wait}s (attempt {attempt + 1}/4)")
                    # 새로 들어오는 요청이 이 대기 시간 동안 즉시 실패하도록 임시 쿨다운 설정
                    _rl._rate_limited_until = time.time() + wait
                    await asyncio.sleep(wait)
                    continue

                resp.raise_for_status()
                data = resp.json()

                usage = data.get("usageMetadata", {})
                _rl._request_times.append(time.time())
                _rl._daily_requests += 1
                _rl._daily_tokens_in += usage.get("promptTokenCount", 0)
                _rl._daily_tokens_out += usage.get("candidatesTokenCount", 0)

                candidates = data.get("candidates", [])
                if candidates:
                    return candidates[0]["content"]["parts"][0]["text"]
                return None

        except httpx.HTTPStatusError as e:
            logger.warning(f"Gemini HTTP {e.response.status_code} (attempt {attempt + 1})")
            if attempt < 3:
                await asyncio.sleep(2 ** attempt)
        except Exception as e:
            logger.warning(f"Gemini call failed: {e} (attempt {attempt + 1})")
            if attempt < 3:
                await asyncio.sleep(2 ** attempt)

    _rl._failed_total += 1
    if use_llm_key:
        # LLM 키 실패는 글로벌 쿨다운 설정 안 함 (bg 작업 영향 없도록)
        logger.warning("Gemini LLM key all retries failed (no global cooldown set).")
    else:
        # BG 키 실패 → 글로벌 쿨다운 설정 (다른 기능 연쇄 실패 방지)
        _rl._rate_limited_until = time.time() + _rl._RATE_LIMIT_COOLDOWN
        logger.warning(f"Gemini all retries failed. Global cooldown {_rl._RATE_LIMIT_COOLDOWN}s activated.")
    return None


async def call_gemini_with_image(
    prompt: str,
    image_bytes: bytes,
    mime_type: str = "image/jpeg",
    max_tokens: int = 1024,
    use_llm_key: bool = False,
) -> Optional[str]:
    """Gemini Vision API 호출 (이미지 + 텍스트 프롬프트)"""
    api_key = _rl._llm_key() if use_llm_key else _rl._next_key()
    if not api_key:
        logger.error("GEMINI_API_KEY not configured")
        return None

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{_rl.GEMINI_MODEL}:generateContent?key={api_key}"
    )
    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    payload = {
        "contents": [{
            "parts": [
                {"inlineData": {"mimeType": mime_type, "data": image_b64}},
                {"text": prompt},
            ]
        }],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": max_tokens,
            "responseMimeType": "application/json",
        },
    }

    await _rl._wait_for_rate_limit()

    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                data = resp.json()
                _rl._request_times.append(time.time())
                _rl._daily_requests += 1
                candidates = data.get("candidates", [])
                if candidates:
                    return candidates[0]["content"]["parts"][0]["text"]
                return None
        except Exception as e:
            logger.warning(f"Gemini vision call failed: {e} (attempt {attempt + 1})")
            if attempt < 2:
                await asyncio.sleep(2 ** attempt)

    return None
