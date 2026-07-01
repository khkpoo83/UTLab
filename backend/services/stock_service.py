"""주가 서비스 파사드 (facade).

기존의 god 모듈을 `services.stock/` 패키지로 분리했지만,
외부 코드(routers/portfolio.py, routers/watchlist.py, routers/kis.py,
services/scheduler.py, services/portfolio_snapshot_service.py 등)의 임포트가
그대로 동작하도록 공개 API를 여기서 재노출한다. 로직은 없다.

tests/conftest.py는 이 파사드 모듈에 monkeypatch.setattr로 fetch_current_price,
fetch_price_detail, fetch_stock_fundamentals, get_chart_data, get_sparkline,
search_stocks를 갈아끼우므로 이 6개는 반드시 모듈 레벨 이름으로 재노출되어야 한다.
"""

from services.stock.chart import (
    _INTRADAY_PERIODS,
    _aggregate_daily,
    _intraday_cache,
    _intraday_series,
    _ts_to_date_str,
    get_chart_data,
    get_chart_data_before,
)
from services.stock.fundamentals import (
    _FUND_KEYS,
    _NAVER_HEADERS,
    _empty_fundamentals,
    _fetch_fundamentals_naver,
    _fetch_fundamentals_yf_sync,
    _fundamentals_cache,
    _has_fund_data,
    _parse_market_cap,
    _parse_num_str,
    _safe_num,
    fetch_stock_fundamentals,
)
from services.stock.ohlcv import (
    _BEFORE_PARAMS,
    _OHLCV_HTTP_PARAMS,
    _fetch_ohlcv_http,
    _fetch_ohlcv_http_range,
    _fetch_ohlcv_sync,
    compress_old_data,
    fetch_ohlcv,
    save_ohlcv,
)
from services.stock.prices import (
    _fetch_price_detail_sync,
    _fetch_sparkline_yahoo,
    _price_cache,
    fetch_current_price,
    fetch_price_detail,
    get_sparkline,
)
from services.stock.search import (
    KOREAN_STOCKS,
    _legacy_search_sync,
    search_stocks,
)

__all__ = [
    "KOREAN_STOCKS",
    "search_stocks",
    "_legacy_search_sync",
    "_fetch_price_detail_sync",
    "fetch_price_detail",
    "fetch_current_price",
    "get_sparkline",
    "_fetch_sparkline_yahoo",
    "_price_cache",
    "_fetch_ohlcv_sync",
    "_fetch_ohlcv_http",
    "_fetch_ohlcv_http_range",
    "fetch_ohlcv",
    "save_ohlcv",
    "compress_old_data",
    "_OHLCV_HTTP_PARAMS",
    "_BEFORE_PARAMS",
    "_empty_fundamentals",
    "_safe_num",
    "_parse_num_str",
    "_parse_market_cap",
    "_fetch_fundamentals_naver",
    "_fetch_fundamentals_yf_sync",
    "_has_fund_data",
    "fetch_stock_fundamentals",
    "_FUND_KEYS",
    "_NAVER_HEADERS",
    "_fundamentals_cache",
    "_ts_to_date_str",
    "_aggregate_daily",
    "_intraday_series",
    "get_chart_data",
    "get_chart_data_before",
    "_INTRADAY_PERIODS",
    "_intraday_cache",
]
