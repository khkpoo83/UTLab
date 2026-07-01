"""메모(포스트잇) 라우터 — CRUD"""
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import Memo, get_db
from repositories.memo_repository import MemoRepository
from routers.auth import get_current_user

router = APIRouter(prefix="/memos", tags=["memo"])


def get_memo_repo(db: AsyncSession = Depends(get_db)) -> MemoRepository:
    return MemoRepository(db)


Repo = Annotated[MemoRepository, Depends(get_memo_repo)]


def _memo_to_dict(m: Memo) -> dict:
    return {
        "id": m.id,
        "title": m.title,
        "body": m.body,
        "color": m.color,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "updated_at": m.updated_at.isoformat() if m.updated_at else None,
    }


@router.get("")
async def list_memos(
    repo: Repo,
    q: str = "",
    _user=Depends(get_current_user),
):
    memos = await repo.list(q)
    return [_memo_to_dict(m) for m in memos]


@router.get("/{memo_id}")
async def get_memo(
    memo_id: int,
    repo: Repo,
    _user=Depends(get_current_user),
):
    m = await repo.get(memo_id)
    if not m:
        raise HTTPException(404, "메모를 찾을 수 없습니다")
    return _memo_to_dict(m)


class MemoCreate(BaseModel):
    title: str
    body: Optional[str] = None
    color: Optional[str] = None

    @field_validator("title")
    @classmethod
    def title_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("제목은 필수입니다")
        return v.strip()


@router.post("", status_code=201)
async def create_memo(
    body: MemoCreate,
    repo: Repo,
    _user=Depends(get_current_user),
):
    m = Memo(title=body.title, body=body.body, color=body.color)
    await repo.add(m)
    return _memo_to_dict(m)


class MemoUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    color: Optional[str] = None

    @field_validator("title")
    @classmethod
    def title_not_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("제목은 필수입니다")
        return v.strip() if v else v


@router.put("/{memo_id}")
async def update_memo(
    memo_id: int,
    body: MemoUpdate,
    repo: Repo,
    _user=Depends(get_current_user),
):
    m = await repo.get(memo_id)
    if not m:
        raise HTTPException(404, "메모를 찾을 수 없습니다")
    if body.title is not None:
        m.title = body.title
    if body.body is not None:
        m.body = body.body
    if body.color is not None:
        m.color = body.color
    m.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await repo.update(m)
    return _memo_to_dict(m)


@router.delete("/{memo_id}")
async def delete_memo(
    memo_id: int,
    repo: Repo,
    _user=Depends(get_current_user),
):
    m = await repo.get(memo_id)
    if not m:
        raise HTTPException(404, "메모를 찾을 수 없습니다")
    await repo.delete(m)
    return {"ok": True}
