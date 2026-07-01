"""뉴스 AI 그룹핑 + 배치 요약."""

import asyncio
import json
import logging
import re
import uuid
from typing import Optional

from services.gemini import rate_limit as _rl
from services.gemini.client import call_gemini

logger = logging.getLogger(__name__)

BATCH_SIZE = _rl.BATCH_SIZE
GROUP_BATCH = _rl.GROUP_BATCH
SECTORS = _rl.SECTORS


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
    bg_keys = _rl._api_keys[:-1] if len(_rl._api_keys) > 1 else _rl._api_keys
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
