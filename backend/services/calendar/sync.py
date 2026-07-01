"""캘린더 목록 조회 및 이벤트 동기화 (full / incremental)"""
import json
import logging
from datetime import timedelta
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import CalendarEvent, CalendarToken
from services.calendar.credentials import get_valid_credentials
from services.calendar.events_db import _db_upsert_event, _upsert_event_from_api
from utils.timeutil import utcnow

logger = logging.getLogger(__name__)

# 동시 실행 방지: (user_id, calendar_id) 단위로 하나만 실행
_syncing_cals: set[tuple] = set()


# ── 캘린더 목록 ────────────────────────────────────────────────────────────────

async def list_user_calendars(user_id: int, db: AsyncSession) -> list[dict]:
    """사용자의 Google 캘린더 목록 조회 (API 호출 후 DB 캐시)"""
    from googleapiclient.discovery import build as gapi_build

    creds = await get_valid_credentials(user_id, db)
    service = gapi_build("calendar", "v3", credentials=creds, cache_discovery=False)

    cal_list_result = service.calendarList().list().execute()
    calendars = []
    for cal in cal_list_result.get("items", []):
        if cal.get("deleted"):
            continue
        calendars.append({
            "id": cal["id"],
            "name": cal.get("summary", cal["id"]),
            "backgroundColor": cal.get("backgroundColor", "#039be5"),
            "foregroundColor": cal.get("foregroundColor", "#ffffff"),
            "primary": cal.get("primary", False),
            "accessRole": cal.get("accessRole", "reader"),
        })

    # DB 캐시 저장
    token_result = await db.execute(select(CalendarToken).where(CalendarToken.user_id == user_id))
    token_row = token_result.scalar_one_or_none()
    if token_row:
        token_row.calendars_json = json.dumps(calendars, ensure_ascii=False)
        await db.commit()

    return calendars


async def get_cached_calendars(user_id: int, db: AsyncSession) -> list[dict]:
    """DB에 캐시된 캘린더 목록 반환"""
    result = await db.execute(select(CalendarToken).where(CalendarToken.user_id == user_id))
    token_row = result.scalar_one_or_none()
    if not token_row or not token_row.calendars_json:
        return []
    try:
        return json.loads(token_row.calendars_json)
    except Exception:
        return []


# ── Full Sync ──────────────────────────────────────────────────────────────────

async def full_sync(user_id: int, db: AsyncSession) -> int:
    """
    전체 동기화 — 처음 연결 시 또는 incremental sync 불가 시 사용
    모든 캘린더에서 이벤트를 재수집
    Returns: 동기화된 이벤트 수
    """
    import asyncio as _asyncio

    from googleapiclient.discovery import build as gapi_build

    creds = await get_valid_credentials(user_id, db)

    result = await db.execute(
        select(CalendarToken).where(CalendarToken.user_id == user_id)
    )
    token_row = result.scalar_one()

    service = gapi_build("calendar", "v3", credentials=creds, cache_discovery=False)

    # 캘린더 목록 갱신
    cal_list_result = await _asyncio.to_thread(
        lambda: service.calendarList().list().execute()
    )
    calendars = []
    for cal in cal_list_result.get("items", []):
        if cal.get("deleted"):
            continue
        calendars.append({
            "id": cal["id"],
            "name": cal.get("summary", cal["id"]),
            "backgroundColor": cal.get("backgroundColor", "#039be5"),
            "foregroundColor": cal.get("foregroundColor", "#ffffff"),
            "primary": cal.get("primary", False),
            "accessRole": cal.get("accessRole", "reader"),
        })
    token_row.calendars_json = json.dumps(calendars, ensure_ascii=False)

    # primary 캘린더의 실제 ID로 token_row.calendar_id 갱신
    # ("primary"라는 별칭 대신 실제 ID를 저장해야 incremental_sync에서 올바른 calendar_id 사용)
    primary_cal = next((c for c in calendars if c.get("primary")), None)
    if primary_cal:
        token_row.calendar_id = primary_cal["id"]

    # 기존 이벤트 삭제
    await db.execute(
        delete(CalendarEvent).where(CalendarEvent.user_id == user_id)
    )

    # 향후 1년 + 과거 1년 이벤트만 가져옴
    now = utcnow()
    time_min = (now - timedelta(days=365)).isoformat() + "Z"
    time_max = (now + timedelta(days=365)).isoformat() + "Z"

    total_synced = 0

    for cal in calendars:
        calendar_id = cal["id"]
        page_token = None

        while True:
            params = {
                "calendarId": calendar_id,
                "timeMin": time_min,
                "timeMax": time_max,
                "singleEvents": True,
                "orderBy": "startTime",
                "maxResults": 250,
                "showDeleted": False,
            }
            if page_token:
                params["pageToken"] = page_token

            try:
                events_result = await _asyncio.to_thread(
                    lambda p=dict(params): service.events().list(**p).execute()
                )
            except Exception as e:
                logger.warning(f"Failed to sync calendar {calendar_id}: {e}")
                break

            for ev in events_result.get("items", []):
                event_obj = _upsert_event_from_api(ev, user_id, calendar_id)
                if event_obj and ev.get("status") != "cancelled":
                    await _db_upsert_event(db, event_obj)
                    total_synced += 1

            page_token = events_result.get("nextPageToken")
            if not page_token:
                break

    # 각 캘린더의 syncToken을 far-future 최소 쿼리로 획득 (timeMin/timeMax 쿼리에선 반환 안 됨)
    far_future = (now + timedelta(days=3650)).isoformat() + "Z"
    sync_tokens_by_cal: dict[str, str] = {}
    for cal in calendars:
        try:
            token_resp = await _asyncio.to_thread(
                lambda c=cal: service.events().list(
                    calendarId=c["id"],
                    updatedMin=far_future,
                    maxResults=1,
                    singleEvents=True,   # incremental_sync와 동일 모드여야 syncToken 일관성 유지
                    showDeleted=False,
                ).execute()
            )
            st = token_resp.get("nextSyncToken")
            if st:
                sync_tokens_by_cal[cal["id"]] = st
        except Exception as e:
            logger.warning(f"Failed to get syncToken for calendar {cal['id']}: {e}")

    if sync_tokens_by_cal:
        token_row.sync_tokens_json = json.dumps(sync_tokens_by_cal)
        primary_cal_id = token_row.calendar_id or "primary"
        token_row.sync_token = sync_tokens_by_cal.get(primary_cal_id) or next(iter(sync_tokens_by_cal.values()))
        logger.debug(f"Saved syncTokens for {len(sync_tokens_by_cal)} calendars, user {user_id}")
    else:
        logger.warning(f"Could not obtain syncTokens for user {user_id}, will full-sync on next push")

    await db.commit()
    logger.info(f"Full sync complete for user {user_id}: {total_synced} events from {len(calendars)} calendars")
    return total_synced


# ── Incremental Sync ───────────────────────────────────────────────────────────

async def incremental_sync(user_id: int, db: AsyncSession, calendar_id: Optional[str] = None) -> int:
    """
    증분 동기화 — Push Notification 수신 시 또는 주기적 폴링 시 사용
    calendar_id: 변경이 발생한 특정 캘린더 ID (None이면 primary)
    syncToken으로 마지막 sync 이후 변경된 이벤트만 가져옴
    Returns: 변경된 이벤트 수 (추가+수정+삭제)

    같은 (user_id, calendar_id) 조합의 sync가 이미 실행 중이면 0을 반환해 중복 실행을 방지
    """
    _sync_key = (user_id, calendar_id)
    if _sync_key in _syncing_cals:
        logger.debug(f"Sync already running for user={user_id} cal={calendar_id}, skipping duplicate")
        return 0
    _syncing_cals.add(_sync_key)
    try:
        return await _do_incremental_sync(user_id, db, calendar_id)
    finally:
        _syncing_cals.discard(_sync_key)


async def incremental_sync_all(user_id: int, db: AsyncSession) -> int:
    """
    Push Notification 수신 시 모든 캘린더 증분 동기화.
    Google이 변경된 캘린더가 아닌 다른 채널(primary 등)로 알림을 보내는 경우에도
    모든 캘린더를 확인하므로 삭제/수정이 누락되지 않음.
    각 캘린더는 _syncing_cals로 중복 실행 방지.
    """
    result = await db.execute(select(CalendarToken).where(CalendarToken.user_id == user_id))
    token_row = result.scalar_one_or_none()
    if not token_row:
        return 0

    try:
        sync_tokens: dict = json.loads(token_row.sync_tokens_json) if token_row.sync_tokens_json else {}
    except Exception:
        sync_tokens = {}

    if not sync_tokens:
        return await incremental_sync(user_id, db)

    total_changed = 0
    for cal_id in list(sync_tokens.keys()):
        try:
            changed = await incremental_sync(user_id, db, calendar_id=cal_id)
            total_changed += changed
        except Exception as e:
            logger.warning(f"Incremental sync failed for calendar {cal_id}, user {user_id}: {e}")

    logger.info(f"incremental_sync_all done for user {user_id}: {total_changed} total changes across {len(sync_tokens)} calendars")
    return total_changed


async def _do_incremental_sync(user_id: int, db: AsyncSession, calendar_id: Optional[str] = None) -> int:
    """incremental_sync 실제 구현 (dedup wrapper에서 호출)"""
    import asyncio as _asyncio

    from googleapiclient.discovery import build as gapi_build

    result = await db.execute(
        select(CalendarToken).where(CalendarToken.user_id == user_id)
    )
    token_row = result.scalar_one_or_none()
    if not token_row:
        return 0

    # 캘린더별 syncToken 로드
    sync_tokens: dict[str, str] = {}
    if token_row.sync_tokens_json:
        try:
            sync_tokens = json.loads(token_row.sync_tokens_json)
        except Exception:
            pass

    # 대상 캘린더와 해당 syncToken 결정
    target_cal = calendar_id or token_row.calendar_id or "primary"
    sync_token = sync_tokens.get(target_cal) or (
        token_row.sync_token if target_cal == (token_row.calendar_id or "primary") else None
    )

    if not sync_token:
        logger.info(f"No syncToken for calendar {target_cal}, user {user_id}, running full sync")
        return await full_sync(user_id, db)

    creds = await get_valid_credentials(user_id, db)
    service = gapi_build("calendar", "v3", credentials=creds, cache_discovery=False)

    page_token = None
    changed = 0
    new_sync_token = None

    try:
        while True:
            params = {
                "calendarId": target_cal,
                "syncToken": sync_token,
                "singleEvents": True,   # full_sync와 동일 모드 — 반복 일정을 인스턴스로 저장(마스터 중복 방지)
                "showDeleted": True,
                "maxResults": 250,
            }
            if page_token:
                params["pageToken"] = page_token

            # 블로킹 Google API 호출을 스레드풀에서 실행 (이벤트 루프 블락 방지)
            events_result = await _asyncio.to_thread(
                lambda p=dict(params): service.events().list(**p).execute()
            )
            items = events_result.get("items", [])

            for ev in items:
                gid = ev.get("id", "")
                status = ev.get("status", "confirmed")

                if status == "cancelled":
                    await db.execute(
                        delete(CalendarEvent).where(
                            CalendarEvent.user_id == user_id,
                            CalendarEvent.google_event_id == gid,
                        )
                    )
                    # 연결된 InvestmentMark도 삭제
                    try:
                        from services.mark_sync import delete_mark_by_gcal_id
                        await delete_mark_by_gcal_id(gid, db)
                    except Exception:
                        pass
                else:
                    new_obj = _upsert_event_from_api(ev, user_id, target_cal)
                    if new_obj:
                        await _db_upsert_event(db, new_obj)
                changed += 1

            page_token = events_result.get("nextPageToken")
            new_sync_token = events_result.get("nextSyncToken")

            if not page_token:
                break

    except Exception as e:
        err_str = str(e)
        if "410" in err_str or "fullSyncRequired" in err_str.lower():
            logger.warning(f"syncToken expired for calendar {target_cal}, user {user_id}, running full sync")
            sync_tokens.pop(target_cal, None)
            token_row.sync_tokens_json = json.dumps(sync_tokens)
            if target_cal == (token_row.calendar_id or "primary"):
                token_row.sync_token = None
            await db.commit()
            return await full_sync(user_id, db)
        raise

    if new_sync_token:
        # 다른 캘린더 동시 sync가 먼저 commit했을 수 있으므로 최신 값 재읽기 후 merge
        await db.refresh(token_row)
        fresh_tokens: dict = {}
        if token_row.sync_tokens_json:
            try:
                fresh_tokens = json.loads(token_row.sync_tokens_json)
            except Exception:
                pass
        fresh_tokens[target_cal] = new_sync_token
        token_row.sync_tokens_json = json.dumps(fresh_tokens)
        if target_cal == (token_row.calendar_id or "primary"):
            token_row.sync_token = new_sync_token

    await db.commit()
    logger.info(f"Incremental sync complete for calendar {target_cal}, user {user_id}: {changed} changes")

    # '투자' 캘린더에서 추가된 이벤트를 InvestmentMark로 동기화
    if changed > 0:
        try:
            from services.mark_sync import sync_marks_from_gcal
            await sync_marks_from_gcal(user_id, db)
        except Exception as e:
            logger.debug(f"InvestmentMark GCal sync skipped: {e}")

    return changed
