"""투자 이벤트 마커 라우터 — 수익률 차트에 날짜별 이벤트 마킹 + Google Calendar 동기화"""
import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import InvestmentMark, get_db
from routers.auth import get_current_user, User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/portfolio/marks", tags=["investment-marks"])

DB = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


class MarkCreate(BaseModel):
    date: str    # "YYYY-MM-DD"
    title: str


class MarkResponse(BaseModel):
    id: int
    date: str
    title: str
    google_event_id: Optional[str] = None
    google_calendar_id: Optional[str] = None
    created_at: str


@router.get("", response_model=list[MarkResponse])
async def list_marks(
    current_user: CurrentUser,
    db: DB,
    from_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    to_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
) -> list[MarkResponse]:
    conditions = []
    if from_date:
        conditions.append(InvestmentMark.date >= from_date)
    if to_date:
        conditions.append(InvestmentMark.date <= to_date)

    stmt = select(InvestmentMark).order_by(InvestmentMark.date)
    if conditions:
        stmt = stmt.where(and_(*conditions))

    result = await db.execute(stmt)
    marks = result.scalars().all()
    return [
        MarkResponse(
            id=m.id,
            date=m.date,
            title=m.title,
            google_event_id=m.google_event_id,
            google_calendar_id=m.google_calendar_id,
            created_at=m.created_at.isoformat(),
        )
        for m in marks
    ]


@router.post("", response_model=MarkResponse, status_code=status.HTTP_201_CREATED)
async def create_mark(
    data: MarkCreate,
    current_user: CurrentUser,
    db: DB,
) -> MarkResponse:
    mark = InvestmentMark(date=data.date, title=data.title)
    db.add(mark)
    await db.commit()
    await db.refresh(mark)

    gcal_event_id: Optional[str] = None
    gcal_calendar_id: Optional[str] = None

    try:
        from services.mark_sync import find_invest_calendar_id
        from services.calendar_service import create_event

        cal_id = await find_invest_calendar_id(current_user.id, db)
        if cal_id:
            event_body = {
                "summary": data.title,
                "start": {"date": data.date},
                "end": {"date": data.date},
            }
            created = await create_event(current_user.id, db, event_body, target_calendar_id=cal_id)
            gcal_event_id = created.get("id")
            gcal_calendar_id = cal_id
            mark.google_event_id = gcal_event_id
            mark.google_calendar_id = gcal_calendar_id
            await db.commit()
    except Exception as e:
        logger.warning(f"GCal event creation failed (non-fatal): {e}")

    return MarkResponse(
        id=mark.id,
        date=mark.date,
        title=mark.title,
        google_event_id=gcal_event_id,
        google_calendar_id=gcal_calendar_id,
        created_at=mark.created_at.isoformat(),
    )


@router.delete("/{mark_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_mark(
    mark_id: int,
    current_user: CurrentUser,
    db: DB,
) -> None:
    result = await db.execute(select(InvestmentMark).where(InvestmentMark.id == mark_id))
    mark = result.scalar_one_or_none()
    if not mark:
        raise HTTPException(status_code=404, detail="Mark not found")

    gcal_event_id = mark.google_event_id

    await db.delete(mark)
    await db.commit()

    if gcal_event_id:
        try:
            from services.calendar_service import delete_event
            await delete_event(current_user.id, db, gcal_event_id)
        except Exception as e:
            logger.warning(f"GCal event deletion failed (non-fatal): {e}")


@router.post("/sync-gcal", status_code=status.HTTP_200_OK)
async def sync_from_gcal(
    current_user: CurrentUser,
    db: DB,
) -> dict:
    """Google Calendar '투자' 캘린더 → InvestmentMark 수동 동기화"""
    from services.mark_sync import sync_marks_from_gcal
    count = await sync_marks_from_gcal(current_user.id, db)
    return {"synced": count}


@router.post("/sync-unsynced", status_code=status.HTTP_200_OK)
async def sync_unsynced_to_gcal(
    current_user: CurrentUser,
    db: DB,
) -> dict:
    """GCal 미동기화 마커(google_event_id 없는 것)를 GCal에 재시도 동기화"""
    from services.mark_sync import sync_unsynced_marks_to_gcal
    return await sync_unsynced_marks_to_gcal(current_user.id, db)
