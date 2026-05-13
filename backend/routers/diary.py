"""AI 투자 일기 라우터"""

import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from models.database import get_db
from routers.auth import get_current_user, User
from services.diary_service import (
    record_event, generate_diary_for_date,
    get_latest_diary, list_events,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/diary", tags=["diary"])
CurrentUser = Annotated[User, Depends(get_current_user)]


# ── 최신 일기 조회 ─────────────────────────────────────────────────────────────

@router.get("/latest")
async def get_latest(current_user: CurrentUser):
    diary = await get_latest_diary()
    return diary or {}


# ── 일기 수동 생성 (테스트/재생성용) ─────────────────────────────────────────────

@router.post("/generate")
async def trigger_generate(
    current_user: CurrentUser,
    date: Optional[str] = Query(None, description="YYYY-MM-DD KST (기본: 어제)"),
    overwrite: bool = Query(False),
):
    content = await generate_diary_for_date(diary_date=date, overwrite=overwrite)
    if not content:
        raise HTTPException(status_code=422, detail="일기 생성 실패: 해당 날짜의 포트폴리오 스냅샷이 없습니다.")
    return {"diary_date": date, "content": content}


# ── 이벤트 기록 ───────────────────────────────────────────────────────────────

class EventCreate(BaseModel):
    event_type: str          # buy | sell | deposit | withdraw
    amount: float
    event_date: Optional[str] = None   # YYYY-MM-DD KST (기본: 오늘)
    ticker: Optional[str] = None
    name: Optional[str] = None
    price: Optional[float] = None
    quantity: Optional[float] = None
    pnl: Optional[float] = None
    pnl_pct: Optional[float] = None
    note: Optional[str] = None


@router.post("/events")
async def create_event(body: EventCreate, current_user: CurrentUser):
    if body.event_type not in ("buy", "sell", "deposit", "withdraw"):
        raise HTTPException(status_code=400, detail="event_type은 buy/sell/deposit/withdraw 중 하나")
    return await record_event(
        event_type=body.event_type,
        amount=body.amount,
        event_date=body.event_date,
        ticker=body.ticker,
        name=body.name,
        price=body.price,
        quantity=body.quantity,
        pnl=body.pnl,
        pnl_pct=body.pnl_pct,
        note=body.note,
    )


@router.get("/events")
async def get_events(
    current_user: CurrentUser,
    date: Optional[str] = Query(None, description="YYYY-MM-DD KST"),
):
    return await list_events(event_date=date)
