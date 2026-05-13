"""Google OAuth2 서비스 — 토큰 Fernet 암호화/복호화, 갱신"""
import base64
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

# ── 암호화 키 ──────────────────────────────────────────────────────────────────
# 환경변수 CALENDAR_ENCRYPT_KEY 가 없으면 자동 생성 후 경고 출력
# 운영 환경에서는 .env에 고정 키를 설정해야 토큰이 재시작 후에도 유효함

_FERNET: Optional[Fernet] = None


def _get_fernet() -> Fernet:
    global _FERNET
    if _FERNET is not None:
        return _FERNET

    raw = os.getenv("CALENDAR_ENCRYPT_KEY", "")
    if raw:
        key = raw.encode()
    else:
        # 키 없으면 서버 수명 동안만 유효한 임시 키 생성 (재시작 시 기존 토큰 복호화 불가)
        key = Fernet.generate_key()
        logger.warning(
            "CALENDAR_ENCRYPT_KEY not set. Token encryption key is ephemeral — "
            "add CALENDAR_ENCRYPT_KEY=<base64-urlsafe-32-bytes> to .env for persistence."
        )

    _FERNET = Fernet(key)
    return _FERNET


def encrypt_token(plaintext: str) -> str:
    """평문 토큰 → Fernet 암호문 (str)"""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_token(ciphertext: str) -> str:
    """Fernet 암호문 → 평문 토큰"""
    try:
        return _get_fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as e:
        raise ValueError("Token decryption failed — key may have changed") from e


# ── Google OAuth2 설정 ─────────────────────────────────────────────────────────
GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
]


def get_oauth_config() -> dict:
    """환경변수에서 Google OAuth 설정 로드"""
    client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "")
    redirect_uri = os.getenv("GOOGLE_REDIRECT_URI", "")

    if not client_id or not client_secret:
        raise ValueError(
            "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env. "
            "Create OAuth 2.0 credentials at https://console.cloud.google.com/"
        )

    return {
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "scopes": GOOGLE_SCOPES,
    }


def build_authorization_url(state: str) -> str:
    """Google OAuth 동의 화면 URL 생성"""
    from google_auth_oauthlib.flow import Flow

    cfg = get_oauth_config()
    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [cfg["redirect_uri"]],
            }
        },
        scopes=cfg["scopes"],
    )
    flow.redirect_uri = cfg["redirect_uri"]
    auth_url, _ = flow.authorization_url(
        access_type="offline",   # refresh_token 발급
        include_granted_scopes="true",
        prompt="consent",        # 항상 동의 화면 → refresh_token 재발급 보장
        state=state,
    )
    return auth_url


def exchange_code_for_tokens(code: str) -> dict:
    """인증 코드 → access/refresh token 교환"""
    from google_auth_oauthlib.flow import Flow

    cfg = get_oauth_config()
    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [cfg["redirect_uri"]],
            }
        },
        scopes=cfg["scopes"],
    )
    flow.redirect_uri = cfg["redirect_uri"]
    import os as _os
    _os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"
    flow.fetch_token(code=code)
    creds = flow.credentials

    return {
        "access_token": creds.token,
        "refresh_token": creds.refresh_token,
        "expiry": creds.expiry,  # datetime or None
        "id_token": getattr(creds, "id_token", None),
    }


def refresh_access_token(refresh_token_plain: str) -> dict:
    """Refresh token으로 새 access token 발급"""
    import google.oauth2.credentials
    import google.auth.transport.requests

    cfg = get_oauth_config()
    creds = google.oauth2.credentials.Credentials(
        token=None,
        refresh_token=refresh_token_plain,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=cfg["client_id"],
        client_secret=cfg["client_secret"],
        scopes=cfg["scopes"],
    )
    request = google.auth.transport.requests.Request()
    creds.refresh(request)

    return {
        "access_token": creds.token,
        "expiry": creds.expiry,
    }


def get_google_email(access_token_plain: str) -> Optional[str]:
    """access token으로 구글 계정 이메일 조회"""
    import httpx

    try:
        resp = httpx.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token_plain}"},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json().get("email")
    except Exception as e:
        logger.warning(f"Failed to get Google email: {e}")
        return None


def build_credentials(access_token_plain: str, refresh_token_plain: Optional[str]):
    """Google API 클라이언트용 Credentials 객체 생성"""
    import google.oauth2.credentials

    cfg = get_oauth_config()
    return google.oauth2.credentials.Credentials(
        token=access_token_plain,
        refresh_token=refresh_token_plain,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=cfg["client_id"],
        client_secret=cfg["client_secret"],
        scopes=cfg["scopes"],
    )
