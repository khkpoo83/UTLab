"""Unit tests for CalendarRepository — direct-session round-trips.

These are the PRIMARY guard for the calendar router's inline DB access, since
several of those endpoints (OAuth callback, disconnect cascade-delete, webhook)
are sensitive/destructive and cannot be safely live-tested.

Uses the same file-backed test DB as the rest of the suite via
``AsyncSessionLocal`` and the ``_schema`` fixture (see conftest.py).
"""

from datetime import datetime

import pytest

from models.database import (
    AsyncSessionLocal,
    CalendarEvent,
    CalendarToken,
    CalendarWatchChannel,
)
from repositories.calendar_repository import CalendarRepository


@pytest.mark.asyncio
async def test_get_token_missing_returns_none(_schema):
    async with AsyncSessionLocal() as session:
        repo = CalendarRepository(session)
        assert await repo.get_token(12345) is None


@pytest.mark.asyncio
async def test_upsert_token_insert_then_update_single_row(_schema):
    """Insert then update-existing → exactly one row, fields updated,
    matching auth_callback's upsert semantics."""
    async with AsyncSessionLocal() as session:
        repo = CalendarRepository(session)

        # insert (new row)
        expiry1 = datetime(2026, 1, 1, 0, 0, 0)
        row = await repo.upsert_token(
            42,
            google_email="a@example.com",
            encrypted_access_token="AT1",
            encrypted_refresh_token="RT1",
            token_expiry=expiry1,
        )
        assert row.id is not None
        assert row.calendar_id == "primary"  # default set only on insert
        assert row.encrypted_refresh_token == "RT1"

        fetched = await repo.get_token(42)
        assert fetched is not None
        assert fetched.encrypted_access_token == "AT1"
        assert fetched.google_email == "a@example.com"

        # update existing — new access token + email + expiry; refresh provided
        expiry2 = datetime(2027, 6, 6, 12, 0, 0)
        updated = await repo.upsert_token(
            42,
            google_email="b@example.com",
            encrypted_access_token="AT2",
            encrypted_refresh_token="RT2",
            token_expiry=expiry2,
        )
        assert updated.id == row.id  # same row, not a new insert
        assert updated.encrypted_access_token == "AT2"
        assert updated.encrypted_refresh_token == "RT2"
        assert updated.google_email == "b@example.com"
        assert updated.token_expiry == expiry2
        assert updated.sync_token is None  # reset on reconnect

    # confirm exactly one row persists across a fresh session
    async with AsyncSessionLocal() as session:
        from sqlalchemy import select
        rows = (
            await session.execute(
                select(CalendarToken).where(CalendarToken.user_id == 42)
            )
        ).scalars().all()
        assert len(rows) == 1
        assert rows[0].encrypted_access_token == "AT2"


@pytest.mark.asyncio
async def test_upsert_token_update_without_refresh_keeps_existing(_schema):
    """auth_callback only overwrites the refresh token when a new one is given
    (Google omits refresh_token on re-consent) — must preserve the old one."""
    async with AsyncSessionLocal() as session:
        repo = CalendarRepository(session)
        await repo.upsert_token(
            7,
            google_email="x@example.com",
            encrypted_access_token="AT1",
            encrypted_refresh_token="ORIGINAL_RT",
            token_expiry=None,
        )
        # re-connect without a refresh token
        updated = await repo.upsert_token(
            7,
            google_email="x@example.com",
            encrypted_access_token="AT2",
            encrypted_refresh_token=None,
            token_expiry=None,
        )
        assert updated.encrypted_access_token == "AT2"
        assert updated.encrypted_refresh_token == "ORIGINAL_RT"  # unchanged


@pytest.mark.asyncio
async def test_delete_all_user_data_cascade_scoped_to_user(_schema):
    """DESTRUCTIVE cascade: deleting user X's data removes X's token, events,
    and watch channels, while user Y's rows SURVIVE."""
    from sqlalchemy import select

    X, Y = 100, 200

    async with AsyncSessionLocal() as session:
        # user X: one of each
        session.add(CalendarToken(
            user_id=X, encrypted_access_token="X_AT", calendar_id="primary",
        ))
        session.add(CalendarEvent(
            user_id=X, google_event_id="X_ev1", calendar_id="primary",
        ))
        session.add(CalendarWatchChannel(
            user_id=X, channel_id="X_ch1", calendar_id="primary", active=True,
        ))
        # user Y: one of each — must survive
        session.add(CalendarToken(
            user_id=Y, encrypted_access_token="Y_AT", calendar_id="primary",
        ))
        session.add(CalendarEvent(
            user_id=Y, google_event_id="Y_ev1", calendar_id="primary",
        ))
        session.add(CalendarWatchChannel(
            user_id=Y, channel_id="Y_ch1", calendar_id="primary", active=True,
        ))
        await session.commit()

    # act — destroy only X
    async with AsyncSessionLocal() as session:
        await CalendarRepository(session).delete_all_user_data(X)

    # assert — X gone, Y intact
    async with AsyncSessionLocal() as session:
        async def count(model, uid):
            rows = (
                await session.execute(select(model).where(model.user_id == uid))
            ).scalars().all()
            return len(rows)

        assert await count(CalendarToken, X) == 0
        assert await count(CalendarEvent, X) == 0
        assert await count(CalendarWatchChannel, X) == 0

        assert await count(CalendarToken, Y) == 1
        assert await count(CalendarEvent, Y) == 1
        assert await count(CalendarWatchChannel, Y) == 1


@pytest.mark.asyncio
async def test_get_active_watch_channel_lookup(_schema):
    """Webhook lookup: match by channel_id AND active == True."""
    async with AsyncSessionLocal() as session:
        session.add(CalendarWatchChannel(
            user_id=1, channel_id="active-ch", calendar_id="primary",
            active=True, webhook_token="tok",
        ))
        session.add(CalendarWatchChannel(
            user_id=1, channel_id="inactive-ch", calendar_id="primary",
            active=False,
        ))
        await session.commit()

    async with AsyncSessionLocal() as session:
        repo = CalendarRepository(session)

        found = await repo.get_active_watch_channel("active-ch")
        assert found is not None
        assert found.user_id == 1
        assert found.webhook_token == "tok"

        # inactive channel is not returned
        assert await repo.get_active_watch_channel("inactive-ch") is None

        # unknown channel
        assert await repo.get_active_watch_channel("nope") is None
