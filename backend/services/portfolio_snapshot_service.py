"""
포트폴리오 일별 스냅샷 서비스.
- 매일 장 마감 후 총 평가액/수익률을 DB에 저장
- 과거 StockPrice 데이터로 백필 가능
- /api/portfolio/history 에서 조회
"""
import asyncio
import logging
from datetime import datetime, date, timedelta
from typing import Optional

import pytz
from sqlalchemy import select, delete, func

from models.database import Portfolio, PortfolioSnapshot, StockPrice, InvestmentEvent, AsyncSessionLocal

logger = logging.getLogger(__name__)
KST = pytz.timezone("Asia/Seoul")


async def save_snapshot(snapshot_date: Optional[datetime] = None, account_no: str = 'TOTAL') -> bool:
    """현재 포트폴리오 가격으로 스냅샷 저장.
    snapshot_date: None이면 오늘 KST 날짜 사용.
    account_no: 'TOTAL'=전체 합산, KIS계좌번호=계좌별
    반환: True=저장, False=데이터 없음
    """
    from services.stock_service import _fetch_price_detail_sync

    if snapshot_date is None:
        now_kst = datetime.now(KST)
        snapshot_date = now_kst.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)

    async with AsyncSessionLocal() as session:
        if account_no != 'TOTAL':
            stmt = select(Portfolio).where(Portfolio.account_no == account_no)
        else:
            stmt = select(Portfolio)
        result = await session.execute(stmt)
        holdings = result.scalars().all()

    if not holdings:
        return False

    loop = asyncio.get_event_loop()
    price_results = await asyncio.gather(
        *[loop.run_in_executor(None, _fetch_price_detail_sync, h.ticker) for h in holdings],
        return_exceptions=True,
    )

    total_value = 0.0
    total_cost = 0.0
    any_price = False

    for holding, price_info in zip(holdings, price_results):
        cost = holding.avg_price * holding.quantity
        total_cost += cost
        if isinstance(price_info, dict) and price_info and price_info.get("price"):
            cv = price_info["price"] * holding.quantity
            total_value += cv
            any_price = True
        else:
            total_value += cost  # 가격 없으면 매수금액으로 대체

    if not any_price or total_cost == 0:
        return False

    pnl = total_value - total_cost
    pnl_pct = pnl / total_cost * 100

    # 누적 실현 손익: 스냅샷 날짜까지의 모든 매도 이벤트 pnl 합산
    snap_date_str = snapshot_date.strftime("%Y-%m-%d")
    async with AsyncSessionLocal() as session:
        sell_rows = await session.execute(
            select(InvestmentEvent.pnl).where(
                InvestmentEvent.event_type == "sell",
                InvestmentEvent.pnl.isnot(None),
                InvestmentEvent.event_date <= snap_date_str,
            )
        )
        realized_pnl = sum(r[0] for r in sell_rows if r[0] is not None)

    async with AsyncSessionLocal() as session:
        # 같은 날짜+계좌 스냅샷이 있으면 덮어쓰기
        existing = await session.execute(
            select(PortfolioSnapshot).where(
                PortfolioSnapshot.date == snapshot_date,
                PortfolioSnapshot.account_no == account_no,
            )
        )
        row = existing.scalar_one_or_none()
        if row:
            row.total_value = round(total_value, 0)
            row.total_cost = round(total_cost, 0)
            row.pnl = round(pnl, 0)
            row.pnl_pct = round(pnl_pct, 4)
            row.realized_pnl = round(realized_pnl, 0)
        else:
            session.add(PortfolioSnapshot(
                date=snapshot_date,
                account_no=account_no,
                total_value=round(total_value, 0),
                total_cost=round(total_cost, 0),
                pnl=round(pnl, 0),
                pnl_pct=round(pnl_pct, 4),
                realized_pnl=round(realized_pnl, 0),
            ))
        await session.commit()

    logger.info(f"Portfolio snapshot saved: {snapshot_date.date()} account={account_no} value={total_value:,.0f} pnl_pct={pnl_pct:.2f}%")
    return True


async def backfill_snapshots(days: int = 180) -> int:
    """StockPrice DB에서 과거 데이터를 이용해 스냅샷 백필.
    이미 스냅샷이 있는 날짜는 건너뜀.
    반환: 저장된 스냅샷 수
    """
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Portfolio))
        holdings = result.scalars().all()

    if not holdings:
        return 0

    # 매도 이벤트 누적 실현 손익 사전 로드 (날짜 오름차순)
    async with AsyncSessionLocal() as session:
        sell_events = (await session.execute(
            select(InvestmentEvent.event_date, InvestmentEvent.pnl)
            .where(InvestmentEvent.event_type == "sell", InvestmentEvent.pnl.isnot(None))
            .order_by(InvestmentEvent.event_date)
        )).all()
    # date → cumulative realized pnl 매핑
    _cum_realized: dict[str, float] = {}
    _running = 0.0
    for ev_date, ev_pnl in sell_events:
        _running += ev_pnl or 0.0
        _cum_realized[ev_date] = _running
    _sell_dates_sorted = sorted(_cum_realized.keys())

    def _realized_pnl_at(snap_date_str: str) -> float:
        """snap_date 이하 최신 누적 실현 손익 반환"""
        val = 0.0
        for d in _sell_dates_sorted:
            if d <= snap_date_str:
                val = _cum_realized[d]
            else:
                break
        return val

    # 이미 있는 전체(TOTAL) 스냅샷 날짜 조회
    async with AsyncSessionLocal() as session:
        existing = await session.execute(
            select(PortfolioSnapshot.date).where(PortfolioSnapshot.account_no == 'TOTAL')
        )
        existing_dates = {r[0].date() if hasattr(r[0], 'date') else r[0] for r in existing}

    cutoff = datetime.utcnow() - timedelta(days=days)
    saved = 0

    # 각 보유 종목의 StockPrice 데이터 날짜 수집
    async with AsyncSessionLocal() as session:
        price_rows = await session.execute(
            select(StockPrice)
            .where(StockPrice.date >= cutoff)
            .order_by(StockPrice.date)
        )
        all_prices = price_rows.scalars().all()

    # ticker → date → close 매핑 (yf_ticker 및 6자리 베이스 ticker 모두 저장)
    price_map: dict[str, dict[date, float]] = {}
    for row in all_prices:
        if row.close is None:
            continue
        d = row.date.date() if hasattr(row.date, 'date') else row.date
        price_map.setdefault(row.ticker, {})[d] = row.close
        # KIS 6자리 ticker로도 조회 가능하도록 별칭 추가 (예: 003380.KQ → 003380)
        base = row.ticker.split('.')[0]
        if base != row.ticker:
            price_map.setdefault(base, {})[d] = row.close

    # 가격 데이터가 있는 날짜 수집
    all_dates: set[date] = set()
    for dates in price_map.values():
        all_dates.update(dates.keys())

    all_dates_for_total = sorted(all_dates - existing_dates)  # TOTAL용: 이미 있는 날짜 제외
    all_dates_set = all_dates  # 계좌별 백필용: 전체 날짜 보존

    snapshots_to_add = []
    for snap_date in all_dates_for_total:
        total_value = 0.0
        total_cost = 0.0
        has_any = False

        for h in holdings:
            cost = h.avg_price * h.quantity
            total_cost += cost
            price = price_map.get(h.ticker, {}).get(snap_date)
            if price:
                total_value += price * h.quantity
                has_any = True
            else:
                total_value += cost

        if not has_any or total_cost == 0:
            continue

        pnl = total_value - total_cost
        pnl_pct = pnl / total_cost * 100
        realized = _realized_pnl_at(snap_date.strftime("%Y-%m-%d"))

        snap_dt = datetime.combine(snap_date, datetime.min.time())
        snapshots_to_add.append(PortfolioSnapshot(
            date=snap_dt,
            account_no='TOTAL',
            total_value=round(total_value, 0),
            total_cost=round(total_cost, 0),
            pnl=round(pnl, 0),
            pnl_pct=round(pnl_pct, 4),
            realized_pnl=round(realized, 0),
        ))

    if snapshots_to_add:
        async with AsyncSessionLocal() as session:
            for snap in snapshots_to_add:
                session.add(snap)
            await session.commit()
        saved = len(snapshots_to_add)
        logger.info(f"Portfolio snapshots backfilled: {saved} days (TOTAL)")

    # ── 계좌별 백필 ──────────────────────────────────────────────────────────
    account_nos = list({h.account_no for h in holdings if h.account_no})
    for acc_no in account_nos:
        acc_holdings = [h for h in holdings if h.account_no == acc_no]
        if not acc_holdings:
            continue

        async with AsyncSessionLocal() as session:
            ex = await session.execute(
                select(PortfolioSnapshot.date).where(PortfolioSnapshot.account_no == acc_no)
            )
            existing_acc = {r[0].date() if hasattr(r[0], 'date') else r[0] for r in ex}

        acc_snaps = []
        for snap_date in sorted(all_dates_set - existing_acc):  # all_dates_set = full price date set
            tv, tc, has = 0.0, 0.0, False
            for h in acc_holdings:
                cost = h.avg_price * h.quantity
                tc += cost
                price = price_map.get(h.ticker, {}).get(snap_date)
                if price:
                    tv += price * h.quantity
                    has = True
                else:
                    tv += cost
            if not has or tc == 0:
                continue
            pnl = tv - tc
            realized = _realized_pnl_at(snap_date.strftime("%Y-%m-%d"))
            acc_snaps.append(PortfolioSnapshot(
                date=datetime.combine(snap_date, datetime.min.time()),
                account_no=acc_no,
                total_value=round(tv, 0),
                total_cost=round(tc, 0),
                pnl=round(pnl, 0),
                pnl_pct=round(pnl / tc * 100, 4),
                realized_pnl=round(realized, 0),
            ))

        if acc_snaps:
            async with AsyncSessionLocal() as session:
                for snap in acc_snaps:
                    session.add(snap)
                await session.commit()
            saved += len(acc_snaps)
            logger.info(f"Portfolio snapshots backfilled: {len(acc_snaps)} days (account={acc_no})")

    return saved



async def get_realtime_snapshot(account_no: str = 'TOTAL') -> Optional[dict]:
    """현재 시세로 실시간 포트폴리오 평가액/손익 계산 (오늘 데이터 포인트용)."""
    from services.stock_service import _fetch_price_detail_sync

    async with AsyncSessionLocal() as session:
        if account_no != 'TOTAL':
            stmt = select(Portfolio).where(Portfolio.account_no == account_no)
        else:
            stmt = select(Portfolio)
        result = await session.execute(stmt)
        holdings = result.scalars().all()

    if not holdings:
        return None

    loop = asyncio.get_event_loop()
    price_results = await asyncio.gather(
        *[loop.run_in_executor(None, _fetch_price_detail_sync, h.ticker) for h in holdings],
        return_exceptions=True,
    )

    total_value = 0.0
    total_cost = 0.0
    any_price = False

    for holding, price_info in zip(holdings, price_results):
        cost = holding.avg_price * holding.quantity
        total_cost += cost
        if isinstance(price_info, dict) and price_info and price_info.get("price"):
            total_value += price_info["price"] * holding.quantity
            any_price = True
        else:
            total_value += cost

    if not any_price or total_cost == 0:
        return None

    pnl = total_value - total_cost
    pnl_pct = pnl / total_cost * 100
    today_kst = datetime.now(KST).strftime("%Y-%m-%d")

    # 오늘까지의 누적 실현 손익
    async with AsyncSessionLocal() as session:
        sell_rows = await session.execute(
            select(InvestmentEvent.pnl).where(
                InvestmentEvent.event_type == "sell",
                InvestmentEvent.pnl.isnot(None),
            )
        )
        realized_pnl = sum(r[0] for r in sell_rows if r[0] is not None)

    return {
        "date": today_kst,
        "total_value": round(total_value, 0),
        "total_cost": round(total_cost, 0),
        "pnl": round(pnl, 0),
        "pnl_pct": round(pnl_pct, 4),
        "realized_pnl": round(realized_pnl, 0),
        "realtime": True,
    }


async def get_history(days: int = 90, account_no: str = 'TOTAL') -> list[dict]:
    """포트폴리오 히스토리 조회.
    - 과거 데이터는 DB 스냅샷 사용 (장 마감 기준)
    - 오늘 데이터는 프론트에서 KIS 실시간 데이터로 주입 (realtime API 호출 없음)
    - account_no: 'TOTAL'=전체, KIS계좌번호=계좌별
    """
    cutoff = datetime.utcnow() - timedelta(days=days)
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(PortfolioSnapshot)
            .where(
                PortfolioSnapshot.date >= cutoff,
                PortfolioSnapshot.account_no == account_no,
            )
            .order_by(PortfolioSnapshot.date)
        )
        rows = result.scalars().all()

    today_kst = datetime.now(KST).strftime("%Y-%m-%d")

    history = []
    for row in rows:
        row_date = row.date.strftime("%Y-%m-%d")
        if row_date == today_kst:
            continue  # 오늘은 프론트에서 KIS 데이터로 주입
        cash = row.cash_balance if row.cash_balance is not None else 0.0
        history.append({
            "date": row_date,
            "total_value": row.total_value,
            "total_cost": row.total_cost,
            "pnl": row.pnl,
            "pnl_pct": row.pnl_pct,
            "realized_pnl": row.realized_pnl if row.realized_pnl is not None else 0.0,
            "cash_balance": cash,
            "equity": (row.total_value or 0.0) + cash,
            "unrealized_pnl": (row.total_value or 0.0) - (row.total_cost or 0.0),
        })

    # 누적 순입금 주입
    if history:
        try:
            from services.deposit_service import get_cumulative_deposits
            dates = [h["date"] for h in history]
            cum = await get_cumulative_deposits(account_no, dates)
            for h in history:
                h["net_deposits"] = cum.get(h["date"], 0.0)
        except Exception as e:
            logger.warning(f"net_deposits 계산 실패: {e}")
            for h in history:
                h["net_deposits"] = 0.0

    return history
