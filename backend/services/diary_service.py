"""AI 투자 일기 서비스

- record_event(): 매수/매도/입금/출금 이벤트 기록
- generate_diary_for_date(): Gemini로 하루 일기 생성 + DB 저장
- get_latest_diary(): 최신 일기 조회
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Optional

import pytz
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import (
    AsyncSessionLocal, Portfolio, PortfolioSnapshot,
    InvestmentEvent, InvestmentDiary,
)

logger = logging.getLogger(__name__)
KST = pytz.timezone("Asia/Seoul")


# ── 이벤트 기록 ───────────────────────────────────────────────────────────────

async def record_event(
    event_type: str,          # buy | sell | deposit | withdraw
    amount: float,
    event_date: Optional[str] = None,   # YYYY-MM-DD KST (기본: 오늘)
    ticker: Optional[str] = None,
    name: Optional[str] = None,
    price: Optional[float] = None,
    quantity: Optional[float] = None,
    pnl: Optional[float] = None,
    pnl_pct: Optional[float] = None,
    note: Optional[str] = None,
) -> dict:
    if not event_date:
        event_date = datetime.now(KST).strftime("%Y-%m-%d")

    async with AsyncSessionLocal() as db:
        ev = InvestmentEvent(
            event_type=event_type,
            event_date=event_date,
            ticker=ticker,
            name=name,
            price=price,
            quantity=quantity,
            amount=amount,
            pnl=pnl,
            pnl_pct=pnl_pct,
            note=note,
        )
        db.add(ev)
        await db.commit()
        await db.refresh(ev)
        return {
            "id": ev.id,
            "event_type": ev.event_type,
            "event_date": ev.event_date,
            "ticker": ev.ticker,
            "name": ev.name,
            "amount": ev.amount,
        }


# ── 스냅샷 조회 헬퍼 ──────────────────────────────────────────────────────────

async def _get_snapshot(db: AsyncSession, date_str: str) -> Optional[PortfolioSnapshot]:
    """YYYY-MM-DD KST 날짜에 해당하는 TOTAL 스냅샷 반환"""
    d = datetime.strptime(date_str, "%Y-%m-%d")
    # SQLite에 UTC로 저장된 값이지만 KST 자정~다음날 자정 범위를 UTC로 변환
    start_utc = KST.localize(d.replace(hour=0, minute=0, second=0)).astimezone(pytz.utc).replace(tzinfo=None)
    end_utc   = KST.localize(d.replace(hour=23, minute=59, second=59)).astimezone(pytz.utc).replace(tzinfo=None)

    result = await db.execute(
        select(PortfolioSnapshot).where(
            and_(
                PortfolioSnapshot.date >= start_utc,
                PortfolioSnapshot.date <= end_utc,
                PortfolioSnapshot.account_no == "TOTAL",
            )
        )
    )
    return result.scalar_one_or_none()


async def _prev_trading_snapshot(db: AsyncSession, from_date_str: str) -> Optional[PortfolioSnapshot]:
    """from_date 이전 최대 7일 내 가장 최근 스냅샷 반환 (직전 거래일)"""
    d = datetime.strptime(from_date_str, "%Y-%m-%d")
    for delta in range(1, 8):
        prev = (d - timedelta(days=delta)).strftime("%Y-%m-%d")
        snap = await _get_snapshot(db, prev)
        if snap:
            return snap
    return None


# ── 일기 생성 ─────────────────────────────────────────────────────────────────

def _fmt_krw(v: Optional[float]) -> str:
    if v is None:
        return "알 수 없음"
    if abs(v) >= 1_0000_0000:
        return f"{v/1_0000_0000:+.2f}억원"
    if abs(v) >= 10000:
        return f"{int(v):+,}원"
    return f"{int(v):+}원"


async def generate_diary_for_date(diary_date: Optional[str] = None, overwrite: bool = False) -> Optional[str]:
    """
    diary_date: YYYY-MM-DD KST (기본: 오늘 KST 기준 전날 = 직전 거래일)
    overwrite=True: 기존 일기가 있어도 재생성
    반환: 생성된 일기 텍스트 (실패 시 None)
    """
    if not diary_date:
        # 새벽에 실행되므로 '어제'가 대상
        yesterday = datetime.now(KST) - timedelta(days=1)
        diary_date = yesterday.strftime("%Y-%m-%d")

    async with AsyncSessionLocal() as db:
        # 기존 일기 확인
        existing = (await db.execute(
            select(InvestmentDiary).where(InvestmentDiary.diary_date == diary_date)
        )).scalar_one_or_none()

        if existing and not overwrite:
            return existing.content

        # ── 스냅샷 수집 ──
        today_snap = await _get_snapshot(db, diary_date)
        if not today_snap:
            logger.info(f"No portfolio snapshot for {diary_date}, diary skipped")
            return None

        prev_snap = await _prev_trading_snapshot(db, diary_date)

        # ── 이벤트 수집 ──
        events = (await db.execute(
            select(InvestmentEvent)
            .where(InvestmentEvent.event_date == diary_date)
            .order_by(InvestmentEvent.created_at)
        )).scalars().all()

        buys      = [e for e in events if e.event_type == "buy"]
        sells     = [e for e in events if e.event_type == "sell"]
        deposits  = [e for e in events if e.event_type == "deposit"]
        withdraws = [e for e in events if e.event_type == "withdraw"]

        # ── 실제 투자 손익 계산 (입출금 효과 제거) ──
        deposit_total  = sum(e.amount or 0 for e in deposits)
        withdraw_total = sum(e.amount or 0 for e in withdraws)

        true_daily_pnl: Optional[float] = None
        if prev_snap:
            raw_change = today_snap.total_value - prev_snap.total_value
            true_daily_pnl = raw_change - deposit_total + withdraw_total

        # ── 주요 보유 종목 (상위 5개) ──
        all_holdings = (await db.execute(select(Portfolio))).scalars().all()
        top5 = sorted(
            all_holdings,
            key=lambda h: (h.avg_price or 0) * (h.quantity or 0),
            reverse=True,
        )[:5]

        # ── 프롬프트용 데이터 텍스트 ──
        lines: list[str] = [f"날짜: {diary_date}"]
        lines.append(f"총 평가액: {int(today_snap.total_value):,}원")
        lines.append(f"누적 손익: {_fmt_krw(today_snap.pnl)} ({today_snap.pnl_pct:+.2f}%)")

        if true_daily_pnl is not None:
            direction = "상승" if true_daily_pnl >= 0 else "하락"
            lines.append(f"오늘 평가액 변동(전일 대비, 입출금 제외): {_fmt_krw(true_daily_pnl)} {direction}")

        if deposit_total > 0:
            lines.append(f"오늘 신규 입금: {int(deposit_total):,}원")
        if withdraw_total > 0:
            lines.append(f"오늘 출금: {int(withdraw_total):,}원")

        if buys:
            lines.append("오늘 매수:")
            for e in buys:
                lines.append(
                    f"  - {e.name or e.ticker} {int(e.quantity or 0)}주 "
                    f"@ {int(e.price or 0):,}원 (합계 {int(e.amount or 0):,}원)"
                )
        if sells:
            lines.append("오늘 매도:")
            for e in sells:
                if e.pnl is not None:
                    tag = "이익실현" if e.pnl >= 0 else "손절"
                    pnl_str = f" [{tag} {_fmt_krw(e.pnl)}]"
                else:
                    pnl_str = ""
                lines.append(
                    f"  - {e.name or e.ticker} {int(e.quantity or 0)}주 "
                    f"@ {int(e.price or 0):,}원{pnl_str}"
                )

        if top5:
            lines.append("주요 보유 종목 (평가금액 순):")
            for h in top5:
                val = (h.avg_price or 0) * (h.quantity or 0)
                lines.append(
                    f"  - {h.name}({h.ticker}): {int(h.quantity)}주, "
                    f"평단 {int(h.avg_price):,}원, 평가 {int(val):,}원"
                )

        data_text = "\n".join(lines)

        # ── Gemini 호출 ──
        prompt = f"""당신은 30~40대 개인 투자자의 하루 투자 일기를 대신 써주는 AI입니다.
아래 데이터를 바탕으로, 투자자가 혼자 쓰는 담담한 독백체 일기를 써주세요.

【핵심 원칙】
- 감탄이나 과도한 감정 표현 금지. 담담하고 사색적인 톤
  좋은 예) "삼성전자를 좀 더 들고 있었어야 했나 싶었지만, 그건 결과를 알고 하는 말이다."
           "손절이 맞는 판단이었는지는 아직 모르겠다. 시간이 지나야 알 수 있는 것들이 있다."
           "별다른 변화 없이 하루가 지났다. 가끔은 이런 날이 오히려 편하다."
  나쁜 예) "드디어 반등! 속이 다 시원했다!" / "오늘도 파이팅!" / "설레는 마음으로"
- 수익·손실은 결과보다 과정이나 판단에 집중 ("그 가격에 팔길 잘했다" 보다 "그 판단이 맞았는지는 모르겠다")
- 익절과 주가 상승을 같은 맥락으로 묶지 말 것. 익절은 판단의 결과, 주가 상승은 시장의 흐름 — 둘은 다른 이야기다
  예) 틀린 표현: "오늘 주가가 올라서 익절했다" → 맞는 표현: "더 들고 있을 이유가 없었다" / "이 가격이면 충분하다고 봤다"
- 손절과 주가 하락도 마찬가지. 손절은 내가 내린 결정, 하락은 시장 — 하락 탓으로 돌리지 말 것
  예) 틀린 표현: "주가가 계속 빠져서 손절했다" → 맞는 표현: "더 버티는 게 의미 없다고 판단했다" / "이 이상은 내 계획 밖이었다"
- **하루 평가액 변동 ≠ 손실**: 오늘 평가액이 전일보다 줄었어도 그것은 '손실'이 아니라 '하락', '조정', '빠졌다' 등으로 표현. '손실'은 오직 매도로 실현된 손해에만 사용
  예) 틀린 표현: "오늘 33만원 손실" → 맞는 표현: "오늘 33만원 빠졌다" / "어제보다 소폭 하락"
- 누적 손익이 양수(수익 중)이면 일별 등락과 무관하게 전반적인 상황은 수익 중임을 전제로 쓸 것
- 매도·매수가 있다면 결정의 배경이나 남은 아쉬움·여지를 짧게
- 2~3문장으로 마무리 (80~150자 수준), 끝맺음은 짧은 관찰이나 각오
- 1인칭 반말 일기체, 마크다운 없이 순수 텍스트, 한국어

투자 데이터:
{data_text}
"""

        content: Optional[str] = None
        try:
            from services.gemini_service import call_gemini
            content = await call_gemini(
                prompt,
                max_tokens=2048,
                force_json_mime=False,
                disable_thinking=True,
                temperature=0.85,
            )
        except Exception as e:
            logger.error(f"Gemini diary generation failed for {diary_date}: {e}")

        if not content or not content.strip():
            # 폴백: 감성 있는 일기체 텍스트
            date_label = diary_date.replace("-", "년 ", 1).replace("-", "월 ") + "일"
            if true_daily_pnl is not None:
                if true_daily_pnl > 0:
                    mood = f"전일보다 {_fmt_krw(true_daily_pnl)} 올랐다. 잘한 건지는 모르겠지만, 오늘은 그냥 받아들이기로 했다."
                elif true_daily_pnl < 0:
                    abs_str = _fmt_krw(abs(true_daily_pnl)).lstrip('+')
                    mood = f"전일보다 {abs_str} 빠졌다. 시장이 그런 날이었다."
                else:
                    mood = "거의 제자리였다. 가끔은 이런 날이 오히려 편하다."
            else:
                mood = "포트폴리오를 확인했다."

            buy_note = ""
            if buys:
                names = ", ".join(e.name or e.ticker for e in buys[:2])
                buy_note = f" {names}를 더 담았다. 맞는 판단인지는 시간이 지나야 알 것 같다."
            sell_note = ""
            if sells:
                for e in sells:
                    if (e.pnl or 0) >= 0:
                        sell_note = f" {e.name or e.ticker}는 여기서 정리했다. 미련이 없는 건 아니지만."
                    else:
                        sell_note = f" {e.name or e.ticker}는 손절로 마무리했다. 버티는 게 답이 아닌 경우도 있다."

            content = f"{date_label}. {mood}{buy_note}{sell_note} 총 평가액은 {int(today_snap.total_value):,}원, 누적 수익률 {today_snap.pnl_pct:+.2f}%."

        content = content.strip()

        raw_data_obj = {
            "diary_date": diary_date,
            "total_value": today_snap.total_value,
            "pnl": today_snap.pnl,
            "pnl_pct": today_snap.pnl_pct,
            "true_daily_pnl": true_daily_pnl,
            "deposit_total": deposit_total,
            "withdraw_total": withdraw_total,
            "buy_count": len(buys),
            "sell_count": len(sells),
        }

        if existing:
            existing.content = content
            existing.raw_data = json.dumps(raw_data_obj, ensure_ascii=False)
            existing.generated_at = datetime.utcnow()
        else:
            db.add(InvestmentDiary(
                diary_date=diary_date,
                content=content,
                raw_data=json.dumps(raw_data_obj, ensure_ascii=False),
            ))

        await db.commit()
        logger.info(f"Investment diary generated/updated for {diary_date}")
        return content


# ── 조회 ──────────────────────────────────────────────────────────────────────

async def get_latest_diary() -> Optional[dict]:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(InvestmentDiary)
            .order_by(InvestmentDiary.diary_date.desc())
            .limit(1)
        )
        diary = result.scalar_one_or_none()
        if not diary:
            return None
        raw = {}
        try:
            if diary.raw_data:
                raw = json.loads(diary.raw_data)
        except Exception:
            pass
        return {
            "diary_date": diary.diary_date,
            "content": diary.content,
            "generated_at": diary.generated_at.isoformat(),
            "raw_data": raw,
        }


async def list_events(event_date: Optional[str] = None) -> list[dict]:
    async with AsyncSessionLocal() as db:
        q = select(InvestmentEvent).order_by(InvestmentEvent.created_at.desc())
        if event_date:
            q = q.where(InvestmentEvent.event_date == event_date)
        rows = (await db.execute(q)).scalars().all()
        return [
            {
                "id": r.id,
                "event_type": r.event_type,
                "event_date": r.event_date,
                "ticker": r.ticker,
                "name": r.name,
                "price": r.price,
                "quantity": r.quantity,
                "amount": r.amount,
                "pnl": r.pnl,
                "pnl_pct": r.pnl_pct,
                "note": r.note,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ]
