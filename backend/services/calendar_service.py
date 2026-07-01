"""Google Calendar 서비스 파사드 (facade).

기존의 god 모듈을 `services.calendar/` 패키지로 분리했지만,
외부 코드(routers/calendar.py, main.py, services/scheduler.py,
services/mark_sync.py, routers/investment_marks.py 등)의 임포트가
그대로 동작하도록 공개 API를 여기서 재노출한다. 로직은 없다.
"""

from services.calendar.credentials import (
    CHANNEL_TTL_SECONDS,
    get_valid_credentials,
    get_webhook_url,
)
from services.calendar.events_api import (
    create_event,
    delete_event,
    delete_event_scoped,
    get_connection_status,
    get_event_recurrence,
    get_events,
    update_event,
    update_event_scoped,
)
from services.calendar.events_db import (
    _UPSERT_COLS,
    _db_upsert_event,
    _master_id_from_row,
    _parse_event_dt,
    _upsert_event_from_api,
)
from services.calendar.push import (
    _register_lock,
    _watch_calendar,
    register_push_channel,
    renew_expiring_channels,
    restore_push_channels_on_startup,
    stop_push_channel,
)
from services.calendar.recurrence import (
    _apply_until,
    _fmt_until,
    _strip_count_until,
)
from services.calendar.sync import (
    _do_incremental_sync,
    _syncing_cals,
    full_sync,
    get_cached_calendars,
    incremental_sync,
    incremental_sync_all,
    list_user_calendars,
)

__all__ = [
    # credentials
    "CHANNEL_TTL_SECONDS",
    "get_valid_credentials",
    "get_webhook_url",
    # events_db
    "_parse_event_dt",
    "_upsert_event_from_api",
    "_db_upsert_event",
    "_UPSERT_COLS",
    "_master_id_from_row",
    # sync
    "list_user_calendars",
    "get_cached_calendars",
    "full_sync",
    "incremental_sync",
    "incremental_sync_all",
    "_do_incremental_sync",
    "_syncing_cals",
    # push
    "_watch_calendar",
    "_register_lock",
    "register_push_channel",
    "stop_push_channel",
    "renew_expiring_channels",
    "restore_push_channels_on_startup",
    # events_api
    "get_events",
    "get_connection_status",
    "create_event",
    "update_event",
    "delete_event",
    "get_event_recurrence",
    "update_event_scoped",
    "delete_event_scoped",
    # recurrence
    "_fmt_until",
    "_apply_until",
    "_strip_count_until",
]
