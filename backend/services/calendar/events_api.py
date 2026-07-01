"""이벤트 조회/상태/CRUD 및 반복 일정 범위(scope) 처리"""
import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import CalendarEvent, CalendarToken, CalendarWatchChannel
from services.calendar.credentials import get_valid_credentials, get_webhook_url
from services.calendar.events_db import _master_id_from_row, _parse_event_dt, _upsert_event_from_api
from services.calendar.recurrence import _apply_until, _fmt_until, _strip_count_until

logger = logging.getLogger(__name__)


# ── 이벤트 조회 헬퍼 ───────────────────────────────────────────────────────────

async def get_events(
    user_id: int,
    db: AsyncSession,
    from_dt: Optional[datetime] = None,
    to_dt: Optional[datetime] = None,
) -> list[CalendarEvent]:
    """DB 캐시에서 이벤트 조회"""
    from sqlalchemy import and_

    conditions = [
        CalendarEvent.user_id == user_id,
        CalendarEvent.status != "cancelled",
    ]
    if from_dt:
        conditions.append(CalendarEvent.start_dt >= from_dt)
    if to_dt:
        conditions.append(CalendarEvent.start_dt <= to_dt)

    result = await db.execute(
        select(CalendarEvent)
        .where(and_(*conditions))
        .order_by(CalendarEvent.start_dt)
    )
    return list(result.scalars().all())


async def get_connection_status(user_id: int, db: AsyncSession) -> dict:
    """연결 상태 요약"""
    result = await db.execute(
        select(CalendarToken).where(CalendarToken.user_id == user_id)
    )
    token_row = result.scalar_one_or_none()

    if not token_row:
        return {"connected": False}

    ch_result = await db.execute(
        select(CalendarWatchChannel).where(
            CalendarWatchChannel.user_id == user_id,
            CalendarWatchChannel.active == True,  # noqa: E712  (pre-existing, preserved verbatim)
        )
    )
    active_channels = ch_result.scalars().all()
    active_channel = active_channels[0] if active_channels else None

    ev_count = await db.execute(
        select(CalendarEvent).where(CalendarEvent.user_id == user_id)
    )
    events = list(ev_count.scalars().all())

    # access token 만료 여부로 재인증 필요 여부 판단
    now_utc = datetime.now(timezone.utc)
    expiry = token_row.token_expiry
    if expiry and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    token_expired = (not expiry) or (expiry <= now_utc)
    has_refresh = bool(token_row.encrypted_refresh_token)
    # refresh token도 없거나 access token 만료 + refresh 없으면 재연결 필요
    needs_reconnect = token_expired and not has_refresh

    return {
        "connected": True,
        "google_email": token_row.google_email,
        "calendar_id": token_row.calendar_id,
        "push_enabled": active_channel is not None,
        "push_expires": active_channel.expiration.isoformat() if active_channel and active_channel.expiration else None,
        "cached_events": len(events),
        "last_sync": token_row.updated_at.isoformat() if token_row.updated_at else None,
        "webhook_url": get_webhook_url(),
        "needs_reconnect": needs_reconnect,
    }


# ── 이벤트 CRUD ────────────────────────────────────────────────────────────────

async def create_event(user_id: int, db: AsyncSession, event_body: dict, target_calendar_id: str = "primary") -> dict:
    """Google Calendar에 이벤트 생성 후 DB에 캐시"""
    from googleapiclient.discovery import build as gapi_build

    creds = await get_valid_credentials(user_id, db)
    result = await db.execute(select(CalendarToken).where(CalendarToken.user_id == user_id))
    token_row = result.scalar_one()
    calendar_id = target_calendar_id or token_row.calendar_id or "primary"

    service = gapi_build("calendar", "v3", credentials=creds, cache_discovery=False)
    created = service.events().insert(calendarId=calendar_id, body=event_body).execute()

    # 반복(마스터) 이벤트는 로컬에 저장하지 않음 — 호출측 full_sync가 인스턴스로 펼쳐 저장
    # (마스터 bare gid를 저장하면 인스턴스와 gid가 달라 중복됨)
    if not created.get("recurrence"):
        event_obj = _upsert_event_from_api(created, user_id, calendar_id)
        if event_obj:
            db.add(event_obj)
            await db.commit()
            await db.refresh(event_obj)
    return created


async def update_event(user_id: int, db: AsyncSession, google_event_id: str, event_body: dict) -> dict:
    """Google Calendar 이벤트 수정 후 DB 갱신"""
    from googleapiclient.discovery import build as gapi_build
    from sqlalchemy import (
        update as sa_update,  # noqa: F401  (pre-existing unused import, preserved verbatim)
    )

    creds = await get_valid_credentials(user_id, db)

    # 이벤트의 실제 calendar_id 조회
    ev_row = (await db.execute(
        select(CalendarEvent).where(
            CalendarEvent.user_id == user_id,
            CalendarEvent.google_event_id == google_event_id,
        )
    )).scalar_one_or_none()
    calendar_id = (ev_row.calendar_id if ev_row else None) or "primary"

    service = gapi_build("calendar", "v3", credentials=creds, cache_discovery=False)
    updated = service.events().patch(calendarId=calendar_id, eventId=google_event_id, body=event_body).execute()

    # DB 캐시 갱신
    ev_result = await db.execute(
        select(CalendarEvent).where(
            CalendarEvent.user_id == user_id,
            CalendarEvent.google_event_id == google_event_id,
        )
    )
    ev = ev_result.scalar_one_or_none()
    # 수정 결과가 반복(마스터)이 되면 로컬 행은 건드리지 않음 — full_sync가 인스턴스로 정리
    if ev and not updated.get("recurrence"):
        start, all_day = _parse_event_dt(updated.get("start", {}))
        end, _ = _parse_event_dt(updated.get("end", {}))
        ev.summary = updated.get("summary")
        ev.description = updated.get("description")
        ev.location = updated.get("location")
        ev.start_dt = start
        ev.end_dt = end
        ev.all_day = all_day
        ev.color_id = updated.get("colorId")
        ev.synced_at = datetime.utcnow()
        await db.commit()
    return updated


# ── 반복 일정 범위(scope) 처리 ─────────────────────────────────────────────────

async def update_event_scoped(
    user_id: int, db: AsyncSession, google_event_id: str, event_body: dict, scope: str
) -> dict:
    """
    반복 일정을 범위(scope)에 따라 수정.
    scope: 'this'(이 일정만) | 'following'(이후 모든) | 'all'(모든)
    event_body: recurrence 포함 가능한 Google 이벤트 body
    """
    from googleapiclient.discovery import build as gapi_build

    ev_row = (await db.execute(
        select(CalendarEvent).where(
            CalendarEvent.user_id == user_id,
            CalendarEvent.google_event_id == google_event_id,
        )
    )).scalar_one_or_none()
    if not ev_row:
        raise ValueError("이벤트를 찾을 수 없습니다.")

    calendar_id = ev_row.calendar_id or "primary"
    recurrence = event_body.get("recurrence")  # noqa: F841  (pre-existing unused var, preserved verbatim)
    creds = await get_valid_credentials(user_id, db)
    service = gapi_build("calendar", "v3", credentials=creds, cache_discovery=False)

    if scope == "this":
        # 이 인스턴스만 — recurrence 변경 불가
        body = {k: v for k, v in event_body.items() if k != "recurrence"}
        result = await asyncio.to_thread(
            lambda: service.events().patch(calendarId=calendar_id, eventId=google_event_id, body=body).execute()
        )

    elif scope == "all":
        # 시리즈 전체 — 내용 + 반복규칙. 날짜/시간(start/end)은 앵커 이동 방지 위해 제외
        master_id = _master_id_from_row(ev_row, google_event_id)
        body = {k: v for k, v in event_body.items() if k not in ("start", "end")}
        result = await asyncio.to_thread(
            lambda: service.events().patch(calendarId=calendar_id, eventId=master_id, body=body).execute()
        )

    elif scope == "redefine":
        # 단일 occurrence 반복(예: COUNT=1)을 마스터에 새 규칙으로 재정의 — start/end 포함 전체 적용
        # (calendar_id는 인스턴스 행에서 정확히 해석됨)
        master_id = _master_id_from_row(ev_row, google_event_id)
        result = await asyncio.to_thread(
            lambda: service.events().patch(calendarId=calendar_id, eventId=master_id, body=event_body).execute()
        )

    elif scope == "following":
        # 이 인스턴스 직전까지 기존 시리즈 자르고, 이 인스턴스부터 새 시리즈 생성
        master_id = _master_id_from_row(ev_row, google_event_id)
        master = await asyncio.to_thread(
            lambda: service.events().get(calendarId=calendar_id, eventId=master_id).execute()
        )
        master_recur = master.get("recurrence") or []
        until = _fmt_until(ev_row.start_dt, bool(ev_row.all_day))
        truncated = _apply_until(master_recur, until)
        await asyncio.to_thread(
            lambda: service.events().patch(calendarId=calendar_id, eventId=master_id, body={"recurrence": truncated}).execute()
        )
        # 새 시리즈 body — 종료조건 없으면 기존 규칙 계승
        new_body = dict(event_body)
        if not new_body.get("recurrence"):
            new_body["recurrence"] = _strip_count_until(master_recur)
        result = await asyncio.to_thread(
            lambda: service.events().insert(calendarId=calendar_id, body=new_body).execute()
        )
    else:
        raise ValueError(f"잘못된 scope: {scope}")

    # 로컬 캐시는 호출측에서 full_sync로 갱신
    return result


async def delete_event_scoped(
    user_id: int, db: AsyncSession, google_event_id: str, scope: str
) -> None:
    """반복 일정을 범위(scope)에 따라 삭제"""
    from googleapiclient.discovery import build as gapi_build

    ev_row = (await db.execute(
        select(CalendarEvent).where(
            CalendarEvent.user_id == user_id,
            CalendarEvent.google_event_id == google_event_id,
        )
    )).scalar_one_or_none()
    if not ev_row:
        raise ValueError("이벤트를 찾을 수 없습니다.")

    calendar_id = ev_row.calendar_id or "primary"
    creds = await get_valid_credentials(user_id, db)
    service = gapi_build("calendar", "v3", credentials=creds, cache_discovery=False)

    if scope == "this":
        await asyncio.to_thread(
            lambda: service.events().delete(calendarId=calendar_id, eventId=google_event_id).execute()
        )
    elif scope == "all":
        master_id = _master_id_from_row(ev_row, google_event_id)
        await asyncio.to_thread(
            lambda: service.events().delete(calendarId=calendar_id, eventId=master_id).execute()
        )
    elif scope == "following":
        master_id = _master_id_from_row(ev_row, google_event_id)
        master = await asyncio.to_thread(
            lambda: service.events().get(calendarId=calendar_id, eventId=master_id).execute()
        )
        master_recur = master.get("recurrence") or []
        until = _fmt_until(ev_row.start_dt, bool(ev_row.all_day))
        truncated = _apply_until(master_recur, until)
        await asyncio.to_thread(
            lambda: service.events().patch(calendarId=calendar_id, eventId=master_id, body={"recurrence": truncated}).execute()
        )
    else:
        raise ValueError(f"잘못된 scope: {scope}")
    # 로컬 캐시는 호출측에서 full_sync로 갱신


async def get_event_recurrence(user_id: int, db: AsyncSession, google_event_id: str) -> Optional[list]:
    """
    반복 일정의 RRULE 규칙 조회.
    인스턴스 ID로 호출되면 raw_json의 recurringEventId로 마스터를 찾아 그 recurrence를 반환.
    반복이 아니면 None.
    """
    from googleapiclient.discovery import build as gapi_build

    ev_row = (await db.execute(
        select(CalendarEvent).where(
            CalendarEvent.user_id == user_id,
            CalendarEvent.google_event_id == google_event_id,
        )
    )).scalar_one_or_none()
    if not ev_row:
        return None

    calendar_id = ev_row.calendar_id or "primary"
    master_id = google_event_id
    # 인스턴스면 raw_json의 recurringEventId로 마스터 식별
    if ev_row.raw_json:
        try:
            raw = json.loads(ev_row.raw_json)
            if raw.get("recurringEventId"):
                master_id = raw["recurringEventId"]
        except Exception:
            pass

    creds = await get_valid_credentials(user_id, db)
    service = gapi_build("calendar", "v3", credentials=creds, cache_discovery=False)
    try:
        master = await asyncio.to_thread(
            lambda: service.events().get(calendarId=calendar_id, eventId=master_id).execute()
        )
    except Exception as e:
        logger.warning(f"get_event_recurrence: master fetch failed for {master_id}: {e}")
        return None
    return master.get("recurrence")


async def delete_event(user_id: int, db: AsyncSession, google_event_id: str) -> None:
    """Google Calendar 이벤트 삭제 후 DB에서 제거"""
    from googleapiclient.discovery import build as gapi_build

    creds = await get_valid_credentials(user_id, db)

    # 이벤트의 실제 calendar_id 조회 (다른 캘린더 이벤트 삭제 실패 방지)
    ev_row = (await db.execute(
        select(CalendarEvent).where(
            CalendarEvent.user_id == user_id,
            CalendarEvent.google_event_id == google_event_id,
        )
    )).scalar_one_or_none()
    calendar_id = (ev_row.calendar_id if ev_row else None) or "primary"

    service = gapi_build("calendar", "v3", credentials=creds, cache_discovery=False)
    service.events().delete(calendarId=calendar_id, eventId=google_event_id).execute()

    await db.execute(
        delete(CalendarEvent).where(
            CalendarEvent.user_id == user_id,
            CalendarEvent.google_event_id == google_event_id,
        )
    )
    await db.commit()
