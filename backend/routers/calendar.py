"""Google Calendar 라우터 — OAuth2, Webhook, SSE, 이벤트 API"""
import json
import logging
import os
import secrets
from datetime import datetime, timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request, Response
from models.database import AsyncSessionLocal
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import CalendarEvent, CalendarToken, CalendarWatchChannel, User, get_db
from routers.auth import get_current_user
from services.google_oauth import (
    build_authorization_url,
    decrypt_token,
    encrypt_token,
    exchange_code_for_tokens,
    get_google_email,
)
from services.calendar_service import (
    full_sync,
    get_connection_status,
    get_events,
    incremental_sync,
    incremental_sync_all,
    list_user_calendars,
    register_push_channel,
    stop_push_channel,
    create_event,
    update_event,
    delete_event,
)
from services.sse_broker import broker as sse_broker

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/calendar", tags=["calendar"])

DB = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]

# OAuth state를 메모리에 임시 저장 (단일 사용자 앱이므로 간단하게 처리)
# 운영 환경에서는 Redis나 DB에 저장 권장
_oauth_states: dict[str, int] = {}  # state → user_id


# ── OAuth2 인증 ────────────────────────────────────────────────────────────────

@router.get("/auth/connect")
async def auth_connect(current_user: CurrentUser) -> dict:
    """
    Google OAuth 동의 화면 URL 반환
    프론트에서 이 URL로 redirect하면 구글 로그인 → 콜백으로 돌아옴
    """
    try:
        state = secrets.token_urlsafe(32)
        _oauth_states[state] = current_user.id
        url = build_authorization_url(state)
        return {"auth_url": url, "state": state}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/auth/callback")
async def auth_callback(
    code: str,
    state: str,
    background_tasks: BackgroundTasks,
    db: DB,
):
    """
    Google OAuth 콜백 — 코드 교환 → 토큰 저장 → Full Sync → Push Channel 등록
    구글이 GOOGLE_REDIRECT_URI로 redirect 시 호출됨 (인증 불필요)
    """
    user_id = _oauth_states.pop(state, None)
    if user_id is None:
        raise HTTPException(400, "Invalid or expired OAuth state. Please try connecting again.")

    # 코드 → 토큰 교환
    try:
        tokens = exchange_code_for_tokens(code)
    except Exception as e:
        logger.error(f"Token exchange failed: {e}")
        raise HTTPException(400, f"Token exchange failed: {e}")

    # 이메일 조회
    email = get_google_email(tokens["access_token"])

    # 토큰 암호화 저장 (upsert)
    result = await db.execute(
        select(CalendarToken).where(CalendarToken.user_id == user_id)
    )
    token_row = result.scalar_one_or_none()

    encrypted_at = encrypt_token(tokens["access_token"])
    encrypted_rt = encrypt_token(tokens["refresh_token"]) if tokens.get("refresh_token") else None

    if token_row:
        token_row.encrypted_access_token = encrypted_at
        if encrypted_rt:
            token_row.encrypted_refresh_token = encrypted_rt
        token_row.token_expiry = tokens.get("expiry")
        token_row.google_email = email
        token_row.sync_token = None  # 재연결 시 full sync
    else:
        token_row = CalendarToken(
            user_id=user_id,
            google_email=email,
            encrypted_access_token=encrypted_at,
            encrypted_refresh_token=encrypted_rt,
            token_expiry=tokens.get("expiry"),
            calendar_id="primary",
        )
        db.add(token_row)

    await db.commit()
    logger.info(f"Google Calendar connected for user {user_id} ({email})")

    # Full Sync + Push Channel 등록을 BackgroundTasks로 처리
    background_tasks.add_task(_post_connect_setup, user_id)

    # 프론트엔드로 리다이렉트 (연결 성공 페이지)
    from fastapi.responses import RedirectResponse
    frontend_url = os.getenv("FRONTEND_URL", "")
    redirect_to = f"{frontend_url}/settings?calendar=connected" if frontend_url else "/settings?calendar=connected"
    return RedirectResponse(url=redirect_to)


async def _post_connect_setup(user_id: int) -> None:
    """OAuth 콜백 후 백그라운드: Full Sync + Push 채널 등록"""
    from models.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        try:
            count = await full_sync(user_id, db)
            logger.info(f"Post-connect full sync: {count} events for user {user_id}")
        except Exception as e:
            logger.error(f"Post-connect full sync failed for user {user_id}: {e}")

        try:
            await register_push_channel(user_id, db)
        except Exception as e:
            logger.error(f"Post-connect push channel failed for user {user_id}: {e}")


@router.delete("/auth/disconnect")
async def auth_disconnect(current_user: CurrentUser, db: DB) -> dict:
    """Google Calendar 연결 해제 — 토큰 + 이벤트 + 채널 삭제"""
    uid = current_user.id

    # Push 채널 중단
    try:
        await stop_push_channel(uid, db)
    except Exception:
        pass

    # DB 데이터 삭제
    await db.execute(delete(CalendarEvent).where(CalendarEvent.user_id == uid))
    await db.execute(delete(CalendarWatchChannel).where(CalendarWatchChannel.user_id == uid))
    await db.execute(delete(CalendarToken).where(CalendarToken.user_id == uid))
    await db.commit()

    return {"message": "Google Calendar disconnected."}


# ── Webhook (Push Notification) ────────────────────────────────────────────────

@router.post("/webhook")
async def calendar_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    x_goog_channel_id: Optional[str] = Header(None),
    x_goog_resource_id: Optional[str] = Header(None),
    x_goog_resource_state: Optional[str] = Header(None),
    x_goog_channel_token: Optional[str] = Header(None),
) -> Response:
    """
    Google Calendar Push Notification 수신 엔드포인트
    - 구글이 이벤트 변경 시 즉시 POST 전송 (인증 없이 공개 접근)
    - X-Goog-Resource-State: sync (채널 등록 확인) | exists (변경 알림)
    - 200 응답 필수 (미응답 시 구글이 재전송 후 채널 비활성화)
    """
    if x_goog_resource_state == "sync":
        # 채널 등록 확인 메시지 — 아무것도 안 해도 됨
        logger.debug(f"Push channel sync confirmed: {x_goog_channel_id}")
        return Response(status_code=200)

    if x_goog_resource_state not in ("exists", "not_exists", "deleted"):
        return Response(status_code=200)

    if not x_goog_channel_id:
        return Response(status_code=200)

    # 어떤 유저의 채널인지 조회 + webhook_token 검증
    async def _process():
        from models.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(CalendarWatchChannel).where(
                    CalendarWatchChannel.channel_id == x_goog_channel_id,
                    CalendarWatchChannel.active == True,
                )
            )
            channel = result.scalar_one_or_none()
            if not channel:
                logger.warning(f"Unknown push channel: {x_goog_channel_id}")
                return

            # webhook_token 검증 — DB에 토큰 있으면 반드시 일치해야 처리
            if channel.webhook_token and x_goog_channel_token != channel.webhook_token:
                logger.warning(
                    f"Webhook token mismatch for channel {x_goog_channel_id} "
                    f"(user={channel.user_id}) — 위조 요청 차단"
                )
                return

            logger.info(
                f"Push notification received: user={channel.user_id}, "
                f"state={x_goog_resource_state}, channel={x_goog_channel_id}"
            )

            try:
                # 모든 캘린더 증분 동기화 — Google이 어느 채널로 알림을 보내든 전체 확인
                changed = await incremental_sync_all(channel.user_id, db)
                logger.info(f"Push-triggered incremental sync: {changed} changes for user {channel.user_id}")

                # 변경이 있을 때만 SSE로 프론트엔드에 즉시 알림
                if changed > 0:
                    sent = await sse_broker.publish(
                        channel.user_id,
                        "calendar_updated",
                        {
                            "changed": changed,
                            "ts": datetime.utcnow().isoformat(),
                            "source": "push",
                        },
                    )
                    logger.info(f"SSE calendar_updated sent to {sent} client(s) for user {channel.user_id}")
            except Exception as e:
                logger.error(f"Push-triggered sync failed for user {channel.user_id}: {e}")

    background_tasks.add_task(_process)
    return Response(status_code=200)


# ── Status & Sync ──────────────────────────────────────────────────────────────

@router.get("/status")
async def calendar_status(current_user: CurrentUser, db: DB) -> dict:
    """연결 상태, Push 채널 정보, 캐시된 이벤트 수"""
    from services.calendar_service import get_valid_credentials
    status = await get_connection_status(current_user.id, db)
    if status.get("connected"):
        try:
            await get_valid_credentials(current_user.id, db)
            status["needs_reconnect"] = False
        except ValueError as e:
            if "NEED_RECONNECT" in str(e):
                status["needs_reconnect"] = True
            else:
                status["needs_reconnect"] = False
        except Exception:
            status["needs_reconnect"] = False
    return status


@router.post("/sync")
async def manual_sync(current_user: CurrentUser, db: DB) -> dict:
    """수동 동기화 (전체 재수집)"""
    try:
        count = await full_sync(current_user.id, db)
    except ValueError as e:
        if "NEED_RECONNECT" in str(e):
            raise HTTPException(403, "Google 토큰이 만료되었습니다. Google Calendar를 다시 연결해주세요.")
        raise HTTPException(400, str(e))
    if count > 0:
        await sse_broker.publish(
            current_user.id,
            "calendar_updated",
            {"changed": count, "ts": datetime.utcnow().isoformat(), "source": "manual"},
        )
    return {"synced": count, "message": f"{count}개 이벤트 동기화 완료"}


@router.post("/watch/register")
async def register_watch(current_user: CurrentUser, db: DB) -> dict:
    """Push Notification 채널 수동 등록/갱신"""
    channel = await register_push_channel(current_user.id, db)
    if not channel:
        return {
            "push_enabled": False,
            "message": "GOOGLE_WEBHOOK_BASE_URL이 설정되지 않아 Push 알림을 사용할 수 없습니다. "
                       "30분마다 폴링으로 대체됩니다.",
        }
    return {
        "push_enabled": True,
        "message": f"Push 알림 채널 {channel['registered']}개가 등록되었습니다.",
    }


# ── 캘린더 목록 ────────────────────────────────────────────────────────────────

@router.get("/calendars")
async def get_calendars(current_user: CurrentUser, db: DB) -> list[dict]:
    """사용자의 Google 캘린더 목록 반환 (API 갱신 후 캐시)"""
    try:
        return await list_user_calendars(current_user.id, db)
    except ValueError as e:
        if "NEED_RECONNECT" in str(e):
            raise HTTPException(403, "Google 토큰이 만료되었습니다. Google Calendar를 다시 연결해주세요.")
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.error(f"get_calendars error: {e}")
        raise HTTPException(500, "캘린더 목록 조회에 실패했습니다.")


# ── 이벤트 조회 ────────────────────────────────────────────────────────────────

# ── SSE 스트림 ──────────────────────────────────────────────────────────────────

@router.get("/stream")
async def calendar_stream(token: str = Query(...)) -> StreamingResponse:
    """SSE 스트림 — EventSource는 커스텀 헤더 불가 → ?token= query param 인증"""
    from routers.auth import get_current_user as _get_user

    try:
        user = await _get_user(token)
        uid = user.id
    except Exception:
        from fastapi.responses import Response as _R
        return _R(status_code=401)

    async def event_generator():
        async for chunk in sse_broker.subscribe(uid):
            yield chunk

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


class CalendarEventResponse(BaseModel):
    id: int
    google_event_id: str
    calendar_id: Optional[str] = None
    summary: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    start_dt: Optional[str] = None   # ISO 8601 UTC
    end_dt: Optional[str] = None
    all_day: bool
    status: Optional[str] = None
    html_link: Optional[str] = None
    color_id: Optional[str] = None
    recurrence: Optional[list] = None


def _event_to_response(ev: CalendarEvent) -> CalendarEventResponse:
    recurrence = None
    if ev.recurrence:
        try:
            recurrence = json.loads(ev.recurrence)
        except Exception:
            pass
    return CalendarEventResponse(
        id=ev.id,
        google_event_id=ev.google_event_id,
        calendar_id=ev.calendar_id,
        summary=ev.summary,
        description=ev.description,
        location=ev.location,
        start_dt=ev.start_dt.isoformat() if ev.start_dt else None,
        end_dt=ev.end_dt.isoformat() if ev.end_dt else None,
        all_day=bool(ev.all_day),
        status=ev.status,
        html_link=ev.html_link,
        color_id=ev.color_id,
        recurrence=recurrence,
    )


@router.get("/events", response_model=list[CalendarEventResponse])
async def list_events(
    current_user: CurrentUser,
    db: DB,
    from_date: Optional[str] = Query(None, description="시작일 YYYY-MM-DD"),
    to_date: Optional[str] = Query(None, description="종료일 YYYY-MM-DD"),
    days: Optional[int] = Query(None, description="오늘부터 N일 (from_date 미설정 시)"),
) -> list[CalendarEventResponse]:
    """캐시된 캘린더 이벤트 목록"""
    now = datetime.utcnow()

    if from_date:
        from_dt = datetime.strptime(from_date, "%Y-%m-%d")
    elif days is not None:
        from_dt = now
    else:
        from_dt = now  # 기본: 오늘부터

    if to_date:
        to_dt = datetime.strptime(to_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
    elif days is not None:
        to_dt = now + timedelta(days=days)
    else:
        to_dt = now + timedelta(days=30)  # 기본: 30일

    events = await get_events(current_user.id, db, from_dt=from_dt, to_dt=to_dt)
    return [_event_to_response(ev) for ev in events]


@router.get("/events/upcoming", response_model=list[CalendarEventResponse])
async def upcoming_events(
    current_user: CurrentUser,
    db: DB,
    limit: int = Query(10, ge=1, le=50),
) -> list[CalendarEventResponse]:
    """오늘 이후 가장 가까운 이벤트 N개"""
    events = await get_events(
        current_user.id, db,
        from_dt=datetime.utcnow(),
        to_dt=datetime.utcnow() + timedelta(days=90),
    )
    return [_event_to_response(ev) for ev in events[:limit]]


# ── 이벤트 CRUD ────────────────────────────────────────────────────────────────

class EventCreateRequest(BaseModel):
    summary: str
    description: Optional[str] = None
    location: Optional[str] = None
    start: str          # ISO 8601 (date or dateTime)
    end: str            # ISO 8601 (date or dateTime)
    all_day: bool = False
    color_id: Optional[str] = None
    calendar_id: Optional[str] = None      # 대상 캘린더 ID (없으면 primary)
    reminders: Optional[list[int]] = None  # 팝업 알림 분 목록 (예: [10, 30])
    status: Optional[str] = None           # confirmed | tentative


class EventUpdateRequest(BaseModel):
    summary: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    start: Optional[str] = None
    end: Optional[str] = None
    all_day: Optional[bool] = None
    color_id: Optional[str] = None
    reminders: Optional[list[int]] = None
    status: Optional[str] = None


def _build_google_event(req: EventCreateRequest) -> dict:
    from datetime import datetime as _dt, timedelta as _td
    if req.all_day:
        start_date = req.start[:10]
        end_date = req.end[:10] if req.end else start_date
        # Google Calendar 종일 이벤트: end는 exclusive → 프론트에서 전달한 마지막 표시일에 +1
        end_date = (_dt.strptime(end_date, "%Y-%m-%d") + _td(days=1)).strftime("%Y-%m-%d")
        body: dict = {
            "summary": req.summary,
            "start": {"date": start_date},
            "end":   {"date": end_date},
        }
    else:
        body = {
            "summary": req.summary,
            "start": {"dateTime": req.start, "timeZone": "Asia/Seoul"},
            "end":   {"dateTime": req.end,   "timeZone": "Asia/Seoul"},
        }
    if req.description is not None:
        body["description"] = req.description
    if req.location is not None:
        body["location"] = req.location
    if req.color_id:
        body["colorId"] = req.color_id
    if req.status:
        body["status"] = req.status
    if req.reminders is not None:
        body["reminders"] = {
            "useDefault": False,
            "overrides": [{"method": "popup", "minutes": m} for m in req.reminders],
        }
    return body


@router.post("/events", response_model=dict)
async def create_calendar_event(
    req: EventCreateRequest,
    current_user: CurrentUser,
    db: DB,
) -> dict:
    """Google Calendar에 새 이벤트 등록"""
    try:
        body = _build_google_event(req)
        result = await create_event(
            current_user.id, db, body,
            target_calendar_id=req.calendar_id or "primary",
        )
        return {"google_event_id": result.get("id"), "html_link": result.get("htmlLink")}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.error(f"create_calendar_event error: {e}")
        raise HTTPException(500, "이벤트 등록에 실패했습니다.")


@router.patch("/events/{google_event_id}", response_model=dict)
async def update_calendar_event(
    google_event_id: str,
    req: EventUpdateRequest,
    current_user: CurrentUser,
    db: DB,
) -> dict:
    """Google Calendar 이벤트 수정"""
    from datetime import datetime as _dt, timedelta as _td
    body: dict = {}
    if req.summary is not None:
        body["summary"] = req.summary
    if req.description is not None:
        body["description"] = req.description
    if req.location is not None:
        body["location"] = req.location
    if req.color_id is not None:
        body["colorId"] = req.color_id
    if req.status is not None:
        body["status"] = req.status
    if req.reminders is not None:
        body["reminders"] = {
            "useDefault": False,
            "overrides": [{"method": "popup", "minutes": m} for m in req.reminders],
        }
    if req.start is not None:
        if req.all_day:
            start_date = req.start[:10]
            end_date = req.end[:10] if req.end else start_date
            # Google Calendar 종일 이벤트: end는 exclusive → +1일
            end_date = (_dt.strptime(end_date, "%Y-%m-%d") + _td(days=1)).strftime("%Y-%m-%d")
            body["start"] = {"date": start_date}
            body["end"] = {"date": end_date}
        else:
            body["start"] = {"dateTime": req.start, "timeZone": "Asia/Seoul"}
            if req.end is not None:
                body["end"] = {"dateTime": req.end, "timeZone": "Asia/Seoul"}
    elif req.end is not None and not req.all_day:
        body["end"] = {"dateTime": req.end, "timeZone": "Asia/Seoul"}
    try:
        result = await update_event(current_user.id, db, google_event_id, body)
        return {"google_event_id": result.get("id"), "updated": True}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.error(f"update_calendar_event error: {e}")
        raise HTTPException(500, "이벤트 수정에 실패했습니다.")


@router.delete("/events/{google_event_id}", response_model=dict)
async def delete_calendar_event(
    google_event_id: str,
    current_user: CurrentUser,
    db: DB,
) -> dict:
    """Google Calendar 이벤트 삭제"""
    try:
        await delete_event(current_user.id, db, google_event_id)
        return {"deleted": True}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.error(f"delete_calendar_event error: {e}")
        raise HTTPException(500, "이벤트 삭제에 실패했습니다.")
