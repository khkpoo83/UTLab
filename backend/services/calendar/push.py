"""Push Notification 채널 관리 (watch/register/stop/renew/restore)"""
import asyncio
import json
import logging
import uuid
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import AsyncSessionLocal, CalendarToken, CalendarWatchChannel
from services.calendar.credentials import (
    CHANNEL_TTL_SECONDS,
    get_valid_credentials,
    get_webhook_url,
)
from utils.timeutil import utcnow

logger = logging.getLogger(__name__)

# register_push_channel 동시 호출 방지 락
_register_lock = asyncio.Lock()


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
            int((utcnow() + timedelta(seconds=CHANNEL_TTL_SECONDS)).timestamp() * 1000)
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
                    CalendarWatchChannel.active == True,  # noqa: E712  (pre-existing, preserved verbatim)
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
            CalendarWatchChannel.active == True,  # noqa: E712  (pre-existing, preserved verbatim)
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
        threshold = utcnow() + timedelta(hours=2)
        result = await db.execute(
            select(CalendarWatchChannel.user_id).where(
                CalendarWatchChannel.active == True,  # noqa: E712  (pre-existing, preserved verbatim)
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
        now = utcnow()

        for token_row in tokens:
            user_id = token_row.user_id
            ch_result = await db.execute(
                select(CalendarWatchChannel).where(
                    CalendarWatchChannel.user_id == user_id,
                    CalendarWatchChannel.active == True,  # noqa: E712  (pre-existing, preserved verbatim)
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
