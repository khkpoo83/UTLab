import json
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import AppSettings, get_db
from routers.auth import get_current_user, User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/settings", tags=["settings"])

CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]

# stock_schedule / news_schedule: dict { "day": [hour, ...] }
# day: 0=월 ~ 6=일, hour: 0~23
# 기본값: 평일(0~4) 8~16시 (주식), 8~20시 (뉴스)
def _default_schedule(start_h: int, end_h: int) -> dict:
    """평일(0-4) start_h ~ end_h-1 시간대 활성화된 스케줄 생성"""
    return {
        str(d): list(range(start_h, end_h))
        for d in range(5)  # 월~금
    }

DEFAULT_SETTINGS = {
    "stock_interval_minutes": 15,
    "news_interval_hours": 1,
    "stock_schedule": _default_schedule(8, 16),   # 평일 08~15시
    "news_schedule": _default_schedule(8, 20),    # 평일 08~19시
    "ai_summary_start_hour": 8,
    "ai_summary_end_hour": 22,
    "ai_summary_max_items": 20,
    "news_retention_days": 30,
    # ── UI 설정 (클라이언트에서 저장, 기기 간 동기화) ──
    "ui_season": "default",         # 시즌 테마
    "ui_pnl_color_config": None,    # 등락 색상 설정 (JSON)
    "ui_logo_icon": "a",            # 로고 아이콘 스타일
    "ui_bg_config": None,           # 배경 설정 (JSON)
    "ui_dark_mode": None,           # 다크모드 (True/False/None=auto)
    "ui_home_widgets": None,        # 홈 위젯 설정 (JSON array)
    "ui_nav_mode": "top",           # 메뉴 방식 (top/sidebar)
    "ui_radius": "lg",              # 모서리 둥글기 (none/sm/md/lg/xl)
    "ui_overlay_style": "both",     # 모달 오버레이 (both/dim/blur/frosted/none)
    "ui_card_opacity": 1.0,         # 카드 투명도 (0.0~1.0)
    "ui_portfolio_cols": None,      # 포트폴리오 테이블 컬럼 설정 (JSON)
    "ui_calendar_hidden_ids": None, # 숨긴 구글 캘린더 ID 목록 (JSON array)
    "ui_photo_keyword": None,       # 홈 사진 위젯 검색 키워드 (기본: Alphonse Mucha)
    # ── 블로그 공개 설정 ──
    "blog_title": "Notes from the U.T Lab4",
}


async def get_all_settings(db: AsyncSession) -> dict:
    result = await db.execute(select(AppSettings))
    rows = result.scalars().all()
    cfg = dict(DEFAULT_SETTINGS)
    for row in rows:
        try:
            cfg[row.key] = json.loads(row.value)
        except Exception:
            cfg[row.key] = row.value
    return cfg


PUBLIC_KEYS = {"blog_title"}

@router.get("/public")
async def public_settings(db: DB) -> dict:
    """인증 없이 접근 가능한 공개 설정값 (blog_title 등)"""
    all_cfg = await get_all_settings(db)
    return {k: all_cfg[k] for k in PUBLIC_KEYS if k in all_cfg}


@router.get("")
async def list_settings(current_user: CurrentUser, db: DB) -> dict:
    return await get_all_settings(db)


class SettingsUpdate(BaseModel):
    settings: dict[str, Any]


@router.get("/ai-usage")
async def get_ai_usage(current_user: CurrentUser) -> dict:
    from services.gemini_service import get_usage_stats
    return get_usage_stats()


@router.put("")
async def update_settings(
    data: SettingsUpdate,
    current_user: CurrentUser,
    db: DB,
) -> dict:
    for key, value in data.settings.items():
        if key not in DEFAULT_SETTINGS:
            continue
        result = await db.execute(select(AppSettings).where(AppSettings.key == key))
        row = result.scalar_one_or_none()
        serialized = json.dumps(value)
        if row:
            row.value = serialized
        else:
            db.add(AppSettings(key=key, value=serialized))
    await db.commit()

    # news_schedule 변경 시 AI 추천 시각 즉시 재조정
    if "news_schedule" in data.settings:
        try:
            from services.scheduler import reschedule_ai_recommendations
            reschedule_ai_recommendations(data.settings["news_schedule"])
        except Exception as e:
            logger.warning(f"reschedule_ai_recommendations failed: {e}")

    # stock_interval_minutes 변경 시 주식 수집 잡 재등록
    if "stock_interval_minutes" in data.settings:
        try:
            from services.scheduler import reschedule_stock
            reschedule_stock(int(data.settings["stock_interval_minutes"]))
        except Exception as e:
            logger.warning(f"reschedule_stock failed: {e}")

    # news_interval_hours 변경 시 뉴스 수집 잡 재등록
    if "news_interval_hours" in data.settings:
        try:
            from services.scheduler import reschedule_news_interval
            reschedule_news_interval(int(data.settings["news_interval_hours"]))
        except Exception as e:
            logger.warning(f"reschedule_news_interval failed: {e}")

    return await get_all_settings(db)
