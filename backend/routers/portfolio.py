import asyncio
import logging
from datetime import datetime
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import Portfolio, Account, get_db
from routers.auth import get_current_user, User
from services.stock_service import (
    fetch_current_price,
    fetch_price_detail,
    get_chart_data,
    search_stocks,
    get_sparkline,
)
from services.news_service import get_ticker_news

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/portfolio", tags=["portfolio"])

CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]


class PortfolioCreate(BaseModel):
    ticker: str
    name: str
    exchange: Optional[str] = None
    avg_price: float
    quantity: float
    memo: Optional[str] = None
    bought_at: Optional[datetime] = None
    sector: Optional[str] = None
    account_id: Optional[int] = None


class PortfolioUpdate(BaseModel):
    avg_price: Optional[float] = None
    quantity: Optional[float] = None
    memo: Optional[str] = None
    bought_at: Optional[datetime] = None
    sector: Optional[str] = None
    name: Optional[str] = None
    account_id: Optional[int] = None


class PortfolioResponse(BaseModel):
    id: int
    ticker: str
    name: str
    exchange: Optional[str]
    avg_price: float
    quantity: float
    memo: Optional[str]
    bought_at: Optional[datetime]
    sector: Optional[str]
    created_at: datetime
    source: str = "manual"
    current_price: Optional[float] = None
    pnl: Optional[float] = None
    pnl_pct: Optional[float] = None
    current_value: Optional[float] = None
    day_change: Optional[float] = None       # 당일 등락금액
    day_change_pct: Optional[float] = None   # 당일 등락률(%)
    weight: Optional[float] = None           # 포트폴리오 비중(%)
    sparkline: list[float] = []
    account_id: Optional[int] = None
    account_name: Optional[str] = None


@router.get("/history")
async def get_portfolio_history(
    current_user: CurrentUser,
    days: int = Query(90, ge=7, le=365),
    account_no: Optional[str] = Query(None),
) -> list[dict]:
    """포트폴리오 수익률 히스토리 (일별 스냅샷)"""
    from services.portfolio_snapshot_service import get_history
    return await get_history(days=days, account_no=account_no or 'TOTAL')


@router.post("/history/snapshot")
async def trigger_snapshot(current_user: CurrentUser) -> dict:
    """수동으로 오늘 스냅샷 저장 트리거"""
    from services.portfolio_snapshot_service import save_snapshot
    ok = await save_snapshot()
    return {"ok": ok}


@router.get("/search")
async def search_stocks_endpoint(
    _: CurrentUser,
    q: str = Query(..., min_length=1),
) -> list[dict]:
    return await search_stocks(q)


@router.get("/summary")
async def get_summary(
    current_user: CurrentUser,
    db: DB,
    account_name: str | None = Query(None),
) -> dict:
    if account_name is not None:
        stmt = (
            select(Portfolio)
            .join(Account, Portfolio.account_id == Account.id)
            .where(Account.name == account_name)
        )
    else:
        stmt = select(Portfolio)
    result = await db.execute(stmt)
    holdings = result.scalars().all()

    if not holdings:
        return {
            "total_value": 0,
            "total_cost": 0,
            "total_pnl": 0,
            "total_pnl_pct": 0,
            "count": 0,
            "day_pnl": None,
            "day_pnl_pct": None,
            "up_count": 0,
            "down_count": 0,
        }

    details = await asyncio.gather(
        *[fetch_price_detail(h.ticker) for h in holdings],
        return_exceptions=True,
    )

    total_value = 0.0
    total_cost = 0.0
    day_pnl = 0.0
    day_pnl_valid = False
    up_count = 0
    down_count = 0

    for holding, detail in zip(holdings, details):
        cost = holding.avg_price * holding.quantity
        total_cost += cost
        d = detail if isinstance(detail, dict) else None
        if d and d.get("price"):
            cv = d["price"] * holding.quantity
            total_value += cv
        else:
            total_value += cost
        if d and d.get("day_change") is not None:
            day_pnl += d["day_change"] * holding.quantity
            day_pnl_valid = True
            if d["day_change"] > 0:
                up_count += 1
            elif d["day_change"] < 0:
                down_count += 1

    total_pnl = total_value - total_cost
    total_pnl_pct = (total_pnl / total_cost * 100) if total_cost > 0 else 0.0

    day_pnl_out = round(day_pnl, 2) if day_pnl_valid else None
    day_pnl_pct_out = None
    if day_pnl_valid and total_value > 0:
        prev_value = total_value - day_pnl
        if prev_value > 0:
            day_pnl_pct_out = round(day_pnl / prev_value * 100, 2)

    return {
        "total_value": round(total_value, 2),
        "total_cost": round(total_cost, 2),
        "total_pnl": round(total_pnl, 2),
        "total_pnl_pct": round(total_pnl_pct, 2),
        "count": len(holdings),
        "day_pnl": day_pnl_out,
        "day_pnl_pct": day_pnl_pct_out,
        "up_count": up_count,
        "down_count": down_count,
    }


@router.get("", response_model=list[PortfolioResponse])
async def list_portfolio(
    current_user: CurrentUser,
    db: DB,
    skip_price: bool = Query(False, description="현재가/스파크라인 조회 생략 (빠른 응답, 섹터·비중 계산용)"),
) -> list[PortfolioResponse]:
    result = await db.execute(select(Portfolio).order_by(Portfolio.created_at.desc()))
    holdings = result.scalars().all()

    # 계좌 정보 로드
    accounts_result = await db.execute(select(Account))
    accounts_map = {a.id: a for a in accounts_result.scalars().all()}

    if skip_price:
        # 현재가 없이 빠른 응답 (Analytics 섹터 가중치 등에 사용)
        total_cost = sum(h.avg_price * h.quantity for h in holdings)
        response = []
        for holding in holdings:
            cost = holding.avg_price * holding.quantity
            holding_account_id = getattr(holding, "account_id", None)
            account = accounts_map.get(holding_account_id) if holding_account_id else None
            response.append(PortfolioResponse(
                id=holding.id, ticker=holding.ticker, name=holding.name,
                exchange=holding.exchange, avg_price=holding.avg_price,
                quantity=holding.quantity, memo=holding.memo,
                bought_at=holding.bought_at, sector=holding.sector,
                created_at=holding.created_at,
                source=getattr(holding, "source", "manual") or "manual",
                current_price=None, pnl=None, pnl_pct=None,
                current_value=round(cost, 2),
                day_change=None, day_change_pct=None,
                weight=round(cost / total_cost * 100, 2) if total_cost > 0 else None,
                sparkline=[], account_id=holding_account_id,
                account_name=account.name if account else None,
            ))
        return response

    details, sparklines = await asyncio.gather(
        asyncio.gather(*[fetch_price_detail(h.ticker) for h in holdings], return_exceptions=True),
        asyncio.gather(*[get_sparkline(h.ticker) for h in holdings], return_exceptions=True),
    )

    # 1차 패스: 평가금액 합산 → 비중 계산용
    total_value = 0.0
    values: list[Optional[float]] = []
    for holding, detail in zip(holdings, details):
        cost = holding.avg_price * holding.quantity
        if isinstance(detail, dict) and detail:
            cv = detail["price"] * holding.quantity
        else:
            cv = cost  # 가격 없으면 매수금액으로 대체
        values.append(cv)
        total_value += cv

    response = []
    for holding, detail, sparkline, cv in zip(holdings, details, sparklines, values):
        d = detail if isinstance(detail, dict) else None
        current_price = d["price"] if d else None
        cost = holding.avg_price * holding.quantity
        current_value = round(cv, 2)
        pnl = round(cv - cost, 2) if d else None
        pnl_pct = round((cv - cost) / cost * 100, 2) if (d and cost > 0) else None
        day_change = round(d["day_change"], 2) if d else None
        day_change_pct = d["day_change_pct"] if d else None
        weight = round(cv / total_value * 100, 2) if total_value > 0 else None
        source = getattr(holding, "source", "manual") or "manual"
        holding_account_id = getattr(holding, "account_id", None)
        account = accounts_map.get(holding_account_id) if holding_account_id else None

        response.append(
            PortfolioResponse(
                id=holding.id,
                ticker=holding.ticker,
                name=holding.name,
                exchange=holding.exchange,
                avg_price=holding.avg_price,
                quantity=holding.quantity,
                memo=holding.memo,
                bought_at=holding.bought_at,
                sector=holding.sector,
                created_at=holding.created_at,
                source=source,
                current_price=current_price,
                pnl=pnl,
                pnl_pct=pnl_pct,
                current_value=current_value,
                day_change=day_change,
                day_change_pct=day_change_pct,
                weight=weight,
                sparkline=sparkline if isinstance(sparkline, list) else [],
                account_id=holding_account_id,
                account_name=account.name if account else None,
            )
        )
    return response


@router.post("", response_model=PortfolioResponse, status_code=status.HTTP_201_CREATED)
async def create_holding(
    data: PortfolioCreate,
    current_user: CurrentUser,
    db: DB,
) -> PortfolioResponse:
    holding = Portfolio(
        ticker=data.ticker.upper(),
        name=data.name,
        exchange=data.exchange,
        avg_price=data.avg_price,
        quantity=data.quantity,
        memo=data.memo,
        bought_at=data.bought_at,
        sector=data.sector,
        account_id=data.account_id,
    )
    db.add(holding)
    await db.commit()
    await db.refresh(holding)

    current_price = await fetch_current_price(holding.ticker)
    cost = holding.avg_price * holding.quantity
    current_value = (current_price * holding.quantity) if current_price else None
    pnl = (current_value - cost) if current_value is not None else None
    pnl_pct = (pnl / cost * 100) if (pnl is not None and cost > 0) else None

    return PortfolioResponse(
        id=holding.id,
        ticker=holding.ticker,
        name=holding.name,
        exchange=holding.exchange,
        avg_price=holding.avg_price,
        quantity=holding.quantity,
        memo=holding.memo,
        bought_at=holding.bought_at,
        sector=holding.sector,
        created_at=holding.created_at,
        current_price=current_price,
        pnl=round(pnl, 2) if pnl is not None else None,
        pnl_pct=round(pnl_pct, 2) if pnl_pct is not None else None,
        current_value=round(current_value, 2) if current_value is not None else None,
        sparkline=[],
        account_id=getattr(holding, "account_id", None),
    )


@router.put("/{holding_id}", response_model=PortfolioResponse)
async def update_holding(
    holding_id: int,
    data: PortfolioUpdate,
    current_user: CurrentUser,
    db: DB,
) -> PortfolioResponse:
    result = await db.execute(select(Portfolio).where(Portfolio.id == holding_id))
    holding = result.scalar_one_or_none()
    if not holding:
        raise HTTPException(status_code=404, detail="Holding not found")

    if data.avg_price is not None:
        holding.avg_price = data.avg_price
    if data.quantity is not None:
        holding.quantity = data.quantity
    if data.memo is not None:
        holding.memo = data.memo
    if data.bought_at is not None:
        holding.bought_at = data.bought_at
    if data.sector is not None:
        holding.sector = data.sector
    if data.name is not None:
        holding.name = data.name
    if 'account_id' in data.model_fields_set:
        holding.account_id = data.account_id

    await db.commit()
    await db.refresh(holding)

    current_price = await fetch_current_price(holding.ticker)
    cost = holding.avg_price * holding.quantity
    current_value = (current_price * holding.quantity) if current_price else None
    pnl = (current_value - cost) if current_value is not None else None
    pnl_pct = (pnl / cost * 100) if (pnl is not None and cost > 0) else None
    holding_account_id = getattr(holding, "account_id", None)

    return PortfolioResponse(
        id=holding.id,
        ticker=holding.ticker,
        name=holding.name,
        exchange=holding.exchange,
        avg_price=holding.avg_price,
        quantity=holding.quantity,
        memo=holding.memo,
        bought_at=holding.bought_at,
        sector=holding.sector,
        created_at=holding.created_at,
        current_price=current_price,
        pnl=round(pnl, 2) if pnl is not None else None,
        pnl_pct=round(pnl_pct, 2) if pnl_pct is not None else None,
        current_value=round(current_value, 2) if current_value is not None else None,
        sparkline=[],
        account_id=holding_account_id,
    )


@router.delete("/{holding_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_holding(
    holding_id: int,
    current_user: CurrentUser,
    db: DB,
) -> None:
    result = await db.execute(select(Portfolio).where(Portfolio.id == holding_id))
    holding = result.scalar_one_or_none()
    if not holding:
        raise HTTPException(status_code=404, detail="Holding not found")
    await db.delete(holding)
    await db.commit()


@router.get("/{holding_id}/chart")
async def get_chart(
    current_user: CurrentUser,
    db: DB,
    holding_id: int,
    period: str = Query("3m", pattern="^(1d|1w|1m|3m|1y)$"),
) -> list[dict]:
    result = await db.execute(select(Portfolio).where(Portfolio.id == holding_id))
    holding = result.scalar_one_or_none()
    if not holding:
        raise HTTPException(status_code=404, detail="Holding not found")

    data = await get_chart_data(holding.ticker, period)
    return data


@router.get("/{holding_id}/news")
async def get_holding_news(
    current_user: CurrentUser,
    db: DB,
    holding_id: int,
) -> list[dict]:
    result = await db.execute(select(Portfolio).where(Portfolio.id == holding_id))
    holding = result.scalar_one_or_none()
    if not holding:
        raise HTTPException(status_code=404, detail="Holding not found")

    return await get_ticker_news(holding.ticker, name=holding.name)


@router.get("/by-ticker/{ticker}/chart")
async def get_chart_by_ticker(
    current_user: CurrentUser,
    ticker: str,
    period: str = Query("3m", pattern="^(1d|1w|1m|3m|1y)$"),
) -> list[dict]:
    """KIS ticker 기반 차트 조회 (StockMaster에서 yf_ticker 매핑)"""
    from sqlalchemy import or_
    from models.database import AsyncSessionLocal, StockMaster
    yf_ticker = ticker
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(StockMaster).where(StockMaster.ticker.like(f"{ticker}.%")).limit(1)
        )
        row = result.scalar_one_or_none()
        if row:
            yf_ticker = row.ticker
        else:
            yf_ticker = f"{ticker}.KS"
    return await get_chart_data(yf_ticker, period)


@router.get("/by-ticker/{ticker}/news")
async def get_news_by_ticker(
    current_user: CurrentUser,
    ticker: str,
    name: str = Query(""),
) -> list[dict]:
    """KIS ticker 기반 뉴스 조회"""
    return await get_ticker_news(ticker, name=name or None)


@router.get("/analysis")
async def get_portfolio_analysis_endpoint(
    current_user: CurrentUser,
    db: DB,
) -> list[dict]:
    """계좌별 AI 포트폴리오 분석 결과 반환"""
    from services.portfolio_analysis_service import get_portfolio_analysis
    return await get_portfolio_analysis(db)


@router.post("/analysis/refresh")
async def refresh_portfolio_analysis(
    current_user: CurrentUser,
    db: DB,
) -> dict:
    """포트폴리오 분석 수동 실행 (PA1 + PA2 순차 실행)"""
    from services.portfolio_analysis_service import run_pa1, run_pa2
    ok = await run_pa1(db)
    if not ok:
        raise HTTPException(status_code=500, detail="PA1 failed")
    count = await run_pa2(db)
    return {"message": f"분석 완료: {count}개 종목", "count": count}
