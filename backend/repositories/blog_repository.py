"""Data-access layer for the blog router.

``BlogRepository`` wraps an ``AsyncSession`` and encapsulates every SQLAlchemy
query that ``routers/blog.py`` previously ran inline.  Query semantics (filters,
ordering, pagination, visibility) and transaction boundaries (commit / refresh /
delete) match the router exactly — this is a behavior-preserving relocation.

Note: the cover-image *file* deletion in ``delete_post`` stays in the router
(it is filesystem, not DB); only the row delete + commit lives here so the
single-commit transaction point is preserved.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import BlogPost


class BlogRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list(
        self,
        visibility: str = "all",
        q: str = "",
        tag: str = "",
        limit: int = 50,
        offset: int = 0,
    ) -> list[BlogPost]:
        """Admin list: newest first, optional visibility / title / tag filters + pagination."""
        stmt = select(BlogPost).order_by(desc(BlogPost.created_at))
        if visibility in ("public", "private"):
            stmt = stmt.where(BlogPost.visibility == visibility)
        if q:
            stmt = stmt.where(BlogPost.title.contains(q))
        if tag:
            stmt = stmt.where(BlogPost.tags.contains(tag))
        stmt = stmt.offset(offset).limit(limit)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def get(self, post_id: int) -> Optional[BlogPost]:
        """Single post by id (via ``session.get``), or ``None``."""
        return await self.db.get(BlogPost, post_id)

    async def add(self, post: BlogPost) -> BlogPost:
        """Persist a new post (add + commit + refresh)."""
        self.db.add(post)
        await self.db.commit()
        await self.db.refresh(post)
        return post

    async def update(self, post: BlogPost) -> BlogPost:
        """Flush field mutations already applied by the caller (commit + refresh)."""
        await self.db.commit()
        await self.db.refresh(post)
        return post

    async def delete(self, post: BlogPost) -> None:
        """Remove a post row (delete + commit).

        The caller is responsible for any filesystem side-effects (cover image)
        before invoking this, so both happen under one commit.
        """
        await self.db.delete(post)
        await self.db.commit()

    async def find_by_cover_image(self, filename: str) -> Optional[BlogPost]:
        """First post whose ``cover_image`` equals ``filename``, or ``None``."""
        result = await self.db.execute(
            select(BlogPost).where(BlogPost.cover_image == filename)
        )
        return result.scalar_one_or_none()

    async def public_list(self, limit: int = 20, offset: int = 0) -> list[BlogPost]:
        """Public list: ``visibility == "public"``, newest first, paginated."""
        stmt = (
            select(BlogPost)
            .where(BlogPost.visibility == "public")
            .order_by(desc(BlogPost.created_at))
            .offset(offset)
            .limit(limit)
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def public_get(self, post_id: int) -> Optional[BlogPost]:
        """Single post by id for the public path (via ``session.get``), or ``None``."""
        return await self.db.get(BlogPost, post_id)
