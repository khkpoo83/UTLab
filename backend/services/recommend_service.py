import asyncio
import json
import logging
from collections import Counter
from datetime import datetime, timedelta, date as _date
from typing import Any

from sqlalchemy import select, delete, String
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import News, Portfolio, Recommendation, StockMaster, AiCycleState, AsyncSessionLocal
from utils.cache import SimpleCache

logger = logging.getLogger(__name__)

# In-memory cache for recommendation results (5 minute TTL)
_recommend_cache = SimpleCache()
_RECOMMEND_CACHE_KEY = "recommendations"
_RECOMMEND_TTL = 300.0  # 5 minutes

SECTORS = [
    "IT/반도체",
    "엔터/게임",
    "금융",
    "에너지",
    "바이오/헬스케어",
    "소비재",
    "산업재",
    "통신",
    "유틸리티",
    "부동산",
    "소재",
    "자동차",
    "방위산업",
    "AI/로봇",
    "친환경/ESG",
]

# 한국 주식 표준 섹터 분류 (뉴스 섹터 → 주식 섹터 매핑)
KR_SECTOR_MAP = {
    # 기술/IT
    "IT/반도체": ["반도체", "IT", "디스플레이", "전자부품", "소프트웨어", "인터넷"],
    "전기/전자": ["전기전자", "전자", "통신장비", "반도체장비"],
    # 엔터/게임
    "엔터/게임": ["게임", "엔터테인먼트", "미디어", "방송", "영화", "콘텐츠"],
    # 금융
    "금융": ["은행", "증권", "보험", "금융", "카드", "저축은행"],
    # 헬스케어
    "바이오/헬스케어": ["바이오", "제약", "의료기기", "헬스케어", "의약품"],
    # 소비재
    "소비재": ["유통", "소비재", "식품", "의류", "화장품", "생활용품"],
    # 산업재
    "산업재": ["기계", "조선", "자동차부품", "항공", "건설기계"],
    # 자동차
    "자동차": ["자동차", "전기차", "배터리", "자동차부품"],
    # 에너지/화학
    "에너지": ["에너지", "정유", "화학", "석유화학", "가스"],
    # 건설/부동산
    "부동산": ["건설", "부동산", "건자재"],
    # 통신
    "통신": ["통신", "이동통신", "통신서비스"],
    # 유틸리티
    "유틸리티": ["전력", "가스", "수도", "유틸리티"],
    # 소재
    "소재": ["소재", "철강", "비철금속", "금속"],
    # 방산
    "방위산업": ["방산", "방위", "항공우주"],
    # 테마
    "AI/로봇": ["인공지능", "AI", "로봇", "자동화"],
    "친환경/ESG": ["친환경", "ESG", "태양광", "풍력", "수소"],
}


# 네이버 업종명 → 내부 섹터 매핑
NAVER_INDUSTRY_TO_SECTOR: dict[str, str] = {
    # IT/반도체
    "반도체": "IT/반도체", "반도체및반도체장비": "IT/반도체", "반도체장비및재료": "IT/반도체",
    "소프트웨어": "IT/반도체", "IT서비스": "IT/반도체", "인터넷": "IT/반도체",
    "게임엔터테인먼트": "엔터/게임", "컴퓨터와주변기기": "IT/반도체",
    "디스플레이패널": "IT/반도체", "통신장비": "IT/반도체", "전자장비와기기": "IT/반도체",
    "전자부품": "IT/반도체", "전기제품": "IT/반도체",
    # 금융
    "은행": "금융", "증권": "금융", "보험": "금융", "보험및연금서비스": "금융",
    "다각화된금융서비스": "금융", "소비자금융": "금융", "자산관리및수탁은행": "금융",
    "투자금융": "금융",
    # 바이오/헬스케어
    "제약": "바이오/헬스케어", "바이오테크놀로지": "바이오/헬스케어",
    "생명과학도구및서비스": "바이오/헬스케어", "의료기기": "바이오/헬스케어",
    "의료장비와용품": "바이오/헬스케어", "건강관리기술": "바이오/헬스케어",
    "건강관리시설": "바이오/헬스케어",
    # 소비재
    "식품": "소비재", "음료": "소비재", "식품및기본식료품소매": "소비재",
    "가정용기기와용품": "소비재", "가정용품": "소비재", "섬유": "소비재",
    "의류및의복": "소비재", "화장품": "소비재", "유통": "소비재",
    "무역회사와판매업체": "소비재", "음식료품": "소비재",
    "백화점및일반상점": "소비재", "전문소매": "소비재",
    # 산업재
    "기계": "산업재", "조선": "산업재", "항공기와국방": "산업재",
    "산업용기계": "산업재", "건설기계": "산업재", "자동차부품": "산업재",
    "항공사": "산업재", "운송인프라": "산업재", "해운사": "산업재",
    "물류서비스": "산업재", "상업서비스와공급품": "산업재",
    # 자동차
    "자동차": "자동차", "자동차및트럭": "자동차", "자동차부품및장비": "자동차",
    # 에너지/화학
    "화학": "에너지", "정유": "에너지", "석유화학": "에너지",
    "에너지장비및서비스": "에너지", "정유및가스": "에너지",
    "석유및가스": "에너지", "에너지": "에너지",
    # 건설/부동산
    "건설": "부동산", "건설및엔지니어링": "부동산", "건자재": "부동산",
    "부동산": "부동산", "건축소재": "부동산",
    # 통신
    "통신서비스": "통신", "이동통신": "통신", "통신": "통신",
    "다각화된통신서비스": "통신", "무선통신서비스": "통신",
    # 유틸리티
    "전기유틸리티": "유틸리티", "가스유틸리티": "유틸리티",
    "수도유틸리티": "유틸리티", "유틸리티": "유틸리티",
    "복합유틸리티": "유틸리티",
    # 소재
    "철강": "소재", "비철금속": "소재", "금속및광업": "소재",
    "종이와목재": "소재", "용기및포장": "소재", "소재": "소재",
    # 방위산업
    "방위및우주항공": "방위산업", "방산": "방위산업",
    "우주항공과국방": "방위산업", "항공우주": "방위산업", "국방": "방위산업",
    # AI/로봇 (테마)
    "인공지능": "AI/로봇", "로봇": "AI/로봇",
    # 미디어/엔터
    "방송과엔터테인먼트": "엔터/게임", "미디어": "엔터/게임",
    "영화및엔터테인먼트": "엔터/게임",
    # 교육/서비스
    "교육서비스": "소비재", "전문및상업서비스": "산업재",
}


def _industry_to_sector(industry: str) -> str | None:
    """네이버 업종명으로 섹터 반환"""
    if not industry:
        return None
    # 정확 매핑 먼저
    if industry in NAVER_INDUSTRY_TO_SECTOR:
        return NAVER_INDUSTRY_TO_SECTOR[industry]
    # 부분 문자열 매핑
    industry_lower = industry.lower()
    for key, sector in NAVER_INDUSTRY_TO_SECTOR.items():
        if key.lower() in industry_lower or industry_lower in key.lower():
            return sector
    return None


def _infer_sector_from_name(name: str) -> str | None:
    """종목명에서 섹터 추론 (ETF → 직접 매핑 → 키워드 순)"""
    # ETF 이름 패턴 (TIGER 반도체, KODEX 2차전지산업 등)
    ETF_PREFIXES = ["TIGER", "KODEX", "KBSTAR", "HANARO", "ARIRANG", "SOL", "ACE", "KOSEF", "RISE", "PLUS", "SMART", "TREX", "TIMEFOLIO"]
    is_etf = any(name.upper().startswith(p) for p in ETF_PREFIXES)
    if is_etf:
        ETF_SECTOR_MAP = {
            "반도체": "IT/반도체", "IT": "IT/반도체", "정보기술": "IT/반도체",
            "2차전지": "자동차", "배터리": "자동차", "전기차": "자동차", "EV": "자동차",
            "바이오": "바이오/헬스케어", "헬스케어": "바이오/헬스케어", "제약": "바이오/헬스케어",
            "금융": "금융", "은행": "금융", "증권": "금융",
            "에너지": "에너지", "화학": "에너지",
            "방산": "방위산업", "방위": "방위산업", "항공우주": "방위산업",
            "자동차": "자동차", "미래차": "자동차",
            "소재": "소재", "철강": "소재",
            "통신": "통신",
            "부동산": "부동산", "건설": "부동산",
            "AI": "IT/반도체", "인공지능": "IT/반도체", "로봇": "IT/반도체",
        }
        for keyword, sector in ETF_SECTOR_MAP.items():
            if keyword in name:
                return sector

    # 대표 종목 직접 매핑
    DIRECT_MAP: dict[str, str] = {
        "삼성전자": "IT/반도체", "SK하이닉스": "IT/반도체", "삼성SDI": "자동차",
        "LG에너지솔루션": "자동차", "에코프로": "자동차", "에코프로비엠": "자동차",
        "포스코퓨처엠": "자동차", "현대차": "자동차", "기아": "자동차",
        "삼성바이오로직스": "바이오/헬스케어", "셀트리온": "바이오/헬스케어",
        "유한양행": "바이오/헬스케어", "한미약품": "바이오/헬스케어",
        "NAVER": "IT/반도체", "카카오": "IT/반도체",
        "KB금융": "금융", "신한지주": "금융", "하나금융지주": "금융",
        "우리금융지주": "금융", "삼성생명": "금융", "한화": "방위산업",
        "현대로템": "방위산업", "한국항공우주": "방위산업", "LIG넥스원": "방위산업",
        "POSCO홀딩스": "소재", "고려아연": "소재", "현대제철": "소재",
        "SK텔레콤": "통신", "KT": "통신", "LG유플러스": "통신",
        "한국전력": "유틸리티", "한국가스공사": "유틸리티",
        "삼성물산": "산업재", "현대건설": "부동산", "GS건설": "부동산",
        "미래에셋": "금융", "삼성증권": "금융", "한국투자증권": "금융",
        "SK이노베이션": "에너지", "S-Oil": "에너지", "GS": "에너지",
        "두산에너빌리티": "산업재", "현대중공업": "산업재", "HD현대": "산업재",
        "한화에어로스페이스": "방위산업", "한화시스템": "방위산업",
        "이마트": "소비재", "롯데쇼핑": "소비재", "신세계": "소비재",
        "삼성SDS": "IT/반도체", "LG CNS": "IT/반도체",
        # 게임
        "펄어비스": "엔터/게임", "넥슨": "엔터/게임", "엔씨소프트": "엔터/게임",
        "넷마블": "엔터/게임", "컴투스": "엔터/게임", "웹젠": "엔터/게임",
        "카카오게임즈": "엔터/게임", "위메이드": "엔터/게임", "크래프톤": "엔터/게임",
        # 엔터/미디어
        "하이브": "엔터/게임", "SM엔터": "엔터/게임", "JYP엔터": "엔터/게임",
        "YG엔터": "엔터/게임", "카카오엔터": "엔터/게임", "CJ ENM": "엔터/게임",
        "스튜디오드래곤": "엔터/게임",
        # IT/소프트웨어
        "토탈소프트": "IT/반도체", "엑셈": "IT/반도체", "엔에프씨": "IT/반도체",
        "동운아나텍": "IT/반도체", "아나텍": "IT/반도체",
        # 결제/핀테크
        "다날": "금융", "카카오페이": "금융", "토스": "금융", "케이뱅크": "금융",
        # 식품/소비재
        "하림": "소비재", "오뚜기": "소비재", "농심": "소비재", "CJ제일제당": "소비재",
        "롯데제과": "소비재", "빙그레": "소비재",
        # 방위산업/광학
        "아이쓰리시스템": "방위산업", "한화비전": "방위산업", "LIG": "방위산업",
        # 바이오
        "엔솔바이오": "바이오/헬스케어", "엔솔": "바이오/헬스케어",
    }
    for key, sector in DIRECT_MAP.items():
        if key in name:
            return sector

    # 키워드 패턴 매칭
    name_lower = name.lower()
    # 특정 패턴 우선 처리
    kr_extended = {
        **KR_SECTOR_MAP,
        "IT/반도체": KR_SECTOR_MAP.get("IT/반도체", []) + ["삼성", "하이닉스", "네이버", "카카오", "소프트웨어", "소프트", "테크", "시스템즈", "솔루션", "데이터"],
        "엔터/게임": KR_SECTOR_MAP.get("엔터/게임", []) + ["게임", "엔터", "미디어", "방송", "콘텐츠", "스튜디오"],
        "자동차": KR_SECTOR_MAP.get("자동차", []) + ["현대", "기아", "배터리", "충전"],
        "부동산": KR_SECTOR_MAP.get("부동산", []) + ["건설", "건자재", "시멘트"],
        "소재": KR_SECTOR_MAP.get("소재", []) + ["강", "철", "알루미늄"],
        "금융": KR_SECTOR_MAP.get("금융", []) + ["페이", "핀테크", "캐피탈", "저축"],
        "소비재": KR_SECTOR_MAP.get("소비재", []) + ["식품", "농업", "축산", "유통"],
        "바이오/헬스케어": KR_SECTOR_MAP.get("바이오/헬스케어", []) + ["사이언스", "메디"],
    }
    for sector, keywords in kr_extended.items():
        for kw in keywords:
            if kw.lower() in name_lower:
                return sector
    return None



async def get_portfolio_sectors() -> dict[str, float]:
    """포트폴리오 섹터 비중 계산 (yfinance 미사용, avg_price 기반)"""
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Portfolio))
        holdings = result.scalars().all()

        if not holdings:
            return {}

        # StockMaster에서 industry 일괄 조회
        tickers = [h.ticker for h in holdings]
        sm_result = await session.execute(
            select(StockMaster).where(StockMaster.ticker.in_(tickers))
        )
        sm_map: dict[str, StockMaster] = {r.ticker: r for r in sm_result.scalars().all()}

        total_value = 0.0
        sector_values: dict[str, float] = {}
        to_update: list[tuple[Portfolio, str]] = []

        for holding in holdings:
            value = holding.avg_price * holding.quantity
            total_value += value

            # 섹터 결정 우선순위: DB 저장값 → StockMaster industry → 이름 추론 → 기본값
            sector = holding.sector
            if not sector:
                sm = sm_map.get(holding.ticker)
                if sm and sm.industry:
                    sector = _industry_to_sector(sm.industry)
            if not sector:
                sector = _infer_sector_from_name(holding.name or "")
            if not sector:
                sector = "기타"

            # 섹터 추론값을 DB에 저장 (sector 미설정 종목만)
            if not holding.sector and sector != "기타":
                to_update.append((holding, sector))

            sector_values[sector] = sector_values.get(sector, 0.0) + value

        # 추론된 섹터 일괄 저장
        if to_update:
            for holding, sector in to_update:
                holding.sector = sector
            await session.commit()

        if total_value == 0:
            return {}

        return {sector: (value / total_value) * 100 for sector, value in sector_values.items()}


async def _get_korean_ticker_map() -> dict[str, str]:
    """StockMaster KR 종목: code → canonical_ticker (예: "035420" → "035420.KS")"""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(StockMaster).where(StockMaster.market == "KR")
        )
        rows = result.scalars().all()
    return {r.ticker.split(".")[0].upper(): r.ticker for r in rows}


async def recalculate_recommendations(use_ai: bool = False, session_name: str = "evening") -> None:
    """추천 재계산. use_ai=True면 Gemini AI 사용, False면 기존 규칙 기반."""
    if use_ai:
        await run_ai_recommendation_cycle(session_name=session_name)
    else:
        await _recalculate_rule_based()


async def _recalculate_rule_based() -> None:
    """기존 규칙 기반 추천 (뉴스 빈도 카운트)"""
    # Invalidate cache when recommendations are recalculated
    await _recommend_cache.clear(_RECOMMEND_CACHE_KEY)
    cutoff = datetime.utcnow() - timedelta(days=7)

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(News)
            .where(
                News.status == "done",
                News.created_at >= cutoff,
                News.related_stocks.isnot(None),
            )
        )
        recent_news = result.scalars().all()

    # 한국 종목 맵: code → canonical ticker (예: "035420" → "035420.KS")
    kr_ticker_map = await _get_korean_ticker_map()

    ticker_counts: Counter = Counter()
    ticker_news_sectors: dict[str, list[str]] = {}

    for news in recent_news:
        if not news.related_stocks:
            continue
        for ticker in news.related_stocks:
            if not ticker:
                continue
            ticker_str = str(ticker)
            ticker_code = ticker_str.split(".")[0].upper()

            # 한국 종목: canonical ticker로 정규화 (035420, 035420.TW 등 → 035420.KS)
            if ticker_code in kr_ticker_map:
                canonical = kr_ticker_map[ticker_code]
            elif ticker_str.endswith(".KS") or ticker_str.endswith(".KQ"):
                canonical = ticker_str  # suffix는 맞지만 DB에 없는 종목
            else:
                continue  # 한국 종목 아니면 스킵

            ticker_counts[canonical] += 1
            if news.sector:
                ticker_news_sectors.setdefault(canonical, []).append(news.sector)

    if not ticker_counts:
        return

    portfolio_sectors = await get_portfolio_sectors()

    top_tickers = [t for t, _ in ticker_counts.most_common(30)]

    # DB에서 이름 일괄 조회: 직접 조회 + 코드 기반 fallback
    async with AsyncSessionLocal() as session:
        master_result = await session.execute(
            select(StockMaster).where(StockMaster.ticker.in_(top_tickers))
        )
        rows = master_result.scalars().all()
        master_map: dict[str, StockMaster] = {r.ticker: r for r in rows}
        # 코드 기반 보조 맵 (suffix 없는 경우 대비)
        code_map: dict[str, StockMaster] = {r.ticker.split(".")[0].upper(): r for r in rows}

    # 가격 조회: 한국 주식은 Naver API, 미국은 yfinance history (rate limit 낮음)
    from services.stock_service import _fetch_price_detail_sync
    loop = asyncio.get_running_loop()
    price_results = await asyncio.gather(
        *[loop.run_in_executor(None, _fetch_price_detail_sync, t) for t in top_tickers],
        return_exceptions=True,
    )

    async with AsyncSessionLocal() as session:
        await session.execute(delete(Recommendation))
        await session.commit()

    recommendations = []
    for ticker, price_info in zip(top_tickers, price_results):
        master = master_map.get(ticker) or code_map.get(ticker.split(".")[0].upper())
        name = (master.name if master else None) or ticker

        # 이름을 해석할 수 없는 티커 (StockMaster에 없는 경우) 스킵
        if name == ticker:
            logger.debug(f"Skipping recommendation for unknown ticker: {ticker}")
            continue

        # 섹터: StockMaster industry → 이름 추론 → 뉴스 섹터 → 기타
        sector = None
        if master and master.industry:
            sector = _industry_to_sector(master.industry)
        if not sector:
            sector = _infer_sector_from_name(name)
        if not sector:
            sectors_from_news = ticker_news_sectors.get(ticker, [])
            if sectors_from_news:
                sector = Counter(sectors_from_news).most_common(1)[0][0]
        if not sector:
            sector = "기타"

        price = None
        change_pct = None
        if isinstance(price_info, dict) and price_info:
            price = price_info.get("price")
            change_pct = price_info.get("day_change_pct")

        sector_weight = portfolio_sectors.get(sector, 0.0)

        if sector_weight == 0:
            strength = "strong"
        elif sector_weight < 10:
            strength = "normal"
        else:
            strength = "watch"

        recommendations.append({
            "ticker": ticker,
            "name": name,
            "sector": sector,
            "sector_weight": sector_weight,
            "news_count": ticker_counts[ticker],
            "latest_price": price,
            "change_pct": change_pct,
            "strength": strength,
        })

    async with AsyncSessionLocal() as session:
        for rec in recommendations:
            r = Recommendation(**rec)
            session.add(r)
        await session.commit()

    logger.info(f"Recalculated {len(recommendations)} recommendations")


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
            affiliation, pol_weight = await calculate_political_weight(
                rec.ticker, approval_data, upcoming_events
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

    from services.gemini_service import generate_ai_recommendations as _gen
    # 여기서는 call_gemini를 직접 사용하기 위해 R1만 실행하는 방식 대신
    # 기존 generate_ai_recommendations를 3단계로 쪼개야 하므로 내부 로직 재현

    from services.gemini_service import call_gemini, get_usage_stats
    import json as _json
    from datetime import date as _dt

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
    from services.stock_service import fetch_current_price, _fetch_price_detail_sync
    loop = asyncio.get_running_loop()

    missing_price = [t for t in r1_tickers if t not in {t2 for t2 in top_tickers}]
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

    from services.gemini_service import call_gemini, get_usage_stats, _RECOMMEND_R2_PROMPT
    import json as _json

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

    from services.gemini_service import call_gemini, get_usage_stats, _RECOMMEND_R3_PROMPT
    import json as _json

    stats = get_usage_stats()
    if stats["rate_limited"]:
        logger.warning(f"run_ai_r3 skipped: Gemini rate-limited ({stats['rate_limit_seconds_remaining']}s)")
        return False

    filtered_candidates = state["filtered_candidates"]
    validations_map = state["validations_map"]
    price_data = state["price_data"]
    portfolio_sectors = state["portfolio_sectors"]
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


async def _get_latest_news_title(session: AsyncSession, ticker: str, name: str) -> str | None:
    """종목의 최신 뉴스 제목 1개 조회"""
    try:
        # ticker 기준 (related_stocks JSON에 포함)
        result = await session.execute(
            select(News.title)
            .where(News.status == "done")
            .where(News.related_stocks.cast(String).contains(ticker))
            .order_by(News.published_at.desc())
            .limit(1)
        )
        row = result.scalar_one_or_none()
        if row:
            return row
        # 종목명 기준 fallback
        if name and name != ticker:
            result2 = await session.execute(
                select(News.title)
                .where(News.status == "done")
                .where(News.title.contains(name))
                .order_by(News.published_at.desc())
                .limit(1)
            )
            return result2.scalar_one_or_none()
    except Exception as e:
        logger.debug(f"_get_latest_news_title failed for {ticker}: {e}")
    return None


async def get_recommendations() -> list[dict]:
    # Check cache first
    cached = await _recommend_cache.get(_RECOMMEND_CACHE_KEY)
    if cached is not None:
        return cached

    # 포트폴리오 보유 종목 조회
    async with AsyncSessionLocal() as session:
        portfolio_result = await session.execute(select(Portfolio))
        holdings = portfolio_result.scalars().all()

    portfolio_tickers = {h.ticker for h in holdings}

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Recommendation).order_by(
                Recommendation.sector,
                Recommendation.news_count.desc(),
            )
        )
        rows = result.scalars().all()

    sector_groups: dict[str, list[dict]] = {}
    seen_tickers: set[str] = set()

    # 최신 뉴스 제목 일괄 조회
    async with AsyncSessionLocal() as session:
        news_tasks = []
        all_tickers_names: list[tuple[str, str]] = []

        for row in rows:
            all_tickers_names.append((row.ticker, row.name or row.ticker))
        for h in holdings:
            if h.ticker not in {r.ticker for r in rows}:
                all_tickers_names.append((h.ticker, h.name or h.ticker))

        latest_news_map: dict[str, str | None] = {}
        for ticker, name in all_tickers_names:
            title = await _get_latest_news_title(session, ticker, name)
            latest_news_map[ticker] = title

    # 1) AI 분석 완료 추천 종목만 표시 (ai_session 있는 것만)
    rows = [r for r in rows if r.ai_session is not None]

    for row in rows:
        sector = row.sector or "기타"
        is_portfolio = row.ticker in portfolio_tickers
        seen_tickers.add(row.ticker)
        sector_groups.setdefault(sector, []).append({
            "id": row.id,
            "ticker": row.ticker,
            "name": row.name,
            "sector": row.sector,
            "sector_weight": row.sector_weight,
            "news_count": row.news_count,
            "latest_price": row.latest_price,
            "change_pct": row.change_pct,
            "strength": row.strength,
            "is_portfolio": is_portfolio,
            "source": "portfolio" if is_portfolio else "news",
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "latest_news_title": latest_news_map.get(row.ticker),
            "reason": row.reason,
            "confidence": row.confidence,
            "ai_session": row.ai_session,
            "entry_price": row.entry_price,
            "entry_range_low": row.entry_range_low,
            "entry_range_high": row.entry_range_high,
            "target_price": row.target_price,
            "target_return_pct": row.target_return_pct,
            "stop_loss_price": row.stop_loss_price,
            "stop_loss_pct": row.stop_loss_pct,
            "technical_summary": row.technical_summary,
            "generated_at": row.generated_at.isoformat() if row.generated_at else None,
            "community_sentiment": row.community_sentiment,
            "political_theme": row.political_theme,
            "political_weight": row.political_weight,
        })

    # 2) 추천에 없는 포트폴리오 종목 추가
    for h in holdings:
        if h.ticker in seen_tickers:
            continue
        sector = h.sector or _infer_sector_from_name(h.name or "") or "기타"
        sector_groups.setdefault(sector, []).append({
            "id": None,
            "ticker": h.ticker,
            "name": h.name,
            "sector": sector,
            "sector_weight": 0.0,
            "news_count": 0,
            "latest_price": h.avg_price,
            "change_pct": None,
            "strength": "watch",
            "is_portfolio": True,
            "source": "portfolio",
            "created_at": None,
            "latest_news_title": latest_news_map.get(h.ticker),
            "reason": None,
            "confidence": None,
            "ai_session": None,
            "entry_price": None,
            "entry_range_low": None,
            "entry_range_high": None,
            "target_price": None,
            "target_return_pct": None,
            "stop_loss_price": None,
            "stop_loss_pct": None,
            "technical_summary": None,
            "generated_at": None,
            "community_sentiment": None,
            "political_theme": None,
            "political_weight": None,
        })

    result_list = []
    for sector, items in sector_groups.items():
        # 섹터 weight: 추천 종목에서 가져오거나 0
        rec_items = [i for i in items if i.get("source") == "news"]
        sector_weight = rec_items[0]["sector_weight"] if rec_items else 0
        result_list.append({
            "sector": sector,
            "sector_weight": sector_weight,
            "items": items,
        })

    result_list.sort(key=lambda x: x["sector_weight"])

    # Cache the result
    await _recommend_cache.set(_RECOMMEND_CACHE_KEY, result_list, ttl_seconds=_RECOMMEND_TTL)

    return result_list
