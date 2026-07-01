"""services.calendar 패키지의 순수 결정론적 RRULE/날짜 헬퍼 단위 테스트.

네트워크/DB/Google 의존이 전혀 없는 순수 함수만 대상으로 하며,
facade(services.calendar_service) 재노출이 실제 구현을 가리키는지도
겸사겸사 검증한다. 단언값은 실제 구현 동작을 그대로 반영한다.
"""

from datetime import datetime

from services.calendar_service import (
    _apply_until,
    _fmt_until,
    _parse_event_dt,
    _strip_count_until,
)

# ── _fmt_until ────────────────────────────────────────────────────────────

def test_fmt_until_all_day_returns_prev_day_date():
    # 종일 이벤트: 하루 전 날짜(YYYYMMDD)
    assert _fmt_until(datetime(2026, 7, 1, 0, 0, 0), True) == "20260630"


def test_fmt_until_timed_returns_prev_second_utc():
    # 시간 있는 이벤트: 1초 전 (YYYYMMDDTHHMMSSZ)
    assert _fmt_until(datetime(2026, 7, 1, 9, 0, 0), False) == "20260701T085959Z"


def test_fmt_until_timed_rolls_back_across_midnight():
    # 자정 직후는 전날 23:59:59로 롤백
    assert _fmt_until(datetime(2026, 7, 1, 0, 0, 0), False) == "20260630T235959Z"


# ── _apply_until ──────────────────────────────────────────────────────────

def test_apply_until_replaces_count_and_injects_until():
    out = _apply_until(["RRULE:FREQ=WEEKLY;COUNT=5"], "20260701T085959Z")
    assert out == ["RRULE:FREQ=WEEKLY;UNTIL=20260701T085959Z"]


def test_apply_until_replaces_existing_until():
    out = _apply_until(["RRULE:FREQ=DAILY;UNTIL=20260101T000000Z"], "20260701T085959Z")
    assert out == ["RRULE:FREQ=DAILY;UNTIL=20260701T085959Z"]


def test_apply_until_preserves_non_rrule_lines():
    out = _apply_until(
        ["RRULE:FREQ=DAILY", "EXDATE;TZID=Asia/Seoul:20260615T090000"],
        "20260701T085959Z",
    )
    assert out == [
        "RRULE:FREQ=DAILY;UNTIL=20260701T085959Z",
        "EXDATE;TZID=Asia/Seoul:20260615T090000",
    ]


def test_apply_until_no_rrule_appends_default_daily():
    # RRULE 라인이 없으면 기본 FREQ=DAILY 규칙을 새로 추가
    assert _apply_until([], "20260701T085959Z") == ["RRULE:FREQ=DAILY;UNTIL=20260701T085959Z"]


def test_apply_until_none_appends_default_daily():
    assert _apply_until(None, "20260701T085959Z") == ["RRULE:FREQ=DAILY;UNTIL=20260701T085959Z"]


# ── _strip_count_until ────────────────────────────────────────────────────

def test_strip_count_until_removes_count():
    assert _strip_count_until(["RRULE:FREQ=WEEKLY;COUNT=5"]) == ["RRULE:FREQ=WEEKLY"]


def test_strip_count_until_removes_until():
    assert _strip_count_until(["RRULE:FREQ=DAILY;UNTIL=20260101T000000Z"]) == ["RRULE:FREQ=DAILY"]


def test_strip_count_until_removes_both_and_preserves_other_parts():
    out = _strip_count_until(["RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10;UNTIL=20260101T000000Z"])
    assert out == ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"]


def test_strip_count_until_preserves_non_rrule_lines():
    out = _strip_count_until(["RRULE:FREQ=DAILY;COUNT=3", "EXDATE:20260615T090000"])
    assert out == ["RRULE:FREQ=DAILY", "EXDATE:20260615T090000"]


def test_strip_count_until_empty_returns_empty():
    assert _strip_count_until([]) == []


def test_strip_count_until_none_returns_empty():
    assert _strip_count_until(None) == []


# ── _parse_event_dt ───────────────────────────────────────────────────────

def test_parse_event_dt_datetime_with_offset_converts_to_utc_naive():
    # +09:00(KST) 09:00 → UTC 00:00, tzinfo 제거, all_day=False
    dt, all_day = _parse_event_dt({"dateTime": "2026-07-01T09:00:00+09:00"})
    assert dt == datetime(2026, 7, 1, 0, 0, 0)
    assert dt.tzinfo is None
    assert all_day is False


def test_parse_event_dt_datetime_naive_treated_as_utc():
    # tz 없는 dateTime은 UTC로 간주
    dt, all_day = _parse_event_dt({"dateTime": "2026-07-01T09:00:00"})
    assert dt == datetime(2026, 7, 1, 9, 0, 0)
    assert all_day is False


def test_parse_event_dt_date_is_all_day():
    dt, all_day = _parse_event_dt({"date": "2026-07-01"})
    assert dt == datetime(2026, 7, 1, 0, 0, 0)
    assert all_day is True


def test_parse_event_dt_empty_returns_none_false():
    dt, all_day = _parse_event_dt({})
    assert dt is None
    assert all_day is False
