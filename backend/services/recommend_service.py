"""추천 서비스 파사드 (facade).

기존의 god 모듈을 `services.recommend/` 패키지로 분리했지만,
외부 코드(routers/recommend.py, services/scheduler.py 등)의 임포트가
그대로 동작하도록 공개 API를 여기서 재노출한다. 로직은 없다.
"""

from services.recommend.ai_cycle import (
    _load_cycle_state,
    _save_cycle_state,
    run_ai_r1,
    run_ai_r2,
    run_ai_r3,
    run_ai_recommendation_cycle,
)
from services.recommend.cache import (
    _RECOMMEND_CACHE_KEY,
    _RECOMMEND_TTL,
    _recommend_cache,
)
from services.recommend.portfolio import (
    _get_korean_ticker_map,
    get_portfolio_sectors,
)
from services.recommend.rule_based import (
    _recalculate_rule_based,
    recalculate_recommendations,
)
from services.recommend.sectors import (
    KR_SECTOR_MAP,
    NAVER_INDUSTRY_TO_SECTOR,
    SECTORS,
    _industry_to_sector,
    _infer_sector_from_name,
)
from services.recommend.store import (
    _get_latest_news_title,
    get_recommendations,
)

__all__ = [
    "SECTORS",
    "KR_SECTOR_MAP",
    "NAVER_INDUSTRY_TO_SECTOR",
    "_industry_to_sector",
    "_infer_sector_from_name",
    "get_portfolio_sectors",
    "_get_korean_ticker_map",
    "recalculate_recommendations",
    "_recalculate_rule_based",
    "run_ai_recommendation_cycle",
    "run_ai_r1",
    "run_ai_r2",
    "run_ai_r3",
    "_save_cycle_state",
    "_load_cycle_state",
    "get_recommendations",
    "_get_latest_news_title",
    "_recommend_cache",
    "_RECOMMEND_CACHE_KEY",
    "_RECOMMEND_TTL",
]
