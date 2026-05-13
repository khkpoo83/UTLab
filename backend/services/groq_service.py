"""Groq API 서비스 (OpenAI 호환)

플래너 챗봇 + 뉴스 요약 전용 — 빠른 응답 + 높은 무료 쿼터
- llama-3.3-70b-versatile: 1000 RPD (플래너 챗, 뉴스 요약 메인)
- llama-3.1-8b-instant: 14400 RPD (뉴스 요약 폴백, 빠른 처리)
"""

import asyncio
import json
import logging
import re
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.3-70b-versatile"
GROQ_FALLBACK_MODEL = "llama-3.1-8b-instant"  # 70b 429 시 빠른 폴백

SECTORS = [
    "IT/반도체", "금융", "에너지", "바이오/헬스케어",
    "소비재", "산업재", "통신", "유틸리티", "부동산", "소재",
]

_NEWS_SYSTEM_PROMPT = "당신은 한국 주식시장 전문 애널리스트입니다. 반드시 JSON만 응답하세요."

_NEWS_BATCH_PROMPT = """\
아래 뉴스 기사(제목+요약)를 분석하여 JSON 객체로만 응답하세요.

기사 목록:
{articles_json}

응답 형식 (JSON 객체, 다른 텍스트 없이):
{{"items":[{{"id":1,"summary":"2문장 한국어 요약","sector":"섹터명","stocks":["티커"]}}]}}

규칙:
- summary: 한국어 자연스러운 2문장.
  첫 문장: 육하원칙(누가/무엇을/얼마나) 위주로 핵심 사실 서술.
  둘째 문장: 국내 주식시장·투자자 관점에서 실질적 의미 또는 주목 이유.
  숫자·% 등 구체적 수치가 있으면 반드시 포함. 추측이나 과장 금지.
- sector: IT/반도체, 금융, 에너지, 바이오/헬스케어, 소비재, 산업재, 통신, 유틸리티, 부동산, 소재 중 정확히 하나.
- stocks: 기사에서 실제 언급된 종목만 (한국: 6자리 숫자코드, 미국: 알파벳 심볼). 불확실하면 []."""

_api_key: str = ""


def configure(api_key: str, model: str = "llama-3.3-70b-versatile") -> None:
    global _api_key, GROQ_MODEL
    _api_key = api_key
    GROQ_MODEL = model
    logger.info(f"Groq configured: model={GROQ_MODEL}, key={'set' if api_key else 'none'}")


async def _call_groq_model(
    client: httpx.AsyncClient,
    model: str,
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
    json_mode: bool,
) -> Optional[str]:
    """단일 모델 Groq 호출 (최대 2회 재시도)"""
    payload: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.1,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    for attempt in range(2):
        resp = await client.post(
            GROQ_API_URL,
            json=payload,
            headers={"Authorization": f"Bearer {_api_key}"},
        )
        if resp.status_code == 429:
            try:
                reason = resp.json().get("error", {}).get("message", resp.text[:200])
            except Exception:
                reason = resp.text[:200]
            m = re.search(r"try again in ([\d.]+)s", reason)
            wait = float(m.group(1)) + 1 if m else 20.0
            logger.warning(f"Groq 429 [{model}] (attempt {attempt+1}/2): {wait:.1f}s 후 재시도")
            if attempt < 1:
                await asyncio.sleep(wait)
                continue
            return None
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]
    return None


async def call_groq(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 8192,
    json_mode: bool = True,
) -> Optional[str]:
    """Groq API 호출. 70b 모델 429 시 8b 모델로 즉시 폴백."""
    if not _api_key:
        logger.error("GROQ_API_KEY not configured")
        return None

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            result = await _call_groq_model(client, GROQ_MODEL, system_prompt, user_prompt, max_tokens, json_mode)
            if result is not None:
                return result
            # 70b 실패(429/오류) → 8b 모델로 폴백
            logger.warning(f"Groq {GROQ_MODEL} failed → fallback to {GROQ_FALLBACK_MODEL}")
            return await _call_groq_model(client, GROQ_FALLBACK_MODEL, system_prompt, user_prompt, max_tokens, json_mode)
    except httpx.TimeoutException:
        logger.warning("Groq timeout (120s)")
        return None
    except Exception as e:
        logger.warning(f"Groq call failed: {e}")
        return None


def _build_news_batch_prompt(batch: list[dict]) -> tuple[str, list[int]]:
    """프롬프트 생성 + 순번→실제id 매핑 반환.
    Groq은 임의 id를 1,2,3... 순번으로 바꿔 응답하므로 순번 기반으로 처리.
    """
    batch_input = []
    id_map: list[int] = []  # 순번(1-based) → 실제 DB id
    for seq, a in enumerate(batch, start=1):
        item: dict = {"id": seq, "title": a["title"], "source": a.get("source", "")}
        if a.get("description"):
            item["desc"] = a["description"]
        batch_input.append(item)
        id_map.append(a["id"])
    prompt = _NEWS_BATCH_PROMPT.format(
        articles_json=json.dumps(batch_input, ensure_ascii=False, separators=(",", ":"))
    )
    return prompt, id_map


def _parse_news_batch_response(batch: list[dict], response_text: Optional[str], id_map: Optional[list[int]] = None) -> list[dict]:
    if not response_text:
        return [{"id": a["id"], "summary": None, "sector": None, "related_stocks": [], "failed": True} for a in batch]
    try:
        parsed = json.loads(response_text)
        if isinstance(parsed, dict):
            items = parsed.get("items") or parsed.get("articles") or parsed.get("results") or list(parsed.values())[0]
        else:
            items = parsed
        if not isinstance(items, list):
            raise ValueError(f"response items is not a list: {type(items)}")
        # 순번(1-based) 기반 매핑: Groq이 1,2,3... 으로 응답하므로
        seq_map = {int(item["id"]): item for item in items if isinstance(item, dict) and "id" in item}
        result = []
        for seq, a in enumerate(batch, start=1):
            real_id = id_map[seq - 1] if id_map else a["id"]
            r = seq_map.get(seq)
            if r:
                sector = r.get("sector")
                result.append({
                    "id": real_id,
                    "summary": r.get("summary"),
                    "sector": sector if sector in SECTORS else None,
                    "related_stocks": r.get("stocks", []) if isinstance(r.get("stocks"), list) else [],
                    "failed": False,
                })
            else:
                result.append({"id": real_id, "summary": None, "sector": None, "related_stocks": [], "failed": True})
        return result
    except Exception as e:
        logger.warning(f"News batch parse error: {e} | response[:300]: {response_text[:300] if response_text else 'None'}")
        return [{"id": a["id"], "summary": None, "sector": None, "related_stocks": [], "failed": True} for a in batch]


async def batch_summarize_news(articles: list[dict]) -> list[dict]:
    """뉴스 기사를 배치로 묶어 Groq으로 요약 (Gemini 쿼터 절약).

    70b 모델 우선, 429 시 8b 모델 폴백.
    articles: [{"id": int, "title": str, "source": str, "description": str|None}, ...]
    returns:  [{"id": int, "summary": str|None, "sector": str|None,
                "related_stocks": list, "failed": bool}]
    """
    if not _api_key:
        logger.error("GROQ_API_KEY not configured — news summarization skipped")
        return [{"id": a["id"], "summary": None, "sector": None, "related_stocks": [], "failed": True} for a in articles]

    BATCH_SIZE = 20  # Gemini보다 컨텍스트가 넉넉하므로 20개 단위
    batches = [articles[i: i + BATCH_SIZE] for i in range(0, len(articles), BATCH_SIZE)]
    all_results: list[dict] = []

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            for idx, batch in enumerate(batches):
                prompt, id_map = _build_news_batch_prompt(batch)
                # 70b 우선 시도
                response = await _call_groq_model(
                    client, GROQ_MODEL, _NEWS_SYSTEM_PROMPT, prompt, max_tokens=4096, json_mode=True
                )
                if response is None:
                    # 70b 429/실패 → 8b 폴백
                    logger.warning(f"News batch {idx+1}/{len(batches)}: 70b failed → 8b fallback")
                    response = await _call_groq_model(
                        client, GROQ_FALLBACK_MODEL, _NEWS_SYSTEM_PROMPT, prompt, max_tokens=4096, json_mode=True
                    )
                all_results.extend(_parse_news_batch_response(batch, response, id_map))
                # 배치 간 간격 (TPM 분산)
                if idx < len(batches) - 1:
                    await asyncio.sleep(3)
    except Exception as e:
        logger.error(f"Groq batch_summarize_news error: {e}")
        # 처리 안 된 기사들 failed 처리
        processed_ids = {r["id"] for r in all_results}
        for a in articles:
            if a["id"] not in processed_ids:
                all_results.append({"id": a["id"], "summary": None, "sector": None, "related_stocks": [], "failed": True})

    succeeded = sum(1 for r in all_results if not r.get("failed"))
    logger.info(f"Groq batch_summarize_news: {len(articles)} articles, {len(batches)} batches, {succeeded} succeeded")
    return all_results
