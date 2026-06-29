"""AI 투자 일기 서비스

- record_event(): 매수/매도/입금/출금 이벤트 기록
- generate_diary_for_date(): Gemini로 하루 일기 생성 + DB 저장
- get_latest_diary(): 최신 일기 조회
"""

import json
import logging
import random
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


async def _recent_diaries(db: AsyncSession, before_date: str, limit: int = 7) -> list[InvestmentDiary]:
    """before_date 이전(미포함)의 최근 일기들 (최신순)"""
    result = await db.execute(
        select(InvestmentDiary)
        .where(InvestmentDiary.diary_date < before_date)
        .order_by(InvestmentDiary.diary_date.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


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

        # 보유 종목 인벤토리는 프롬프트에 넣지 않는다(매일 똑같이 받아적는 '나열 문단'의 원인).
        # 오늘 실제 매수/매도한 종목만 위에 명시되어 있고, 그것만 일기 소재로 삼는다.

        # ── 시장 지수 (코스피/코스닥) — 조용한 날에도 차별화되는 재료 ──
        try:
            from services.index_service import get_cached_indices
            indices = await get_cached_indices()
            idx_lines = []
            for idx in indices:
                name = (idx.get("name") or "").upper()
                if any(k in name for k in ("KOSPI", "KOSDAQ", "코스피", "코스닥")):
                    cp = idx.get("change_pct")
                    if cp is not None:
                        d = "상승" if cp >= 0 else "하락"
                        idx_lines.append(f"  - {idx.get('name')}: {cp:+.2f}% {d}")
            if idx_lines:
                lines.append("시장 지수(전일 대비):")
                lines.extend(idx_lines)
        except Exception as e:
            logger.debug(f"diary index fetch skipped: {e}")

        data_text = "\n".join(lines)

        # ── 최근 일기: 전문이 아니라 '시작 문장'만 (구조 모방 방지, 중복 도입부만 차단) ──
        recents = await _recent_diaries(db, diary_date, limit=7)
        recent_block = ""
        if recents:
            openers = []
            for r in reversed(recents):
                body = (r.content or "").strip()
                # 날짜 머리글 줄은 건너뛰고 첫 실제 문장만
                for ln in body.splitlines():
                    ln = ln.strip()
                    if ln and not ln.replace("년", "").replace("월", "").replace("일", "").replace(" ", "").replace("요", "").isdigit():
                        first = ln.split(".")[0][:45]
                        openers.append(f"- {first}…")
                        break
            recent_block = "\n".join(openers)

        # ── 날짜 시드 기반 회전: 매일 다른 관점/예시로 구조적 반복 차단 ──
        seed = int(diary_date.replace("-", ""))
        rng = random.Random(seed)

        focus_angles = [
            "오늘의 시장 흐름이 내 포트폴리오에 어떻게 비쳤는지",
            "내 판단이나 원칙 중 하나를 떠올리며",
            "특정 보유 종목 하나에 대한 생각",
            "투자보다 그날의 마음가짐이나 태도",
            "기다림, 인내, 시간에 대한 단상",
            "어제와 달라진 점 또는 변하지 않은 점",
            "숫자 너머에 있는 의미나 거리두기",
        ]
        focus = rng.choice(focus_angles)

        good_examples = [
            '"삼성전자를 좀 더 들고 있었어야 했나 싶었지만, 그건 결과를 알고 하는 말이다."',
            '"손절이 맞는 판단이었는지는 아직 모르겠다. 시간이 지나야 알 수 있는 것들이 있다."',
            '"별다른 변화 없이 하루가 지났다."',
            '"지수는 빠졌지만 내 계획에 바뀐 건 없다."',
            '"오늘은 아무것도 하지 않았다. 그게 가장 어려운 선택일 때도 있다."',
            '"숫자를 너무 자주 들여다보는 것 같다. 조금 거리를 둬도 될 텐데."',
            '"오를 때 사고 싶고 빠질 때 팔고 싶은 마음을, 오늘도 한 번 눌렀다."',
        ]
        picked_examples = rng.sample(good_examples, 3)
        examples_text = "\n".join(f"  좋은 예) {ex}" for ex in picked_examples)

        recent_section = ""
        if recent_block:
            recent_section = f"""
【최근에 이미 쓴 시작 문장들 — 비슷하게 시작하지 말 것】
아래는 최근 일기들의 첫 문장이다. 오늘은 이것들과 다른 방식으로 시작하라.
"오늘 평가액은 …원 올랐다/빠졌다", "오늘 총 평가액이 …" 같은 숫자 보고로 시작하는 패턴을 매번 반복하지 마라.
또 "가끔은 이런 날이 오히려 편하다", "시간이 지나야 알 수 있다" 같은 상투구도 다시 쓰지 마라.
{recent_block}
"""

        # ── Gemini 호출 ──
        prompt = f"""당신은 30~40대 개인 투자자의 하루 투자 일기를 대신 써주는 AI입니다.
아래 데이터를 바탕으로, 투자자가 혼자 쓰는 담담한 독백체 일기를 써주세요.

【오늘의 관점】 {focus} — 이 각도를 중심으로 풀어내되, 억지로 끼워맞추진 말 것.

【핵심 원칙】
- 감탄이나 과도한 감정 표현 금지. 담담하고 사색적인 톤. 매번 표현을 새로 고를 것.
{examples_text}
  나쁜 예) "드디어 반등! 속이 다 시원했다!" / "오늘도 파이팅!" / "설레는 마음으로"
- 수익·손실은 결과보다 과정이나 판단에 집중 ("그 가격에 팔길 잘했다" 보다 "그 판단이 맞았는지는 모르겠다")
- 익절과 주가 상승을 같은 맥락으로 묶지 말 것. 익절은 판단의 결과, 주가 상승은 시장의 흐름 — 둘은 다른 이야기다
  예) 틀린 표현: "오늘 주가가 올라서 익절했다" → 맞는 표현: "더 들고 있을 이유가 없었다" / "이 가격이면 충분하다고 봤다"
- 손절과 주가 하락도 마찬가지. 손절은 내가 내린 결정, 하락은 시장 — 하락 탓으로 돌리지 말 것
  예) 틀린 표현: "주가가 계속 빠져서 손절했다" → 맞는 표현: "더 버티는 게 의미 없다고 판단했다" / "이 이상은 내 계획 밖이었다"
- **하루 평가액 변동 ≠ 손실**: 오늘 평가액이 전일보다 줄었어도 그것은 '손실'이 아니라 '하락', '조정', '빠졌다' 등으로 표현. '손실'은 오직 매도로 실현된 손해에만 사용
  예) 틀린 표현: "오늘 33만원 손실" → 맞는 표현: "오늘 33만원 빠졌다" / "어제보다 소폭 하락"
- 누적 손익이 양수(수익 중)이면 일별 등락과 무관하게 전반적인 상황은 수익 중임을 전제로 쓸 것
- **개별 종목의 당일 등락(올랐다/빠졌다/제자리)은 데이터로 주어지지 않았다. 종목별 움직임을 추측하거나 지어내지 말 것.** 종목 언급은 보유 사실·평단·비중·내 생각 수준으로만, 당일 주가 방향은 단정하지 말 것
- **위 데이터에 '오늘 매수'/'오늘 매도'가 없으면, 매매를 한 것처럼 쓰지 말 것.** 비중을 줄였다/늘렸다, 일부 정리했다 같은 거래 서술 금지. 매매 기록이 있을 때만 그 종목을 언급
- 금액은 "1억 3백만원", "280만원"처럼 억·만원 단위로 어림해서 쓸 것. 원 단위 숫자(예: 103,120,427원)를 그대로 옮겨 쓰지 말 것
- 매매가 없는 조용한 날이면 시장 지수나 마음가짐 등 다른 재료로 쓸 것. 매번 똑같이 "변화 없는 하루"로 시작하지 말 것
- **보유 종목을 매일 전부 나열하지 말 것.** 종목 나열식 문단(SK하이닉스·삼성전자·…를 차례로 언급)은 금지. 오늘 관점에 꼭 필요하면 종목 하나만 짧게 언급
- 매도·매수가 있다면 결정의 배경이나 남은 아쉬움·여지를 짧게
- **분량 엄수: 2~4문장, 한 문단, 150자 안팎.** 여러 문단으로 길게 늘여 쓰지 말 것. 끝맺음은 짧은 관찰이나 각오
- 1인칭 반말 일기체, 마크다운 없이 순수 텍스트, 한국어
- 본문 맨 위에 날짜("2026년 6월 22일" 등)를 다시 쓰지 말 것. 바로 일기 내용으로 시작
{recent_section}
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
                temperature=0.95,
            )
        except Exception as e:
            logger.error(f"Gemini diary generation failed for {diary_date}: {e}")

        if not content or not content.strip():
            # 폴백: 감성 있는 일기체 텍스트
            date_label = diary_date.replace("-", "년 ", 1).replace("-", "월 ") + "일"
            if true_daily_pnl is not None:
                if true_daily_pnl > 0:
                    mood = rng.choice([
                        f"전일보다 {_fmt_krw(true_daily_pnl)} 올랐다. 잘한 건지는 모르겠지만, 오늘은 그냥 받아들이기로 했다.",
                        f"전일 대비 {_fmt_krw(true_daily_pnl)}. 오른 날이라고 특별히 달라질 건 없다.",
                        f"오늘은 {_fmt_krw(true_daily_pnl)} 플러스. 숫자보다 계획을 보기로 한다.",
                    ])
                elif true_daily_pnl < 0:
                    abs_str = _fmt_krw(abs(true_daily_pnl)).lstrip('+')
                    mood = rng.choice([
                        f"전일보다 {abs_str} 빠졌다. 시장이 그런 날이었다.",
                        f"오늘 {abs_str} 조정. 내 계획에 바뀐 건 없다.",
                        f"{abs_str} 밀렸다. 이런 날도 지나간다.",
                    ])
                else:
                    mood = rng.choice([
                        "거의 제자리였다.",
                        "큰 움직임 없는 하루였다.",
                        "지수도 내 계좌도 잔잔했다.",
                    ])
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
