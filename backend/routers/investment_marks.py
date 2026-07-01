"""투자 이벤트 마커 라우터 — 수익률 차트에 날짜별 이벤트 마킹 + Google Calendar 동기화"""
import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import InvestmentMark, get_db
from repositories.investment_mark_repository import InvestmentMarkRepository
from routers.auth import User, get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/portfolio/marks", tags=["investment-marks"])


def get_mark_repo(db: AsyncSession = Depends(get_db)) -> InvestmentMarkRepository:
    return InvestmentMarkRepository(db)


DB = Annotated[AsyncSession, Depends(get_db)]
Repo = Annotated[InvestmentMarkRepository, Depends(get_mark_repo)]
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
    repo: Repo,
    from_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    to_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
) -> list[MarkResponse]:
    marks = await repo.list(from_date, to_date)
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
    repo: Repo,
    db: DB,
) -> MarkResponse:
    mark = InvestmentMark(date=data.date, title=data.title)
    await repo.add(mark)

    gcal_event_id: Optional[str] = None
    gcal_calendar_id: Optional[str] = None

    try:
        from services.calendar_service import create_event
        from services.mark_sync import find_invest_calendar_id

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
            await repo.commit()
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
    repo: Repo,
    db: DB,
) -> None:
    mark = await repo.get(mark_id)
    if not mark:
        raise HTTPException(status_code=404, detail="Mark not found")

    gcal_event_id = mark.google_event_id

    await repo.delete(mark)

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
