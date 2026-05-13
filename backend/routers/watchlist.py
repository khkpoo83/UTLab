import logging
from datetime import datetime
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import Watchlist, Recommendation, get_db
from routers.auth import get_current_user, User
from services.stock_service import fetch_current_price

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/watchlist", tags=["watchlist"])

CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]


class WatchlistCreate(BaseModel):
    ticker: str
    name: str
    exchange: Optional[str] = "KOSPI"
    target_price: Optional[float] = None
    memo: Optional[str] = None


class WatchlistUpdate(BaseModel):
    name: Optional[str] = None
    target_price: Optional[float] = None
    memo: Optional[str] = None


class WatchlistResponse(BaseModel):
    id: int
    ticker: str
    name: str
    exchange: Optional[str]
    target_price: Optional[float]
    memo: Optional[str]
    added_at: Optional[datetime]
    created_at: Optional[datetime]
    current_price: Optional[float] = None
    change_pct: Optional[float] = None
    is_recommended: bool = False


@router.get("", response_model=list[WatchlistResponse])
async def list_watchlist(current_user: CurrentUser, db: DB) -> list[WatchlistResponse]:
    result = await db.execute(select(Watchlist).order_by(Watchlist.created_at.desc()))
    items = result.scalars().all()

    # Get recent recommendation tickers (last 7 days)
    from datetime import timedelta
    cutoff = datetime.utcnow() - timedelta(days=7)
    rec_result = await db.execute(
        select(Recommendation.ticker).where(
            Recommendation.created_at >= cutoff
        )
    )
    recommended_tickers = {row[0] for row in rec_result.fetchall()}

    response = []
    for item in items:
        current_price = None
        change_pct = None
        try:
            price_data = await fetch_current_price(item.ticker)
            if isinstance(price_data, dict):
                current_price = price_data.get("price")
                change_pct = price_data.get("change_pct")
            elif price_data is not None:
                current_price = float(price_data)
        except Exception as e:
            logger.debug(f"Failed to fetch price for watchlist ticker {item.ticker}: {e}")

        response.append(
            WatchlistResponse(
                id=item.id,
                ticker=item.ticker,
                name=item.name,
                exchange=item.exchange,
                target_price=item.target_price,
                memo=item.memo,
                added_at=item.added_at,
                created_at=item.created_at,
                current_price=current_price,
                change_pct=change_pct,
                is_recommended=item.ticker in recommended_tickers,
            )
        )
    return response


@router.post("", response_model=WatchlistResponse, status_code=status.HTTP_201_CREATED)
async def create_watchlist_item(
    data: WatchlistCreate,
    current_user: CurrentUser,
    db: DB,
) -> WatchlistResponse:
    try:
        item = Watchlist(
            ticker=data.ticker.upper(),
            name=data.name,
            exchange=data.exchange or "KOSPI",
            target_price=data.target_price,
            memo=data.memo,
        )
        db.add(item)
        await db.commit()
        await db.refresh(item)

        current_price = None
        change_pct = None
        try:
            price_data = await fetch_current_price(item.ticker)
            if isinstance(price_data, dict):
                current_price = price_data.get("price")
                change_pct = price_data.get("change_pct")
            elif price_data is not None:
                current_price = float(price_data)
        except Exception:
            pass

        return WatchlistResponse(
            id=item.id,
            ticker=item.ticker,
            name=item.name,
            exchange=item.exchange,
            target_price=item.target_price,
            memo=item.memo,
            added_at=item.added_at,
            created_at=item.created_at,
            current_price=current_price,
            change_pct=change_pct,
        )
    except Exception as e:
        logger.error(f"create_watchlist_item error: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{item_id}", response_model=WatchlistResponse)
async def update_watchlist_item(
    item_id: int,
    data: WatchlistUpdate,
    current_user: CurrentUser,
    db: DB,
) -> WatchlistResponse:
    result = await db.execute(select(Watchlist).where(Watchlist.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Watchlist item not found")

    if data.name is not None:
        item.name = data.name
    if data.target_price is not None:
        item.target_price = data.target_price
    if data.memo is not None:
        item.memo = data.memo

    await db.commit()
    await db.refresh(item)

    current_price = None
    change_pct = None
    try:
        price_data = await fetch_current_price(item.ticker)
        if isinstance(price_data, dict):
            current_price = price_data.get("price")
            change_pct = price_data.get("change_pct")
        elif price_data is not None:
            current_price = float(price_data)
    except Exception:
        pass

    return WatchlistResponse(
        id=item.id,
        ticker=item.ticker,
        name=item.name,
        exchange=item.exchange,
        target_price=item.target_price,
        memo=item.memo,
        added_at=item.added_at,
        created_at=item.created_at,
        current_price=current_price,
        change_pct=change_pct,
    )


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_watchlist_item(
    item_id: int,
    current_user: CurrentUser,
    db: DB,
) -> None:
    result = await db.execute(select(Watchlist).where(Watchlist.id == item_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Watchlist item not found")
    await db.delete(item)
    await db.commit()
