#!/usr/bin/env python3
"""
카카오톡 알림 테스트 스크립트
사용법: python scripts/test_kakao.py
환경변수 필요: KAKAO_REST_API_KEY, KAKAO_ACCESS_TOKEN, KAKAO_REFRESH_TOKEN
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from services.kakao_notify import (
    test_connection,
    send_stock_alert,
    send_ai_recommendation_alert,
)


async def run_tests() -> None:
    print("=" * 60)
    print("  카카오톡 알림 테스트")
    print("=" * 60)
    print()

    # 환경변수 확인
    rest_api_key = os.getenv("KAKAO_REST_API_KEY", "")
    access_token = os.getenv("KAKAO_ACCESS_TOKEN", "")
    refresh_token = os.getenv("KAKAO_REFRESH_TOKEN", "")

    print("[환경변수 확인]")
    print(f"  KAKAO_REST_API_KEY  : {'설정됨' if rest_api_key else '❌ 미설정'}")
    print(f"  KAKAO_ACCESS_TOKEN  : {'설정됨' if access_token else '❌ 미설정'}")
    print(f"  KAKAO_REFRESH_TOKEN : {'설정됨' if refresh_token else '❌ 미설정'}")
    print()

    if not access_token:
        print("[중단] KAKAO_ACCESS_TOKEN이 설정되지 않았습니다.")
        print("  scripts/kakao_auth.py 를 실행하여 토큰을 먼저 발급받으세요.")
        sys.exit(1)

    results: list[tuple[str, bool]] = []

    # --- 테스트 1: 연결 테스트 ---
    print("[테스트 1] 연결 테스트 (test_connection)")
    result = await test_connection()
    success = result.get("success", False)
    print(f"  결과: {'✅ 성공' if success else '❌ 실패'}")
    print(f"  메시지: {result.get('message', '')}")
    results.append(("연결 테스트", success))
    print()

    # --- 테스트 2: 주식 알림 테스트 ---
    print("[테스트 2] 주식 알림 테스트 (send_stock_alert)")

    test_cases = [
        {
            "label": "목표가 도달 (price_above)",
            "kwargs": dict(
                ticker="005930",
                name="삼성전자",
                alert_type="price_above",
                current_price=82000,
                threshold=80000,
            ),
        },
        {
            "label": "AI 목표가 달성 (target_hit)",
            "kwargs": dict(
                ticker="000660",
                name="SK하이닉스",
                alert_type="target_hit",
                current_price=195000,
                threshold=165000,
            ),
        },
        {
            "label": "손절가 도달 (stop_hit)",
            "kwargs": dict(
                ticker="035420",
                name="NAVER",
                alert_type="stop_hit",
                current_price=171000,
                threshold=190000,
            ),
        },
    ]

    for tc in test_cases:
        print(f"  - {tc['label']}...")
        ok = await send_stock_alert(**tc["kwargs"])
        print(f"    결과: {'✅ 성공' if ok else '❌ 실패'}")
        results.append((f"주식 알림 ({tc['label']})", ok))

    print()

    # --- 테스트 3: AI 추천 알림 테스트 ---
    print("[테스트 3] AI 추천 알림 테스트 (send_ai_recommendation_alert)")
    sample_items = [
        {
            "ticker": "005930",
            "name": "삼성전자",
            "strength": "★★★",
            "change_pct": 1.2,
            "target_return_pct": 15.0,
        },
        {
            "ticker": "000660",
            "name": "SK하이닉스",
            "strength": "★★☆",
            "change_pct": -0.3,
            "target_return_pct": 12.0,
        },
        {
            "ticker": "035420",
            "name": "NAVER",
            "strength": "★☆☆",
            "change_pct": 0.7,
            "target_return_pct": 8.5,
        },
    ]
    ok = await send_ai_recommendation_alert(sample_items)
    print(f"  결과: {'✅ 성공' if ok else '❌ 실패'}")
    results.append(("AI 추천 알림", ok))
    print()

    # --- 최종 결과 요약 ---
    print("=" * 60)
    print("  테스트 결과 요약")
    print("=" * 60)
    passed = sum(1 for _, s in results if s)
    total = len(results)
    for name, status in results:
        icon = "✅" if status else "❌"
        print(f"  {icon} {name}")
    print()
    print(f"  총 {total}개 중 {passed}개 성공")
    print()

    if passed < total:
        print("[참고] 실패한 테스트가 있습니다.")
        print("  1. 환경변수(KAKAO_ACCESS_TOKEN 등)가 올바르게 설정되었는지 확인하세요.")
        print("  2. 토큰이 만료된 경우 scripts/kakao_auth.py 로 재발급하세요.")
        print("  3. 카카오 개발자 콘솔에서 talk_message 권한이 동의되었는지 확인하세요.")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(run_tests())
