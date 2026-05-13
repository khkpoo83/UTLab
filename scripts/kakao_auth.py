#!/usr/bin/env python3
"""
카카오 OAuth 토큰 최초 발급 스크립트
=====================================
사용법: python scripts/kakao_auth.py

사전 준비:
1. https://developers.kakao.com 에서 앱 생성
2. 앱 설정 > 카카오 로그인 > 활성화
3. Redirect URI 설정: https://localhost (OOB 방식 사용)
4. 동의항목 > talk_message 권한 설정
"""

import sys
import urllib.parse
import urllib.request
import urllib.error
import json


REDIRECT_URI = "https://localhost"


def exchange_code_for_tokens(rest_api_key: str, code: str) -> dict | None:
    """인가 코드로 액세스/리프레시 토큰 발급."""
    token_url = "https://kauth.kakao.com/oauth/token"
    params = urllib.parse.urlencode(
        {
            "grant_type": "authorization_code",
            "client_id": rest_api_key,
            "redirect_uri": REDIRECT_URI,
            "code": code,
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        token_url,
        data=params,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        print(f"\n[오류] HTTP {e.code}: {body}")
        return None
    except Exception as e:
        print(f"\n[오류] 요청 실패: {e}")
        return None


def main() -> None:
    print("=" * 60)
    print("  카카오 OAuth 토큰 최초 발급")
    print("=" * 60)
    print()

    # REST API 키 입력
    rest_api_key = input("카카오 앱 REST API 키를 입력하세요: ").strip()
    if not rest_api_key:
        print("[오류] REST API 키를 입력해야 합니다.")
        sys.exit(1)

    # OAuth 인가 URL 생성
    auth_url = (
        "https://kauth.kakao.com/oauth/authorize"
        f"?client_id={rest_api_key}"
        f"&redirect_uri={urllib.parse.quote(REDIRECT_URI, safe='')}"
        "&response_type=code"
        "&scope=talk_message"
    )

    print()
    print("[1단계] 아래 URL을 브라우저에서 열고 카카오 계정으로 로그인하세요:")
    print()
    print(f"  {auth_url}")
    print()
    print("[2단계] 로그인 후 리다이렉트된 URL에서 'code=' 뒤의 값을 복사하세요.")
    print("  예시 URL: https://localhost/?code=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX")
    print()

    # 인가 코드 입력
    code = input("code 값을 붙여넣으세요: ").strip()
    if not code:
        print("[오류] 인가 코드를 입력해야 합니다.")
        sys.exit(1)

    # 토큰 발급 요청
    print()
    print("토큰 발급 중...")
    result = exchange_code_for_tokens(rest_api_key, code)

    if not result:
        print("[실패] 토큰 발급에 실패했습니다. REST API 키와 인가 코드를 확인하세요.")
        sys.exit(1)

    access_token = result.get("access_token", "")
    refresh_token = result.get("refresh_token", "")

    if not access_token:
        print(f"[실패] 응답에 access_token이 없습니다: {result}")
        sys.exit(1)

    print()
    print("=" * 60)
    print("  토큰 발급 성공!")
    print("=" * 60)
    print()
    print(f"  KAKAO_ACCESS_TOKEN  = {access_token}")
    print(f"  KAKAO_REFRESH_TOKEN = {refresh_token}")
    print()
    print("[환경변수 설정 방법]")
    print()
    print("방법 1 - backend/.env 파일에 추가:")
    print(f"  KAKAO_REST_API_KEY={rest_api_key}")
    print(f"  KAKAO_ACCESS_TOKEN={access_token}")
    print(f"  KAKAO_REFRESH_TOKEN={refresh_token}")
    print()
    print("방법 2 - docker-compose.yml environment 섹션에 추가:")
    print("  environment:")
    print(f"    - KAKAO_REST_API_KEY={rest_api_key}")
    print(f"    - KAKAO_ACCESS_TOKEN={access_token}")
    print(f"    - KAKAO_REFRESH_TOKEN={refresh_token}")
    print()
    print("[주의사항]")
    print("  - 액세스 토큰 유효기간: 6시간")
    print("  - 리프레시 토큰 유효기간: 60일 (만료 1개월 전 갱신 가능)")
    print("  - 토큰은 안전한 곳에 보관하고 외부에 노출하지 마세요.")
    print()


if __name__ == "__main__":
    main()
