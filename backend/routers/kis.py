"""KIS REST API 라우터"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Annotated

import httpx

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy import or_

from models.database import AppSettings, AsyncSessionLocal, StockMaster, User
from routers.auth import get_current_user
from services.kis_service import get_kis_service
from services.stock_service import get_sparkline

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/kis", tags=["kis"])

CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("/accounts")
async def list_accounts(current_user: CurrentUser) -> list[dict]:
    """계좌 목록 조회 (키/토큰 미포함)"""
    try:
        svc = get_kis_service()
        return svc.get_account_list()
    except RuntimeError:
        raise HTTPException(status_code=503, detail="KIS 서비스 미설정")
    except Exception as e:
        logger.error(f"계좌 목록 조회 실패: {e}")
        raise HTTPException(status_code=503, detail="KIS 서비스 사용 불가")


@router.get("/balance")
async def get_all_balance(current_user: CurrentUser) -> list[dict]:
    """전체 계좌 잔고 조회"""
    try:
        svc = get_kis_service()
        return await svc.get_all_accounts_balance()
    except RuntimeError:
        raise HTTPException(status_code=503, detail="KIS 서비스 미설정")
    except Exception as e:
        logger.error(f"전체 잔고 조회 실패: {e}")
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/balance/{account_no}")
async def get_account_balance(account_no: str, current_user: CurrentUser) -> dict:
    """계좌별 잔고 상세 조회"""
    try:
        svc = get_kis_service()
        return await svc.get_account_balance(account_no)
    except RuntimeError:
        raise HTTPException(status_code=503, detail="KIS 서비스 미설정")
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"계좌 {account_no} 잔고 조회 실패: {e}")
        raise HTTPException(status_code=503, detail=str(e))


async def _load_aliases() -> dict[str, str]:
    """AppSettings에서 KIS 계좌 별명 조회"""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(AppSettings).where(AppSettings.key == "kis_aliases")
        )
        row = result.scalar_one_or_none()
        if row and row.value:
            try:
                return json.loads(row.value)
            except Exception:
                pass
    return {}


@router.get("/aliases")
async def get_aliases(current_user: CurrentUser) -> dict:
    """KIS 계좌 별명 조회"""
    return await _load_aliases()


@router.put("/aliases")
async def update_aliases(
    current_user: CurrentUser,
    aliases: dict = Body(...),
) -> dict:
    """KIS 계좌 별명 저장 (account_no → alias)"""
    value = json.dumps(aliases, ensure_ascii=False)
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(AppSettings).where(AppSettings.key == "kis_aliases")
        )
        row = result.scalar_one_or_none()
        if row:
            row.value = value
        else:
            session.add(AppSettings(key="kis_aliases", value=value))
        await session.commit()
    return aliases


async def _load_colors() -> dict[str, str]:
    """AppSettings에서 KIS 계좌 색상 조회"""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(AppSettings).where(AppSettings.key == "kis_colors")
        )
        row = result.scalar_one_or_none()
        if row and row.value:
            try:
                return json.loads(row.value)
            except Exception:
                pass
    return {}


@router.get("/colors")
async def get_colors(current_user: CurrentUser) -> dict:
    """KIS 계좌 색상 조회"""
    return await _load_colors()


@router.put("/colors")
async def update_colors(
    current_user: CurrentUser,
    colors: dict = Body(...),
) -> dict:
    """KIS 계좌 색상 저장 (account_no → hex color)"""
    value = json.dumps(colors, ensure_ascii=False)
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(AppSettings).where(AppSettings.key == "kis_colors")
        )
        row = result.scalar_one_or_none()
        if row:
            row.value = value
        else:
            session.add(AppSettings(key="kis_colors", value=value))
        await session.commit()
    return colors


@router.get("/portfolio")
async def get_kis_portfolio(
    current_user: CurrentUser,
    force: bool = Query(False, description="캐시 무효화 후 KIS API 재조회"),
) -> list[dict]:
    """KIS 잔고 기반 포트폴리오 (day_change + sparkline + sector 보강)"""
    try:
        svc = get_kis_service()
    except RuntimeError:
        raise HTTPException(status_code=503, detail="KIS 서비스 미설정")

    if force:
        svc.invalidate_cache()

    balances = await svc.get_all_accounts_balance()
    valid = [b for b in balances if "error" not in b]
    if not valid:
        return []

    # 사용자 정의 별명 적용
    aliases = await _load_aliases()
    for b in valid:
        if b["account_no"] in aliases:
            b["alias"] = aliases[b["account_no"]]

    # KIS ticker 목록 수집 (중복 제거)
    unique_tickers = list({h["ticker"] for b in valid for h in b.get("holdings", [])})

    # StockMaster에서 yf_ticker(exchange) + sector 조회
    master_map: dict[str, dict] = {}
    if unique_tickers:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(StockMaster).where(
                    or_(*[StockMaster.ticker.like(f"{t}.%") for t in unique_tickers])
                )
            )
            for row in result.scalars():
                code = row.ticker.split(".")[0]
                master_map[code] = {
                    "yf_ticker": row.ticker,
                    "exchange": row.exchange,
                    "sector": row.industry,
                }

    def _yf(ticker: str) -> str:
        return master_map.get(ticker, {}).get("yf_ticker") or f"{ticker}.KS"

    _YF_HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
    }

    async def _fetch_prev_close_one(client: httpx.AsyncClient, yf_ticker: str) -> tuple[str, float | None]:
        import datetime as _dt
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yf_ticker}?interval=1d&range=5d"
        try:
            r = await client.get(url, headers=_YF_HEADERS, timeout=8)
            data = r.json().get("chart", {}).get("result", [{}])[0]
            closes_raw: list = data.get("indicators", {}).get("quote", [{}])[0].get("close", [])
            timestamps: list = data.get("timestamp", [])
            valid_closes = [c for c in closes_raw if c is not None]
            if not valid_closes:
                return yf_ticker, None

            # 마지막 bar가 오늘(KST) 날짜인지 확인
            _kst = _dt.timezone(_dt.timedelta(hours=9))
            _today_kst = _dt.datetime.now(_kst).date()
            last_bar_is_today = False
            if timestamps:
                last_bar_date = _dt.datetime.fromtimestamp(timestamps[-1], tz=_kst).date()
                last_bar_is_today = (last_bar_date == _today_kst)

            if last_bar_is_today:
                if closes_raw[-1] is None:
                    # 장 진행 중: 오늘 bar close 없음 → valid[-1] = 직전 거래일 종가
                    prev = valid_closes[-1]
                else:
                    # 장 종료: 오늘 close 있음 → valid[-2] = 직전 거래일 종가
                    prev = valid_closes[-2] if len(valid_closes) >= 2 else valid_closes[-1]
            else:
                # 오늘 bar 없음 (장 개장 전 or 비거래일) → valid[-1] = 직전 거래일 종가
                prev = valid_closes[-1]

            return yf_ticker, float(prev)
        except Exception:
            return yf_ticker, None

    # Yahoo HTTP 비동기 병렬 + sparkline 동시 실행
    yf_tickers_list = [_yf(t) for t in unique_tickers]
    async with httpx.AsyncClient() as _client:
        prev_close_results, sparklines = await asyncio.gather(
            asyncio.gather(*[_fetch_prev_close_one(_client, yft) for yft in yf_tickers_list]),
            asyncio.gather(*[get_sparkline(_yf(t)) for t in unique_tickers], return_exceptions=True),
        )
    # yf_ticker → prev_close 매핑 후 code 기준으로 변환
    yft_to_prev = {yft: pc for yft, pc in prev_close_results if pc is not None}
    prev_close_map = {t: yft_to_prev.get(_yf(t)) for t in unique_tickers}
    sparkline_map = {t: (s if isinstance(s, list) else []) for t, s in zip(unique_tickers, sparklines)}

    result_accounts = []
    for b in valid:
        holdings_out = []
        total_eval = b.get("total_eval_amount", 0) or 0

        for h in b.get("holdings", []):
            ticker = h["ticker"]
            meta = master_map.get(ticker, {})
            current_price = h["current_price"]
            eval_amount = h["eval_amount"]

            # 전일종가 기반 day_change 계산
            prev_close = prev_close_map.get(ticker)
            if current_price and prev_close and prev_close > 0:
                day_change = round(current_price - prev_close, 2)
                day_change_pct = round((current_price - prev_close) / prev_close * 100, 2)
            else:
                day_change = None
                day_change_pct = None

            holdings_out.append({
                "ticker": ticker,
                "name": h["name"],
                "exchange": meta.get("exchange", "KRX"),
                "kis_market": h.get("market", "KRX"),
                "avg_price": h["avg_price"],
                "quantity": h["quantity"],
                "current_price": current_price,
                "krx_current_price": h.get("krx_current_price"),
                "current_value": eval_amount,
                "krx_eval_amount": h.get("krx_eval_amount"),
                "pnl": h["pnl_amount"],
                "pnl_pct": h["pnl_pct"],
                "day_change": day_change,
                "day_change_pct": day_change_pct,
                "weight": round(eval_amount / total_eval * 100, 2) if total_eval else None,
                "sparkline": sparkline_map.get(ticker, []),
                "sector": meta.get("sector"),
                "source": "kiwoom",
                "memo": None,
                "bought_at": None,
            })

        result_accounts.append({
            "account_no": b["account_no"],
            "account_type": b["account_type"],
            "alias": b["alias"],
            "total_eval_amount": b.get("total_eval_amount", 0),
            "total_purchase_amount": b.get("total_purchase_amount", 0),
            "total_pnl_amount": b.get("total_pnl_amount", 0),
            "total_pnl_pct": b.get("total_pnl_pct", 0),
            "krx_total_eval_amount": b.get("krx_total_eval_amount", b.get("total_eval_amount", 0)),
            "krx_total_pnl_amount": b.get("krx_total_pnl_amount", b.get("total_pnl_amount", 0)),
            "krx_total_pnl_pct": b.get("krx_total_pnl_pct", b.get("total_pnl_pct", 0)),
            "deposit": b.get("deposit", 0),
            "holdings": holdings_out,
        })

    return result_accounts


@router.post("/sync")
async def sync_all(current_user: CurrentUser) -> dict:
    """KIS 데이터 동기화: Portfolio DB 업데이트 + 스냅샷 저장"""
    try:
        from services.kis_sync_service import sync_kis_to_portfolio
        result = await sync_kis_to_portfolio()
        return result
    except RuntimeError:
        raise HTTPException(status_code=503, detail="KIS 서비스 미설정")
    except Exception as e:
        logger.error(f"KIS sync 실패: {e}")
        raise HTTPException(status_code=503, detail=str(e))
