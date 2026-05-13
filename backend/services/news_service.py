import asyncio
import hashlib
import logging
import uuid
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from typing import Any, Optional

import feedparser
import pytz
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import News, AsyncSessionLocal

logger = logging.getLogger(__name__)

RSS_FEEDS = [
    {"name": "한국경제", "url": "https://www.hankyung.com/feed/economy"},
    {"name": "매일경제", "url": "https://www.mk.co.kr/rss/40300001/"},
    {"name": "연합뉴스", "url": "https://www.yna.co.kr/rss/economy.xml"},
    {"name": "머니투데이", "url": "https://www.mt.co.kr/rss/1000/1010.xml"},
]


def _parse_feed_sync(feed_info: dict) -> list[dict]:
    try:
        parsed = feedparser.parse(feed_info["url"])
        articles = []
        for entry in parsed.entries[:20]:
            url = entry.get("link", "")
            if not url:
                continue
            url_hash = hashlib.sha256(url.encode()).hexdigest()
            title = entry.get("title", "").strip()

            published_at = None
            if hasattr(entry, "published_parsed") and entry.published_parsed:
                try:
                    published_at = datetime(*entry.published_parsed[:6])
                except Exception:
                    pass

            # RSS summary/description (기사 첫 단락, 없으면 None)
            description = (
                entry.get("summary") or entry.get("description") or ""
            ).strip() or None
            # HTML 태그 제거 (간단히)
            if description:
                import re as _re
                description = _re.sub(r'<[^>]+>', '', description).strip() or None
            if description and len(description) > 300:
                description = description[:300]

            articles.append({
                "title": title,
                "url": url,
                "url_hash": url_hash,
                "source": feed_info["name"],
                "published_at": published_at,
                "description": description,
            })
        return articles
    except Exception as e:
        logger.warning(f"Feed parse error for {feed_info['name']}: {e}")
        return []


# ── 투자 관련성 필터 ───────────────────────────────────────────────────────────
_INVESTMENT_KW = [
    # 시장/지수
    "주식", "증시", "코스피", "코스닥", "나스닥", "다우", "s&p", "닛케이", "항셍",
    # 거시경제
    "금리", "환율", "원달러", "달러", "채권", "국채", "인플레", "기준금리",
    "fed", "연준", "한은", "통화", "경기침체", "경기회복", "gdp", "무역", "수출", "수입",
    "관세",
    # 기업/실적
    "실적", "영업이익", "매출", "순이익", "흑자", "적자", "어닝",
    "상장", "공모", "ipo", "유상증자", "배당", "자사주", "지분", "m&a", "인수합병",
    # 금융상품/투자
    "펀드", "etf", "리츠", "선물", "옵션", "공매도", "외국인", "기관투자",
    "증권", "투자", "포트폴리오", "헤지",
    # 산업/섹터
    "반도체", "배터리", "전기차", "2차전지", "바이오", "헬스케어", "방산", "조선",
    "철강", "석유", "정유", "태양광", "hbm",
    # 주요 기업명 (검색 빈도 높은 것만)
    "삼성전자", "sk하이닉스", "현대차", "lg에너지", "셀트리온", "카카오", "네이버",
    "포스코", "삼성sdi", "기아", "kb금융", "신한금융",
]


def _is_investment_relevant(title: str, description: str | None) -> bool:
    """제목+설명에 투자 관련 키워드가 하나 이상 있으면 True."""
    text = (title + " " + (description or "")).lower()
    return any(kw in text for kw in _INVESTMENT_KW)


async def fetch_all_feeds() -> list[dict]:
    loop = asyncio.get_event_loop()
    tasks = [
        loop.run_in_executor(None, _parse_feed_sync, feed)
        for feed in RSS_FEEDS
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    all_articles = []
    for result in results:
        if isinstance(result, list):
            all_articles.extend(result)
    return all_articles


def _title_similarity(t1: str, t2: str) -> float:
    return SequenceMatcher(None, t1, t2).ratio()


def deduplicate(articles: list[dict]) -> list[dict]:
    seen_hashes: set[str] = set()
    unique = []
    for article in articles:
        h = article["url_hash"]
        if h in seen_hashes:
            continue
        is_dup = False
        for existing in unique:
            if _title_similarity(article["title"], existing["title"]) > 0.8:
                is_dup = True
                break
        if not is_dup:
            seen_hashes.add(h)
            unique.append(article)
    return unique


_PREFIX_RE = None

def _normalize_title(title: str) -> str:
    """그룹핑 비교용 제목 정규화:
    - [속보], [단독], [긴급], [종합] 등 뉴스 접두 태그 제거
    - 특수문자·공백 제거 후 소문자화
    """
    import re
    global _PREFIX_RE
    if _PREFIX_RE is None:
        _PREFIX_RE = re.compile(r'^\s*\[[^\]]{1,10}\]\s*')
    t = title
    # 반복 접두어 제거 (예: [속보][종합])
    while True:
        stripped = _PREFIX_RE.sub('', t)
        if stripped == t:
            break
        t = stripped
    return re.sub(r'[^\w가-힣]', '', t).lower()


def _title_keywords(title: str) -> str:
    """제목 앞 20자 기반 키 (정규화 후)"""
    return _normalize_title(title)[:20]


def group_similar(articles: list[dict]) -> list[dict]:
    """Group similar articles using difflib-based title similarity + prefix matching.

    세 가지 조건으로 그룹화:
    1. 정규화 제목 앞 20자 동일
    2. 정규화 제목 앞 15자 부분 일치
    3. SequenceMatcher 유사도 임계값 초과
    같은 시간대(2시간 이내) 기사끼리는 더 느슨하게 매칭.
    """
    if not articles:
        return articles

    # 정규화 제목 사전 계산
    norm_titles = [_normalize_title(a["title"]) for a in articles]

    groups: dict[int, str] = {}
    for i in range(len(articles)):
        if i not in groups:
            group_id = str(uuid.uuid4())
            groups[i] = group_id
            kw_i = norm_titles[i][:20]
            pub_i = articles[i].get("published_at")
            for j in range(i + 1, len(articles)):
                if j not in groups:
                    kw_j = norm_titles[j][:20]
                    pub_j = articles[j].get("published_at")

                    # 시간 차이 체크 (2시간 이내면 더 느슨하게 매칭)
                    time_close = False
                    if pub_i and pub_j:
                        try:
                            diff = abs((pub_i - pub_j).total_seconds())
                            time_close = diff < 7200
                        except Exception:
                            pass

                    # 조건 1: 정규화 앞 20자 동일
                    if kw_i and kw_j and kw_i == kw_j:
                        groups[j] = group_id
                        continue

                    # 조건 2: 정규화 앞 15자 부분 일치 (time_close 또는 충분히 긴 경우)
                    if len(kw_i) >= 10 and len(kw_j) >= 10 and kw_i[:15] == kw_j[:15]:
                        if time_close or (len(kw_i) >= 15 and len(kw_j) >= 15):
                            groups[j] = group_id
                            continue

                    # 조건 3: difflib 유사도 (정규화 제목 기준)
                    threshold = 0.45 if time_close else 0.6
                    sim = _title_similarity(norm_titles[i], norm_titles[j])
                    if sim > threshold:
                        groups[j] = group_id

    for i, article in enumerate(articles):
        article["group_id"] = groups.get(i, str(uuid.uuid4()))
    return articles


async def _get_existing_url_hashes() -> set[str]:
    """Fetch all existing url_hash values from DB for deduplication."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(News.url_hash))
        return {row[0] for row in result.all()}


async def save_news(articles: list[dict]) -> list[int]:
    if not articles:
        return []

    # Fetch existing hashes once for batch deduplication (avoids N+1 queries)
    existing_hashes = await _get_existing_url_hashes()

    saved_ids = []
    async with AsyncSessionLocal() as session:
        for article in articles:
            url_hash = article["url_hash"]
            if url_hash in existing_hashes:
                continue
            existing_hashes.add(url_hash)  # prevent duplicates within same batch
            news = News(
                title=article["title"],
                url=article["url"],
                url_hash=url_hash,
                source=article.get("source"),
                published_at=article.get("published_at"),
                description=article.get("description"),
                group_id=article.get("group_id"),
                status="pending",
            )
            session.add(news)
            await session.flush()
            saved_ids.append(news.id)
        await session.commit()
    return saved_ids


async def collect_and_save_news() -> list[int]:
    logger.info("Fetching RSS feeds...")
    articles = await fetch_all_feeds()
    logger.info(f"Fetched {len(articles)} articles raw")
    articles = deduplicate(articles)
    logger.info(f"After dedup: {len(articles)} articles")

    # 투자 관련성 필터 (AI 호출 전 사전 제거)
    before = len(articles)
    articles = [a for a in articles if _is_investment_relevant(a["title"], a.get("description"))]
    logger.info(f"After investment filter: {len(articles)} articles (removed {before - len(articles)})")

    # heuristic 그룹핑 (AI 그룹핑 제거 → API 호출 절약)
    articles = group_similar(articles)

    saved_ids = await save_news(articles)
    logger.info(f"Saved {len(saved_ids)} new articles")
    return saved_ids


async def get_top_pending_news_ids(limit: int = 20) -> list[int]:
    """
    그룹별 대표 기사(가장 최신) 중 status=pending인 것을 최신순으로 limit개 반환.
    같은 group_id가 있으면 1개만, 없는 경우(group_id=None)는 개별 처리.
    """
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(News)
            .where(News.status == "pending")
            .order_by(News.published_at.desc().nullslast(), News.created_at.desc())
            .limit(limit * 3)  # 그룹 중복 제거 위해 여유있게 조회
        )
        rows = result.scalars().all()

    seen_groups: set[str] = set()
    top_ids: list[int] = []
    for row in rows:
        gid = row.group_id
        if gid:
            if gid in seen_groups:
                continue
            seen_groups.add(gid)
        top_ids.append(row.id)
        if len(top_ids) >= limit:
            break
    return top_ids


async def get_news_list(
    page: int = 1,
    page_size: int = 30,
    sector: Optional[str] = None,
    status: Optional[str] = None,
    date: Optional[str] = None,
) -> dict:
    KST = pytz.timezone("Asia/Seoul")

    async with AsyncSessionLocal() as session:
        conditions = []
        if sector:
            conditions.append(News.sector == sector)
        if status:
            conditions.append(News.status == status)
        if date:
            target_date = datetime.strptime(date, "%Y-%m-%d")
            start_kst = KST.localize(target_date)
            end_kst = start_kst + timedelta(days=1)
            start_utc = start_kst.astimezone(pytz.utc).replace(tzinfo=None)
            end_utc = end_kst.astimezone(pytz.utc).replace(tzinfo=None)
            conditions.append(
                and_(
                    News.published_at >= start_utc,
                    News.published_at < end_utc,
                )
            )

        base_query = select(News).order_by(News.published_at.desc().nullslast(), News.created_at.desc())
        count_query = select(func.count(News.id))

        if conditions:
            filter_clause = and_(*conditions) if len(conditions) > 1 else conditions[0]
            base_query = base_query.where(filter_clause)
            count_query = count_query.where(filter_clause)

        total_result = await session.scalar(count_query)
        total = total_result or 0

        offset = (page - 1) * page_size
        query = base_query.offset(offset).limit(page_size)
        result = await session.execute(query)
        rows = result.scalars().all()

        return {
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": [
                {
                    "id": r.id,
                    "title": r.title,
                    "url": r.url,
                    "source": r.source,
                    "published_at": r.published_at.isoformat() if r.published_at else None,
                    "summary": r.summary,
                    "sector": r.sector,
                    "related_stocks": r.related_stocks,
                    "group_id": r.group_id,
                    "status": r.status,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in rows
            ],
        }


async def get_ticker_news(ticker: str, limit: int = 15, name: str = "") -> list[dict]:
    """티커 또는 종목명으로 관련 뉴스 조회.
    1차: related_stocks 필드에서 ticker_base 매칭
    2차: 제목에서 name 키워드 매칭 (name 제공 시)
    3차: 최근 done 기사 중 sector 매칭 (fallback)
    """
    ticker_base = ticker.split(".")[0].upper()
    # 이름에서 의미있는 키워드 추출 (2자 이상)
    name_keyword = name.strip() if len(name.strip()) >= 2 else ""

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(News)
            .where(News.status == "done")
            .order_by(News.published_at.desc().nullslast(), News.created_at.desc())
            .limit(300)
        )
        rows = result.scalars().all()

    def to_dict(r: News) -> dict:
        return {
            "id": r.id,
            "title": r.title,
            "url": r.url,
            "source": r.source,
            "published_at": r.published_at.isoformat() if r.published_at else None,
            "summary": r.summary,
            "sector": r.sector,
            "related_stocks": r.related_stocks,
            "status": r.status,
        }

    # 1차: related_stocks ticker 매칭
    matched_ids: set[int] = set()
    matched = []
    for r in rows:
        related = r.related_stocks or []
        if any(ticker_base in str(s).upper() for s in related):
            matched.append(to_dict(r))
            matched_ids.add(r.id)

    # 2차: 종목명 제목 매칭 (부족한 경우)
    if name_keyword and len(matched) < limit:
        for r in rows:
            if r.id in matched_ids:
                continue
            if name_keyword in (r.title or ""):
                matched.append(to_dict(r))
                matched_ids.add(r.id)
                if len(matched) >= limit:
                    break

    return matched[:limit]
