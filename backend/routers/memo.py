"""메모(포스트잇) 라우터 — CRUD"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import get_db, Memo
from routers.auth import get_current_user

router = APIRouter(prefix="/memos", tags=["memo"])


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
    q: str = "",
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    stmt = select(Memo).order_by(desc(Memo.created_at))
    if q:
        stmt = stmt.where(Memo.title.contains(q))
    result = await db.execute(stmt)
    return [_memo_to_dict(m) for m in result.scalars().all()]


@router.get("/{memo_id}")
async def get_memo(
    memo_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    m = await db.get(Memo, memo_id)
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
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    m = Memo(title=body.title, body=body.body, color=body.color)
    db.add(m)
    await db.commit()
    await db.refresh(m)
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
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    m = await db.get(Memo, memo_id)
    if not m:
        raise HTTPException(404, "메모를 찾을 수 없습니다")
    if body.title is not None:
        m.title = body.title
    if body.body is not None:
        m.body = body.body
    if body.color is not None:
        m.color = body.color
    m.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()
    await db.refresh(m)
    return _memo_to_dict(m)


@router.delete("/{memo_id}")
async def delete_memo(
    memo_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    m = await db.get(Memo, memo_id)
    if not m:
        raise HTTPException(404, "메모를 찾을 수 없습니다")
    await db.delete(m)
    await db.commit()
    return {"ok": True}
