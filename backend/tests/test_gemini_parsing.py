"""Unit tests for the pure deterministic parsing helpers in the gemini package.

These cover ``_extract_json_array`` and ``_parse_batch_response`` in
``services.gemini.news`` (re-exported from ``services.gemini_service``).
No network / DB needed — the helpers are pure functions.

Behavior asserted here mirrors the *actual* implementation (verified against
the code), including its fallback paths for malformed input.
"""

import json

from services.gemini.news import _extract_json_array, _parse_batch_response

# ── _extract_json_array ──────────────────────────────────────────────────

def test_extract_json_array_valid_in_text():
    # 앞뒤 텍스트가 섞여 있어도 첫 [ ~ 마지막 ] 구간을 파싱
    out = _extract_json_array('prefix [{"id":0,"g":1},{"id":1,"g":1}] suffix')
    assert out == [{"id": 0, "g": 1}, {"id": 1, "g": 1}]


def test_extract_json_array_fenced_json_block():
    # ```json ... ``` 코드펜스를 제거하고 파싱
    text = '```json\n[{"id":1,"g":2}]\n```'
    assert _extract_json_array(text) == [{"id": 1, "g": 2}]


def test_extract_json_array_fenced_plain_block():
    # 언어 태그 없는 ``` 펜스도 제거
    text = '```\n[{"id":3,"g":4}]\n```'
    assert _extract_json_array(text) == [{"id": 3, "g": 4}]


def test_extract_json_array_empty_string_returns_none():
    assert _extract_json_array("") is None


def test_extract_json_array_garbage_no_brackets_returns_none():
    assert _extract_json_array("hello, no json here") is None


def test_extract_json_array_invalid_json_returns_none():
    # 대괄호는 있지만 내용이 유효한 JSON이 아니면 None
    assert _extract_json_array("[not valid json,]") is None


def test_extract_json_array_empty_array_returns_empty_list():
    # 빈 배열 "[]" 은 (None 이 아니라) 빈 리스트로 파싱됨
    assert _extract_json_array("[]") == []


# ── _parse_batch_response ────────────────────────────────────────────────

def test_parse_batch_response_none_text_all_failed():
    batch = [{"id": 1, "title": "a"}, {"id": 2, "title": "b"}]
    out = _parse_batch_response(batch, None)
    assert out == [
        {"id": 1, "summary": None, "sector": None, "related_stocks": [], "failed": True},
        {"id": 2, "summary": None, "sector": None, "related_stocks": [], "failed": True},
    ]


def test_parse_batch_response_well_formed_mapped_back():
    batch = [{"id": 1, "title": "a"}, {"id": 2, "title": "b"}]
    response = json.dumps([
        {"id": 1, "summary": "요약", "sector": "금융", "stocks": ["005930"]},
        {"id": 2, "summary": "요약2", "sector": "에너지", "stocks": ["096770"]},
    ])
    out = _parse_batch_response(batch, response)
    assert out == [
        {"id": 1, "summary": "요약", "sector": "금융", "related_stocks": ["005930"], "failed": False},
        {"id": 2, "summary": "요약2", "sector": "에너지", "related_stocks": ["096770"], "failed": False},
    ]


def test_parse_batch_response_unknown_sector_nulled():
    # SECTORS 목록에 없는 섹터는 None 으로 정규화 (단, failed 는 False)
    batch = [{"id": 1, "title": "a"}]
    response = json.dumps([{"id": 1, "summary": "s", "sector": "NOT_A_SECTOR", "stocks": []}])
    out = _parse_batch_response(batch, response)
    assert out == [
        {"id": 1, "summary": "s", "sector": None, "related_stocks": [], "failed": False},
    ]


def test_parse_batch_response_stocks_not_list_becomes_empty():
    # stocks 가 리스트가 아니면 빈 리스트로 대체
    batch = [{"id": 1, "title": "a"}]
    response = json.dumps([{"id": 1, "summary": "s", "sector": "금융", "stocks": "005930"}])
    out = _parse_batch_response(batch, response)
    assert out == [
        {"id": 1, "summary": "s", "sector": "금융", "related_stocks": [], "failed": False},
    ]


def test_parse_batch_response_missing_id_marked_failed():
    # 응답에 특정 id 가 빠지면 그 항목만 failed 처리
    batch = [{"id": 1, "title": "a"}, {"id": 2, "title": "b"}]
    response = json.dumps([{"id": 1, "summary": "s", "sector": "금융", "stocks": []}])
    out = _parse_batch_response(batch, response)
    assert out == [
        {"id": 1, "summary": "s", "sector": "금융", "related_stocks": [], "failed": False},
        {"id": 2, "summary": None, "sector": None, "related_stocks": [], "failed": True},
    ]


def test_parse_batch_response_non_list_json_all_failed():
    # 리스트가 아닌 JSON (dict) → ValueError → 전부 failed 폴백
    batch = [{"id": 1, "title": "a"}, {"id": 2, "title": "b"}]
    out = _parse_batch_response(batch, '{"a": 1}')
    assert out == [
        {"id": 1, "summary": None, "sector": None, "related_stocks": [], "failed": True},
        {"id": 2, "summary": None, "sector": None, "related_stocks": [], "failed": True},
    ]


def test_parse_batch_response_malformed_json_all_failed():
    # 파싱 불가능한 문자열 → 예외 → 전부 failed 폴백
    batch = [{"id": 1, "title": "a"}]
    out = _parse_batch_response(batch, "this is not json")
    assert out == [
        {"id": 1, "summary": None, "sector": None, "related_stocks": [], "failed": True},
    ]
