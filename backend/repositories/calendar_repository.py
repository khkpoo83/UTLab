"""Data-access layer for the calendar router.

``CalendarRepository`` wraps an ``AsyncSession`` and encapsulates every
SQLAlchemy query that ``routers/calendar.py`` previously ran inline.  Query
semantics (filters, ordering) and transaction boundaries (commit) match the
router exactly — this is a behavior-preserving relocation.

Only the router's OWN direct SQLAlchemy access is relocated here; all delegated
``calendar_service`` / ``google_oauth`` / ``sse_broker`` logic stays in the
router untouched.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import CalendarEvent, CalendarToken, CalendarWatchChannel


class CalendarRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_token(self, user_id: int) -> Optional[CalendarToken]:
        """The user's ``CalendarToken`` row, or ``None``.

        Mirrors ``auth_callback``'s upsert lookup.
        """
        result = await self.db.execute(
            select(CalendarToken).where(CalendarToken.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def upsert_token(
        self,
        user_id: int,
        *,
        google_email: Optional[str],
        encrypted_access_token: str,
        encrypted_refresh_token: Optional[str],
        token_expiry: Optional[datetime],
    ) -> CalendarToken:
        """Insert-or-update the user's OAuth token, then commit.

        Matches ``auth_callback`` exactly:
        * Existing row: overwrite access token; overwrite refresh token ONLY
          when a new one is provided; set expiry/email; reset ``sync_token`` to
          ``None`` (force full sync on reconnect).
        * New row: create with ``calendar_id="primary"`` and the given fields.
        """
        result = await self.db.execute(
            select(CalendarToken).where(CalendarToken.user_id == user_id)
        )
        token_row = result.scalar_one_or_none()

        if token_row:
            token_row.encrypted_access_token = encrypted_access_token
            if encrypted_refresh_token:
                token_row.encrypted_refresh_token = encrypted_refresh_token
            token_row.token_expiry = token_expiry
            token_row.google_email = google_email
            token_row.sync_token = None  # 재연결 시 full sync
        else:
            token_row = CalendarToken(
                user_id=user_id,
                google_email=google_email,
                encrypted_access_token=encrypted_access_token,
                encrypted_refresh_token=encrypted_refresh_token,
                token_expiry=token_expiry,
                calendar_id="primary",
            )
            self.db.add(token_row)

        await self.db.commit()
        return token_row

    async def delete_all_user_data(self, user_id: int) -> None:
        """DESTRUCTIVE: delete all calendar data for a user in one transaction.

        Mirrors ``auth_disconnect``: delete the user's ``CalendarEvent`` rows,
        ``CalendarWatchChannel`` rows, and ``CalendarToken`` row, then a single
        commit.  Scoped strictly by ``user_id`` — other users' rows untouched.
        """
        await self.db.execute(
            delete(CalendarEvent).where(CalendarEvent.user_id == user_id)
        )
        await self.db.execute(
            delete(CalendarWatchChannel).where(CalendarWatchChannel.user_id == user_id)
        )
        await self.db.execute(
            delete(CalendarToken).where(CalendarToken.user_id == user_id)
        )
        await self.db.commit()

    async def get_active_watch_channel(
        self, channel_id: str
    ) -> Optional[CalendarWatchChannel]:
        """Active watch channel by ``channel_id``, or ``None``.

        Mirrors ``calendar_webhook._process``'s lookup: match ``channel_id`` and
        ``active == True``.
        """
        result = await self.db.execute(
            select(CalendarWatchChannel).where(
                CalendarWatchChannel.channel_id == channel_id,
                CalendarWatchChannel.active == True,  # noqa: E712
            )
        )
        return result.scalar_one_or_none()
