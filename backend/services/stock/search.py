import asyncio

KOREAN_STOCKS = [  # 레거시 폴백 (DB 없을 때)
    # KOSPI 대형주
    {"ticker": "005930.KS", "name": "삼성전자", "exchange": "KOSPI"},
    {"ticker": "000660.KS", "name": "SK하이닉스", "exchange": "KOSPI"},
    {"ticker": "373220.KS", "name": "LG에너지솔루션", "exchange": "KOSPI"},
    {"ticker": "035420.KS", "name": "NAVER", "exchange": "KOSPI"},
    {"ticker": "005380.KS", "name": "현대차", "exchange": "KOSPI"},
    {"ticker": "051910.KS", "name": "LG화학", "exchange": "KOSPI"},
    {"ticker": "006400.KS", "name": "삼성SDI", "exchange": "KOSPI"},
    {"ticker": "068270.KS", "name": "셀트리온", "exchange": "KOSPI"},
    {"ticker": "035720.KS", "name": "카카오", "exchange": "KOSPI"},
    {"ticker": "000270.KS", "name": "기아", "exchange": "KOSPI"},
    {"ticker": "105560.KS", "name": "KB금융", "exchange": "KOSPI"},
    {"ticker": "055550.KS", "name": "신한지주", "exchange": "KOSPI"},
    {"ticker": "096770.KS", "name": "SK이노베이션", "exchange": "KOSPI"},
    {"ticker": "003550.KS", "name": "LG", "exchange": "KOSPI"},
    {"ticker": "066570.KS", "name": "LG전자", "exchange": "KOSPI"},
    {"ticker": "003490.KS", "name": "대한항공", "exchange": "KOSPI"},
    {"ticker": "017670.KS", "name": "SK텔레콤", "exchange": "KOSPI"},
    {"ticker": "030200.KS", "name": "KT", "exchange": "KOSPI"},
    {"ticker": "086790.KS", "name": "하나금융지주", "exchange": "KOSPI"},
    {"ticker": "032830.KS", "name": "삼성생명", "exchange": "KOSPI"},
    {"ticker": "018260.KS", "name": "삼성에스디에스", "exchange": "KOSPI"},
    {"ticker": "011200.KS", "name": "HMM", "exchange": "KOSPI"},
    {"ticker": "009150.KS", "name": "삼성전기", "exchange": "KOSPI"},
    {"ticker": "028260.KS", "name": "삼성물산", "exchange": "KOSPI"},
    {"ticker": "034730.KS", "name": "SK", "exchange": "KOSPI"},
    {"ticker": "012330.KS", "name": "현대모비스", "exchange": "KOSPI"},
    {"ticker": "033780.KS", "name": "KT&G", "exchange": "KOSPI"},
    {"ticker": "010950.KS", "name": "S-Oil", "exchange": "KOSPI"},
    {"ticker": "207940.KS", "name": "삼성바이오로직스", "exchange": "KOSPI"},
    {"ticker": "036570.KS", "name": "엔씨소프트", "exchange": "KOSPI"},
    {"ticker": "251270.KS", "name": "넷마블", "exchange": "KOSPI"},
    {"ticker": "090430.KS", "name": "아모레퍼시픽", "exchange": "KOSPI"},
    {"ticker": "000100.KS", "name": "유한양행", "exchange": "KOSPI"},
    {"ticker": "010130.KS", "name": "고려아연", "exchange": "KOSPI"},
    {"ticker": "047050.KS", "name": "포스코인터내셔널", "exchange": "KOSPI"},
    {"ticker": "005490.KS", "name": "POSCO홀딩스", "exchange": "KOSPI"},
    {"ticker": "024110.KS", "name": "기업은행", "exchange": "KOSPI"},
    {"ticker": "078930.KS", "name": "GS", "exchange": "KOSPI"},
    {"ticker": "000810.KS", "name": "삼성화재", "exchange": "KOSPI"},
    {"ticker": "001570.KS", "name": "금양", "exchange": "KOSPI"},
    {"ticker": "352820.KS", "name": "하이브", "exchange": "KOSPI"},
    {"ticker": "259960.KS", "name": "크래프톤", "exchange": "KOSPI"},
    {"ticker": "316140.KS", "name": "우리금융지주", "exchange": "KOSPI"},
    {"ticker": "139480.KS", "name": "이마트", "exchange": "KOSPI"},
    {"ticker": "009830.KS", "name": "한화솔루션", "exchange": "KOSPI"},
    {"ticker": "010140.KS", "name": "삼성중공업", "exchange": "KOSPI"},
    {"ticker": "042660.KS", "name": "한화오션", "exchange": "KOSPI"},
    {"ticker": "329180.KS", "name": "HD현대중공업", "exchange": "KOSPI"},
    {"ticker": "267250.KS", "name": "HD현대", "exchange": "KOSPI"},
    {"ticker": "009540.KS", "name": "HD한국조선해양", "exchange": "KOSPI"},
    {"ticker": "000720.KS", "name": "현대건설", "exchange": "KOSPI"},
    {"ticker": "011170.KS", "name": "롯데케미칼", "exchange": "KOSPI"},
    {"ticker": "004020.KS", "name": "현대제철", "exchange": "KOSPI"},
    {"ticker": "161390.KS", "name": "한국타이어앤테크놀로지", "exchange": "KOSPI"},
    {"ticker": "000080.KS", "name": "하이트진로", "exchange": "KOSPI"},
    {"ticker": "021240.KS", "name": "코웨이", "exchange": "KOSPI"},
    {"ticker": "403900.KS", "name": "하나투어", "exchange": "KOSPI"},
    # KOSDAQ
    {"ticker": "247540.KQ", "name": "에코프로비엠", "exchange": "KOSDAQ"},
    {"ticker": "086520.KQ", "name": "에코프로", "exchange": "KOSDAQ"},
    {"ticker": "196170.KQ", "name": "알테오젠", "exchange": "KOSDAQ"},
    {"ticker": "263750.KQ", "name": "펄어비스", "exchange": "KOSDAQ"},
    {"ticker": "112040.KQ", "name": "위메이드", "exchange": "KOSDAQ"},
    {"ticker": "041510.KQ", "name": "에스엠", "exchange": "KOSDAQ"},
    {"ticker": "035900.KQ", "name": "JYP Ent.", "exchange": "KOSDAQ"},
    {"ticker": "122870.KQ", "name": "와이지엔터테인먼트", "exchange": "KOSDAQ"},
    {"ticker": "293490.KQ", "name": "카카오게임즈", "exchange": "KOSDAQ"},
    {"ticker": "145020.KQ", "name": "휴젤", "exchange": "KOSDAQ"},
    {"ticker": "091990.KQ", "name": "셀트리온헬스케어", "exchange": "KOSDAQ"},
    {"ticker": "028300.KQ", "name": "HLB", "exchange": "KOSDAQ"},
    {"ticker": "950130.KQ", "name": "엑스플러스", "exchange": "KOSDAQ"},
    {"ticker": "214150.KQ", "name": "클래시스", "exchange": "KOSDAQ"},
    {"ticker": "039030.KQ", "name": "이오테크닉스", "exchange": "KOSDAQ"},
    {"ticker": "036830.KQ", "name": "솔브레인홀딩스", "exchange": "KOSDAQ"},
    {"ticker": "054040.KQ", "name": "한국컴퓨터", "exchange": "KOSDAQ"},
    {"ticker": "240810.KQ", "name": "원익IPS", "exchange": "KOSDAQ"},
    # 카카오뱅크, 카카오페이
    {"ticker": "323410.KS", "name": "카카오뱅크", "exchange": "KOSPI"},
    {"ticker": "377300.KS", "name": "카카오페이", "exchange": "KOSPI"},
    # 미국 주요 ETF/종목
    {"ticker": "AAPL", "name": "Apple", "exchange": "NASDAQ"},
    {"ticker": "MSFT", "name": "Microsoft", "exchange": "NASDAQ"},
    {"ticker": "NVDA", "name": "NVIDIA", "exchange": "NASDAQ"},
    {"ticker": "GOOGL", "name": "Alphabet", "exchange": "NASDAQ"},
    {"ticker": "AMZN", "name": "Amazon", "exchange": "NASDAQ"},
    {"ticker": "META", "name": "Meta", "exchange": "NASDAQ"},
    {"ticker": "TSLA", "name": "Tesla", "exchange": "NASDAQ"},
]


async def search_stocks(query: str) -> list[dict[str, str]]:
    """DB 기반 종목 검색. DB가 비어있으면 레거시 정적 목록으로 폴백."""
    from services.stock_list_service import get_stock_count, search_stocks_db
    count = await get_stock_count()
    if count > 0:
        return await search_stocks_db(query)

    # DB 미초기화 시 레거시 정적 목록 검색
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _legacy_search_sync, query)


def _legacy_search_sync(query: str) -> list[dict[str, str]]:
    """레거시: 정적 목록 검색 (DB 초기화 전 폴백용)"""
    q = query.lower().strip()
    results = []
    seen: set[str] = set()
    for stock in KOREAN_STOCKS:
        if q in stock["name"].lower() or q in stock["ticker"].lower():
            if stock["ticker"] not in seen:
                seen.add(stock["ticker"])
                results.append(stock)
        if len(results) >= 20:
            break
    return results
