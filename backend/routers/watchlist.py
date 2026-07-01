import asyncio
import logging
from datetime import datetime
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import Watchlist, get_db
from repositories.watchlist_repository import WatchlistRepository
from routers.auth import User, get_current_user
from services.stock_service import fetch_current_price
from utils.timeutil import utcnow

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/watchlist", tags=["watchlist"])


def get_watchlist_repo(db: AsyncSession = Depends(get_db)) -> WatchlistRepository:
    return WatchlistRepository(db)


CurrentUser = Annotated[User, Depends(get_current_user)]
Repo = Annotated[WatchlistRepository, Depends(get_watchlist_repo)]


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
async def list_watchlist(current_user: CurrentUser, repo: Repo) -> list[WatchlistResponse]:
    items = await repo.list_all_ordered()

    # Get recent recommendation tickers (last 7 days)
    from datetime import timedelta
    cutoff = utcnow() - timedelta(days=7)
    recommended_tickers = await repo.recent_recommended_tickers(cutoff)

    # 병렬로 모든 watchlist 종목 가격 조회 (N+1 → 1 round)
    async def _safe_fetch(item: Watchlist) -> tuple[Optional[float], Optional[float]]:
        try:
            price_data = await fetch_current_price(item.ticker)
            if isinstance(price_data, dict):
                return price_data.get("price"), price_data.get("change_pct")
            elif price_data is not None:
                return float(price_data), None
        except Exception as e:
            logger.debug(f"Failed to fetch price for watchlist ticker {item.ticker}: {e}")
        return None, None

    price_results = await asyncio.gather(*(_safe_fetch(item) for item in items))

    response = []
    for item, (current_price, change_pct) in zip(items, price_results):
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
    repo: Repo,
) -> WatchlistResponse:
    try:
        item = Watchlist(
            ticker=data.ticker.upper(),
            name=data.name,
            exchange=data.exchange or "KOSPI",
            target_price=data.target_price,
            memo=data.memo,
        )
        await repo.add(item)

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
    repo: Repo,
) -> WatchlistResponse:
    item = await repo.get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Watchlist item not found")

    if data.name is not None:
        item.name = data.name
    if data.target_price is not None:
        item.target_price = data.target_price
    if data.memo is not None:
        item.memo = data.memo

    await repo.update(item)

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
    repo: Repo,
) -> None:
    item = await repo.get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Watchlist item not found")
    await repo.delete(item)
