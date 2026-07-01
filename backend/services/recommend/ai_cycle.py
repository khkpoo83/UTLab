"""Gemini 3-Round AI 기반 추천 사이클 (전체 + R1/R2/R3 단계별 분리)."""

import asyncio
import json
import logging
from collections import Counter
from datetime import datetime, timedelta

from sqlalchemy import delete, select

from models.database import AiCycleState, AsyncSessionLocal, News, Recommendation, StockMaster
from services.recommend.cache import _RECOMMEND_CACHE_KEY, _recommend_cache
from services.recommend.portfolio import _get_korean_ticker_map, get_portfolio_sectors

logger = logging.getLogger(__name__)


async def run_ai_recommendation_cycle(session_name: str = "evening") -> None:
    """Gemini 3-Round AI 기반 추천 사이클 실행.

    session_name: "morning" (07:00 KST) | "evening" (22:00 KST)
    """
    await _recommend_cache.clear(_RECOMMEND_CACHE_KEY)

    from services.gemini_service import generate_ai_recommendations
    from services.technical_analysis import analyze_ticker

    # 뉴스 조회 기간: 저녁=오늘 전체(24h), 아침=최근 12h
    hours_back = 24 if session_name == "evening" else 12
    cutoff = datetime.utcnow() - timedelta(hours=hours_back)

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(News)
            .where(
                News.status == "done",
                News.created_at >= cutoff,
                News.summary.isnot(None),
            )
            .order_by(News.published_at.desc())
            .limit(60)
        )
        recent_news = result.scalars().all()

    if not recent_news:
        logger.info(f"run_ai_recommendation_cycle: no news found for {session_name}")
        return

    # 뉴스 리스트 구성
    news_list = [
        {
            "title": n.title,
            "summary": n.summary or "",
            "sector": n.sector or "",
            "source": n.source or "",
        }
        for n in recent_news
    ]

    # 포트폴리오 섹터 비중
    portfolio_sectors = await get_portfolio_sectors()

    # 뉴스에서 언급된 종목 집계 (기술적 분석 대상)
    kr_ticker_map = await _get_korean_ticker_map()
    ticker_counts: Counter = Counter()
    for n in recent_news:
        for t in (n.related_stocks or []):
            t_str = str(t)
            t_code = t_str.split(".")[0].upper()
            if t_code in kr_ticker_map:
                ticker_counts[kr_ticker_map[t_code]] += 1
            elif t_str.endswith(".KS") or t_str.endswith(".KQ"):
                ticker_counts[t_str] += 1

    top_tickers = [t for t, _ in ticker_counts.most_common(10)]

    # 기술적 분석 (병렬)
    tech_results = await asyncio.gather(
        *[analyze_ticker(t) for t in top_tickers],
        return_exceptions=True,
    )
    technical_data: dict[str, dict] = {}
    for ticker, result in zip(top_tickers, tech_results):
        if isinstance(result, dict):
            technical_data[ticker] = result
        else:
            technical_data[ticker] = {"available": False}

    # 현재가 조회
    from services.stock_service import _fetch_price_detail_sync
    loop = asyncio.get_running_loop()
    price_results = await asyncio.gather(
        *[loop.run_in_executor(None, _fetch_price_detail_sync, t) for t in top_tickers],
        return_exceptions=True,
    )
    price_data: dict[str, float] = {}
    for ticker, pr in zip(top_tickers, price_results):
        if isinstance(pr, dict) and pr.get("price"):
            price_data[ticker] = pr["price"]

    # 커뮤니티 심리 수집
    ticker_name_map = {}
    ticker_sector_map = {}
    async with AsyncSessionLocal() as session:
        master_result = await session.execute(
            select(StockMaster).where(StockMaster.ticker.in_(top_tickers))
        )
        for sm in master_result.scalars().all():
            ticker_name_map[sm.ticker] = sm.name
    # fallback: use ticker code as name
    for ticker in top_tickers:
        if ticker not in ticker_name_map:
            ticker_name_map[ticker] = ticker.split(".")[0]

    # sector map from existing recommendations
    async with AsyncSessionLocal() as session:
        rec_result = await session.execute(select(Recommendation).where(Recommendation.ai_session.is_(None)))
        for rec in rec_result.scalars().all():
            ticker_sector_map[rec.ticker] = rec.sector or "기타"

    community_context = ""
    political_context = ""

    logger.info(f"Data ready: top_tickers={top_tickers}, price_data keys={list(price_data.keys())}, tech keys={list(technical_data.keys())}")

    # Gemini 3-Round 호출
    ai_recs = await generate_ai_recommendations(
        news_list=news_list,
        portfolio_sectors=portfolio_sectors,
        technical_data=technical_data,
        price_data=price_data,
        session_name=session_name,
        community_context=community_context,
        political_context=political_context,
    )

    if not ai_recs:
        logger.info("AI recommendation cycle returned no results")
        return

    # DB 저장 (모든 이전 추천 삭제 후 AI 추천만 저장)
    async with AsyncSessionLocal() as session:
        await session.execute(delete(Recommendation))
        await session.commit()

    now = datetime.utcnow()
    portfolio_sectors_current = await get_portfolio_sectors()

    async with AsyncSessionLocal() as session:
        for rec in ai_recs:
            ticker = rec.get("ticker", "")
            sector = rec.get("sector") or "기타"
            sector_weight = portfolio_sectors_current.get(sector, 0.0)

            # 현재가
            latest_price = price_data.get(ticker)

            # change_pct는 price_results에서
            change_pct = None
            for t, pr in zip(top_tickers, price_results):
                if t == ticker and isinstance(pr, dict):
                    change_pct = pr.get("day_change_pct")
                    break

            r = Recommendation(
                ticker=ticker,
                name=rec.get("name", ticker),
                sector=sector,
                sector_weight=sector_weight,
                news_count=ticker_counts.get(ticker, 0),
                latest_price=latest_price,
                change_pct=change_pct,
                strength=rec.get("strength", "normal"),
                # New AI fields
                reason=rec.get("reason"),
                confidence=rec.get("confidence"),
                ai_session=session_name,
                entry_price=rec.get("entry_price"),
                entry_range_low=rec.get("entry_range_low"),
                entry_range_high=rec.get("entry_range_high"),
                target_price=rec.get("target_price"),
                target_return_pct=rec.get("target_return_pct"),
                stop_loss_price=rec.get("stop_loss_price"),
                stop_loss_pct=rec.get("stop_loss_pct"),
                technical_summary=rec.get("technical_summary"),
                generated_at=now,
            )
            session.add(r)
        await session.commit()

    # 정치 가중치 보정
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Recommendation).where(Recommendation.ai_session == session_name)
        )
        saved_recs = result.scalars().all()
        for rec in saved_recs:
            affiliation, pol_weight = await calculate_political_weight(  # noqa: F821
                rec.ticker, approval_data, upcoming_events  # noqa: F821
            )
            if affiliation:
                rec.political_theme = affiliation
                rec.political_weight = pol_weight
        await session.commit()

    logger.info(f"AI recommendations saved: {len(ai_recs)} ({session_name})")


# ── AI 추천 단계별 분리 실행 (10분 간격, rate limit 분산) ─────────────────────

async def _save_cycle_state(session_name: str, step: int, data: dict) -> None:
    """R1/R2 중간 결과를 DB에 저장. 기존 동일 session의 이전 단계도 삭제."""
    expires = datetime.utcnow() + timedelta(hours=2)
    async with AsyncSessionLocal() as session:
        # 기존 같은 session_name 상태 삭제
        await session.execute(
            delete(AiCycleState).where(AiCycleState.session_name == session_name)
        )
        state = AiCycleState(
            session_name=session_name,
            step=step,
            state_json=json.dumps(data, ensure_ascii=False),
            expires_at=expires,
        )
        session.add(state)
        await session.commit()
    logger.info(f"AI cycle state saved: session={session_name} step={step}")


async def _load_cycle_state(session_name: str, required_step: int) -> dict | None:
    """DB에서 중간 상태 로드. 만료되었거나 단계가 안 맞으면 None."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(AiCycleState)
            .where(AiCycleState.session_name == session_name)
            .order_by(AiCycleState.created_at.desc())
            .limit(1)
        )
        state = result.scalar_one_or_none()
    if not state:
        logger.warning(f"AI cycle state not found: session={session_name}")
        return None
    if state.step != required_step:
        logger.warning(f"AI cycle step mismatch: expected {required_step}, got {state.step}")
        return None
    if state.expires_at < datetime.utcnow():
        logger.warning(f"AI cycle state expired: session={session_name}")
        return None
    return json.loads(state.state_json)


async def run_ai_r1(session_name: str = "evening") -> bool:
    """Step 1: 뉴스 수집 + 포트폴리오 분석 + R1 후보 발굴 → DB에 중간 상태 저장.

    returns True if successful, False otherwise.
    """
    await _recommend_cache.clear(_RECOMMEND_CACHE_KEY)

    # 여기서는 call_gemini를 직접 사용하기 위해 R1만 실행하는 방식 대신
    # 기존 generate_ai_recommendations를 3단계로 쪼개야 하므로 내부 로직 재현

    import json as _json
    from datetime import date as _dt

    from services.gemini_service import call_gemini, get_usage_stats

    # Rate limit 체크
    stats = get_usage_stats()
    if stats["rate_limited"]:
        logger.warning(f"run_ai_r1 skipped: Gemini rate-limited ({stats['rate_limit_seconds_remaining']}s)")
        return False

    hours_back = 24 if session_name == "evening" else 12
    cutoff = datetime.utcnow() - timedelta(hours=hours_back)

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(News)
            .where(News.status == "done", News.created_at >= cutoff, News.summary.isnot(None))
            .order_by(News.published_at.desc())
            .limit(60)
        )
        recent_news = result.scalars().all()

    if not recent_news:
        logger.info(f"run_ai_r1: no summarized news for {session_name}")
        return False

    news_list = [
        {"title": n.title, "summary": n.summary or "", "sector": n.sector or "", "source": n.source or ""}
        for n in recent_news
    ]
    portfolio_sectors = await get_portfolio_sectors()
    kr_ticker_map = await _get_korean_ticker_map()
    ticker_counts: Counter = Counter()
    for n in recent_news:
        for t in (n.related_stocks or []):
            t_str = str(t)
            t_code = t_str.split(".")[0].upper()
            if t_code in kr_ticker_map:
                ticker_counts[kr_ticker_map[t_code]] += 1
            elif t_str.endswith(".KS") or t_str.endswith(".KQ"):
                ticker_counts[t_str] += 1

    top_tickers = [t for t, _ in ticker_counts.most_common(10)]

    # 커뮤니티 심리
    ticker_name_map = {}
    async with AsyncSessionLocal() as session:
        master_result = await session.execute(select(StockMaster).where(StockMaster.ticker.in_(top_tickers)))
        for sm in master_result.scalars().all():
            ticker_name_map[sm.ticker] = sm.name
    for ticker in top_tickers:
        if ticker not in ticker_name_map:
            ticker_name_map[ticker] = ticker.split(".")[0]

    ticker_sector_map = {}
    async with AsyncSessionLocal() as session:
        rec_result = await session.execute(select(Recommendation).where(Recommendation.ai_session.is_(None)))
        for rec in rec_result.scalars().all():
            ticker_sector_map[rec.ticker] = rec.sector or "기타"

    community_context = ""
    political_context = ""

    # R1 Gemini 호출
    from services.gemini_service import _RECOMMEND_R1_PROMPT
    today = _dt.today().strftime("%Y년 %m월 %d일")
    session_label = "아침 분석" if session_name == "morning" else "저녁 분석"
    news_lines = []
    for i, n in enumerate(news_list[:40], 1):
        line = f"[{i}] [{n.get('sector','일반')}] {n.get('title','')}"
        if n.get("summary"):
            line += f" — {n['summary']}"
        news_lines.append(line)
    sector_lines = [f"- {s}: {w:.1f}%" for s, w in sorted(portfolio_sectors.items(), key=lambda x: -x[1])]

    r1_prompt = _RECOMMEND_R1_PROMPT.format(
        date=today, session=session_label, news_count=len(news_list[:40]),
        news_summaries="\n".join(news_lines),
        portfolio_sectors="\n".join(sector_lines) if sector_lines else "포트폴리오 없음",
        community_context=community_context,
        political_context=political_context or "정치 데이터 없음",
    )
    logger.info(f"run_ai_r1: calling Gemini R1 (session={session_name})")
    r1_raw = await call_gemini(r1_prompt, max_tokens=4096, force_json_mime=True, disable_thinking=True)
    if not r1_raw:
        logger.warning("run_ai_r1: R1 Gemini call failed")
        return False

    try:
        r1_data = _json.loads(r1_raw)
        candidates = r1_data.get("candidates", [])
    except Exception as e:
        logger.warning(f"run_ai_r1: parse error: {e}")
        return False

    if not candidates:
        logger.info("run_ai_r1: no candidates")
        return False

    logger.info(f"run_ai_r1: {len(candidates)} candidates: {[c.get('ticker') for c in candidates]}")

    # 현재가 + 기술적 분석 보충
    r1_tickers = [c.get("ticker", "") for c in candidates if c.get("ticker")]
    from services.stock_service import fetch_current_price
    loop = asyncio.get_running_loop()  # noqa: F841

    missing_price = [t for t in r1_tickers if t not in {t2 for t2 in top_tickers}]  # noqa: F841
    extra_prices = await asyncio.gather(*[fetch_current_price(t) for t in r1_tickers], return_exceptions=True)
    price_data: dict[str, float] = {}
    for t, p in zip(r1_tickers, extra_prices):
        if isinstance(p, (int, float)) and p:
            price_data[t] = p

    from services.technical_analysis import analyze_ticker
    tech_results = await asyncio.gather(*[analyze_ticker(t) for t in r1_tickers], return_exceptions=True)
    technical_data: dict[str, dict] = {}
    for t, r in zip(r1_tickers, tech_results):
        technical_data[t] = r if isinstance(r, dict) else {"available": False}

    # 중간 상태 저장
    state = {
        "session_name": session_name,
        "candidates": candidates,
        "news_list": news_list[:40],
        "portfolio_sectors": portfolio_sectors,
        "price_data": price_data,
        "technical_data": technical_data,
        "community_context": community_context,
        "political_context": political_context,
        "ticker_counts": dict(ticker_counts),
        "top_tickers": top_tickers,
    }
    await _save_cycle_state(session_name, 1, state)
    return True


async def run_ai_r2(session_name: str = "evening") -> bool:
    """Step 2: DB에서 R1 상태 로드 → R2 기술적 검증 → 상태 저장.

    returns True if successful, False otherwise.
    """
    state = await _load_cycle_state(session_name, required_step=1)
    if not state:
        return False

    import json as _json

    from services.gemini_service import _RECOMMEND_R2_PROMPT, call_gemini, get_usage_stats

    stats = get_usage_stats()
    if stats["rate_limited"]:
        logger.warning(f"run_ai_r2 skipped: Gemini rate-limited ({stats['rate_limit_seconds_remaining']}s)")
        return False

    candidates = state["candidates"]
    technical_data = state["technical_data"]

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

    r2_prompt = _RECOMMEND_R2_PROMPT.format(
        candidates_json=_json.dumps(candidates, ensure_ascii=False),
        technical_data="\n".join(tech_lines),
    )
    logger.info(f"run_ai_r2: calling Gemini R2 (session={session_name})")
    r2_raw = await call_gemini(r2_prompt, max_tokens=3000, force_json_mime=True, disable_thinking=True)

    validations_map: dict[str, dict] = {}
    if r2_raw:
        try:
            r2_data = _json.loads(r2_raw)
            for v in r2_data.get("validations", []):
                validations_map[v.get("ticker", "")] = v
        except Exception as e:
            logger.warning(f"run_ai_r2: parse error: {e}")

    filtered_candidates = [
        c for c in candidates
        if validations_map.get(c.get("ticker", {}), {}).get("confidence", "medium") != "low"
    ]
    if not filtered_candidates:
        filtered_candidates = candidates

    logger.info(f"run_ai_r2: {len(filtered_candidates)} passed validation")

    # 상태 업데이트 저장
    state["validations_map"] = validations_map
    state["filtered_candidates"] = filtered_candidates
    await _save_cycle_state(session_name, 2, state)
    return True


async def run_ai_r3(session_name: str = "evening") -> bool:
    """Step 3: DB에서 R2 상태 로드 → R3 최종 선별 → Recommendation DB 저장.

    returns True if successful, False otherwise.
    """
    state = await _load_cycle_state(session_name, required_step=2)
    if not state:
        return False

    import json as _json

    from services.gemini_service import _RECOMMEND_R3_PROMPT, call_gemini, get_usage_stats

    stats = get_usage_stats()
    if stats["rate_limited"]:
        logger.warning(f"run_ai_r3 skipped: Gemini rate-limited ({stats['rate_limit_seconds_remaining']}s)")
        return False

    filtered_candidates = state["filtered_candidates"]
    validations_map = state["validations_map"]
    price_data = state["price_data"]
    portfolio_sectors = state["portfolio_sectors"]  # noqa: F841
    ticker_counts = state["ticker_counts"]
    top_tickers = state["top_tickers"]

    combined = [{**c, **validations_map.get(c.get("ticker", ""), {})} for c in filtered_candidates]
    price_lines = [f"- {ticker}: {price:,.0f}원" for ticker, price in price_data.items() if price]
    price_text = "\n".join(price_lines) if price_lines else "가격 정보 없음"

    r3_prompt = _RECOMMEND_R3_PROMPT.format(
        combined_json=_json.dumps(combined, ensure_ascii=False),
        price_data=price_text,
    )
    logger.info(f"run_ai_r3: calling Gemini R3 (session={session_name})")
    r3_raw = await call_gemini(r3_prompt, max_tokens=4096, force_json_mime=True, disable_thinking=True)
    if not r3_raw:
        logger.warning("run_ai_r3: R3 Gemini call failed")
        return False

    try:
        r3_data = _json.loads(r3_raw)
        ai_recs = r3_data.get("recommendations", [])
    except Exception as e:
        logger.warning(f"run_ai_r3: parse error: {e}")
        return False

    if not ai_recs:
        logger.warning("run_ai_r3: no recommendations returned")
        return False

    # DB 저장
    async with AsyncSessionLocal() as session:
        await session.execute(delete(Recommendation))
        await session.commit()

    now = datetime.utcnow()
    portfolio_sectors_current = await get_portfolio_sectors()

    # price_results 재구성 (change_pct용)
    from services.stock_service import _fetch_price_detail_sync
    loop = asyncio.get_running_loop()
    price_results = await asyncio.gather(
        *[loop.run_in_executor(None, _fetch_price_detail_sync, t) for t in top_tickers],
        return_exceptions=True,
    )

    async with AsyncSessionLocal() as session:
        for rec in ai_recs:
            ticker = rec.get("ticker", "")
            sector = rec.get("sector") or "기타"
            sector_weight = portfolio_sectors_current.get(sector, 0.0)
            latest_price = price_data.get(ticker)
            change_pct = None
            for t, pr in zip(top_tickers, price_results):
                if t == ticker and isinstance(pr, dict):
                    change_pct = pr.get("day_change_pct")
                    break
            r = Recommendation(
                ticker=ticker, name=rec.get("name", ticker), sector=sector,
                sector_weight=sector_weight, news_count=ticker_counts.get(ticker, 0),
                latest_price=latest_price, change_pct=change_pct,
                strength=rec.get("strength", "normal"), reason=rec.get("reason"),
                confidence=rec.get("confidence"), ai_session=session_name,
                entry_price=rec.get("entry_price"), entry_range_low=rec.get("entry_range_low"),
                entry_range_high=rec.get("entry_range_high"), target_price=rec.get("target_price"),
                target_return_pct=rec.get("target_return_pct"), stop_loss_price=rec.get("stop_loss_price"),
                stop_loss_pct=rec.get("stop_loss_pct"), technical_summary=rec.get("technical_summary"),
                generated_at=now,
            )
            session.add(r)
        await session.commit()

    # 사용한 cycle state 삭제
    async with AsyncSessionLocal() as session:
        await session.execute(delete(AiCycleState).where(AiCycleState.session_name == session_name))
        await session.commit()

    await _recommend_cache.clear(_RECOMMEND_CACHE_KEY)
    logger.info(f"run_ai_r3: {len(ai_recs)} recommendations saved (session={session_name})")
    return True
