"""Gemini AI 서비스

배치 처리로 API 호출을 최소화:
- 뉴스 그룹핑: 한 번에 최대 80개 제목 → 1회 호출로 클러스터링
- 뉴스 요약: 최대 10개 → 1회 호출
- 모의투자: 단건 호출
- 무료 티어: 15 RPM, 1,500 RPD 준수
- 사용량 인메모리 추적 (일 단위 자동 리셋)
"""

import asyncio
import base64
import json
import logging
import re
import time
import uuid
from collections import deque
from datetime import date
from typing import Optional

import httpx

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
    global _daily_requests, _daily_tokens_in, _daily_tokens_out, _failed_total, _rate_limited_until, _llm_key_exhausted_until

    if api_key is None:
        api_key = _llm_key() if use_llm_key else _next_key()
    if not api_key:
        logger.error("GEMINI_API_KEY not configured")
        return None

    now_ts = time.time()

    # LLM 전용 키 쿨다운 중이면 즉시 None 반환 → planner 에서 Groq 즉시 fallback
    if use_llm_key and now_ts < _llm_key_exhausted_until:
        remaining = _llm_key_exhausted_until - now_ts
        logger.warning(f"Gemini LLM key in cooldown: {remaining:.0f}s remaining, skipping → Groq")
        return None

    # 글로벌 쿨다운 중이면 즉시 None 반환 (연속 429 방어)
    # LLM 전용 키는 별도 키를 사용하므로 글로벌 쿨다운 무시하고 직접 시도
    if not use_llm_key and now_ts < _rate_limited_until:
        remaining = _rate_limited_until - now_ts
        logger.warning(f"Gemini globally rate-limited: {remaining:.0f}s remaining, skipping call")
        return None

    _reset_daily_if_needed()

    if _daily_requests >= RPD_LIMIT * max(1, len(_api_keys)):
        logger.warning(f"Daily limit reached ({RPD_LIMIT * max(1, len(_api_keys))} RPD combined)")
        return None

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent?key={api_key}"
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

    await _wait_for_rate_limit()

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
                        _llm_key_exhausted_until = time.time() + _LLM_KEY_COOLDOWN
                        logger.warning(f"Gemini LLM key 429: cooldown {_LLM_KEY_COOLDOWN}s, returning None immediately → Groq")
                        _failed_total += 1
                        return None
                    # BG 키: 미시도 키로 전환
                    available_keys = _api_keys[:-1] if len(_api_keys) > 1 else _api_keys
                    alt_key = next((k for k in available_keys if k not in tried_keys), None)
                    if alt_key:
                        logger.info(f"Gemini 429 on key ...{api_key[-6:]}: switching to alt key ...{alt_key[-6:]}")
                        api_key = alt_key
                        tried_keys.add(api_key)
                        url = (
                            f"https://generativelanguage.googleapis.com/v1beta/models/"
                            f"{GEMINI_MODEL}:generateContent?key={api_key}"
                        )
                        continue
                    wait = 4 ** (attempt + 1)  # 4, 16, 64, 256초
                    logger.warning(f"Gemini 429 (all keys exhausted): waiting {wait}s (attempt {attempt + 1}/4)")
                    # 새로 들어오는 요청이 이 대기 시간 동안 즉시 실패하도록 임시 쿨다운 설정
                    _rate_limited_until = time.time() + wait
                    await asyncio.sleep(wait)
                    continue

                resp.raise_for_status()
                data = resp.json()

                usage = data.get("usageMetadata", {})
                _request_times.append(time.time())
                _daily_requests += 1
                _daily_tokens_in += usage.get("promptTokenCount", 0)
                _daily_tokens_out += usage.get("candidatesTokenCount", 0)

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

    _failed_total += 1
    if use_llm_key:
        # LLM 키 실패는 글로벌 쿨다운 설정 안 함 (bg 작업 영향 없도록)
        logger.warning("Gemini LLM key all retries failed (no global cooldown set).")
    else:
        # BG 키 실패 → 글로벌 쿨다운 설정 (다른 기능 연쇄 실패 방지)
        _rate_limited_until = time.time() + _RATE_LIMIT_COOLDOWN
        logger.warning(f"Gemini all retries failed. Global cooldown {_RATE_LIMIT_COOLDOWN}s activated.")
    return None


async def call_gemini_with_image(
    prompt: str,
    image_bytes: bytes,
    mime_type: str = "image/jpeg",
    max_tokens: int = 1024,
    use_llm_key: bool = False,
) -> Optional[str]:
    """Gemini Vision API 호출 (이미지 + 텍스트 프롬프트)"""
    api_key = _llm_key() if use_llm_key else _next_key()
    if not api_key:
        logger.error("GEMINI_API_KEY not configured")
        return None

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent?key={api_key}"
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

    await _wait_for_rate_limit()

    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                data = resp.json()
                _request_times.append(time.time())
                _daily_requests += 1
                candidates = data.get("candidates", [])
                if candidates:
                    return candidates[0]["content"]["parts"][0]["text"]
                return None
        except Exception as e:
            logger.warning(f"Gemini vision call failed: {e} (attempt {attempt + 1})")
            if attempt < 2:
                await asyncio.sleep(2 ** attempt)

    return None


# ── 뉴스 AI 그룹핑 ───────────────────────────────────────────────────────────

_GROUP_PROMPT = """\
You are a Korean news clustering assistant.
Group the following Korean financial news articles by topic/event.
Articles covering the same event (even with different prefixes like [속보],[단독],[긴급]) must be in the same group.
Articles only loosely related by theme should be in different groups.

Articles:
{articles_json}

Reply with ONLY a JSON array. Each element must have "id" (integer) and "g" (integer group number).
Every article must appear exactly once. Example: [{{"id":0,"g":1}},{{"id":1,"g":1}},{{"id":2,"g":2}}]"""


def _extract_json_array(text: str) -> Optional[list]:
    """텍스트에서 JSON 배열 추출 (```json 블록 또는 직접 [...])"""
    if not text:
        return None
    # ```json 블록 제거
    cleaned = re.sub(r'```(?:json)?', '', text).strip()
    # 첫 번째 [ ... ] 추출
    start = cleaned.find('[')
    end = cleaned.rfind(']') + 1
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(cleaned[start:end])
    except Exception:
        return None


async def group_articles_by_topic(articles: list[dict]) -> list[dict]:
    """제목 기반 AI 그룹핑. articles에 group_id 필드를 채워 반환.

    articles: [{"title": str, ...}, ...]  (인덱스를 임시 id로 사용)
    returns: 동일 리스트에 "group_id" 키 추가
    """
    if not articles:
        return articles

    all_assigned: dict[int, str] = {}  # index → group_id

    for batch_start in range(0, len(articles), GROUP_BATCH):
        batch = articles[batch_start: batch_start + GROUP_BATCH]
        batch_input = [
            {"id": batch_start + i, "title": a["title"]}
            for i, a in enumerate(batch)
        ]
        prompt = _GROUP_PROMPT.format(
            articles_json=json.dumps(batch_input, ensure_ascii=False, separators=(",", ":"))
        )
        # max_tokens: 기사당 {"id":NN,"g":NN} ≈ 20토큰, 여유 4배
        # disable_thinking=True: 단순 구조화 작업에 thinking 불필요 → 출력 토큰 낭비 방지
        response_text = await call_gemini(
            prompt,
            max_tokens=max(2048, len(batch) * 80),
            force_json_mime=True,
            disable_thinking=True,
        )

        if not response_text:
            for i in range(len(batch)):
                all_assigned[batch_start + i] = str(uuid.uuid4())
            continue

        parsed = _extract_json_array(response_text)

        if parsed is None or not isinstance(parsed, list):
            logger.warning(f"Group parse failed | full response: {response_text[:600]}")
            for i in range(len(batch)):
                all_assigned[batch_start + i] = str(uuid.uuid4())
            continue

        # g 번호(정수) → UUID 매핑
        g_to_uuid: dict[int, str] = {}
        for item in parsed:
            if not isinstance(item, dict):
                continue
            idx = item.get("id")
            g = item.get("g")
            if idx is None or g is None:
                continue
            if g not in g_to_uuid:
                g_to_uuid[g] = str(uuid.uuid4())
            all_assigned[idx] = g_to_uuid[g]

        # 응답에 빠진 기사는 고유 UUID
        for i in range(len(batch)):
            if batch_start + i not in all_assigned:
                all_assigned[batch_start + i] = str(uuid.uuid4())

        logger.info(f"AI grouping: {len(batch)} articles → {len(g_to_uuid)} groups")

    for i, article in enumerate(articles):
        article["group_id"] = all_assigned.get(i, str(uuid.uuid4()))

    return articles


# ── 뉴스 배치 요약 ────────────────────────────────────────────────────────────

_NEWS_BATCH_PROMPT = """\
당신은 한국 주식시장 전문 애널리스트입니다.
아래 뉴스 기사(제목+요약)를 분석하여 JSON 배열로만 응답하세요.

기사 목록:
{articles_json}

응답 형식 (JSON 배열, 다른 텍스트 없이):
[{{"id":1,"summary":"2문장 한국어 요약","sector":"섹터명","stocks":["티커"]}}]

규칙:
- summary: 한국어 자연스러운 2문장.
  첫 문장: 육하원칙(누가/무엇을/얼마나) 위주로 핵심 사실 서술.
  둘째 문장: 국내 주식시장·투자자 관점에서 실질적 의미 또는 주목 이유.
  숫자·% 등 구체적 수치가 있으면 반드시 포함. 추측이나 과장 금지.
- sector: IT/반도체, 금융, 에너지, 바이오/헬스케어, 소비재, 산업재, 통신, 유틸리티, 부동산, 소재 중 정확히 하나. 복합적이면 가장 핵심 섹터.
- stocks: 기사에서 실제 언급된 종목만 (한국: 6자리 숫자코드, 미국: 알파벳 심볼). 불확실하면 []."""


def _build_batch_prompt(batch: list[dict]) -> str:
    batch_input = []
    for a in batch:
        item: dict = {"id": a["id"], "title": a["title"], "source": a.get("source", "")}
        if a.get("description"):
            item["desc"] = a["description"]
        batch_input.append(item)
    return _NEWS_BATCH_PROMPT.format(
        articles_json=json.dumps(batch_input, ensure_ascii=False, separators=(",", ":"))
    )


def _parse_batch_response(batch: list[dict], response_text: Optional[str]) -> list[dict]:
    if not response_text:
        return [{"id": a["id"], "summary": None, "sector": None, "related_stocks": [], "failed": True} for a in batch]
    try:
        parsed = json.loads(response_text)
        if not isinstance(parsed, list):
            raise ValueError("response is not a list")
        parsed_map = {
            item["id"]: item
            for item in parsed
            if isinstance(item, dict) and "id" in item
        }
        result = []
        for a in batch:
            r = parsed_map.get(a["id"])
            if r:
                sector = r.get("sector")
                result.append({
                    "id": a["id"],
                    "summary": r.get("summary"),
                    "sector": sector if sector in SECTORS else None,
                    "related_stocks": r.get("stocks", []) if isinstance(r.get("stocks"), list) else [],
                    "failed": False,
                })
            else:
                result.append({"id": a["id"], "summary": None, "sector": None, "related_stocks": [], "failed": True})
        return result
    except Exception as e:
        logger.warning(f"Batch parse error: {e} | response[:200]: {response_text[:200]}")
        return [{"id": a["id"], "summary": None, "sector": None, "related_stocks": [], "failed": True} for a in batch]


async def batch_summarize_news(articles: list[dict]) -> list[dict]:
    """뉴스 기사를 BATCH_SIZE 단위로 묶어 Gemini 병렬 호출로 요약.

    키가 N개면 N개 배치를 동시에 처리.
    articles: [{"id": int, "title": str, "source": str, "description": str|None}, ...]
    returns:  [{"id": int, "summary": str|None, "sector": str|None,
                "related_stocks": list, "failed": bool}]
    """
    # 배치 분할
    batches = [articles[i: i + BATCH_SIZE] for i in range(0, len(articles), BATCH_SIZE)]
    # BG 키만 사용 (LLM 전용 키 보호: 마지막 키 제외)
    bg_keys = _api_keys[:-1] if len(_api_keys) > 1 else _api_keys
    n_keys = max(1, len(bg_keys))

    # 키 할당: 배치 인덱스 → BG 키만 (LLM 키 오염 방지)
    def _key_for(batch_idx: int) -> Optional[str]:
        if not bg_keys:
            return None
        return bg_keys[batch_idx % len(bg_keys)]

    # 병렬 처리: n_keys 개씩 묶어서 asyncio.gather
    all_results: list[dict] = []
    for chunk_start in range(0, len(batches), n_keys):
        chunk = batches[chunk_start: chunk_start + n_keys]
        tasks = [
            call_gemini(
                _build_batch_prompt(batch),
                max_tokens=8192,
                api_key=_key_for(chunk_start + idx),
            )
            for idx, batch in enumerate(chunk)
        ]
        responses = await asyncio.gather(*tasks)
        for batch, response_text in zip(chunk, responses):
            all_results.extend(_parse_batch_response(batch, response_text))

    logger.info(f"batch_summarize_news: {len(articles)} articles, {len(batches)} batches, {n_keys} parallel keys")
    return all_results


# ── AI 추천 3-Round 검증 ──────────────────────────────────────────────────────

_RECOMMEND_R1_PROMPT = """\
당신은 한국 주식시장 전문 애널리스트입니다. 아래 정보를 종합하여 향후 1~4주 매수 검토 후보를 제시하세요.

## 분석 날짜: {date} ({session})

## 오늘 주요 뉴스 요약 ({news_count}건)
{news_summaries}

## 현재 포트폴리오 섹터 비중
{portfolio_sectors}

## 커뮤니티 반응 (섹터별 대중 심리)
{community_context}

## 정치테마 현황
{political_context}

## 선정 기준 (모두 충족 필요)
1. 뉴스 모멘텀: 긍정적 촉매(실적, 수주, 정책 수혜 등)가 뉴스에서 확인됨
2. 글로벌/지정학 적합성: 현재 국제 정세(무역, 금리, 지정학 리스크 등)와 부합
3. 섹터 다각화: 포트폴리오 저비중 섹터 우선
4. 실체성: 테마주·루머 아닌 실제 실적·수주·정책 근거

중요: 글로벌 매크로 환경(미 금리, 달러 강세/약세, 중국 경기, 지정학 리스크 등)도 반드시 고려하세요.
한국 수출 기업은 환율·교역 조건, 내수 기업은 소비 심리·금리를 분석에 포함하세요.

후보 최대 10종목. 확신 없으면 줄여도 됩니다.

JSON 응답 (다른 텍스트 없이):
{{"candidates": [{{"ticker": "035420.KS", "name": "NAVER", "sector": "IT/반도체", "catalyst": "핵심 상승 근거 1문장 (수치 포함)", "macro_fit": "글로벌 환경 적합성 1문장", "risk": "주요 하방 리스크 1문장"}}]}}"""

_RECOMMEND_R2_PROMPT = """\
당신은 투자 리스크 관리 전문가입니다. 다음 종목들을 기술적 분석 관점에서 검증하세요.

## Round 1 후보 종목
{candidates_json}

## 각 종목의 기술적 분석 데이터
{technical_data}

## 검증 항목
각 후보에 대해 평가하세요:
1. technical_ok: MA 배열(5>20>60), RSI 30~70 적정 구간, 거래량 증가 여부
2. rsi_signal: oversold(<30=매수기회)/neutral(30-70)/overbought(>70=주의)
3. entry_timing: good(지금 진입 적절)/wait(조정 후 진입)/caution(진입 위험)
4. is_structural: 뉴스 모멘텀이 구조적 변화인가(true) vs 일시적 노이즈(false)
5. confidence: high(강한 근거) / medium(보통) / low(불확실)
6. validation_note: 검증 소견 1문장

신뢰도 'low'는 최종 추천에서 제외됩니다.

JSON 응답 (다른 텍스트 없이):
{{"validations": [{{"ticker": "...", "technical_ok": true, "rsi_signal": "neutral", "entry_timing": "good", "is_structural": true, "confidence": "high", "validation_note": "소견"}}]}}"""

_RECOMMEND_R3_PROMPT = """\
당신은 한국 주식 포트폴리오 매니저입니다. 아래 분석을 바탕으로 최종 추천을 확정하세요.

## 후보 + 검증 결과 요약
{combined_json}

## 현재가 정보
{price_data}

## 최종 선별 기준
- confidence=high 종목 우선 선택
- confidence=medium 종목도 포함 가능 (entry_timing=good 또는 is_structural=true 중 하나라도 해당 시)
- confidence=low 종목만 제외
- **반드시 최소 2종목, 최대 5종목 선택** (후보 중 최선의 2~5종목을 항상 출력해야 함)
- 포트폴리오 보유 종목은 추가 매수 명확한 근거 있을 때만 포함

각 종목 필수 제시:
- reason: 추천 이유 2~3문장 (뉴스 근거 + 기술적 근거 + 전망, 구체적 수치 필수)
- entry_price: 현재가 기준 추천 진입가 (원화 정수)
- entry_range_low / entry_range_high: 진입 구간 (현재가 ±3~5% 범위)
- target_price: 1~4주 목표가 (현재가 대비 +8~20% 현실적으로)
- target_return_pct: 목표 수익률 (소수점 1자리)
- stop_loss_price: 손절가 (현재가 대비 -5~10%)
- stop_loss_pct: 손절 % (음수, 소수점 1자리)
- technical_summary: 기술적 분석 한 줄 요약 (MA배열, RSI, 거래량 핵심만)

JSON 응답 (다른 텍스트 없이):
{{"recommendations": [{{"ticker": "005930.KS", "name": "삼성전자", "sector": "IT/반도체", "strength": "strong", "confidence": "high", "reason": "...", "entry_price": 75000, "entry_range_low": 73000, "entry_range_high": 76500, "target_price": 85000, "target_return_pct": 13.3, "stop_loss_price": 70000, "stop_loss_pct": -6.7, "technical_summary": "..."}}]}}"""


async def generate_ai_recommendations(
    news_list: list[dict],
    portfolio_sectors: dict[str, float],
    technical_data: dict[str, dict],
    price_data: dict[str, float],
    session_name: str = "evening",
    community_context: str = "",
    political_context: str = "",
) -> list[dict]:
    """3-Round Gemini 검증으로 최종 추천 종목 반환.

    news_list: [{"title": str, "summary": str, "sector": str, "source": str}, ...]
    portfolio_sectors: {"IT/반도체": 35.2, ...}
    technical_data: {"005930.KS": {분석 결과 dict}, ...}
    price_data: {"005930.KS": 75000.0, ...}
    session_name: "morning" | "evening"
    """
    import json as _json
    from datetime import date as _date

    today = _date.today().strftime("%Y년 %m월 %d일")
    session_label = "아침 분석" if session_name == "morning" else "저녁 분석"

    # 뉴스 요약 구성 (최대 40건, 토큰 절약)
    news_lines = []
    for i, n in enumerate(news_list[:40], 1):
        line = f"[{i}] [{n.get('sector','일반')}] {n.get('title','')}"
        if n.get("summary"):
            line += f" — {n['summary']}"
        news_lines.append(line)
    news_text = "\n".join(news_lines)

    # 포트폴리오 섹터 텍스트
    sector_lines = [f"- {s}: {w:.1f}%" for s, w in sorted(portfolio_sectors.items(), key=lambda x: -x[1])]
    sector_text = "\n".join(sector_lines) if sector_lines else "포트폴리오 없음"

    # ── Round 1: 후보 발굴 ──
    logger.info("AI Recommend Round 1: candidate discovery")
    r1_prompt = _RECOMMEND_R1_PROMPT.format(
        date=today,
        session=session_label,
        news_count=len(news_list[:40]),
        news_summaries=news_text,
        portfolio_sectors=sector_text,
        community_context=community_context or "커뮤니티 데이터 수집 중",
        political_context=political_context or "정치 데이터 없음",
    )
    # disable_thinking=True: gemini-2.5-flash thinking 토큰이 maxOutputTokens 예산 소모
    # → thinking OFF + 토큰 충분히 확보해야 JSON 잘림 방지
    r1_raw = await call_gemini(r1_prompt, max_tokens=4096, force_json_mime=True, disable_thinking=True)
    if not r1_raw:
        logger.warning("AI Recommend Round 1 failed (no response)")
        return []

    try:
        r1_data = _json.loads(r1_raw)
        candidates = r1_data.get("candidates", [])
    except Exception as e:
        logger.warning(f"Round 1 parse error: {e} | raw[:300]: {r1_raw[:300]}")
        return []

    if not candidates:
        logger.info("Round 1: no candidates found")
        return []

    logger.info(f"Round 1: {len(candidates)} candidates: {[c.get('ticker') for c in candidates]}")

    # R1 후보 중 price_data 없는 종목 보충 조회
    r1_tickers = [c.get("ticker", "") for c in candidates if c.get("ticker")]
    missing_price = [t for t in r1_tickers if t not in price_data]
    if missing_price:
        from services.stock_service import fetch_current_price
        extra_prices = await asyncio.gather(
            *[fetch_current_price(t) for t in missing_price],
            return_exceptions=True,
        )
        for t, p in zip(missing_price, extra_prices):
            if isinstance(p, (int, float)) and p:
                price_data[t] = p
        logger.info(f"Round 1: supplemented prices for {[t for t,p in zip(missing_price, extra_prices) if isinstance(p,(int,float)) and p]}")

    # R1 후보 중 technical_data 없는 종목 보충 분석
    missing_tech = [t for t in r1_tickers if t not in technical_data]
    if missing_tech:
        from services.technical_analysis import analyze_ticker
        tech_extras = await asyncio.gather(
            *[analyze_ticker(t) for t in missing_tech],
            return_exceptions=True,
        )
        for t, r in zip(missing_tech, tech_extras):
            technical_data[t] = r if isinstance(r, dict) else {"available": False}
        logger.info(f"Round 1: supplemented technical data for {len(missing_tech)} tickers")

    # ── Round 2: 기술적 분석 검증 ──
    logger.info("AI Recommend Round 2: technical validation")
    tech_lines = []
    for c in candidates:
        t = c.get("ticker", "")
        td = technical_data.get(t, {})
        if not td.get("available"):
            tech_lines.append(f"- {t}: 기술적 데이터 없음 (최근 수집 부족)")
        else:
            tech_lines.append(
                f"- {t} ({c.get('name','')}): 현재가={td.get('current_price')}, "
                f"MA5={td.get('ma5')}/MA20={td.get('ma20')}/MA60={td.get('ma60')}, "
                f"MA정배열={td.get('ma_bullish')}, RSI={td.get('rsi')}, "
                f"거래량추세={td.get('volume_trend')}, "
                f"지지={td.get('support')}/저항={td.get('resistance')}, "
                f"52주포지션={td.get('week52_position_pct')}%"
            )
    tech_text = "\n".join(tech_lines)

    r2_prompt = _RECOMMEND_R2_PROMPT.format(
        candidates_json=_json.dumps(candidates, ensure_ascii=False),
        technical_data=tech_text,
    )
    r2_raw = await call_gemini(r2_prompt, max_tokens=3000, force_json_mime=True, disable_thinking=True)

    validations_map: dict[str, dict] = {}
    if r2_raw:
        try:
            r2_data = _json.loads(r2_raw)
            for v in r2_data.get("validations", []):
                validations_map[v.get("ticker", "")] = v
        except Exception as e:
            logger.warning(f"Round 2 parse error: {e} | raw[:300]: {r2_raw[:300]}")
    logger.info(f"Round 2 validations: {list(validations_map.values())[:3]}")

    # confidence=low 필터
    filtered_candidates = [
        c for c in candidates
        if validations_map.get(c.get("ticker", {}), {}).get("confidence", "medium") != "low"
    ]
    if not filtered_candidates:
        filtered_candidates = candidates  # 전부 low면 그냥 진행

    logger.info(f"Round 2: {len(filtered_candidates)} passed validation")

    # ── Round 3: 최종 선별 + 가격 전략 ──
    logger.info("AI Recommend Round 3: final selection")
    combined = []
    for c in filtered_candidates:
        t = c.get("ticker", "")
        v = validations_map.get(t, {})
        combined.append({**c, **v})

    price_lines = [
        f"- {ticker}: {price:,.0f}원"
        for ticker, price in price_data.items()
        if price
    ]
    price_text = "\n".join(price_lines) if price_lines else "가격 정보 없음"

    r3_prompt = _RECOMMEND_R3_PROMPT.format(
        combined_json=_json.dumps(combined, ensure_ascii=False),
        price_data=price_text,
    )
    r3_raw = await call_gemini(r3_prompt, max_tokens=4096, force_json_mime=True, disable_thinking=True)
    if not r3_raw:
        logger.warning("AI Recommend Round 3 failed (no response)")
        return []

    try:
        r3_data = _json.loads(r3_raw)
        final_recs = r3_data.get("recommendations", [])
    except Exception as e:
        logger.warning(f"Round 3 parse error: {e} | raw[:300]: {r3_raw[:300]}")
        return []

    if not final_recs:
        logger.warning(f"Round 3 returned 0 recs. raw[:500]: {r3_raw[:500]}")
    logger.info(f"AI Recommend complete: {len(final_recs)} final recommendations")
    return final_recs


# ── 사용량 통계 ───────────────────────────────────────────────────────────────

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
