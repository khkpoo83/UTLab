from datetime import datetime
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import Account, get_db
from repositories.account_repository import AccountRepository
from routers.auth import User, get_current_user

router = APIRouter(prefix="/accounts", tags=["accounts"])


def get_account_repo(db: AsyncSession = Depends(get_db)) -> AccountRepository:
    return AccountRepository(db)


CurrentUser = Annotated[User, Depends(get_current_user)]
Repo = Annotated[AccountRepository, Depends(get_account_repo)]


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
async def list_accounts(current_user: CurrentUser, repo: Repo):
    return await repo.list_all_ordered()


@router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
async def create_account(data: AccountCreate, current_user: CurrentUser, repo: Repo):
    account = Account(name=data.name, color=data.color or "#3B82F6")
    await repo.add(account)
    return account


@router.put("/{account_id}", response_model=AccountResponse)
async def update_account(
    account_id: int,
    data: AccountUpdate,
    current_user: CurrentUser,
    repo: Repo,
):
    account = await repo.get(account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    if data.name is not None:
        account.name = data.name
    if data.color is not None:
        account.color = data.color
    await repo.update(account)
    return account


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(account_id: int, current_user: CurrentUser, repo: Repo):
    account = await repo.get(account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    # 해당 계좌의 포지션들 account_id 초기화 후 계좌 삭제 (단일 트랜잭션)
    await repo.delete_with_holdings_detached(account)
