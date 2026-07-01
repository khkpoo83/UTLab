"""이벤트 파싱 및 DB Upsert 헬퍼"""
import json
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import CalendarEvent

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
        from datetime import date  # noqa: F401  (pre-existing unused import, preserved verbatim)
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


# ── 반복 마스터 ID 추출 ────────────────────────────────────────────────────────

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
