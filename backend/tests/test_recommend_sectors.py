"""Unit tests for the pure sector-classification logic.

These cover the deterministic helpers in ``services.recommend.sectors``
(re-exported from ``services.recommend_service``). No DB / network needed.
"""

from services.recommend.sectors import (
    KR_SECTOR_MAP,
    SECTORS,
    _industry_to_sector,
    _infer_sector_from_name,
)

# ── _industry_to_sector ──────────────────────────────────────────────────

def test_industry_to_sector_exact_mapping():
    # 네이버 업종명 정확 매핑
    assert _industry_to_sector("반도체") == "IT/반도체"
    assert _industry_to_sector("은행") == "금융"


def test_industry_to_sector_empty_returns_none():
    assert _industry_to_sector("") is None


def test_industry_to_sector_unknown_returns_none():
    assert _industry_to_sector("완전무관한산업xyz") is None


# ── _infer_sector_from_name ──────────────────────────────────────────────

def test_infer_sector_direct_map():
    # 대표 종목 직접 매핑
    assert _infer_sector_from_name("삼성전자") == "IT/반도체"


def test_infer_sector_etf_prefix():
    # ETF 이름 패턴 (TIGER 반도체)
    assert _infer_sector_from_name("TIGER 반도체") == "IT/반도체"


def test_infer_sector_keyword_pattern():
    # 직접/ETF 매핑에 없고 키워드("강")로 추론되는 경우
    assert _infer_sector_from_name("동국제강") == "소재"


def test_infer_sector_unmatched_returns_none():
    assert _infer_sector_from_name("완전무관ZZZ") is None


# ── 자료구조 구조 검증 ───────────────────────────────────────────────────

def test_sectors_structure():
    assert isinstance(SECTORS, list)
    assert "IT/반도체" in SECTORS
    assert "금융" in SECTORS
    # 중복 없음
    assert len(SECTORS) == len(set(SECTORS))


def test_kr_sector_map_structure():
    assert isinstance(KR_SECTOR_MAP, dict)
    # 각 값은 키워드 리스트
    assert all(isinstance(v, list) for v in KR_SECTOR_MAP.values())
    assert "반도체" in KR_SECTOR_MAP["IT/반도체"]
    assert "은행" in KR_SECTOR_MAP["금융"]
