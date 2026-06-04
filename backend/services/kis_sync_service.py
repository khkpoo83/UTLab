"""
KIS 보유종목 → Portfolio DB 동기화 + PortfolioSnapshot 저장

흐름:
  1. KIS API에서 전체 계좌 잔고 조회 (캐시 무효화 후 최신)
  2. KIS 계좌별 Account DB 레코드 생성/매핑
  3. 이전 보유와 비교해 매도/신규 감지 → InvestmentEvent 자동 기록
  4. 기존 source='kiwoom' Portfolio 전부 삭제 후 재삽입
  5. KIS eval 금액으로 당일 PortfolioSnapshot 저장 (실현 손익 포함)
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

import pytz
from sqlalchemy import delete, select

from models.database import Account, Portfolio, PortfolioSnapshot, InvestmentEvent, AsyncSessionLocal

logger = logging.getLogger(__name__)
KST = pytz.timezone("Asia/Seoul")

_ACCOUNT_COLORS = {
    "GENERAL":     "#3B82F6",
    "ISA":         "#10B981",
    "PENSION":     "#F59E0B",
    "IRP_PERSONAL": "#8B5CF6",
    "IRP_COMPANY": "#EC4899",
}


async def sync_kis_to_portfolio() -> dict:
    """KIS API 데이터를 Portfolio DB에 동기화하고 스냅샷을 저장한다."""
    try:
        from services.kis_service import get_kis_service
        svc = get_kis_service()
    except RuntimeError:
        return {"status": "skip", "reason": "KIS 서비스 미설정"}

    svc.invalidate_cache()
    balances = await svc.get_all_accounts_balance()
    valid = [b for b in balances if "error" not in b]

    if not valid:
        return {"status": "skip", "reason": "유효한 계좌 없음"}

    today_str = datetime.now(KST).strftime("%Y-%m-%d")

    async with AsyncSessionLocal() as session:
        # ── 1. KIS 계좌 → Account 매핑 (없으면 생성) ────────────────────────
        account_id_map: dict[str, int] = {}
        for b in valid:
            alias    = b["alias"]
            acc_no   = b["account_no"]
            acc_type = b["account_type"]

            result = await session.execute(select(Account).where(Account.name == alias))
            acct = result.scalar_one_or_none()
            if not acct:
                color = _ACCOUNT_COLORS.get(acc_type, "#6B7280")
                acct = Account(name=alias, color=color)
                session.add(acct)
                await session.flush()
            account_id_map[acc_no] = acct.id

        # ── 2. 이전 보유 스냅샷 저장 (매도 감지용) ──────────────────────────
        old_rows = (await session.execute(
            select(Portfolio).where(Portfolio.source == "kiwoom")
        )).scalars().all()
        # (account_no, ticker) → {avg_price, quantity, name}
        old_map: dict[tuple[str, str], dict] = {
            (r.account_no or "", r.ticker): {"avg_price": r.avg_price, "quantity": r.quantity, "name": r.name}
            for r in old_rows
        }

        # ── 3. 새 보유 맵 구성 ───────────────────────────────────────────────
        new_map: dict[tuple[str, str], dict] = {}
        for b in valid:
            acc_no = b["account_no"]
            for h in b.get("holdings", []):
                key = (acc_no, h["ticker"])
                new_map[key] = {
                    "avg_price":    h["avg_price"],
                    "quantity":     h["quantity"],
                    "name":         h["name"],
                    "current_price": h.get("current_price") or h["avg_price"],
                }

        # ── 4. 매도 감지 → InvestmentEvent 자동 기록 ────────────────────────
        sell_events_added = 0
        for (acc_no, ticker), old in old_map.items():
            new = new_map.get((acc_no, ticker))
            old_qty = old["quantity"] or 0
            new_qty = (new["quantity"] or 0) if new else 0
            sold_qty = old_qty - new_qty

            if sold_qty <= 0:
                continue  # 변동 없거나 추가 매수

            # 오늘 이미 기록된 매도 이벤트가 있으면 중복 방지
            dup = (await session.execute(
                select(InvestmentEvent).where(
                    InvestmentEvent.event_type == "sell",
                    InvestmentEvent.event_date == today_str,
                    InvestmentEvent.ticker == ticker,
                )
            )).scalar_one_or_none()
            if dup:
                continue

            avg = old["avg_price"] or 0
            # 매도 시점 현재가: 신규 보유에 있으면 그 현재가, 전량 매도면 직전 avg로 근사
            sell_price = new["current_price"] if new else avg
            pnl = (sell_price - avg) * sold_qty
            pnl_pct = ((sell_price - avg) / avg * 100) if avg > 0 else 0.0

            session.add(InvestmentEvent(
                event_type = "sell",
                event_date = today_str,
                ticker     = ticker,
                name       = old["name"],
                price      = round(sell_price, 0),
                quantity   = sold_qty,
                amount     = round(sell_price * sold_qty, 0),
                pnl        = round(pnl, 0),
                pnl_pct    = round(pnl_pct, 2),
                account_no = acc_no,
                note       = "KIS 자동감지",
            ))
            sell_events_added += 1

        await session.flush()

        # ── 5. 기존 KIS 종목 전부 삭제 후 재삽입 ────────────────────────────
        await session.execute(delete(Portfolio).where(Portfolio.source == "kiwoom"))

        total_holdings = 0
        for b in valid:
            acc_no     = b["account_no"]
            account_id = account_id_map.get(acc_no)
            for h in b.get("holdings", []):
                session.add(Portfolio(
                    ticker      = h["ticker"],
                    name        = h["name"],
                    exchange    = "KRX",
                    avg_price   = h["avg_price"],
                    quantity    = h["quantity"],
                    source      = "kiwoom",
                    account_no  = acc_no,
                    account_id  = account_id,
                    external_id = f"{acc_no}_{h['ticker']}",
                ))
                total_holdings += 1

        # ── 6. 누적 실현 손익 조회 (TOTAL + 계좌별) ─────────────────────────
        sell_rows_all = (await session.execute(
            select(InvestmentEvent.pnl, InvestmentEvent.account_no).where(
                InvestmentEvent.event_type == "sell",
                InvestmentEvent.pnl.isnot(None),
                InvestmentEvent.event_date <= today_str,
            )
        )).all()
        realized_pnl_total = sum(r[0] for r in sell_rows_all if r[0] is not None)
        # 계좌별 실현손익 (account_no 있는 이벤트만, NULL은 TOTAL에만 반영)
        realized_pnl_by_acc: dict[str, float] = {}
        for pnl_val, acc in sell_rows_all:
            if acc and pnl_val is not None:
                realized_pnl_by_acc[acc] = realized_pnl_by_acc.get(acc, 0.0) + pnl_val

        # ── 7. PortfolioSnapshot 저장 ────────────────────────────────────────
        total_eval     = sum(b.get("total_eval_amount", 0) for b in valid)
        total_purchase = sum(b.get("total_purchase_amount", 0) for b in valid)
        total_cash     = sum(b.get("deposit", 0) for b in valid)

        now_kst = datetime.now(KST)
        snap_dt = now_kst.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)

        async def _upsert_snapshot(
            acct_no: str, eval_amt: float, purchase_amt: float,
            cash_amt: float = 0.0, r_pnl: float = 0.0,
        ) -> None:
            if purchase_amt <= 0 or eval_amt <= 0:
                return
            p  = eval_amt - purchase_amt
            pp = p / purchase_amt * 100
            ex = await session.execute(
                select(PortfolioSnapshot).where(
                    PortfolioSnapshot.date       == snap_dt,
                    PortfolioSnapshot.account_no == acct_no,
                )
            )
            r = ex.scalar_one_or_none()
            if r:
                r.total_value  = round(eval_amt, 0)
                r.total_cost   = round(purchase_amt, 0)
                r.pnl          = round(p, 0)
                r.pnl_pct      = round(pp, 4)
                r.realized_pnl = round(r_pnl, 0)
                r.cash_balance = round(cash_amt, 0)
            else:
                session.add(PortfolioSnapshot(
                    date          = snap_dt,
                    account_no    = acct_no,
                    total_value   = round(eval_amt, 0),
                    total_cost    = round(purchase_amt, 0),
                    pnl           = round(p, 0),
                    pnl_pct       = round(pp, 4),
                    realized_pnl  = round(r_pnl, 0),
                    cash_balance  = round(cash_amt, 0),
                ))

        await _upsert_snapshot('TOTAL', total_eval, total_purchase, total_cash, realized_pnl_total)
        for b in valid:
            acc_no = b["account_no"]
            await _upsert_snapshot(
                acc_no,
                b.get("total_eval_amount", 0),
                b.get("total_purchase_amount", 0),
                b.get("deposit", 0),
                realized_pnl_by_acc.get(acc_no, 0.0),
            )

        await session.commit()

    logger.info(
        f"KIS sync 완료: {len(valid)}개 계좌, {total_holdings}개 종목, "
        f"평가 {total_eval:,.0f}원, 매도감지 {sell_events_added}건"
    )

    # 입출금 내역 자동 동기화 (실패해도 전체 sync는 성공으로 처리)
    deposit_synced: dict[str, int] = {}
    try:
        from services.deposit_service import sync_all_deposit_history
        deposit_synced = await sync_all_deposit_history()
        logger.info(f"입출금 sync 완료: {deposit_synced}")
    except Exception as e:
        logger.warning(f"입출금 sync 실패 (무시): {e}")

    return {
        "status": "ok",
        "accounts": len(valid),
        "holdings": total_holdings,
        "sells_detected": sell_events_added,
        "deposit_synced": deposit_synced,
    }
