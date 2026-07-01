import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import get_db
from repositories.news_repository import NewsRepository
from routers.auth import User, get_current_user
from services.news_service import collect_and_save_news, get_news_list
from services.ollama_service import enqueue_summarize

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/news", tags=["news"])


def get_news_repo(db: AsyncSession = Depends(get_db)) -> NewsRepository:
    return NewsRepository(db)


CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]
Repo = Annotated[NewsRepository, Depends(get_news_repo)]


@router.get("")
async def list_news(
    current_user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    sector: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    date: Optional[str] = Query(None),
) -> dict:
    return await get_news_list(page=page, page_size=page_size, sector=sector, status=status, date=date)


@router.get("/{news_id}")
async def get_news_detail(
    news_id: int,
    current_user: CurrentUser,
    repo: Repo,
) -> dict:
    news = await repo.get(news_id)
    if not news:
        raise HTTPException(status_code=404, detail="News not found")

    return {
        "id": news.id,
        "title": news.title,
        "url": news.url,
        "source": news.source,
        "published_at": news.published_at.isoformat() if news.published_at else None,
        "summary": news.summary,
        "sector": news.sector,
        "related_stocks": news.related_stocks,
        "group_id": news.group_id,
        "status": news.status,
        "created_at": news.created_at.isoformat() if news.created_at else None,
    }


@router.post("/refresh")
async def refresh_news(current_user: CurrentUser) -> dict:
    from services.news_service import get_top_pending_news_ids
    saved_ids = await collect_and_save_news()
    # 모든 기사가 아닌 그룹별 상위 10개만 큐에 등록
    top_ids = await get_top_pending_news_ids(limit=10)
    for news_id in top_ids:
        await enqueue_summarize(news_id, priority=1)
    return {"message": f"Refreshed. saved={len(saved_ids)}, queued={len(top_ids)}", "count": len(saved_ids)}


@router.get("/queue/status")
async def get_news_queue_status(current_user: CurrentUser, repo: Repo) -> dict:
    from services.ollama_service import get_queue_status
    qs = get_queue_status()
    # 세 카운트는 하나의 세션을 공유하므로 순차 실행 (동시 실행 불가). 카운트는 소량이라 무해.
    pending_cnt = await repo.count_by_status("pending")
    summarizing_cnt = await repo.count_by_status("summarizing")
    done_cnt = await repo.count_by_status("done")
    return {
        "queue_size": qs["queue_size"],
        "worker_running": qs["worker_running"],
        "pending": pending_cnt or 0,
        "summarizing": summarizing_cnt or 0,
        "done": done_cnt or 0,
    }
