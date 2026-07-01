"""추천 결과 인메모리 캐시 (모듈 간 공유)."""

from utils.cache import SimpleCache

# In-memory cache for recommendation results (5 minute TTL)
_recommend_cache = SimpleCache()
_RECOMMEND_CACHE_KEY = "recommendations"
_RECOMMEND_TTL = 300.0  # 5 minutes
