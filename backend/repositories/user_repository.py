"""User data access for authentication.

Wraps the User queries used by the auth router. Security logic (lockout,
failed-attempt counting, bcrypt verification, initial-user creation) stays in
the router; only the SQLAlchemy access lives here. Constructed with whatever
session the caller owns — auth manages its own ``AsyncSessionLocal`` sessions
(including inside the ``get_current_user`` dependency), so this repository is
built inside those blocks rather than via a ``get_db`` provider.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import User


class UserRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_username(self, username: str) -> User | None:
        result = await self.db.execute(select(User).where(User.username == username))
        return result.scalar_one_or_none()

    async def get_by_id(self, user_id: int) -> User:
        """Fetch by id, raising if absent (matches the auth change-password path)."""
        result = await self.db.execute(select(User).where(User.id == user_id))
        return result.scalar_one()

    def add(self, user: User) -> None:
        self.db.add(user)

    async def commit(self) -> None:
        await self.db.commit()
