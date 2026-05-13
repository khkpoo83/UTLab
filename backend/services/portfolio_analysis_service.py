"""포트폴리오 AI 분석 서비스 (PA1 → PA2 2단계 파이프라인)

PA1 (03:00 KST): 계좌별 보유종목 + 현재가 + 최근 뉴스 수집 → AiCycleState 저장
PA2 (03:10 KST): PA1 상태 로드 → Gemini 계좌별 분석 → PortfolioAnalysis 저장
"""
import json
import logging
import re
from datetime import datetime, timedelta
from typing import Optional

import pytz
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import (
    Portfolio, Account, News, PortfolioAnalysis, AiCycleState, AsyncSessionLocal
)

logger = logging.getLogger(__name__)

KST = pytz.timezone("Asia/Seoul")

PA_SESSION_NAME = "portfolio_analysis"
PA_EXPIRES_HOURS = 2


def _today_kst() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d")


async def _save_pa_state(step: int, data: dict) -> None:
    """PA1/PA2 중간 상태 AiCycleState에 저장."""
    expires = datetime.utcnow() + timedelta(hours=PA_EXPIRES_HOURS)
    async with AsyncSessionLocal() as session:
        await session.execute(
            delete(AiCycleState).where(AiCycleState.session_name == PA_SESSION_NAME)
        )
        state = AiCycleState(
            session_name=PA_SESSION_NAME,
            step=step,
            state_json=json.dumps(data, ensure_ascii=False),
            expires_at=expires,
        )
        session.add(state)
        await session.commit()
    logger.info(f"PA cycle state saved: step={step}")


async def _load_pa_state(required_step: int) -> Optional[dict]:
    """AiCycleState에서 PA 상태 로드."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(AiCycleState).where(AiCycleState.session_name == PA_SESSION_NAME)
        )
        state = result.scalar_one_or_none()
    if not state:
        logger.warning(f"PA cycle state not found (required step={required_step})")
        return None
    if state.step != required_step:
        logger.warning(f"PA cycle step mismatch: expected {required_step}, got {state.step}")
        return None
    if state.expires_at < datetime.utcnow():
        logger.warning(f"PA cycle state expired")
        return None
    return json.loads(state.state_json)


async def _get_ticker_recent_news(ticker: str, name: str, limit: int = 3) -> list[str]:
    """티커/종목명으로 최근 뉴스 헤드라인 수집 (News 테이블에서 직접 조회)."""
    ticker_base = ticker.split(".")[0].upper()
    name_keyword = name.strip() if len(name.strip()) >= 2 else ""

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(News)
            .where(News.status == "done")
            .order_by(News.published_at.desc().nullslast(), News.created_at.desc())
            .limit(200)
        )
        rows = result.scalars().all()

    matched_ids: set[int] = set()
    headlines: list[str] = []

    for r in rows:
        if len(headlines) >= limit:
            break
        related = r.related_stocks or []
        if any(ticker_base in str(s).upper() for s in related):
            headlines.append(r.title)
            matched_ids.add(r.id)

    if name_keyword and len(headlines) < limit:
        for r in rows:
            if len(headlines) >= limit:
                break
            if r.id in matched_ids:
                continue
            if name_keyword in (r.title or ""):
                headlines.append(r.title)
                matched_ids.add(r.id)

    return headlines[:limit]


async def run_pa1(db: AsyncSession) -> bool:
    """
    포트폴리오 분석 1단계: 계좌별 보유종목 + 최근 뉴스 수집 → AiCycleState 저장

    - 모든 Portfolio 항목을 account_id별로 그룹핑
    - 각 종목의 현재가/수익률 계산
    - 각 종목의 최근 관련 뉴스 헤드라인 3개 수집 (News 테이블에서)
    - 결과를 AiCycleState에 session_name="portfolio_analysis", step=1 로 저장
    """
    session_date = _today_kst()
    logger.info(f"PA1 started: session_date={session_date}")

    # 포트폴리오 로드
    result = await db.execute(select(Portfolio))
    holdings = result.scalars().all()

    if not holdings:
        logger.info("PA1: no portfolio holdings, skipping")
        return False

    # 계좌 정보 로드
    accounts_result = await db.execute(select(Account))
    accounts_map = {a.id: a.name for a in accounts_result.scalars().all()}

    # 현재가 조회
    from services.stock_service import fetch_current_price
    import asyncio
    prices = await asyncio.gather(
        *[fetch_current_price(h.ticker) for h in holdings],
        return_exceptions=True,
    )

    # 계좌별 그룹핑
    account_groups: dict[Optional[int], dict] = {}
    for holding, price in zip(holdings, prices):
        acc_id = getattr(holding, "account_id", None)
        if acc_id not in account_groups:
            acc_name = accounts_map.get(acc_id, "미분류") if acc_id is not None else "미분류"
            account_groups[acc_id] = {
                "account_id": acc_id,
                "account_name": acc_name,
                "holdings": [],
            }

        current_price = price if isinstance(price, (int, float)) and price else None
        pnl_pct = None
        if current_price and holding.avg_price > 0:
            pnl_pct = round((current_price - holding.avg_price) / holding.avg_price * 100, 2)

        account_groups[acc_id]["holdings"].append({
            "ticker": holding.ticker,
            "name": holding.name,
            "exchange": holding.exchange or "",
            "avg_price": holding.avg_price,
            "current_price": current_price,
            "quantity": holding.quantity,
            "pnl_pct": pnl_pct,
        })

    # 뉴스 수집 (각 종목별)
    accounts_list = []
    for acc_id, group in account_groups.items():
        enriched_holdings = []
        for h in group["holdings"]:
            headlines = await _get_ticker_recent_news(h["ticker"], h["name"], limit=3)
            enriched_holdings.append({**h, "recent_news": headlines})
        accounts_list.append({
            "account_id": acc_id,
            "account_name": group["account_name"],
            "holdings": enriched_holdings,
        })

    state = {
        "accounts": accounts_list,
        "session_date": session_date,
    }

    await _save_pa_state(step=1, data=state)
    logger.info(f"PA1 complete: {len(holdings)} holdings across {len(accounts_list)} accounts")
    return True


def _get_investment_horizon(account_name: str) -> str:
    """계좌명에서 투자 기간/목적 컨텍스트 추출"""
    name = account_name or ""
    if any(k in name for k in ["노후", "연금", "은퇴", "퇴직"]):
        return "초장기(10년 이상) 노후 대비 투자 계좌. 복리 성장, 배당 재투자, 장기 보유 관점으로 분석하세요. 단기 변동성보다 펀더멘털과 장기 성장성에 집중하세요."
    if any(k in name for k in ["장기", "적립", "장투"]):
        return "장기(3~5년) 투자 계좌. 성장 모멘텀과 중장기 업황 사이클을 중심으로 분석하세요."
    if any(k in name for k in ["투자", "단기", "트레이딩", "스윙"]):
        return "단·중기(1주~3개월) 투자 계좌. 기술적 분석, 단기 모멘텀, 뉴스 이벤트 영향을 중심으로 분석하세요."
    return "중기(1~6개월) 투자 계좌. 성장성과 단기 모멘텀을 균형있게 분석하세요."


_PA2_PROMPT_TEMPLATE = """\
당신은 전문 주식 투자 애널리스트입니다. 아래 포트폴리오의 각 종목에 대해 투자 조언을 제공하세요.

계좌: {account_name}
투자 성격: {investment_horizon}
분석일: {session_date}

보유 종목:
{holdings_text}

각 종목에 대해 반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만:
{{
  "analyses": [
    {{
      "ticker": "종목코드",
      "outlook": "bullish 또는 neutral 또는 bearish",
      "recommendation": "buy_more 또는 hold 또는 reduce 또는 sell",
      "short_term_forecast": "이 계좌의 투자 성격에 맞는 전망 2-3문장. 구체적인 수치 포함.",
      "key_points": ["핵심포인트1", "핵심포인트2", "핵심포인트3"],
      "risks": "주요 리스크 1문장",
      "confidence": "high 또는 medium 또는 low"
    }}
  ]
}}"""


def _build_holdings_text(holdings: list[dict]) -> str:
    lines = []
    for h in holdings:
        avg_price = h.get("avg_price", 0)
        current_price = h.get("current_price")
        pnl_pct = h.get("pnl_pct")
        recent_news = h.get("recent_news", [])

        price_str = f"{int(avg_price):,}원"
        curr_str = f"{int(current_price):,}원" if current_price else "조회불가"
        pnl_str = f"{pnl_pct:+.1f}%" if pnl_pct is not None else "N/A"
        news_str = " / ".join(recent_news) if recent_news else "최근 뉴스 없음"

        lines.append(
            f"■ {h['name']} ({h['ticker']}/{h.get('exchange', '')})\n"
            f"  - 평균매입가: {price_str} | 현재가: {curr_str} | 수익률: {pnl_str}\n"
            f"  - 보유수량: {h.get('quantity', 0):.0f}주\n"
            f"  - 최근 뉴스: {news_str}"
        )
    return "\n".join(lines)


def _parse_pa2_response(response_text: str) -> Optional[list[dict]]:
    """Gemini 응답에서 analyses JSON 파싱."""
    if not response_text:
        return None
    try:
        data = json.loads(response_text)
        if isinstance(data, dict) and "analyses" in data:
            return data["analyses"]
    except Exception:
        pass
    # JSON 블록 수동 추출 시도
    cleaned = re.sub(r'```(?:json)?', '', response_text).strip()
    start = cleaned.find('{')
    end = cleaned.rfind('}') + 1
    if start >= 0 and end > start:
        try:
            data = json.loads(cleaned[start:end])
            if isinstance(data, dict) and "analyses" in data:
                return data["analyses"]
        except Exception:
            pass
    logger.warning(f"PA2 JSON parse failed: {response_text[:300]}")
    return None


async def run_pa2(db: AsyncSession) -> int:
    """
    포트폴리오 분석 2단계: PA1 상태 로드 → 계좌별 Gemini 호출 → PortfolioAnalysis 저장

    Returns: number of analyses saved
    """
    state = await _load_pa_state(required_step=1)
    if not state:
        logger.warning("PA2: no valid PA1 state found, aborting")
        return 0

    session_date = state.get("session_date", _today_kst())
    accounts = state.get("accounts", [])

    if not accounts:
        logger.info("PA2: no accounts in state, skipping")
        return 0

    # 오늘 이미 분석 결과 있으면 스킵 (dedup)
    existing = await db.execute(
        select(PortfolioAnalysis).where(PortfolioAnalysis.session_date == session_date).limit(1)
    )
    if existing.scalar_one_or_none():
        logger.info(f"PA2: today's analysis already exists (session_date={session_date}), skipping")
        return 0

    from services.gemini_service import call_gemini

    total_saved = 0

    for account in accounts:
        acc_id = account.get("account_id")
        acc_name = account.get("account_name", "미분류")
        holdings = account.get("holdings", [])

        if not holdings:
            continue

        holdings_text = _build_holdings_text(holdings)
        investment_horizon = _get_investment_horizon(acc_name)
        prompt = _PA2_PROMPT_TEMPLATE.format(
            account_name=acc_name,
            investment_horizon=investment_horizon,
            session_date=session_date,
            holdings_text=holdings_text,
        )

        logger.info(f"PA2: calling Gemini for account '{acc_name}' ({len(holdings)} holdings)")
        response = await call_gemini(
            prompt,
            max_tokens=4096,
            force_json_mime=True,
            disable_thinking=True,
        )

        if not response:
            logger.warning(f"PA2: Gemini returned no response for account '{acc_name}'")
            continue

        analyses = _parse_pa2_response(response)
        if not analyses:
            logger.warning(f"PA2: failed to parse Gemini response for account '{acc_name}'")
            continue

        # ticker → holding 매핑
        holding_map = {h["ticker"]: h for h in holdings}
        # ticker_base → holding 매핑 (suffix 없는 경우 대비)
        holding_base_map = {h["ticker"].split(".")[0].upper(): h for h in holdings}

        generated_at = datetime.utcnow()

        for analysis in analyses:
            raw_ticker = analysis.get("ticker", "")
            # holding 찾기 (exact or base match)
            holding = holding_map.get(raw_ticker) or holding_base_map.get(raw_ticker.split(".")[0].upper())
            if not holding:
                logger.warning(f"PA2: no holding found for ticker '{raw_ticker}', skipping")
                continue

            key_points = analysis.get("key_points", [])
            if not isinstance(key_points, list):
                key_points = []

            record = PortfolioAnalysis(
                account_id=acc_id,
                account_name=acc_name,
                ticker=holding["ticker"],
                name=holding["name"],
                outlook=analysis.get("outlook", "neutral"),
                recommendation=analysis.get("recommendation", "hold"),
                short_term_forecast=analysis.get("short_term_forecast", ""),
                key_points_json=json.dumps(key_points, ensure_ascii=False),
                risks=analysis.get("risks", ""),
                confidence=analysis.get("confidence", "medium"),
                session_date=session_date,
                generated_at=generated_at,
            )
            db.add(record)
            total_saved += 1

        await db.commit()
        logger.info(f"PA2: saved {total_saved} analyses so far (account='{acc_name}')")

    logger.info(f"PA2 complete: {total_saved} total analyses saved")
    return total_saved


async def get_portfolio_analysis(db: AsyncSession) -> list[dict]:
    """
    최신 PortfolioAnalysis 결과를 계좌별로 그룹핑해서 반환.

    Returns: [{"account_id": ..., "account_name": ..., "session_date": ...,
               "generated_at": ..., "items": [...]}]
    """
    # 가장 최신 session_date 찾기
    result = await db.execute(
        select(PortfolioAnalysis.session_date)
        .order_by(PortfolioAnalysis.session_date.desc())
        .limit(1)
    )
    latest_date = result.scalar_one_or_none()
    if not latest_date:
        return []

    # 최신 날짜의 모든 분석 조회
    result = await db.execute(
        select(PortfolioAnalysis)
        .where(PortfolioAnalysis.session_date == latest_date)
        .order_by(PortfolioAnalysis.account_id.nullsfirst(), PortfolioAnalysis.name)
    )
    rows = result.scalars().all()

    # 계좌별 그룹핑
    groups: dict = {}
    for row in rows:
        key = row.account_id  # None for unassigned
        if key not in groups:
            groups[key] = {
                "account_id": row.account_id,
                "account_name": row.account_name or "미분류",
                "session_date": row.session_date,
                "generated_at": row.generated_at.isoformat() if row.generated_at else None,
                "items": [],
            }

        key_points: list[str] = []
        try:
            if row.key_points_json:
                key_points = json.loads(row.key_points_json)
        except Exception:
            pass

        groups[key]["items"].append({
            "ticker": row.ticker,
            "name": row.name,
            "outlook": row.outlook,
            "recommendation": row.recommendation,
            "short_term_forecast": row.short_term_forecast,
            "key_points": key_points,
            "risks": row.risks,
            "confidence": row.confidence,
        })

    return list(groups.values())
