"""
KIS 입출금내역 수집 및 누적 순입금 계산 서비스.

흐름:
  1. sync_deposit_history() — kt00015 호출 → deposit_event 테이블에 upsert
  2. get_cumulative_deposits() — 날짜 범위별 누적 순입금 반환 (히스토리 차트용)

앵커 모델:
  - 가장 오래된 deposit_event.date 를 기준 시점(anchor)으로 삼음
  - anchor 이전 포트폴리오 변화는 "원금"으로 간주 (추적 불가)
  - anchor 이후: 누적 순입금 = Σ(deposit_event.amount)
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, delete, text as _text
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import DepositEvent, AsyncSessionLocal

logger = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))

# kt00015 응답 한도: API가 최대 20건/1회 반환 (페이지네이션 키 없음)
# → 30일 단위로 분할 조회하여 데이터 누락 방지
_MAX_DAYS_TOTAL  = 364   # 최초 full-sync 기간
_CHUNK_DAYS      = 30    # 분할 단위
_INCREMENTAL_BUF = 3     # 증분 sync 시 마지막 날짜 앞으로 겹치는 여유일 (당일 누락 방지)


async def sync_deposit_history(account_no: str) -> int:
    """입출금 내역을 증분 수집해 deposit_event에 저장.

    - DB에 기존 데이터가 있으면: 마지막 저장 날짜 - _INCREMENTAL_BUF일부터 오늘까지만 조회 (1~2회 API 호출)
    - 최초 실행(빈 DB): _MAX_DAYS_TOTAL일 치를 30일 단위로 분할 전수 조회

    Returns: 새로 저장된 건수
    """
    from services.kis_service import get_kis_service

    svc = get_kis_service()
    if account_no not in {a["account_no"] for a in svc.get_account_list()}:
        logger.warning(f"deposit sync: 계좌 {account_no} 미등록")
        return 0

    today = datetime.now(KST).date()

    # ── 시작 날짜 결정: 기존 최신 레코드 기준 증분 vs 최초 전수 ──────────────
    async with AsyncSessionLocal() as session:
        latest_q = await session.execute(
            select(DepositEvent.date)
            .where(DepositEvent.account_no == account_no)
            .order_by(DepositEvent.date.desc())
            .limit(1)
        )
        latest_row = latest_q.scalar_one_or_none()

    if latest_row:
        from datetime import date as _date
        latest_date = _date.fromisoformat(latest_row)
        # 마지막 저장일에서 버퍼만큼 앞으로 당겨 당일 미처리 건 재확인
        start = max(latest_date - timedelta(days=_INCREMENTAL_BUF), today - timedelta(days=_MAX_DAYS_TOTAL))
        logger.info(f"deposit sync ({account_no}): 증분 조회 {start} ~ {today}")
    else:
        start = today - timedelta(days=_MAX_DAYS_TOTAL)
        logger.info(f"deposit sync ({account_no}): 최초 전수 조회 {start} ~ {today}")

    # ── API 조회: 30일 단위 분할 (한 번에 최대 20건 제한 우회) ─────────────
    all_api_items: list[dict] = []
    chunk_start = start
    while chunk_start <= today:
        chunk_end = min(chunk_start + timedelta(days=_CHUNK_DAYS - 1), today)
        try:
            chunk_items = await svc.fetch_deposit_history(
                account_no,
                chunk_start.strftime("%Y%m%d"),
                chunk_end.strftime("%Y%m%d"),
            )
            all_api_items.extend(chunk_items)
        except Exception as e:
            logger.warning(f"deposit sync chunk 실패 ({account_no}, {chunk_start}~{chunk_end}): {e}")
        chunk_start = chunk_end + timedelta(days=1)

    # API 결과 내 (date, trde_no) 자체 중복 제거
    seen_api: set[tuple] = set()
    items: list[dict] = []
    for item in all_api_items:
        key = (item["date"], item.get("trde_no") or "")
        if key not in seen_api:
            seen_api.add(key)
            items.append(item)

    if not items:
        return 0

    saved = 0
    async with AsyncSessionLocal() as session:
        # DB에 이미 있는 (date, trde_no) 조회 — 조회 구간만 확인
        existing_q = await session.execute(
            select(DepositEvent.date, DepositEvent.trde_no).where(
                DepositEvent.account_no == account_no,
                DepositEvent.date >= start.strftime("%Y-%m-%d"),
            )
        )
        existing_keys = {(r[0], r[1]) for r in existing_q if r[1]}

        for item in items:
            trde_no = item.get("trde_no") or ""
            if trde_no and (item["date"], trde_no) in existing_keys:
                continue  # 동일 날짜+거래번호 이미 존재
            session.add(DepositEvent(
                account_no=account_no,
                date=item["date"],
                trde_no=trde_no or None,
                amount=item["amount"],
                remark=item.get("remark"),
                balance_after=item.get("balance_after"),
            ))
            saved += 1

        await session.commit()

    logger.info(f"deposit sync ({account_no}): {len(items)}건 조회, {saved}건 신규 저장")
    return saved


async def sync_all_deposit_history() -> dict[str, int]:
    """모든 등록 계좌의 입출금 내역 동기화. sync_all() 에서 호출."""
    from services.kis_service import get_kis_service

    svc = get_kis_service()
    accounts = svc.get_account_list()
    results: dict[str, int] = {}
    for acc in accounts:
        acc_no = acc["account_no"]
        results[acc_no] = await sync_deposit_history(acc_no)
    return results


async def get_cumulative_deposits(
    account_no: str,
    dates: list[str],   # ["YYYY-MM-DD", ...] 오름차순
) -> dict[str, float]:
    """날짜 목록에 대해 누적 순입금(원)을 반환.

    반환: {"YYYY-MM-DD": 누적액, ...}
    - 앵커(첫 번째 deposit_event) 이전 날짜: 0.0 반환
    - 앵커 이후: 해당 날짜까지의 Σ(amount)
    """
    if not dates:
        return {}

    async with AsyncSessionLocal() as session:
        if account_no == "TOTAL":
            q = await session.execute(
                select(DepositEvent.date, DepositEvent.amount)
                .order_by(DepositEvent.date)
            )
        else:
            q = await session.execute(
                select(DepositEvent.date, DepositEvent.amount)
                .where(DepositEvent.account_no == account_no)
                .order_by(DepositEvent.date)
            )
        rows = q.all()

    if not rows:
        return {d: 0.0 for d in dates}

    # 앵커: 가장 오래된 입출금 기록 날짜
    anchor_date = rows[0][0]  # "YYYY-MM-DD"

    # 날짜별 amount 누적합
    cumsum: dict[str, float] = {}
    running = 0.0
    row_idx = 0
    for d in dates:
        if d < anchor_date:
            cumsum[d] = 0.0
            continue
        while row_idx < len(rows) and rows[row_idx][0] <= d:
            running += float(rows[row_idx][1] or 0)
            row_idx += 1
        cumsum[d] = round(running, 0)

    return cumsum
