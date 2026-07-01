"""Data-access layer for the profile router.

``ProfileRepository`` wraps an ``AsyncSession`` and encapsulates every
SQLAlchemy query over ``UserProfile`` that ``routers/profile.py`` previously ran
inline.  The get-or-create control flow and default values stay in the router;
only the raw DB access moves here.  Transaction boundaries (commit / refresh)
match the router exactly — this is a behavior-preserving relocation.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import UserProfile


class ProfileRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_user_id(self, user_id: int) -> Optional[UserProfile]:
        """Single profile for the given user id, or ``None``."""
        result = await self.db.execute(
            select(UserProfile).where(UserProfile.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def add(self, profile: UserProfile) -> UserProfile:
        """Persist a new profile (add + commit + refresh)."""
        self.db.add(profile)
        await self.db.commit()
        await self.db.refresh(profile)
        return profile

    async def update(self, profile: UserProfile) -> UserProfile:
        """Flush field mutations already applied by the caller (commit + refresh)."""
        await self.db.commit()
        await self.db.refresh(profile)
        return profile
