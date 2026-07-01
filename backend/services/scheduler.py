import asyncio
import logging
from datetime import datetime, timedelta

import pytz
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import delete, select

from models.database import AsyncSessionLocal, News, Portfolio
from utils.logging_config import new_correlation_id
from utils.timeutil import utcnow

logger = logging.getLogger(__name__)

KST = pytz.timezone("Asia/Seoul")
scheduler = AsyncIOScheduler()


def _is_trading_time(tickers: list[str]) -> bool:
    """
    현재 시각이 보유 종목의 거래 시간 내인지 확인.
    - 한국 주식 (.KS/.KQ): 월~금 08:00~16:00 KST (장전+정규+일부 시간외)
    - 미국 주식: 월~금 23:30~06:00 KST (정규장 기준)
    """
    try:
        now = datetime.now(KST)
        if now.weekday() >= 5:  # 토/일
            return False

        hm = now.hour * 60 + now.minute
        has_kr = any(t.endswith(".KS") or t.endswith(".KQ") for t in tickers)
        has_us = any(not (t.endswith(".KS") or t.endswith(".KQ")) for t in tickers)

        # 한국 시장: 08:00 ~ 16:00 KST (장전 08:00-09:00, 정규 09:00-15:30, 시간외 15:30-16:00)
        if has_kr and 8 * 60 <= hm < 16 * 60:
            return True

        # 미국 정규장: 23:30 ~ 익일 06:00 KST
        if has_us and (hm >= 23 * 60 + 30 or hm < 6 * 60):
            return True

        return False
    except Exception:
        return True  # 오류 시 기본적으로 조회


def _index_in_trading_hours(symbol: str, now_kst) -> bool:
    """지수별 거래 시간 확인"""
    hm = now_kst.hour * 60 + now_kst.minute
    weekday = now_kst.weekday()

    if symbol in ('^KS11', '^KQ11', '^N225'):
        # 한국/일본: KST 08:30~16:00 (평일)
        if weekday >= 5:
            return False
        return 8 * 60 + 30 <= hm <= 16 * 60
    else:
        # 미국 지수: KST 22:00~06:00 (평일 + 주말 고려)
        return hm >= 22 * 60 or hm < 6 * 60


async def job_fetch_stock_prices() -> None:
    try:
        from services.stock_service import fetch_ohlcv, save_ohlcv

        async with AsyncSessionLocal() as session:
            result = await session.execute(select(Portfolio))
            holdings = result.scalars().all()

        if not holdings:
            return

        tickers = [h.ticker for h in holdings]

        # 거래 시간이 아니면 스킵
        if not _is_trading_time(tickers):
            logger.debug("Non-trading hours, skipping stock price fetch")
            return

        for holding in holdings:
            try:
                data = await fetch_ohlcv(holding.ticker, "1m")
                if data:
                    await save_ohlcv(holding.ticker, data)
            except Exception as e:
                logger.warning(f"Failed to fetch prices for {holding.ticker}: {e}")
    except Exception as e:
        logger.error(f"job_fetch_stock_prices error: {e}")


async def job_fetch_market_indices() -> None:
    try:
        from services.index_service import INDICES, fetch_indices

        now = datetime.now(KST)
        # 어떤 지수든 거래 시간이면 해당 지수만 업데이트
        active_symbols = [
            idx["symbol"] for idx in INDICES
            if _index_in_trading_hours(idx["symbol"], now)
        ]

        if not active_symbols:
            # 모든 지수 거래 시간 밖 - 06:00 KST에 하루 1회 갱신
            hm = now.hour * 60 + now.minute
            if 6 * 60 <= hm < 6 * 60 + 16:  # 06:00~06:15 구간에만 전체 갱신
                await fetch_indices()
                logger.info("Market indices updated (daily refresh)")
            else:
                logger.debug("All indices outside trading hours, skipping")
            return

        await fetch_indices()
        logger.info(f"Market indices updated (active: {active_symbols})")
    except Exception as e:
        logger.error(f"job_fetch_market_indices error: {e}")


def _is_schedule_active(schedule: dict) -> bool:
    """현재 KST 시각이 schedule에 활성화된 요일/시간인지 확인.
    schedule: {"0": [8,9,...], "5": [10,...], ...} (0=월 ~ 6=일)
    """
    now = datetime.now(KST)
    hours = schedule.get(str(now.weekday()), [])
    return now.hour in hours


async def job_fetch_news() -> None:
    """수집 후 그룹별 대표 기사 상위 N개만 Gemini 요약 큐에 등록."""
    try:
        from routers.settings import get_all_settings
        async with AsyncSessionLocal() as _s:
            cfg = await get_all_settings(_s)

        news_schedule = cfg.get("news_schedule", {})
        if news_schedule:
            if not _is_schedule_active(news_schedule):
                logger.debug("News fetch skipped (outside configured schedule)")
                return
        else:
            # 스케줄 미설정 시 00:00~06:00 KST 스킵
            now = datetime.now(KST)
            if 0 <= now.hour < 6:
                logger.debug("News fetch skipped (quiet hours 00:00-06:00 KST)")
                return

        from services.news_service import collect_and_save_news, get_top_pending_news_ids
        from services.ollama_service import enqueue_summarize

        saved_ids = await collect_and_save_news()
        logger.info(f"News fetch job: saved {len(saved_ids)} new articles")

        # 그룹핑에서 Gemini API 호출 직후 rate limit 회복 대기 (30초)
        await asyncio.sleep(30)

        max_items = int(cfg.get("ai_summary_max_items", 20))
        top_ids = await get_top_pending_news_ids(limit=max_items)
        queued = 0
        for news_id in top_ids:
            await enqueue_summarize(news_id, priority=2)
            queued += 1
        logger.info(f"Queued {queued} articles for summarization")
    except Exception as e:
        logger.error(f"job_fetch_news error: {e}")


def _calc_recommend_hours(news_schedule: dict) -> tuple[int, int]:
    """뉴스 스케줄에서 겹치지 않는 추천 시각 계산.

    news_schedule: {"0": [8,9,...,19], "1": [...], ...}  (요일→시간 목록)
    Returns: (morning_hour, evening_hour) KST 기준
    """
    all_hours = []
    for hours in news_schedule.values():
        all_hours.extend(int(h) for h in hours)

    if not all_hours:
        return 7, 22  # 기본값

    min_news_h = min(all_hours)  # 가장 이른 뉴스 수집 시각 (e.g. 8)
    max_news_h = max(all_hours)  # 가장 늦은 뉴스 수집 시각 (e.g. 19 → 20:00까지 처리)

    # Morning: 뉴스 시작 1시간 전 (R1~R3 = 20분 소요, 충분히 여유)
    morning_h = max(0, min_news_h - 1)
    # Evening: 마지막 수집 시각 +2시간 (뉴스 처리 완료 후 여유)
    evening_h = min(23, max_news_h + 2)

    return morning_h, evening_h


def reschedule_stock(stock_interval_minutes: int) -> None:
    """주식 조회 인터벌 재등록"""
    scheduler.add_job(
        job_fetch_stock_prices,
        IntervalTrigger(minutes=stock_interval_minutes),
        id="fetch_stock_prices",
        replace_existing=True,
        misfire_grace_time=60,
        max_instances=1,
    )
    logger.info(f"Stock schedule updated: every {stock_interval_minutes} min")


def reschedule_news_interval(news_interval_hours: int) -> None:
    """뉴스 수집 인터벌 재등록 (내부에서 news_schedule 체크)"""
    scheduler.add_job(
        job_fetch_news,
        IntervalTrigger(hours=news_interval_hours),
        id="fetch_news",
        replace_existing=True,
        misfire_grace_time=600,
        max_instances=1,
    )
    logger.info(f"News interval updated: every {news_interval_hours} hour(s)")


def reschedule_ai_recommendations(news_schedule: dict) -> None:
    """뉴스 스케줄에 따라 AI 추천 R1/R2/R3 시각을 재등록 (겹침 방지)."""
    morning_h, evening_h = _calc_recommend_hours(news_schedule)

    step_fns = {
        "r1": job_ai_recommend_r1,
        "r2": job_ai_recommend_r2,
        "r3": job_ai_recommend_r3,
    }

    for r_step, minute in [("r1", 0), ("r2", 10), ("r3", 20)]:
        fn = step_fns[r_step]
        scheduler.add_job(
            lambda f=fn: asyncio.ensure_future(f("morning")),
            CronTrigger(day_of_week="mon-fri", hour=morning_h, minute=minute, timezone=KST),
            id=f"ai_recommend_morning_{r_step}",
            replace_existing=True,
            misfire_grace_time=300,
            max_instances=1,
        )
        scheduler.add_job(
            lambda f=fn: asyncio.ensure_future(f("evening")),
            CronTrigger(hour=evening_h, minute=minute, timezone=KST),
            id=f"ai_recommend_evening_{r_step}",
            replace_existing=True,
            misfire_grace_time=300,
            max_instances=1,
        )

    logger.info(f"AI recommend schedule updated: morning={morning_h:02d}:00~{morning_h:02d}:20, evening={evening_h:02d}:00~{evening_h:02d}:20 (KST)")


async def job_ai_recommend_r1(session_name: str) -> None:
    """R1: 뉴스 수집 + 후보 발굴 → DB 저장"""
    try:
        from services.recommend_service import run_ai_r1
        ok = await run_ai_r1(session_name=session_name)
        logger.info(f"AI R1 {'completed' if ok else 'skipped/failed'} ({session_name})")
    except Exception as e:
        logger.error(f"job_ai_recommend_r1 error ({session_name}): {e}")


async def job_ai_recommend_r2(session_name: str) -> None:
    """R2: 기술적 검증 → DB 저장"""
    try:
        from services.recommend_service import run_ai_r2
        ok = await run_ai_r2(session_name=session_name)
        logger.info(f"AI R2 {'completed' if ok else 'skipped/failed'} ({session_name})")
    except Exception as e:
        logger.error(f"job_ai_recommend_r2 error ({session_name}): {e}")


async def job_ai_recommend_r3(session_name: str) -> None:
    """R3: 최종 선별 → Recommendation 저장"""
    try:
        from services.recommend_service import run_ai_r3
        ok = await run_ai_r3(session_name=session_name)
        logger.info(f"AI R3 {'completed' if ok else 'skipped/failed'} ({session_name})")
    except Exception as e:
        logger.error(f"job_ai_recommend_r3 error ({session_name}): {e}")


async def job_kis_sync() -> None:
    """KIS DB 동기화 (Portfolio 테이블 갱신). 스냅샷은 저장하지 않음."""
    try:
        from services.kis_sync_service import sync_kis_to_portfolio
        result = await sync_kis_to_portfolio()
        logger.info(f"KIS auto sync: {result}")
    except Exception as e:
        logger.warning(f"KIS auto sync failed: {e}")


async def job_save_portfolio_snapshot() -> None:
    """장 마감 후 포트폴리오 스냅샷 저장 (평일 16:10 KST).
    KIS 서비스가 활성화된 경우 KIS sync(DB 동기화 + eval 금액 기반 스냅샷)를 우선 사용.
    KIS 없으면 수동 Portfolio DB 기반 스냅샷으로 폴백.
    """
    try:
        from services.kis_sync_service import sync_kis_to_portfolio
        result = await sync_kis_to_portfolio()
        if result.get("status") == "ok":
            logger.info(f"Portfolio snapshot saved via KIS sync: {result}")
            return
    except Exception as e:
        logger.warning(f"KIS sync failed, falling back to manual snapshot: {e}")

    try:
        from services.portfolio_snapshot_service import save_snapshot
        ok = await save_snapshot()
        if ok:
            logger.info("Portfolio snapshot saved (manual mode)")
    except Exception as e:
        logger.error(f"job_save_portfolio_snapshot error: {e}")


async def job_update_stock_list() -> None:
    """KRX 전 종목 목록 일일 갱신 (매일 오전 6시)"""
    try:
        from services.stock_list_service import update_stock_industries, update_stock_list
        count = await update_stock_list()
        logger.info(f"Stock list updated: {count} stocks")
        # 종목 목록 갱신 후 업종 정보도 갱신
        industry_count = await update_stock_industries()
        logger.info(f"Stock industries updated: {industry_count} stocks")
    except Exception as e:
        logger.error(f"job_update_stock_list error: {e}")


async def job_portfolio_analysis_pa1() -> None:
    """03:00 KST - 포트폴리오 분석 1단계: 데이터 수집"""
    from models.database import AsyncSessionLocal
    from services.portfolio_analysis_service import run_pa1
    async with AsyncSessionLocal() as db:
        try:
            await run_pa1(db)
        except Exception as e:
            logger.error(f"job_portfolio_analysis_pa1 error: {e}")


async def job_portfolio_analysis_pa2() -> None:
    """03:10 KST - 포트폴리오 분석 2단계: Gemini 분석"""
    from models.database import AsyncSessionLocal
    from services.portfolio_analysis_service import run_pa2
    async with AsyncSessionLocal() as db:
        try:
            count = await run_pa2(db)
            logger.info(f"Portfolio analysis complete: {count} stocks analyzed")
        except Exception as e:
            logger.error(f"job_portfolio_analysis_pa2 error: {e}")


async def job_generate_investment_diary() -> None:
    """평일 22:00 KST — 당일 투자 일기 자동 생성"""
    try:
        from datetime import datetime

        from services.diary_service import generate_diary_for_date
        today = datetime.now(KST).strftime("%Y-%m-%d")
        content = await generate_diary_for_date(diary_date=today, overwrite=True)
        if content:
            logger.info("Investment diary generated successfully")
        else:
            logger.info("Investment diary skipped (no snapshot for today)")
    except Exception as e:
        logger.error(f"job_generate_investment_diary error: {e}")


async def job_calendar_sync() -> None:
    """30분마다 Google Calendar full sync — 모든 캘린더 삭제/변경 반영"""
    try:
        from models.database import CalendarToken
        from services.calendar_service import full_sync
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(CalendarToken))
            users = result.scalars().all()
        for token_row in users:
            try:
                async with AsyncSessionLocal() as db:
                    synced = await full_sync(token_row.user_id, db)
                    logger.info(f"Calendar poll full sync: {synced} events for user {token_row.user_id}")
            except ValueError as e:
                if "NEED_RECONNECT" in str(e):
                    logger.warning(f"Calendar sync skipped for user {token_row.user_id}: token invalid, reconnection needed")
                else:
                    logger.error(f"Calendar sync error for user {token_row.user_id}: {e}")
            except Exception as e:
                logger.error(f"Calendar sync error for user {token_row.user_id}: {e}")
    except Exception as e:
        logger.error(f"job_calendar_sync error: {e}")


async def job_calendar_channel_renew() -> None:
    """4시간마다 만료 임박 push 채널 갱신"""
    try:
        from services.calendar_service import renew_expiring_channels
        await renew_expiring_channels()
    except Exception as e:
        logger.error(f"job_calendar_channel_renew error: {e}")


async def job_cleanup() -> None:
    try:
        # Read retention setting from AppSettings (fallback to defaults)
        news_retention_days = 30
        stock_cutoff_days = 90
        try:
            import json as _json

            from models.database import AppSettings
            async with AsyncSessionLocal() as s:
                row = await s.execute(
                    select(AppSettings).where(AppSettings.key == "news_retention_days")
                )
                r = row.scalar_one_or_none()
                if r and r.value:
                    try:
                        news_retention_days = int(_json.loads(r.value))
                    except Exception:
                        pass
        except Exception:
            pass

        news_cutoff = utcnow() - timedelta(days=news_retention_days)
        stock_cutoff = utcnow() - timedelta(days=stock_cutoff_days)

        async with AsyncSessionLocal() as session:
            await session.execute(
                delete(News).where(News.created_at < news_cutoff)
            )
            await session.commit()

        async with AsyncSessionLocal() as session:
            result = await session.execute(select(Portfolio))
            holdings = result.scalars().all()
            tickers = [h.ticker for h in holdings]

        for ticker in tickers:
            from services.stock_service import compress_old_data
            await compress_old_data(ticker, stock_cutoff)

        logger.info("Cleanup job completed")
    except Exception as e:
        logger.error(f"job_cleanup error: {e}")


def start_scheduler(
    stock_interval_minutes: int = 15,
    index_interval_minutes: int = 15,
    news_interval_minutes: int = 60,
) -> None:
    # 재시작 시 모든 interval 작업이 동시에 실행되는 것을 막기 위해 첫 실행 시각을 분산
    now = utcnow()
    scheduler.add_job(
        job_fetch_stock_prices,
        IntervalTrigger(minutes=stock_interval_minutes),
        id="fetch_stock_prices",
        replace_existing=True,
        misfire_grace_time=60,
        max_instances=1,
        next_run_time=now + timedelta(minutes=2),
    )
    scheduler.add_job(
        job_fetch_market_indices,
        IntervalTrigger(minutes=index_interval_minutes),
        id="fetch_market_indices",
        replace_existing=True,
        misfire_grace_time=60,
        max_instances=1,
        next_run_time=now + timedelta(minutes=4),
    )
    # 뉴스 수집: IntervalTrigger로 매 news_interval_minutes마다 실행
    # 실제 수집 여부는 job_fetch_news() 내부에서 news_schedule 기반으로 판단
    scheduler.add_job(
        job_fetch_news,
        IntervalTrigger(minutes=news_interval_minutes),
        id="fetch_news",
        replace_existing=True,
        misfire_grace_time=600,
        max_instances=1,
        next_run_time=now + timedelta(minutes=10),
    )
    # ── AI 추천 단계별 분리 ── 기본 스케줄로 등록 (설정 로드 후 재조정됨)
    from routers.settings import DEFAULT_SETTINGS
    reschedule_ai_recommendations(DEFAULT_SETTINGS["news_schedule"])
    # 평일 08:00 KST 장 전 KIS sync (Portfolio 테이블 최신화)
    scheduler.add_job(
        job_kis_sync,
        CronTrigger(day_of_week="mon-fri", hour=8, minute=0, timezone=KST),
        id="kis_sync_morning",
        replace_existing=True,
        misfire_grace_time=1800,
        max_instances=1,
    )
    # 평일 16:10 KST 장 마감 후 포트폴리오 스냅샷 저장
    scheduler.add_job(
        job_save_portfolio_snapshot,
        CronTrigger(day_of_week="mon-fri", hour=16, minute=10, timezone=KST),
        id="save_portfolio_snapshot",
        replace_existing=True,
        misfire_grace_time=1800,
        max_instances=1,
    )
    # 매일 오전 6시에 KRX 종목 목록 갱신
    scheduler.add_job(
        job_update_stock_list,
        CronTrigger(hour=6, minute=0, timezone=KST),
        id="update_stock_list",
        replace_existing=True,
        misfire_grace_time=3600,
        max_instances=1,
    )
    scheduler.add_job(
        job_cleanup,
        CronTrigger(hour=2, minute=0),
        id="cleanup",
        replace_existing=True,
        misfire_grace_time=3600,
        max_instances=1,
    )
    # AI 투자 일기: 평일 22:00 KST (당일 장 마감 후)
    scheduler.add_job(
        job_generate_investment_diary,
        CronTrigger(day_of_week="mon-fri", hour=22, minute=0, timezone=KST),
        id="generate_investment_diary",
        replace_existing=True,
        misfire_grace_time=3600,
        max_instances=1,
    )
    # 포트폴리오 AI 분석: 매일 새벽 03:00/03:10 KST (기존 스케줄 공백 시간)
    scheduler.add_job(
        job_portfolio_analysis_pa1,
        CronTrigger(hour=3, minute=0, timezone=KST),
        id="portfolio_analysis_pa1",
        replace_existing=True,
        misfire_grace_time=1800,
        max_instances=1,
    )
    scheduler.add_job(
        job_portfolio_analysis_pa2,
        CronTrigger(hour=3, minute=10, timezone=KST),
        id="portfolio_analysis_pa2",
        replace_existing=True,
        misfire_grace_time=1800,
        max_instances=1,
    )
    # Google Calendar 30분 폴링 sync (push webhook 보완)
    scheduler.add_job(
        job_calendar_sync,
        IntervalTrigger(minutes=30),
        id="calendar_sync",
        replace_existing=True,
        misfire_grace_time=300,
        max_instances=1,
        next_run_time=now + timedelta(minutes=6),
    )
    # Push 채널 4시간마다 갱신 체크 (채널 만료 2시간 전 갱신)
    scheduler.add_job(
        job_calendar_channel_renew,
        IntervalTrigger(hours=4),
        id="calendar_channel_renew",
        replace_existing=True,
        misfire_grace_time=600,
        max_instances=1,
        next_run_time=now + timedelta(minutes=8),
    )
    scheduler.start()
    logger.info("Scheduler started")


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")


def _stamp_jobs_with_correlation_id() -> None:
    """Wrap every module-level ``job_*`` coroutine so each run gets a fresh
    correlation id (``job:<name>``). Mirrors the per-request middleware so
    background logs are traceable end-to-end. Applied at import time, before
    any ``add_job`` resolves these names at startup."""
    import functools
    import inspect
    import sys

    module = sys.modules[__name__]
    for name, fn in list(vars(module).items()):
        if not name.startswith("job_") or not inspect.iscoroutinefunction(fn):
            continue

        @functools.wraps(fn)
        async def _wrapped(*args, _fn=fn, _name=name, **kwargs):
            new_correlation_id(f"job:{_name[4:]}")
            return await _fn(*args, **kwargs)

        setattr(module, name, _wrapped)


_stamp_jobs_with_correlation_id()
