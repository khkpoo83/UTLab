"""반복 일정(RRULE) 순수 헬퍼 — 네트워크/DB 의존 없음"""
from datetime import datetime, timedelta
from typing import Optional


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
