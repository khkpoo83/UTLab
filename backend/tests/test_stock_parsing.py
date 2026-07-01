"""services.stock 패키지의 순수 결정론적 헬퍼 단위 테스트 (네트워크/DB 없음).

facade 재노출이 실제 구현을 가리키는지 겸사겸사 검증한다.
"""

from services.stock_service import (
    _aggregate_daily,
    _intraday_series,
    _legacy_search_sync,
    _parse_market_cap,
    _parse_num_str,
    _safe_num,
    _ts_to_date_str,
)


class TestParseNumStr:
    def test_extracts_number_with_suffix(self):
        assert _parse_num_str("25.62배") == 25.62

    def test_strips_commas(self):
        assert _parse_num_str("12,372원") == 12372.0

    def test_negative(self):
        assert _parse_num_str("-3.5%") == -3.5

    def test_none_input(self):
        assert _parse_num_str(None) is None

    def test_garbage_returns_none(self):
        assert _parse_num_str("없음") is None


class TestParseMarketCap:
    def test_jo_and_eok(self):
        # 1,853조 2,703억 = 1853e12 + 2703e8
        assert _parse_market_cap("1,853조 2,703억") == 1853 * 1e12 + 2703 * 1e8

    def test_eok_only(self):
        assert _parse_market_cap("5,000억") == 5000 * 1e8

    def test_plain_number_fallback(self):
        # 조/억 없으면 _parse_num_str 폴백
        assert _parse_market_cap("1,234") == 1234.0

    def test_none_input(self):
        assert _parse_market_cap(None) is None

    def test_empty_string(self):
        assert _parse_market_cap("") is None


class TestSafeNum:
    def test_numeric_string(self):
        assert _safe_num("42.5") == 42.5

    def test_int(self):
        assert _safe_num(7) == 7.0

    def test_none(self):
        assert _safe_num(None) is None

    def test_nan_excluded(self):
        assert _safe_num(float("nan")) is None

    def test_garbage(self):
        assert _safe_num("abc") is None


class TestTsToDateStr:
    def test_kst_adjustment(self):
        # 2021-01-01 00:00:00 UTC = ts 1609459200
        # +9h 보정 → 2021-01-01 09:00 → 날짜 2021-01-01
        assert _ts_to_date_str(1609459200) == "2021-01-01"

    def test_kst_rolls_to_next_day(self):
        # 2021-01-01 20:00:00 UTC = 1609531200; +9h → 다음날 05:00 → 2021-01-02
        assert _ts_to_date_str(1609531200) == "2021-01-02"


class TestAggregateDaily:
    def test_merges_same_date(self):
        series = [
            {"time": "2021-01-01", "open": 10, "high": 12, "low": 9, "close": 11, "volume": 100},
            {"time": "2021-01-01", "open": 11, "high": 15, "low": 8, "close": 14, "volume": 50},
        ]
        out = _aggregate_daily(series)
        assert len(out) == 1
        bar = out[0]
        assert bar["open"] == 10  # 첫 시가 유지
        assert bar["high"] == 15  # max
        assert bar["low"] == 8   # min
        assert bar["close"] == 14  # 마지막 종가
        assert bar["volume"] == 150  # 합

    def test_sorted_unique_dates(self):
        series = [
            {"time": "2021-01-02", "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1},
            {"time": "2021-01-01", "open": 2, "high": 2, "low": 2, "close": 2, "volume": 2},
        ]
        out = _aggregate_daily(series)
        assert [b["time"] for b in out] == ["2021-01-01", "2021-01-02"]

    def test_empty(self):
        assert _aggregate_daily([]) == []


class TestIntradaySeries:
    def test_dedupe_last_wins_and_sorted(self):
        live = [
            {"time": 200, "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1},
            {"time": 100, "open": 2, "high": 2, "low": 2, "close": 2, "volume": 2},
            {"time": 200, "open": 3, "high": 3, "low": 3, "close": 3, "volume": 3},
        ]
        out = _intraday_series(live)
        assert [b["time"] for b in out] == [100, 200]
        # 200은 마지막 값(close=3)으로 dedupe
        assert out[1]["close"] == 3

    def test_empty(self):
        assert _intraday_series([]) == []


class TestLegacySearchSync:
    def test_matches_by_name(self):
        results = _legacy_search_sync("삼성전자")
        assert any(s["ticker"] == "005930.KS" for s in results)

    def test_matches_by_ticker_case_insensitive(self):
        results = _legacy_search_sync("aapl")
        assert any(s["ticker"] == "AAPL" for s in results)

    def test_no_match(self):
        assert _legacy_search_sync("존재하지않는종목zzz") == []
