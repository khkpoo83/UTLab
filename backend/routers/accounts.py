from datetime import datetime
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import Account, Portfolio, get_db
from routers.auth import get_current_user, User

router = APIRouter(prefix="/accounts", tags=["accounts"])

CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]


class AccountCreate(BaseModel):
    name: str
    color: Optional[str] = "#3B82F6"


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None


class AccountResponse(BaseModel):
    id: int
    name: str
    color: str
    created_at: datetime


@router.get("", response_model=list[AccountResponse])
async def list_accounts(current_user: CurrentUser, db: DB):
    result = await db.execute(select(Account).order_by(Account.created_at))
    return result.scalars().all()


@router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
async def create_account(data: AccountCreate, current_user: CurrentUser, db: DB):
    account = Account(name=data.name, color=data.color or "#3B82F6")
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return account


@router.put("/{account_id}", response_model=AccountResponse)
async def update_account(
    account_id: int,
    data: AccountUpdate,
    current_user: CurrentUser,
    db: DB,
):
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    if data.name is not None:
        account.name = data.name
    if data.color is not None:
        account.color = data.color
    await db.commit()
    await db.refresh(account)
    return account


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(account_id: int, current_user: CurrentUser, db: DB):
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    # 해당 계좌의 포지션들 account_id 초기화
    await db.execute(
        update(Portfolio).where(Portfolio.account_id == account_id).values(account_id=None)
    )
    await db.delete(account)
    await db.commit()
