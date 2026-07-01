import logging
import os
from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import Depends, FastAPI
from pydantic_settings import BaseSettings, SettingsConfigDict

from models.database import init_db
from routers.auth import get_current_user
from utils.logging_config import configure_logging

configure_logging()
logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    app_username: str = "admin"
    app_password: str = ""        # 환경변수 필수 — 초기 사용자 생성 1회만 사용
    jwt_secret: str = ""          # 환경변수 필수
    jwt_expire_minutes: int = 1440

    gemini_api_key: str = ""
    gemini_api_key2: str = ""
    gemini_api_key3: str = ""
    gemini_model: str = "gemini-2.5-flash"

    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"

    news_fetch_interval_minutes: int = 30
    stock_fetch_interval_minutes: int = 15
    index_fetch_interval_minutes: int = 15

    raw_data_retention_days: int = 90
    news_retention_days: int = 30

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting U.T Lab4 backend...")

    await init_db()
    logger.info("Database initialized")

    if not settings.jwt_secret:
        raise RuntimeError("JWT_SECRET 환경변수가 설정되지 않았습니다.")

    from routers.auth import configure as configure_auth
    from routers.auth import ensure_initial_user
    configure_auth(
        secret_key=settings.jwt_secret,
        expire_minutes=settings.jwt_expire_minutes,
        username=settings.app_username,
        password=settings.app_password,
    )
    await ensure_initial_user()   # DB에 사용자 없을 때만 1회 생성, 이후 평문 제거

    from services.gemini_service import configure as configure_gemini
    extra_keys = [k for k in [settings.gemini_api_key2, settings.gemini_api_key3] if k]
    configure_gemini(
        api_key=settings.gemini_api_key,
        model=settings.gemini_model,
        extra_keys=extra_keys or None,
    )

    from services.groq_service import configure as configure_groq
    if settings.groq_api_key:
        configure_groq(api_key=settings.groq_api_key, model=settings.groq_model)
        logger.info(f"Groq configured: model={settings.groq_model}")

    from services.ollama_service import start_worker
    start_worker()
    logger.info("AI worker started")

    # KIS API 초기화
    kis_tar_path = os.getenv("KIS_TAR_PATH", "")
    kis_base_url = os.getenv("KIS_BASE_URL", "https://api.kiwoom.com")  # 실서버. 모의투자는 mockapi.kiwoom.com
    kis_account_map = os.getenv("KIS_ACCOUNT_MAP", "")
    kis_product_code = os.getenv("KIS_DEFAULT_PRODUCT_CODE", "01")
    kis_cache_ttl = int(os.getenv("KIS_CACHE_TTL", "45"))
    if kis_tar_path and kis_account_map:
        try:
            from services.kis_service import configure as configure_kis
            configure_kis(kis_tar_path, kis_base_url, kis_account_map, kis_product_code, kis_cache_ttl)
            logger.info("KIS 서비스 초기화 완료")
        except Exception as e:
            logger.warning(f"KIS 서비스 초기화 실패 (무시): {e}")
    else:
        logger.info("KIS_TAR_PATH 또는 KIS_ACCOUNT_MAP 미설정, KIS 서비스 비활성화")

    # DB 저장된 설정을 읽어 스케줄러 파라미터 결정
    _stock_interval = settings.stock_fetch_interval_minutes
    _news_interval = settings.news_fetch_interval_minutes
    try:
        from models.database import AsyncSessionLocal
        from routers.settings import get_all_settings
        async with AsyncSessionLocal() as _s:
            _cfg = await get_all_settings(_s)
        _stock_interval = int(_cfg.get("stock_interval_minutes", _stock_interval))
        _news_interval_hours = int(_cfg.get("news_interval_hours", 1))
        _news_interval = _news_interval_hours * 60
    except Exception as e:
        logger.warning(f"Failed to load DB settings for scheduler: {e}")
        _cfg = {}

    from services.scheduler import reschedule_ai_recommendations, start_scheduler
    start_scheduler(
        stock_interval_minutes=_stock_interval,
        index_interval_minutes=settings.index_fetch_interval_minutes,
        news_interval_minutes=_news_interval,
    )
    logger.info("Scheduler started")

    # DB에 저장된 news_schedule 읽어서 AI 추천 시각 재조정
    try:
        reschedule_ai_recommendations(_cfg.get("news_schedule", {}))
        logger.info("AI recommendation schedule adjusted from DB settings")
    except Exception as e:
        logger.warning(f"AI recommendation reschedule on startup failed: {e}")

    try:
        from services.index_service import fetch_indices
        await fetch_indices()
        logger.info("Initial market indices fetched")
    except Exception as e:
        logger.warning(f"Initial index fetch failed: {e}")

    try:
        from services.ollama_service import enqueue_pending_news
        count = await enqueue_pending_news()
        if count:
            logger.info(f"Re-enqueued {count} pending news items on startup")
    except Exception as e:
        logger.warning(f"Startup news re-enqueue failed: {e}")

    # Google Calendar Push Channel 복구 + 갱신 스케줄러 등록
    try:
        import asyncio as _asyncio

        from services.calendar_service import (
            renew_expiring_channels,
            restore_push_channels_on_startup,
        )

        # Push Channel 복구 (백그라운드)
        _asyncio.create_task(restore_push_channels_on_startup())
        logger.info("Calendar push channel restore scheduled")

        # Push Channel 갱신 — 1시간마다 체크 (만료 2시간 이내 채널 자동 갱신)
        from services.scheduler import scheduler as _scheduler

        _scheduler.add_job(
            renew_expiring_channels,
            "interval",
            hours=1,
            id="calendar_channel_renew",
            replace_existing=True,
        )

        logger.info("Calendar scheduler jobs registered")
    except Exception as e:
        logger.warning(f"Calendar scheduler setup failed (non-critical): {e}")

    # 포트폴리오 스냅샷 백필 (스냅샷 없으면 과거 데이터로 채움)
    try:
        import asyncio as _asyncio

        from sqlalchemy import func as _func
        from sqlalchemy import select as _select

        from models.database import AsyncSessionLocal as _Session
        from models.database import PortfolioSnapshot as _Snap
        async with _Session() as s:
            cnt = await s.execute(_select(_func.count()).select_from(_Snap))
            snap_count = cnt.scalar() or 0
        # 항상 백필 실행 (이미 있는 날짜는 skip, per-account 누락분 채움)
        logger.info(f"Portfolio snapshots: {snap_count} days available. Backfilling gaps...")
        from services.portfolio_snapshot_service import backfill_snapshots
        _asyncio.create_task(backfill_snapshots(days=180))
    except Exception as e:
        logger.warning(f"Portfolio snapshot backfill failed: {e}")

    # 종목 목록 초기화 (DB가 비어있을 때만 수행, 백그라운드로)
    try:
        import asyncio as _asyncio

        from sqlalchemy import func, select

        from models.database import AsyncSessionLocal, StockMaster
        from services.stock_list_service import (
            get_stock_count,
            update_stock_industries,
            update_stock_list,
        )
        existing = await get_stock_count()
        if existing == 0:
            logger.info("Stock master DB empty, fetching KRX stock list in background...")
            _asyncio.create_task(update_stock_list())
        else:
            logger.info(f"Stock master DB has {existing} stocks")
            # 업종 정보가 없으면 백그라운드로 fetch
            async with AsyncSessionLocal() as s:
                has_industry = await s.execute(
                    select(func.count()).select_from(StockMaster).where(StockMaster.industry.isnot(None))
                )
                industry_count = has_industry.scalar() or 0
            if industry_count == 0:
                logger.info("No industry data, fetching in background...")
                _asyncio.create_task(update_stock_industries())
            else:
                logger.info(f"Stock master has industry data for {industry_count} stocks")
    except Exception as e:
        logger.warning(f"Stock list initialization failed: {e}")

    yield

    logger.info("Shutting down U.T Lab4 backend...")
    from services.scheduler import stop_scheduler
    stop_scheduler()
    from services.ollama_service import stop_worker  # noqa: F401 (queue wrapper)
    stop_worker()


app = FastAPI(
    title="U.T Lab4 API",
    version="1.0.0",
    lifespan=lifespan,
)

from utils.middleware import CorrelationIdMiddleware

app.add_middleware(CorrelationIdMiddleware)


from routers import accounts, auth, news, portfolio, recommend, watchlist
from routers import blog as blog_router
from routers import calendar as calendar_router
from routers import diary as diary_router
from routers import investment_marks as marks_router
from routers import kis as kis_router
from routers import memo as memo_router
from routers import photos as photos_router
from routers import planner as planner_router
from routers import profile as profile_router
from routers import settings as settings_router

app.include_router(auth.router, prefix="/api")
app.include_router(portfolio.router, prefix="/api")
app.include_router(accounts.router, prefix="/api")
app.include_router(news.router, prefix="/api")
app.include_router(recommend.router, prefix="/api")
app.include_router(settings_router.router, prefix="/api")
app.include_router(watchlist.router, prefix="/api")
app.include_router(kis_router.router, prefix="/api")
app.include_router(planner_router.router)
app.include_router(profile_router.router, prefix="/api")
app.include_router(calendar_router.router, prefix="/api")
app.include_router(diary_router.router, prefix="/api")
app.include_router(photos_router.router)
app.include_router(blog_router.router)
app.include_router(marks_router.router, prefix="/api")
app.include_router(memo_router.router, prefix="/api")


@app.get("/api/health")
async def health_check() -> dict:
    return {"status": "ok", "service": "U.T Lab4"}


@app.get("/api/indices")
async def get_indices(_: Annotated[Any, Depends(get_current_user)]) -> list[dict]:
    from services.index_service import get_cached_indices
    return await get_cached_indices()


@app.get("/api/indices/{symbol}/history")
async def get_index_history(symbol: str, _: Annotated[Any, Depends(get_current_user)]) -> list[dict]:
    from services.index_service import fetch_index_history
    return await fetch_index_history(symbol)


@app.get("/api/indices/{symbol}/intraday")
async def get_index_intraday(symbol: str, _: Annotated[Any, Depends(get_current_user)]) -> list[dict]:
    from services.index_service import fetch_index_intraday
    return await fetch_index_intraday(symbol)
