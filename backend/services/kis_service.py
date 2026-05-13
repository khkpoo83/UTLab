"""
키움증권 REST API 서비스 (api.kiwoom.com)

보안 원칙:
- 키 값은 절대 로그에 출력하지 않음
- tarfile.extractfile() 사용으로 디스크 추출 없음 (메모리 in-memory 로드)
- 액세스 토큰은 서버 메모리에만 저장

API 스펙:
- 토큰: POST /oauth2/token  (api-id: au10001)
- 잔고: POST /api/dostk/acnt (api-id: kt00004)
- 모든 요청 POST + JSON body
- 헤더: api-id, authorization, cont-yn, next-key
"""
from __future__ import annotations

import logging
import tarfile
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


@dataclass
class AccountConfig:
    account_no: str
    account_type: str   # GENERAL, ISA, PENSION, IRP_PERSONAL, IRP_COMPANY
    alias: str
    appkey: str = field(repr=False)
    secretkey: str = field(repr=False)


@dataclass
class TokenCache:
    token: str = field(repr=False)
    expires_at: float = 0.0  # unix timestamp

    def is_valid(self, buffer_secs: int = 300) -> bool:
        return time.time() < (self.expires_at - buffer_secs)


class KiwoomService:
    """키움증권 REST API 클라이언트"""

    BASE_URL = "https://api.kiwoom.com"

    def __init__(
        self,
        tar_path: str,
        base_url: str,
        account_map_str: str,
        cache_ttl: int = 300,
    ):
        self._tar_path = tar_path
        self._base_url = (base_url or self.BASE_URL).rstrip("/")
        self._cache_ttl = cache_ttl
        self._accounts: dict[str, AccountConfig] = {}
        self._token_cache: dict[str, TokenCache] = {}
        self._balance_cache: dict[str, tuple[float, dict]] = {}
        self._raw_keys: dict[str, dict[str, str]] = {}
        # NXT 거래 종목 누적 캐시: 한 번이라도 NXT 가격 차이 감지된 종목 DB+메모리 영속
        self._nxt_known_tickers: set[str] = set()

        self._load_keys()
        self._parse_account_map(account_map_str)
        # DB에서 저장된 NXT 종목 목록 로드 (비동기이므로 get_account_balance 최초 호출 시 lazy load)
        self._nxt_db_loaded: bool = False

    # ── NXT 종목 DB 영속 ────────────────────────────────────────────────────────

    async def _load_nxt_tickers_from_db(self) -> None:
        """AppSettings에서 NXT 종목 목록 로드 (없으면 알려진 NXT 종목으로 초기화)"""
        from models.database import AppSettings, AsyncSessionLocal
        from sqlalchemy import select
        try:
            async with AsyncSessionLocal() as session:
                row = (await session.execute(
                    select(AppSettings).where(AppSettings.key == "kis_nxt_tickers")
                )).scalar_one_or_none()
                if row and row.value:
                    tickers = json.loads(row.value)
                    self._nxt_known_tickers.update(tickers)
                    logger.info(f"NXT 종목 {len(tickers)}개 DB에서 로드: {tickers}")
                else:
                    # 초기 시드: 알려진 NXT 상장 종목 (2026년 기준 주요 종목)
                    seed = {"000660"}  # SK하이닉스
                    self._nxt_known_tickers.update(seed)
                    logger.info(f"NXT 종목 DB 없음 → 시드 사용: {seed}")
        except Exception as e:
            logger.warning(f"NXT 종목 DB 로드 실패: {e}")

    async def _save_nxt_tickers_to_db(self) -> None:
        """AppSettings에 NXT 종목 목록 저장"""
        from models.database import AppSettings, AsyncSessionLocal
        from sqlalchemy import select
        try:
            value = json.dumps(sorted(self._nxt_known_tickers), ensure_ascii=False)
            async with AsyncSessionLocal() as session:
                row = (await session.execute(
                    select(AppSettings).where(AppSettings.key == "kis_nxt_tickers")
                )).scalar_one_or_none()
                if row:
                    row.value = value
                else:
                    session.add(AppSettings(key="kis_nxt_tickers", value=value))
                await session.commit()
        except Exception as e:
            logger.warning(f"NXT 종목 DB 저장 실패: {e}")

    # ── 키 로드 ──────────────────────────────────────────────────────────────

    def _load_keys(self) -> None:
        """TAR 파일에서 in-memory로 키 로드 (디스크 추출 없음)"""
        try:
            with tarfile.open(self._tar_path, "r") as tar:
                for member in tar.getmembers():
                    f = tar.extractfile(member)
                    if f is None:
                        continue
                    value = f.read().decode("utf-8").strip()
                    name = member.name.split("/")[-1]  # 경로 제거
                    if "_appkey.txt" in name:
                        acc_no = name.replace("_appkey.txt", "")
                        self._raw_keys.setdefault(acc_no, {})["appkey"] = value
                    elif "_secretkey.txt" in name:
                        acc_no = name.replace("_secretkey.txt", "")
                        self._raw_keys.setdefault(acc_no, {})["secretkey"] = value
            # 키 값은 로그에 출력하지 않음
            logger.info(f"키움 키 로드 완료: {len(self._raw_keys)}개 계좌 (값 로그 생략)")
        except Exception as e:
            logger.error(f"키움 키 로드 실패: {e}")

    def _parse_account_map(self, account_map_str: str) -> None:
        """KIS_ACCOUNT_MAP 파싱 → AccountConfig 생성"""
        for entry in account_map_str.split(","):
            parts = entry.strip().split(":")
            if len(parts) < 3:
                continue
            acc_no, acc_type, alias = parts[0], parts[1], parts[2]
            keys = self._raw_keys.get(acc_no, {})
            if not keys.get("appkey") or not keys.get("secretkey"):
                logger.warning(f"계좌 {acc_no}: 키 없음, 조회 불가")
            self._accounts[acc_no] = AccountConfig(
                account_no=acc_no,
                account_type=acc_type,
                alias=alias,
                appkey=keys.get("appkey", ""),
                secretkey=keys.get("secretkey", ""),
            )
        logger.info(f"계좌 설정 완료: {list(self._accounts.keys())}")

    # ── 토큰 관리 ─────────────────────────────────────────────────────────────

    @staticmethod
    def _parse_expires_dt(expires_dt: str) -> float:
        """'YYYYMMDDHHMMSS' → unix timestamp"""
        try:
            dt = datetime.strptime(expires_dt, "%Y%m%d%H%M%S")
            return dt.timestamp()
        except Exception:
            return time.time() + 86400  # 파싱 실패 시 24시간

    async def _get_token(self, account_no: str) -> str:
        """액세스 토큰 발급 또는 캐시 반환"""
        cached = self._token_cache.get(account_no)
        if cached and cached.is_valid():
            return cached.token

        acc = self._accounts.get(account_no)
        if not acc:
            raise ValueError(f"계좌 {account_no} 미등록")
        if not acc.appkey or not acc.secretkey:
            raise ValueError(f"계좌 {account_no} 키 없음")

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{self._base_url}/oauth2/token",
                headers={
                    "api-id": "au10001",
                    "authorization": "",
                    "cont-yn": "N",
                    "next-key": "",
                    "Content-Type": "application/json;charset=UTF-8",
                },
                json={
                    "grant_type": "client_credentials",
                    "appkey": acc.appkey,
                    "secretkey": acc.secretkey,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        if data.get("return_code", -1) != 0:
            raise RuntimeError(f"토큰 발급 실패: {data.get('return_msg', '알 수 없는 오류')}")

        token = data.get("token", "")
        expires_at = self._parse_expires_dt(data.get("expires_dt", ""))
        self._token_cache[account_no] = TokenCache(token=token, expires_at=expires_at)
        logger.info(f"토큰 발급 완료: 계좌 {account_no} (값 로그 생략)")
        return token

    # ── 잔고 조회 ─────────────────────────────────────────────────────────────

    async def _fetch_balance_raw(self, account_no: str, token: str, stex_tp: str) -> dict:
        """kt00004 단일 거래소 타입 조회"""
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{self._base_url}/api/dostk/acnt",
                headers={
                    "api-id": "kt00004",
                    "authorization": f"Bearer {token}",
                    "cont-yn": "N",
                    "next-key": "",
                    "Content-Type": "application/json;charset=UTF-8",
                },
                json={
                    "qry_tp": "0",
                    "dmst_stex_tp": stex_tp,
                },
            )
            resp.raise_for_status()
            return resp.json()

    async def get_account_balance(self, account_no: str, _retry: bool = True) -> dict:
        """계좌평가현황요청 (kt00004) - KRX + NXT 합산"""
        # 최초 호출 시 DB에서 NXT 목록 로드
        if not self._nxt_db_loaded:
            self._nxt_db_loaded = True
            await self._load_nxt_tickers_from_db()

        cached = self._balance_cache.get(account_no)
        if cached:
            ts, data = cached
            if time.time() - ts < self._cache_ttl:
                return data

        acc = self._accounts.get(account_no)
        if not acc:
            raise ValueError(f"계좌 {account_no} 미등록")

        token = await self._get_token(account_no)

        # KRX 조회
        raw_krx = await self._fetch_balance_raw(account_no, token, "KRX")
        rc = raw_krx.get("return_code", -1)
        if rc != 0:
            msg = raw_krx.get("return_msg", "")
            if _retry and ("8005" in msg or "Token" in msg or "token" in msg or "인증" in msg):
                logger.warning(f"계좌 {account_no} 토큰 무효 → 재발급 후 재시도")
                self._token_cache.pop(account_no, None)
                return await self.get_account_balance(account_no, _retry=False)
            raise RuntimeError(f"잔고 조회 실패(KRX): {msg}")

        # NXT 조회 (실패해도 KRX 결과로 계속 진행)
        raw_nxt: dict = {}
        try:
            raw_nxt = await self._fetch_balance_raw(account_no, token, "NXT")
            if raw_nxt.get("return_code", -1) != 0:
                logger.warning(f"NXT 조회 실패: {raw_nxt.get('return_msg', '')}, KRX 결과만 사용")
                raw_nxt = {}
        except Exception as e:
            logger.warning(f"NXT 조회 예외: {e}, KRX 결과만 사용")

        before_nxt = frozenset(self._nxt_known_tickers)
        result = self._parse_kt00004_merged(account_no, acc, raw_krx, raw_nxt)
        self._balance_cache[account_no] = (time.time(), result)
        # 새 NXT 종목이 발견된 경우 DB에 저장
        if self._nxt_known_tickers != before_nxt:
            import asyncio
            asyncio.ensure_future(self._save_nxt_tickers_to_db())
        return result

    def _parse_kt00004(self, account_no: str, acc: AccountConfig, raw: dict) -> dict:
        """kt00004 응답 파싱 - 민감 정보 제외"""
        holdings = []
        for item in raw.get("stk_acnt_evlt_prst", []):
            qty = int(item.get("rmnd_qty", "0").strip() or 0)
            if qty <= 0:
                continue
            # 숫자 필드: 앞에 0 패딩 제거
            def num(v: str) -> float:
                s = (v or "0").strip().lstrip("+")
                try:
                    return float(s)
                except ValueError:
                    return 0.0

            raw_cd = item.get("stk_cd", "")
            # 시장 구분 접두사 제거: A=KRX, B=NXT 등 첫 글자가 알파벳이면 제거
            ticker = raw_cd[1:] if raw_cd and raw_cd[0].isalpha() else raw_cd
            market = "NXT" if raw_cd.startswith("B") else "KRX"
            holdings.append({
                "ticker": ticker,
                "name": item.get("stk_nm", ""),
                "market": market,
                "quantity": qty,
                "avg_price": num(item.get("avg_prc", "0")),
                "current_price": abs(num(item.get("cur_prc", "0"))),
                "eval_amount": num(item.get("evlt_amt", "0")),
                "pnl_amount": num(item.get("pl_amt", "0")),
                "pnl_pct": num(item.get("pl_rt", "0")),
                "purchase_amount": num(item.get("pur_amt", "0")),
            })

        def num(v: str) -> float:
            s = (v or "0").strip().lstrip("+")
            try:
                return float(s)
            except ValueError:
                return 0.0

        # holdings 기반 합산 (예수금 제외) — aset_evlt_amt는 예수금 포함이라 오류 발생
        total_eval = sum(h["eval_amount"] for h in holdings)
        total_purchase = sum(h["purchase_amount"] for h in holdings)
        total_pnl = total_eval - total_purchase
        total_pnl_pct = (total_pnl / total_purchase * 100) if total_purchase > 0 else 0.0
        deposit = num(raw.get("d2_entra", "0"))                  # D+2 예수금 (실제 출금/매수 가능)

        return {
            "account_no": account_no,
            "account_type": acc.account_type,
            "alias": acc.alias,
            "holdings": holdings,
            "total_eval_amount": total_eval,
            "total_purchase_amount": total_purchase,
            "total_pnl_amount": total_pnl,
            "total_pnl_pct": round(total_pnl_pct, 2),
            "deposit": deposit,
            "total_assets": num(raw.get("prsm_dpst_aset_amt", "0")),  # 추정예탁자산
            "fetched_at": time.time(),
        }

    def _parse_kt00004_merged(self, account_no: str, acc: AccountConfig, raw_krx: dict, raw_nxt: dict) -> dict:
        """KRX + NXT 응답 병합 파싱 — NXT 종목은 NXT 시세로 덮어씀"""
        def num(v: str) -> float:
            s = (v or "0").strip().lstrip("+")
            try:
                return float(s)
            except ValueError:
                return 0.0

        def parse_items(raw: dict) -> dict[str, dict]:
            result: dict[str, dict] = {}
            for item in raw.get("stk_acnt_evlt_prst", []):
                qty = int(item.get("rmnd_qty", "0").strip() or 0)
                if qty <= 0:
                    continue
                raw_cd = item.get("stk_cd", "")
                ticker = raw_cd[1:] if raw_cd and raw_cd[0].isalpha() else raw_cd
                # "B" prefix = NXT 거래소 종목 (KIS API 스펙)
                is_nxt_prefix = raw_cd.startswith("B")
                result[ticker] = {
                    "ticker": ticker,
                    "name": item.get("stk_nm", ""),
                    "market": "NXT" if is_nxt_prefix else "KRX",
                    "quantity": qty,
                    "avg_price": num(item.get("avg_prc", "0")),
                    "current_price": abs(num(item.get("cur_prc", "0"))),
                    "eval_amount": num(item.get("evlt_amt", "0")),
                    "pnl_amount": num(item.get("pl_amt", "0")),
                    "pnl_pct": num(item.get("pl_rt", "0")),
                    "purchase_amount": num(item.get("pur_amt", "0")),
                }
            return result

        krx_map = parse_items(raw_krx)
        nxt_map = parse_items(raw_nxt) if raw_nxt else {}

        # NXT 종목 처리:
        # KIS API는 NXT 조회 시에도 "B" prefix 없이 "A"로 반환하므로 prefix 기반 감지 불가.
        # 대신 가격 차이(≥500원)로 NXT 실거래 여부 판단 — 거래 시간 외에도 KIS가 NXT 종가를 반환함.
        for ticker, nxt_h in nxt_map.items():
            if ticker not in krx_map:
                continue
            h = krx_map[ticker]
            price_diff = abs(nxt_h["current_price"] - h["current_price"])
            has_nxt_price = nxt_h["current_price"] > 0 and price_diff > 0

            if has_nxt_price:
                self._nxt_known_tickers.add(ticker)
                h["market"] = "NXT"
                h["krx_current_price"] = h["current_price"]
                h["krx_eval_amount"] = h["eval_amount"]
                h["current_price"] = nxt_h["current_price"]
                h["eval_amount"] = nxt_h["eval_amount"]
                h["pnl_amount"] = nxt_h["pnl_amount"]
                h["pnl_pct"] = nxt_h["pnl_pct"]
            elif ticker in self._nxt_known_tickers:
                # 이전에 NXT 가격 차이 감지됐던 종목 → 뱃지 유지 (현재 가격은 동일)
                h["market"] = "NXT"
                h["krx_current_price"] = h["current_price"]
                h["krx_eval_amount"] = h["eval_amount"]

        # 루프 밖: nxt_map에 없는 종목도 known_tickers이면 뱃지 부여 (가격은 KRX 그대로)
        for ticker, h in krx_map.items():
            if h.get("market") != "NXT" and ticker in self._nxt_known_tickers:
                h["market"] = "NXT"
                h["krx_current_price"] = h["current_price"]
                h["krx_eval_amount"] = h["eval_amount"]

        holdings = list(krx_map.values())
        total_eval = sum(h["eval_amount"] for h in holdings)
        total_purchase = sum(h["purchase_amount"] for h in holdings)
        total_pnl = total_eval - total_purchase
        total_pnl_pct = (total_pnl / total_purchase * 100) if total_purchase > 0 else 0.0

        # KRX 기준 합계 (NXT 전 가격)
        krx_total_eval = sum(h.get("krx_eval_amount", h["eval_amount"]) for h in holdings)
        krx_total_pnl = krx_total_eval - total_purchase
        krx_total_pnl_pct = (krx_total_pnl / total_purchase * 100) if total_purchase > 0 else 0.0

        deposit = num(raw_krx.get("d2_entra", "0"))

        return {
            "account_no": account_no,
            "account_type": acc.account_type,
            "alias": acc.alias,
            "holdings": holdings,
            "total_eval_amount": total_eval,
            "total_purchase_amount": total_purchase,
            "total_pnl_amount": total_pnl,
            "total_pnl_pct": round(total_pnl_pct, 2),
            "krx_total_eval_amount": krx_total_eval,
            "krx_total_pnl_amount": krx_total_pnl,
            "krx_total_pnl_pct": round(krx_total_pnl_pct, 2),
            "deposit": deposit,
            "total_assets": num(raw_krx.get("prsm_dpst_aset_amt", "0")),
            "fetched_at": time.time(),
        }

    # ── 전체 계좌 ─────────────────────────────────────────────────────────────

    def get_account_list(self) -> list[dict]:
        return [
            {"account_no": a.account_no, "account_type": a.account_type, "alias": a.alias}
            for a in self._accounts.values()
        ]

    async def _get_balance_safe(self, acc_no: str) -> dict:
        try:
            return await self.get_account_balance(acc_no)
        except Exception as e:
            logger.error(f"계좌 {acc_no} 잔고 조회 실패: {e}")
            acc = self._accounts[acc_no]
            return {
                "account_no": acc_no,
                "account_type": acc.account_type,
                "alias": acc.alias,
                "error": str(e),
                "holdings": [],
            }

    async def get_all_accounts_balance(self) -> list[dict]:
        """전체 계좌 잔고 병렬 조회"""
        import asyncio
        tasks = [self._get_balance_safe(acc_no) for acc_no in self._accounts]
        return list(await asyncio.gather(*tasks))

    def invalidate_cache(self, account_no: str | None = None) -> None:
        if account_no:
            self._balance_cache.pop(account_no, None)
        else:
            self._balance_cache.clear()

    def get_cached_price(self, ticker: str) -> Optional[dict]:
        """잔고 캐시에서 특정 ticker의 현재가 정보 반환 (NXT 가격 우선).
        반환: {"price": float, "krx_price": float|None} or None (캐시 없거나 미보유)
        """
        for acc_no, (ts, data) in self._balance_cache.items():
            if time.time() - ts > self._cache_ttl:
                continue
            for h in data.get("holdings", []):
                if h["ticker"] == ticker:
                    return {
                        "price": h["current_price"],
                        "krx_price": h.get("krx_current_price"),
                    }
        return None


# ── 싱글톤 ───────────────────────────────────────────────────────────────────

_service: KiwoomService | None = None


def get_kis_service() -> KiwoomService:
    global _service
    if _service is None:
        raise RuntimeError("키움 서비스 미초기화 - configure() 먼저 호출")
    return _service


def configure(
    tar_path: str,
    base_url: str,
    account_map_str: str,
    product_code: str = "01",   # 키움은 미사용, 호환성 유지
    cache_ttl: int = 300,
) -> KiwoomService:
    global _service
    _service = KiwoomService(tar_path, base_url, account_map_str, cache_ttl)
    return _service
