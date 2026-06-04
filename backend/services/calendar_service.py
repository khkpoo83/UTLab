"""Google Calendar 서비스 — 이벤트 동기화, Push Notification 채널 관리"""
import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select, delete
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import (
    AsyncSessionLocal, CalendarEvent, CalendarToken, CalendarWatchChannel
)
from services.google_oauth import (
    build_credentials, decrypt_token, encrypt_token, refresh_access_token
)

logger = logging.getLogger(__name__)

# 동시 실행 방지: (user_id, calendar_id) 단위로 하나만 실행
_syncing_cals: set[tuple] = set()

# register_push_channel 동시 호출 방지 락
_register_lock = asyncio.Lock()

# Push Notification 채널 TTL (구글 최대 1주일 = 604800초)
# 만료 1시간 전에 갱신하기 위해 6일 23시간으로 설정
CHANNEL_TTL_SECONDS = 6 * 24 * 3600 + 23 * 3600  # 6일 23시간


# ── 토큰 헬퍼 ──────────────────────────────────────────────────────────────────

async def get_valid_credentials(user_id: int, db: AsyncSession):
    """유효한 구글 Credentials 반환 (필요 시 자동 갱신)"""
    result = await db.execute(
        select(CalendarToken).where(CalendarToken.user_id == user_id)
    )
    token_row = result.scalar_one_or_none()
    if not token_row:
        raise ValueError("Google Calendar not connected. Please authenticate first.")

    access_token = decrypt_token(token_row.encrypted_access_token)
    refresh_token = (
        decrypt_token(token_row.encrypted_refresh_token)
        if token_row.encrypted_refresh_token
        else None
    )

    # Access token 만료 5분 이내면 갱신
    now_utc = datetime.now(timezone.utc)
    expiry = token_row.token_expiry
    if expiry:
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        needs_refresh = expiry <= now_utc + timedelta(minutes=5)
    else:
        needs_refresh = True

    if needs_refresh and refresh_token:
        logger.info(f"Refreshing Google access token for user {user_id}")
        try:
            new_tokens = refresh_access_token(refresh_token)
            token_row.encrypted_access_token = encrypt_token(new_tokens["access_token"])
            token_row.token_expiry = new_tokens["expiry"]
            await db.commit()
            access_token = new_tokens["access_token"]
        except Exception as e:
            err = str(e).lower()
            if "invalid_grant" in err or "token has been expired" in err or "revoked" in err:
                logger.warning(f"Google refresh token invalid for user {user_id}: {e}")
                raise ValueError("NEED_RECONNECT: Google token expired or revoked.")
            raise

    return build_credentials(access_token, refresh_token)


# ── 이벤트 파싱 ────────────────────────────────────────────────────────────────

def _parse_event_dt(dt_obj: dict) -> tuple[Optional[datetime], bool]:
    """Google Calendar datetime/date 객체 → (datetime UTC, all_day)"""
    if "dateTime" in dt_obj:
        from dateutil import parser as dtparser
        dt = dtparser.parse(dt_obj["dateTime"])
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).replace(tzinfo=None), False
    elif "date" in dt_obj:
        # 종일 이벤트 — 날짜만 있음 (시간 없음)
        from datetime import date
        d = datetime.strptime(dt_obj["date"], "%Y-%m-%d")
        return d, True
    return None, False


def _upsert_event_from_api(event_data: dict, user_id: int, calendar_id: str) -> Optional[CalendarEvent]:
    """Google API 이벤트 dict → CalendarEvent ORM 객체 (None = 삭제된 이벤트)"""
    google_id = event_data.get("id", "")
    status = event_data.get("status", "confirmed")

    start, all_day = _parse_event_dt(event_data.get("start", {}))
    end, _ = _parse_event_dt(event_data.get("end", {}))

    recurrence = event_data.get("recurrence")

    return CalendarEvent(
        user_id=user_id,
        google_event_id=google_id,
        calendar_id=calendar_id,
        summary=event_data.get("summary"),
        description=event_data.get("description"),
        location=event_data.get("location"),
        start_dt=start,
        end_dt=end,
        all_day=all_day,
        recurrence=json.dumps(recurrence) if recurrence else None,
        status=status,
        html_link=event_data.get("htmlLink"),
        color_id=event_data.get("colorId"),
        raw_json=json.dumps(event_data, ensure_ascii=False),
        synced_at=datetime.utcnow(),
    )


# ── DB Upsert 헬퍼 ────────────────────────────────────────────────────────────

_UPSERT_COLS = [
    "calendar_id", "summary", "description", "location",
    "start_dt", "end_dt", "all_day", "recurrence",
    "status", "html_link", "color_id", "raw_json", "synced_at",
]

async def _db_upsert_event(db: AsyncSession, ev: CalendarEvent) -> None:
    """INSERT OR REPLACE 방식 upsert — UNIQUE(user_id, google_event_id) 충돌 안전"""
    vals = {
        "user_id":         ev.user_id,
        "google_event_id": ev.google_event_id,
        "calendar_id":     ev.calendar_id,
        "summary":         ev.summary,
        "description":     ev.description,
        "location":        ev.location,
        "start_dt":        ev.start_dt,
        "end_dt":          ev.end_dt,
        "all_day":         ev.all_day,
        "recurrence":      ev.recurrence,
        "status":          ev.status,
        "html_link":       ev.html_link,
        "color_id":        ev.color_id,
        "raw_json":        ev.raw_json,
        "synced_at":       ev.synced_at,
    }
    stmt = sqlite_insert(CalendarEvent).values(**vals)
    stmt = stmt.on_conflict_do_update(
        index_elements=["user_id", "google_event_id"],
        set_={c: vals[c] for c in _UPSERT_COLS},
    )
    await db.execute(stmt)


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
    now = datetime.utcnow()
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


# ── Push Notification Channel 관리 ────────────────────────────────────────────

def get_webhook_url() -> Optional[str]:
    """Push Notification을 받을 공개 HTTPS URL"""
    base = os.getenv("GOOGLE_WEBHOOK_BASE_URL", "").rstrip("/")
    if not base:
        return None
    return f"{base}/api/calendar/webhook"


def _watch_calendar(user_id: int, calendar_id: str, service, webhook_url: str) -> Optional[dict]:
    """Google API에 watch 요청 — DB 저장 없이 채널 데이터만 반환"""
    import secrets as _secrets

    channel_id = str(uuid.uuid4())
    webhook_token = _secrets.token_hex(32)
    body = {
        "id": channel_id,
        "type": "web_hook",
        "address": webhook_url,
        "token": webhook_token,
        "expiration": str(
            int((datetime.utcnow() + timedelta(seconds=CHANNEL_TTL_SECONDS)).timestamp() * 1000)
        ),
    }
    try:
        watch_resp = service.events().watch(calendarId=calendar_id, body=body).execute()
    except Exception as e:
        logger.warning(f"Push channel registration failed for cal {calendar_id}: {e}")
        return None

    expiry_ms = watch_resp.get("expiration")
    expiry_dt = datetime.utcfromtimestamp(int(expiry_ms) / 1000) if expiry_ms else None
    return {
        "user_id": user_id,
        "channel_id": channel_id,
        "resource_id": watch_resp.get("resourceId"),
        "calendar_id": calendar_id,
        "expiration": expiry_dt,
        "webhook_token": webhook_token,
    }


async def register_push_channel(user_id: int, db: Optional[AsyncSession] = None) -> Optional[dict]:
    """
    모든 캘린더에 Push Notification 채널 등록
    - 캘린더별로 개별 채널 등록 → 어느 캘린더에서 변경이 있어도 즉시 알림
    - 채널은 최대 1주일 유효 → APScheduler로 자동 갱신
    - db 파라미터는 하위 호환용 (무시됨 — 내부적으로 새 세션 사용)
    - 동시 호출 방지: _register_lock으로 직렬화
    Returns: 첫 번째 채널 정보 dict or None (webhook URL 미설정 시)
    """
    import asyncio as _asyncio
    from googleapiclient.discovery import build as gapi_build

    webhook_url = get_webhook_url()
    if not webhook_url:
        logger.warning(
            "GOOGLE_WEBHOOK_BASE_URL not set — push notifications disabled. "
            "Set it to your public HTTPS server URL (e.g. https://your-domain.com)"
        )
        return None

    # 동시 호출 방지 — 여러 곳에서 동시에 호출되면 채널 중복 발생
    async with _register_lock:
        # Step 1: credentials + 캘린더 목록 + 기존 채널 목록 획득
        async with AsyncSessionLocal() as read_db:
            creds = await get_valid_credentials(user_id, read_db)
            result = await read_db.execute(
                select(CalendarToken).where(CalendarToken.user_id == user_id)
            )
            token_row = result.scalar_one()
            calendars: list[dict] = []
            if token_row.calendars_json:
                try:
                    calendars = json.loads(token_row.calendars_json)
                except Exception:
                    pass
            if not calendars:
                calendars = [{"id": token_row.calendar_id or "primary"}]

            # 기존 활성 채널 목록 (Google에 stop 요청용)
            old_ch_result = await read_db.execute(
                select(CalendarWatchChannel).where(
                    CalendarWatchChannel.user_id == user_id,
                    CalendarWatchChannel.active == True,
                )
            )
            old_channels = old_ch_result.scalars().all()
            # ORM 객체를 plain dict로 복사 (세션 닫힌 후에도 사용)
            old_channel_data = [
                {"channel_id": ch.channel_id, "resource_id": ch.resource_id}
                for ch in old_channels
            ]

        service = gapi_build("calendar", "v3", credentials=creds, cache_discovery=False)

        # Step 2: 기존 Google 채널 중단 (best effort — DB 삭제 전에 실행)
        for ch_data in old_channel_data:
            try:
                await _asyncio.to_thread(
                    lambda c=ch_data: service.channels().stop(
                        body={"id": c["channel_id"], "resourceId": c["resource_id"]}
                    ).execute()
                )
                logger.info(f"Stopped old push channel: {ch_data['channel_id']}")
            except Exception as e:
                logger.warning(f"Failed to stop old channel {ch_data['channel_id']}: {e}")

        # Step 3: Google API에 모든 캘린더 채널 신규 등록
        new_channels = []
        for cal in calendars:
            ch_data = await _asyncio.to_thread(
                lambda cal_id=cal["id"]: _watch_calendar(user_id, cal_id, service, webhook_url)
            )
            if ch_data:
                new_channels.append(ch_data)

        if not new_channels:
            logger.warning(f"No push channels registered for user {user_id}")
            return None

        # Step 4: DB — 기존 채널 전체 삭제 후 신규 채널 저장 (단일 트랜잭션)
        async with AsyncSessionLocal() as write_db:
            await write_db.execute(
                delete(CalendarWatchChannel).where(
                    CalendarWatchChannel.user_id == user_id,
                )
            )
            for ch in new_channels:
                write_db.add(CalendarWatchChannel(**ch, active=True))
            await write_db.commit()

        logger.info(f"Registered {len(new_channels)}/{len(calendars)} push channels for user {user_id}")
        return {"registered": len(new_channels)}


async def stop_push_channel(user_id: int, db: AsyncSession) -> bool:
    """Push 채널 구글에 중단 요청 후 DB 삭제"""
    from googleapiclient.discovery import build as gapi_build

    result = await db.execute(
        select(CalendarWatchChannel).where(
            CalendarWatchChannel.user_id == user_id,
            CalendarWatchChannel.active == True,
        )
    )
    channels = result.scalars().all()
    if not channels:
        return True

    try:
        creds = await get_valid_credentials(user_id, db)
        service = gapi_build("calendar", "v3", credentials=creds, cache_discovery=False)
        for ch in channels:
            try:
                service.channels().stop(
                    body={"id": ch.channel_id, "resourceId": ch.resource_id}
                ).execute()
            except Exception as e:
                logger.warning(f"Stop channel error (ignored): {e}")
            ch.active = False
    except Exception as e:
        logger.warning(f"Could not stop push channels for user {user_id}: {e}")

    await db.commit()
    return True


async def renew_expiring_channels() -> None:
    """
    APScheduler 잡 — 만료 2시간 이내 채널을 자동 갱신
    user 단위로 모든 캘린더 채널을 한 번에 갱신
    """
    async with AsyncSessionLocal() as db:
        threshold = datetime.utcnow() + timedelta(hours=2)
        result = await db.execute(
            select(CalendarWatchChannel.user_id).where(
                CalendarWatchChannel.active == True,
                CalendarWatchChannel.expiration <= threshold,
            ).distinct()
        )
        user_ids = [row[0] for row in result.fetchall()]

        for user_id in user_ids:
            logger.info(f"Renewing all push channels for user {user_id}")
            try:
                async with AsyncSessionLocal() as renew_db:
                    await register_push_channel(user_id, renew_db)
            except Exception as e:
                logger.error(f"Channel renewal failed for user {user_id}: {e}")


async def restore_push_channels_on_startup() -> None:
    """
    서버 재시작 시 활성 채널 복구
    - 만료됐거나 채널 수가 캘린더 수보다 적으면 전체 재등록
    """
    async with AsyncSessionLocal() as db:
        # 토큰이 있는 모든 사용자
        token_result = await db.execute(select(CalendarToken))
        tokens = token_result.scalars().all()
        now = datetime.utcnow()

        for token_row in tokens:
            user_id = token_row.user_id
            ch_result = await db.execute(
                select(CalendarWatchChannel).where(
                    CalendarWatchChannel.user_id == user_id,
                    CalendarWatchChannel.active == True,
                )
            )
            channels = ch_result.scalars().all()

            # 캘린더 수 파악
            try:
                cal_count = len(json.loads(token_row.calendars_json)) if token_row.calendars_json else 1
            except Exception:
                cal_count = 1

            expired = any(c.expiration and c.expiration <= now for c in channels)
            # 채널 수 부족만으로는 재등록 안 함 — push 미지원 캘린더(공휴일 등)가 있으면 항상 부족하게 보임
            needs_register = not channels or expired

            if needs_register:
                logger.info(
                    f"Re-registering push channels for user {user_id} "
                    f"(have {len(channels)}, need {cal_count}, expired={expired})"
                )
                try:
                    async with AsyncSessionLocal() as reg_db:
                        await register_push_channel(user_id, reg_db)
                except Exception as e:
                    logger.error(f"Startup channel restore failed for user {user_id}: {e}")
            else:
                for ch in channels:
                    logger.info(
                        f"Push channel active: user={user_id} cal={ch.calendar_id} expires={ch.expiration}"
                    )


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
            CalendarWatchChannel.active == True,
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
    from sqlalchemy import update as sa_update

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

def _master_id_from_row(ev_row: Optional[CalendarEvent], gid: str) -> str:
    """인스턴스 row의 raw_json에서 recurringEventId(마스터 ID) 추출, 없으면 gid 그대로"""
    if ev_row and ev_row.raw_json:
        try:
            r = json.loads(ev_row.raw_json)
            if r.get("recurringEventId"):
                return r["recurringEventId"]
        except Exception:
            pass
    return gid


def _fmt_until(start_dt: datetime, all_day: bool) -> str:
    """이 인스턴스 직전까지로 시리즈를 자르기 위한 RRULE UNTIL 문자열"""
    if all_day:
        return (start_dt - timedelta(days=1)).strftime("%Y%m%d")
    return (start_dt - timedelta(seconds=1)).strftime("%Y%m%dT%H%M%SZ")


def _apply_until(recurrence: Optional[list], until_str: str) -> list:
    """RRULE에서 COUNT/UNTIL 제거 후 새 UNTIL 적용 (다른 라인 EXDATE 등은 보존)"""
    out: list = []
    has_rrule = False
    for line in (recurrence or []):
        if line.startswith("RRULE:"):
            has_rrule = True
            parts = [
                p for p in line[len("RRULE:"):].split(";")
                if p and not p.startswith("COUNT=") and not p.startswith("UNTIL=")
            ]
            parts.append(f"UNTIL={until_str}")
            out.append("RRULE:" + ";".join(parts))
        else:
            out.append(line)
    if not has_rrule:
        out.append(f"RRULE:FREQ=DAILY;UNTIL={until_str}")
    return out


def _strip_count_until(recurrence: Optional[list]) -> list:
    """새 시리즈용 RRULE에서 기존 종료조건(COUNT/UNTIL) 제거 (계속 반복으로)"""
    out: list = []
    for line in (recurrence or []):
        if line.startswith("RRULE:"):
            parts = [
                p for p in line[len("RRULE:"):].split(";")
                if p and not p.startswith("COUNT=") and not p.startswith("UNTIL=")
            ]
            out.append("RRULE:" + ";".join(parts))
        else:
            out.append(line)
    return out


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
    recurrence = event_body.get("recurrence")
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
