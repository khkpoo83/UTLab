"""사용자 프로필 라우터 — 개인정보 저장 및 플래너 연동"""
import logging
from datetime import date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import User, UserProfile, get_db
from repositories.profile_repository import ProfileRepository
from routers.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/profile", tags=["profile"])


def get_profile_repo(db: AsyncSession = Depends(get_db)) -> ProfileRepository:
    return ProfileRepository(db)


Repo = Annotated[ProfileRepository, Depends(get_profile_repo)]
CurrentUser = Annotated[User, Depends(get_current_user)]


class ProfileResponse(BaseModel):
    display_name: Optional[str] = None
    birth_date: Optional[str] = None      # "YYYY-MM-DD"
    profile_icon: Optional[str] = "👤"
    job: Optional[str] = None
    retire_age: Optional[int] = 60
    monthly_income_만: Optional[int] = None
    # 계산 필드
    age: Optional[int] = None             # 현재 나이 (만 나이)
    birth_year: Optional[int] = None


class ProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    birth_date: Optional[str] = None
    profile_icon: Optional[str] = None
    job: Optional[str] = None
    retire_age: Optional[int] = None
    monthly_income_만: Optional[int] = None


def _calc_age(birth_date_str: Optional[str]) -> Optional[int]:
    if not birth_date_str:
        return None
    try:
        bd = date.fromisoformat(birth_date_str)
        today = date.today()
        return today.year - bd.year - ((today.month, today.day) < (bd.month, bd.day))
    except Exception:
        return None


async def _get_or_create_profile(user: User, repo: ProfileRepository) -> UserProfile:
    profile = await repo.get_by_user_id(user.id)
    if not profile:
        profile = UserProfile(user_id=user.id, profile_icon="👤", retire_age=60)
        await repo.add(profile)
    return profile


@router.get("", response_model=ProfileResponse)
async def get_profile(current_user: CurrentUser, repo: Repo) -> ProfileResponse:
    profile = await _get_or_create_profile(current_user, repo)
    age = _calc_age(profile.birth_date)
    birth_year = date.fromisoformat(profile.birth_date).year if profile.birth_date else None
    return ProfileResponse(
        display_name=profile.display_name,
        birth_date=profile.birth_date,
        profile_icon=profile.profile_icon or "👤",
        job=profile.job,
        retire_age=profile.retire_age,
        monthly_income_만=profile.monthly_income_만,
        age=age,
        birth_year=birth_year,
    )


@router.put("", response_model=ProfileResponse)
async def update_profile(data: ProfileUpdate, current_user: CurrentUser, repo: Repo) -> ProfileResponse:
    profile = await _get_or_create_profile(current_user, repo)

    if data.display_name is not None:
        profile.display_name = data.display_name
    if data.birth_date is not None:
        # 간단한 날짜 형식 검증
        try:
            date.fromisoformat(data.birth_date)
        except ValueError:
            raise HTTPException(400, "birth_date must be YYYY-MM-DD format")
        profile.birth_date = data.birth_date
    if data.profile_icon is not None:
        profile.profile_icon = data.profile_icon
    if data.job is not None:
        profile.job = data.job
    if data.retire_age is not None:
        if not (40 <= data.retire_age <= 80):
            raise HTTPException(400, "retire_age must be between 40 and 80")
        profile.retire_age = data.retire_age
    if data.monthly_income_만 is not None:
        profile.monthly_income_만 = data.monthly_income_만

    await repo.update(profile)

    age = _calc_age(profile.birth_date)
    birth_year = date.fromisoformat(profile.birth_date).year if profile.birth_date else None
    return ProfileResponse(
        display_name=profile.display_name,
        birth_date=profile.birth_date,
        profile_icon=profile.profile_icon or "👤",
        job=profile.job,
        retire_age=profile.retire_age,
        monthly_income_만=profile.monthly_income_만,
        age=age,
        birth_year=birth_year,
    )
