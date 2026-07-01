"""토큰/자격증명 헬퍼 및 공유 상수"""
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import CalendarToken
from services.google_oauth import (
    build_credentials,
    decrypt_token,
    encrypt_token,
    refresh_access_token,
)

logger = logging.getLogger(__name__)

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


# ── Push Notification Webhook URL ─────────────────────────────────────────────

def get_webhook_url() -> Optional[str]:
    """Push Notification을 받을 공개 HTTPS URL"""
    base = os.getenv("GOOGLE_WEBHOOK_BASE_URL", "").rstrip("/")
    if not base:
        return None
    return f"{base}/api/calendar/webhook"
