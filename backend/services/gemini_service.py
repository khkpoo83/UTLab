"""Gemini AI 서비스 파사드 (facade).

기존의 god 모듈을 `services.gemini/` 패키지로 분리했지만,
외부 코드(main.py, services/planner_service.py, routers/blog.py 등)의
임포트가 그대로 동작하도록 공개 API를 여기서 재노출한다. 로직은 없다.

배치 처리로 API 호출을 최소화:
- 뉴스 그룹핑: 한 번에 최대 80개 제목 → 1회 호출로 클러스터링
- 뉴스 요약: 최대 10개 → 1회 호출
- 모의투자: 단건 호출
- 무료 티어: 15 RPM, 1,500 RPD 준수
- 사용량 인메모리 추적 (일 단위 자동 리셋)
"""

from services.gemini.client import (
    call_gemini,
    call_gemini_with_image,
)
from services.gemini.news import (
    _GROUP_PROMPT,
    _NEWS_BATCH_PROMPT,
    BATCH_SIZE,
    GROUP_BATCH,
    SECTORS,
    _build_batch_prompt,
    _extract_json_array,
    _parse_batch_response,
    batch_summarize_news,
    group_articles_by_topic,
)
from services.gemini.rate_limit import (
    _LLM_KEY_COOLDOWN,
    _RATE_LIMIT_COOLDOWN,
    GEMINI_MODEL,
    RPD_LIMIT,
    RPM_LIMIT,
    _llm_key,
    _next_key,
    _reset_daily_if_needed,
    _rpm_current,
    _wait_for_rate_limit,
    configure,
    get_usage_stats,
)
from services.gemini.recommendations import (
    _RECOMMEND_R1_PROMPT,
    _RECOMMEND_R2_PROMPT,
    _RECOMMEND_R3_PROMPT,
    generate_ai_recommendations,
)

__all__ = [
    "GEMINI_MODEL",
    "RPM_LIMIT",
    "RPD_LIMIT",
    "BATCH_SIZE",
    "GROUP_BATCH",
    "SECTORS",
    "_RATE_LIMIT_COOLDOWN",
    "_LLM_KEY_COOLDOWN",
    "configure",
    "_next_key",
    "_llm_key",
    "_reset_daily_if_needed",
    "_rpm_current",
    "_wait_for_rate_limit",
    "get_usage_stats",
    "call_gemini",
    "call_gemini_with_image",
    "group_articles_by_topic",
    "batch_summarize_news",
    "_GROUP_PROMPT",
    "_NEWS_BATCH_PROMPT",
    "_build_batch_prompt",
    "_parse_batch_response",
    "_extract_json_array",
    "generate_ai_recommendations",
    "_RECOMMEND_R1_PROMPT",
    "_RECOMMEND_R2_PROMPT",
    "_RECOMMEND_R3_PROMPT",
]
