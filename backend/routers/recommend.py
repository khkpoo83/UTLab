import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends

from routers.auth import get_current_user, User
from services.recommend_service import (
    get_recommendations,
    get_portfolio_sectors,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/recommend", tags=["recommend"])

CurrentUser = Annotated[User, Depends(get_current_user)]

# 재계산 진행 상태 (단일 사용자 앱이므로 메모리 플래그로 충분)
_refresh_running = False
_refresh_error: str | None = None
_refresh_done = False


@router.get("")
async def get_recommend_list(current_user: CurrentUser) -> list[dict]:
    return await get_recommendations()


@router.get("/sectors")
async def get_sector_analysis(current_user: CurrentUser) -> dict:
    sectors = await get_portfolio_sectors()
    return {"sectors": sectors}


@router.get("/ai-status")
async def get_ai_status(current_user: CurrentUser) -> dict:
    """Gemini AI 서비스 상태 조회"""
    from services.gemini_service import get_usage_stats
    stats = get_usage_stats()
    return {
        "available": not stats["rate_limited"],
        "rate_limited": stats["rate_limited"],
        "rate_limit_seconds_remaining": stats["rate_limit_seconds_remaining"],
        "rpm_used": stats["rpm_used"],
        "rpm_limit": stats["rpm_limit"],
        "rpd_used": stats["rpd_used"],
        "rpd_limit": stats["rpd_limit"],
        "failed_total": stats["failed_total"],
    }


@router.get("/refresh-status")
async def get_refresh_status(current_user: CurrentUser) -> dict:
    """재계산 진행 상태 조회 — Frontend 폴링용"""
    return {
        "running": _refresh_running,
        "done": _refresh_done,
        "error": _refresh_error,
    }


async def _run_refresh_bg() -> None:
    """백그라운드에서 R1→R2→R3 순차 실행"""
    global _refresh_running, _refresh_error, _refresh_done
    _refresh_running = True
    _refresh_error = None
    _refresh_done = False
    try:
        from services.recommend_service import run_ai_r1, run_ai_r2, run_ai_r3
        ok1 = await run_ai_r1(session_name="evening")
        if not ok1:
            _refresh_error = "R1 후보 발굴 실패 (뉴스 부족 또는 Gemini 오류)"
            return
        ok2 = await run_ai_r2(session_name="evening")
        if not ok2:
            _refresh_error = "R2 기술 검증 실패 (Gemini 오류)"
            return
        ok3 = await run_ai_r3(session_name="evening")
        if not ok3:
            _refresh_error = "R3 최종 선별 실패 (Gemini 오류)"
            return
        _refresh_done = True
        logger.info("Background recommend refresh completed successfully")
    except Exception as e:
        _refresh_error = f"AI 추천 생성 실패: {str(e)[:100]}"
        logger.error(f"Background recommend refresh error: {e}")
    finally:
        _refresh_running = False


@router.post("/refresh")
async def refresh_recommendations(background_tasks: BackgroundTasks, current_user: CurrentUser) -> dict:
    global _refresh_running, _refresh_error, _refresh_done

    from services.gemini_service import get_usage_stats
    stats = get_usage_stats()
    if stats["rate_limited"]:
        remaining = stats["rate_limit_seconds_remaining"]
        return {
            "error": f"AI 서비스 일시 사용 불가 (Rate Limit 초과 · {remaining}초 후 재시도 가능)",
            "rate_limited": True,
            "running": False,
        }

    if _refresh_running:
        return {"message": "이미 재계산 중입니다.", "running": True}

    # 상태 초기화 후 백그라운드 실행
    _refresh_running = True
    _refresh_error = None
    _refresh_done = False
    background_tasks.add_task(_run_refresh_bg)

    return {"message": "AI 추천 재계산을 시작했습니다 (R1→R2→R3). 1~2분 후 자동 업데이트됩니다.", "running": True}
