"""AI 추천 3-Round 검증."""

import asyncio
import logging

from services.gemini.client import call_gemini

logger = logging.getLogger(__name__)


# ── AI 추천 3-Round 검증 ──────────────────────────────────────────────────────

_RECOMMEND_R1_PROMPT = """\
당신은 한국 주식시장 전문 애널리스트입니다. 아래 정보를 종합하여 향후 1~4주 매수 검토 후보를 제시하세요.

## 분석 날짜: {date} ({session})

## 오늘 주요 뉴스 요약 ({news_count}건)
{news_summaries}

## 현재 포트폴리오 섹터 비중
{portfolio_sectors}

## 커뮤니티 반응 (섹터별 대중 심리)
{community_context}

## 정치테마 현황
{political_context}

## 선정 기준 (모두 충족 필요)
1. 뉴스 모멘텀: 긍정적 촉매(실적, 수주, 정책 수혜 등)가 뉴스에서 확인됨
2. 글로벌/지정학 적합성: 현재 국제 정세(무역, 금리, 지정학 리스크 등)와 부합
3. 섹터 다각화: 포트폴리오 저비중 섹터 우선
4. 실체성: 테마주·루머 아닌 실제 실적·수주·정책 근거

중요: 글로벌 매크로 환경(미 금리, 달러 강세/약세, 중국 경기, 지정학 리스크 등)도 반드시 고려하세요.
한국 수출 기업은 환율·교역 조건, 내수 기업은 소비 심리·금리를 분석에 포함하세요.

후보 최대 10종목. 확신 없으면 줄여도 됩니다.

JSON 응답 (다른 텍스트 없이):
{{"candidates": [{{"ticker": "035420.KS", "name": "NAVER", "sector": "IT/반도체", "catalyst": "핵심 상승 근거 1문장 (수치 포함)", "macro_fit": "글로벌 환경 적합성 1문장", "risk": "주요 하방 리스크 1문장"}}]}}"""

_RECOMMEND_R2_PROMPT = """\
당신은 투자 리스크 관리 전문가입니다. 다음 종목들을 기술적 분석 관점에서 검증하세요.

## Round 1 후보 종목
{candidates_json}

## 각 종목의 기술적 분석 데이터
{technical_data}

## 검증 항목
각 후보에 대해 평가하세요:
1. technical_ok: MA 배열(5>20>60), RSI 30~70 적정 구간, 거래량 증가 여부
2. rsi_signal: oversold(<30=매수기회)/neutral(30-70)/overbought(>70=주의)
3. entry_timing: good(지금 진입 적절)/wait(조정 후 진입)/caution(진입 위험)
4. is_structural: 뉴스 모멘텀이 구조적 변화인가(true) vs 일시적 노이즈(false)
5. confidence: high(강한 근거) / medium(보통) / low(불확실)
6. validation_note: 검증 소견 1문장

신뢰도 'low'는 최종 추천에서 제외됩니다.

JSON 응답 (다른 텍스트 없이):
{{"validations": [{{"ticker": "...", "technical_ok": true, "rsi_signal": "neutral", "entry_timing": "good", "is_structural": true, "confidence": "high", "validation_note": "소견"}}]}}"""

_RECOMMEND_R3_PROMPT = """\
당신은 한국 주식 포트폴리오 매니저입니다. 아래 분석을 바탕으로 최종 추천을 확정하세요.

## 후보 + 검증 결과 요약
{combined_json}

## 현재가 정보
{price_data}

## 최종 선별 기준
- confidence=high 종목 우선 선택
- confidence=medium 종목도 포함 가능 (entry_timing=good 또는 is_structural=true 중 하나라도 해당 시)
- confidence=low 종목만 제외
- **반드시 최소 2종목, 최대 5종목 선택** (후보 중 최선의 2~5종목을 항상 출력해야 함)
- 포트폴리오 보유 종목은 추가 매수 명확한 근거 있을 때만 포함

각 종목 필수 제시:
- reason: 추천 이유 2~3문장 (뉴스 근거 + 기술적 근거 + 전망, 구체적 수치 필수)
- entry_price: 현재가 기준 추천 진입가 (원화 정수)
- entry_range_low / entry_range_high: 진입 구간 (현재가 ±3~5% 범위)
- target_price: 1~4주 목표가 (현재가 대비 +8~20% 현실적으로)
- target_return_pct: 목표 수익률 (소수점 1자리)
- stop_loss_price: 손절가 (현재가 대비 -5~10%)
- stop_loss_pct: 손절 % (음수, 소수점 1자리)
- technical_summary: 기술적 분석 한 줄 요약 (MA배열, RSI, 거래량 핵심만)

JSON 응답 (다른 텍스트 없이):
{{"recommendations": [{{"ticker": "005930.KS", "name": "삼성전자", "sector": "IT/반도체", "strength": "strong", "confidence": "high", "reason": "...", "entry_price": 75000, "entry_range_low": 73000, "entry_range_high": 76500, "target_price": 85000, "target_return_pct": 13.3, "stop_loss_price": 70000, "stop_loss_pct": -6.7, "technical_summary": "..."}}]}}"""


async def generate_ai_recommendations(
    news_list: list[dict],
    portfolio_sectors: dict[str, float],
    technical_data: dict[str, dict],
    price_data: dict[str, float],
    session_name: str = "evening",
    community_context: str = "",
    political_context: str = "",
) -> list[dict]:
    """3-Round Gemini 검증으로 최종 추천 종목 반환.

    news_list: [{"title": str, "summary": str, "sector": str, "source": str}, ...]
    portfolio_sectors: {"IT/반도체": 35.2, ...}
    technical_data: {"005930.KS": {분석 결과 dict}, ...}
    price_data: {"005930.KS": 75000.0, ...}
    session_name: "morning" | "evening"
    """
    import json as _json
    from datetime import date as _date

    today = _date.today().strftime("%Y년 %m월 %d일")
    session_label = "아침 분석" if session_name == "morning" else "저녁 분석"

    # 뉴스 요약 구성 (최대 40건, 토큰 절약)
    news_lines = []
    for i, n in enumerate(news_list[:40], 1):
        line = f"[{i}] [{n.get('sector','일반')}] {n.get('title','')}"
        if n.get("summary"):
            line += f" — {n['summary']}"
        news_lines.append(line)
    news_text = "\n".join(news_lines)

    # 포트폴리오 섹터 텍스트
    sector_lines = [f"- {s}: {w:.1f}%" for s, w in sorted(portfolio_sectors.items(), key=lambda x: -x[1])]
    sector_text = "\n".join(sector_lines) if sector_lines else "포트폴리오 없음"

    # ── Round 1: 후보 발굴 ──
    logger.info("AI Recommend Round 1: candidate discovery")
    r1_prompt = _RECOMMEND_R1_PROMPT.format(
        date=today,
        session=session_label,
        news_count=len(news_list[:40]),
        news_summaries=news_text,
        portfolio_sectors=sector_text,
        community_context=community_context or "커뮤니티 데이터 수집 중",
        political_context=political_context or "정치 데이터 없음",
    )
    # disable_thinking=True: gemini-2.5-flash thinking 토큰이 maxOutputTokens 예산 소모
    # → thinking OFF + 토큰 충분히 확보해야 JSON 잘림 방지
    r1_raw = await call_gemini(r1_prompt, max_tokens=4096, force_json_mime=True, disable_thinking=True)
    if not r1_raw:
        logger.warning("AI Recommend Round 1 failed (no response)")
        return []

    try:
        r1_data = _json.loads(r1_raw)
        candidates = r1_data.get("candidates", [])
    except Exception as e:
        logger.warning(f"Round 1 parse error: {e} | raw[:300]: {r1_raw[:300]}")
        return []

    if not candidates:
        logger.info("Round 1: no candidates found")
        return []

    logger.info(f"Round 1: {len(candidates)} candidates: {[c.get('ticker') for c in candidates]}")

    # R1 후보 중 price_data 없는 종목 보충 조회
    r1_tickers = [c.get("ticker", "") for c in candidates if c.get("ticker")]
    missing_price = [t for t in r1_tickers if t not in price_data]
    if missing_price:
        from services.stock_service import fetch_current_price
        extra_prices = await asyncio.gather(
            *[fetch_current_price(t) for t in missing_price],
            return_exceptions=True,
        )
        for t, p in zip(missing_price, extra_prices):
            if isinstance(p, (int, float)) and p:
                price_data[t] = p
        logger.info(f"Round 1: supplemented prices for {[t for t,p in zip(missing_price, extra_prices) if isinstance(p,(int,float)) and p]}")

    # R1 후보 중 technical_data 없는 종목 보충 분석
    missing_tech = [t for t in r1_tickers if t not in technical_data]
    if missing_tech:
        from services.technical_analysis import analyze_ticker
        tech_extras = await asyncio.gather(
            *[analyze_ticker(t) for t in missing_tech],
            return_exceptions=True,
        )
        for t, r in zip(missing_tech, tech_extras):
            technical_data[t] = r if isinstance(r, dict) else {"available": False}
        logger.info(f"Round 1: supplemented technical data for {len(missing_tech)} tickers")

    # ── Round 2: 기술적 분석 검증 ──
    logger.info("AI Recommend Round 2: technical validation")
    tech_lines = []
    for c in candidates:
        t = c.get("ticker", "")
        td = technical_data.get(t, {})
        if not td.get("available"):
            tech_lines.append(f"- {t}: 기술적 데이터 없음 (최근 수집 부족)")
        else:
            tech_lines.append(
                f"- {t} ({c.get('name','')}): 현재가={td.get('current_price')}, "
                f"MA5={td.get('ma5')}/MA20={td.get('ma20')}/MA60={td.get('ma60')}, "
                f"MA정배열={td.get('ma_bullish')}, RSI={td.get('rsi')}, "
                f"거래량추세={td.get('volume_trend')}, "
                f"지지={td.get('support')}/저항={td.get('resistance')}, "
                f"52주포지션={td.get('week52_position_pct')}%"
            )
    tech_text = "\n".join(tech_lines)

    r2_prompt = _RECOMMEND_R2_PROMPT.format(
        candidates_json=_json.dumps(candidates, ensure_ascii=False),
        technical_data=tech_text,
    )
    r2_raw = await call_gemini(r2_prompt, max_tokens=3000, force_json_mime=True, disable_thinking=True)

    validations_map: dict[str, dict] = {}
    if r2_raw:
        try:
            r2_data = _json.loads(r2_raw)
            for v in r2_data.get("validations", []):
                validations_map[v.get("ticker", "")] = v
        except Exception as e:
            logger.warning(f"Round 2 parse error: {e} | raw[:300]: {r2_raw[:300]}")
    logger.info(f"Round 2 validations: {list(validations_map.values())[:3]}")

    # confidence=low 필터
    filtered_candidates = [
        c for c in candidates
        if validations_map.get(c.get("ticker", {}), {}).get("confidence", "medium") != "low"
    ]
    if not filtered_candidates:
        filtered_candidates = candidates  # 전부 low면 그냥 진행

    logger.info(f"Round 2: {len(filtered_candidates)} passed validation")

    # ── Round 3: 최종 선별 + 가격 전략 ──
    logger.info("AI Recommend Round 3: final selection")
    combined = []
    for c in filtered_candidates:
        t = c.get("ticker", "")
        v = validations_map.get(t, {})
        combined.append({**c, **v})

    price_lines = [
        f"- {ticker}: {price:,.0f}원"
        for ticker, price in price_data.items()
        if price
    ]
    price_text = "\n".join(price_lines) if price_lines else "가격 정보 없음"

    r3_prompt = _RECOMMEND_R3_PROMPT.format(
        combined_json=_json.dumps(combined, ensure_ascii=False),
        price_data=price_text,
    )
    r3_raw = await call_gemini(r3_prompt, max_tokens=4096, force_json_mime=True, disable_thinking=True)
    if not r3_raw:
        logger.warning("AI Recommend Round 3 failed (no response)")
        return []

    try:
        r3_data = _json.loads(r3_raw)
        final_recs = r3_data.get("recommendations", [])
    except Exception as e:
        logger.warning(f"Round 3 parse error: {e} | raw[:300]: {r3_raw[:300]}")
        return []

    if not final_recs:
        logger.warning(f"Round 3 returned 0 recs. raw[:500]: {r3_raw[:500]}")
    logger.info(f"AI Recommend complete: {len(final_recs)} final recommendations")
    return final_recs
