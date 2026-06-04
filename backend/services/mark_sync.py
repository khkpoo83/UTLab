"""투자 마커 ↔ Google Calendar '투자' 캘린더 동기화 서비스"""
import json
import logging
from typing import Optional

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import CalendarEvent, CalendarToken, InvestmentMark

logger = logging.getLogger(__name__)


async def find_invest_calendar_id(user_id: int, db: AsyncSession) -> Optional[str]:
    """캐시에서 '투자' 이름의 Google Calendar ID 조회"""
    result = await db.execute(select(CalendarToken).where(CalendarToken.user_id == user_id))
    token = result.scalar_one_or_none()
    if not token or not token.calendars_json:
        return None
    try:
        calendars = json.loads(token.calendars_json)
        for cal in calendars:
            if cal.get("name") == "투자":
                return cal["id"]
    except Exception:
        pass
    return None


async def sync_marks_from_gcal(user_id: int, db: AsyncSession) -> int:
    """
    Google Calendar '투자' 캘린더 이벤트 → InvestmentMark 동기화
    - CalendarEvent 테이블에서 '투자' 캘린더 이벤트를 읽어 InvestmentMark에 없으면 추가
    - 이미 google_event_id가 있는 마커는 스킵
    """
    cal_id = await find_invest_calendar_id(user_id, db)
    if not cal_id:
        return 0

    gcal_result = await db.execute(
        select(CalendarEvent).where(
            CalendarEvent.user_id == user_id,
            CalendarEvent.calendar_id == cal_id,
            CalendarEvent.status != "cancelled",
        )
    )
    gcal_events = gcal_result.scalars().all()
    if not gcal_events:
        return 0

    existing_result = await db.execute(
        select(InvestmentMark.google_event_id).where(
            InvestmentMark.google_event_id.isnot(None)
        )
    )
    existing_gcal_ids = {row[0] for row in existing_result.fetchall()}

    synced = 0
    for ev in gcal_events:
        if not ev.summary:
            continue
        if ev.google_event_id in existing_gcal_ids:
            continue
        if not ev.start_dt:
            continue

        date_str = ev.start_dt.strftime("%Y-%m-%d")
        mark = InvestmentMark(
            date=date_str,
            title=ev.summary,
            google_event_id=ev.google_event_id,
            google_calendar_id=cal_id,
        )
        db.add(mark)
        synced += 1

    if synced > 0:
        await db.commit()
        logger.info(f"Synced {synced} marks from GCal '투자' calendar for user {user_id}")

    return synced


async def sync_unsynced_marks_to_gcal(user_id: int, db: AsyncSession) -> dict:
    """google_event_id가 없는 마커들을 GCal '투자' 캘린더에 동기화.

    Returns: {"synced": int, "failed": int}
    """
    from services.calendar_service import create_event

    cal_id = await find_invest_calendar_id(user_id, db)
    if not cal_id:
        return {"synced": 0, "failed": 0, "error": "투자 캘린더를 찾을 수 없습니다. GCal 연결 후 전체 동기화를 먼저 실행하세요."}

    result = await db.execute(
        select(InvestmentMark).where(InvestmentMark.google_event_id.is_(None))
    )
    unsynced = result.scalars().all()
    if not unsynced:
        return {"synced": 0, "failed": 0}

    synced = 0
    failed = 0
    for mark in unsynced:
        try:
            event_body = {
                "summary": mark.title,
                "start": {"date": mark.date},
                "end": {"date": mark.date},
            }
            created = await create_event(user_id, db, event_body, target_calendar_id=cal_id)
            mark.google_event_id = created.get("id")
            mark.google_calendar_id = cal_id
            synced += 1
        except Exception as e:
            logger.warning(f"미동기화 마커 GCal 동기화 실패 (id={mark.id}): {e}")
            failed += 1

    if synced > 0:
        await db.commit()
        logger.info(f"미동기화 마커 {synced}건 GCal 동기화 완료 (실패: {failed}건)")

    return {"synced": synced, "failed": failed}


async def delete_mark_by_gcal_id(gcal_event_id: str, db: AsyncSession) -> None:
    """GCal 이벤트 삭제 시 연결된 InvestmentMark도 삭제"""
    await db.execute(
        delete(InvestmentMark).where(InvestmentMark.google_event_id == gcal_event_id)
    )
