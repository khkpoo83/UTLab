"""AI 처리 큐 및 워커 (Gemini 기반)

뉴스 요약은 BATCH_SIZE 단위로 묶어 Gemini 1회 호출.
모의투자 분석은 단건 처리.
중복 enqueue 방지 (_enqueued_ids 세트).
"""

import asyncio
import logging
from datetime import datetime
from typing import Optional

import pytz
from sqlalchemy import select

from models.database import News, AsyncSessionLocal

_KST = pytz.timezone("Asia/Seoul")


async def _is_ai_summary_active() -> bool:
    """현재 KST 시각이 ai_summary_start_hour ~ ai_summary_end_hour 범위인지 확인"""
    try:
        from routers.settings import get_all_settings
        async with AsyncSessionLocal() as s:
            cfg = await get_all_settings(s)
        now = datetime.now(_KST)
        start = int(cfg.get("ai_summary_start_hour", 8))
        end = int(cfg.get("ai_summary_end_hour", 22))
        return start <= now.hour < end
    except Exception:
        return True

logger = logging.getLogger(__name__)

_queue: asyncio.Queue = asyncio.Queue()
_worker_task: Optional[asyncio.Task] = None
_enqueued_ids: set[int] = set()  # 중복 enqueue 방지

BATCH_SIZE = 10


def configure(*args, **kwargs) -> None:
    """하위 호환성 유지 (Ollama 설정 불필요 - Gemini 사용)"""
    pass


async def enqueue_summarize(news_id: int, priority: int = 2) -> None:
    if news_id in _enqueued_ids:
        return
    _enqueued_ids.add(news_id)
    await _queue.put((priority, "news", news_id))



async def _copy_summary_to_group(session, rep: News) -> int:
    """대표 기사의 요약을 같은 group_id의 pending 기사들에 복사하고 done 처리."""
    if not rep.group_id:
        return 0
    result = await session.execute(
        select(News).where(
            News.group_id == rep.group_id,
            News.id != rep.id,
            News.status == "pending",
        )
    )
    members = result.scalars().all()
    for m in members:
        m.summary = rep.summary
        m.sector = rep.sector
        m.related_stocks = rep.related_stocks
        m.status = "done"
    return len(members)


async def _handle_news_batch(news_ids: list[int]) -> None:
    from services.groq_service import batch_summarize_news

    articles = []
    async with AsyncSessionLocal() as session:
        for nid in news_ids:
            result = await session.execute(select(News).where(News.id == nid))
            news = result.scalar_one_or_none()
            if news and news.status in ("pending", "summarizing"):
                news.status = "summarizing"
                articles.append({
                    "id": news.id,
                    "title": news.title,
                    "source": news.source or "",
                    "description": news.description,
                })
        await session.commit()

    if not articles:
        for nid in news_ids:
            _enqueued_ids.discard(nid)
        return

    logger.info(f"Processing batch of {len(articles)} news articles via Groq")
    results = await batch_summarize_news(articles)

    async with AsyncSessionLocal() as session:
        copied_total = 0
        for r in results:
            result = await session.execute(select(News).where(News.id == r["id"]))
            news = result.scalar_one_or_none()
            if not news:
                continue
            if not r.get("failed"):
                news.summary = r.get("summary")
                news.sector = r.get("sector")
                news.related_stocks = r.get("related_stocks", [])
                news.status = "done"
                # 같은 그룹의 pending 기사에 요약 복사 (API 호출 절약)
                copied = await _copy_summary_to_group(session, news)
                copied_total += copied
            else:
                # 실패 시 pending으로 복구 → 나중에 rate limit 회복 후 재시도 가능
                news.status = "pending"
        await session.commit()

    succeeded = sum(1 for r in results if not r.get("failed"))
    if copied_total:
        logger.info(f"Batch done: {succeeded}/{len(results)} succeeded, {copied_total} group members copied")
    else:
        logger.info(f"Batch done: {succeeded}/{len(results)} succeeded")

    # 전체 실패(rate limit 등) 시 재시도 전 충분히 대기
    if succeeded == 0 and results:
        logger.warning("All articles failed (likely rate limit). Waiting 120s before retry.")
        await asyncio.sleep(120)

    for r in results:
        _enqueued_ids.discard(r["id"])


async def _reset_stuck_summarizing() -> int:
    """서버 재시작 시 summarizing 상태로 고착된 기사를 pending으로 복구."""
    from sqlalchemy import update
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            update(News).where(News.status == "summarizing").values(status="pending")
        )
        await session.commit()
        return result.rowcount


async def ai_worker() -> None:
    logger.info("AI worker started (Gemini batch mode)")
    # 시작 시 고착된 summarizing 기사 복구
    reset_count = await _reset_stuck_summarizing()
    if reset_count:
        logger.info(f"Reset {reset_count} stuck 'summarizing' articles to 'pending' on startup")
    while True:
        try:
            # 큐가 비어 있으면 DB에서 pending 자동 추가 (최대 60개)
            if _queue.empty():
                if await _is_ai_summary_active():
                    added = await enqueue_pending_news(limit=20)
                    if added:
                        logger.info(f"Auto-enqueued {added} pending news articles")
                else:
                    await asyncio.sleep(60)  # 비활성 시간: 1분 대기 후 재확인
                    continue

            try:
                priority, job_type, job_id = await asyncio.wait_for(_queue.get(), timeout=30.0)
            except asyncio.TimeoutError:
                continue
            _queue.task_done()

            try:
                if job_type == "news":
                    # AI 서머리 비활성 시간이면 enqueued_ids에서 제거 후 스킵 (재등록 가능)
                    if not await _is_ai_summary_active():
                        _enqueued_ids.discard(job_id)
                        while True:
                            try:
                                _, jt, jid = _queue.get_nowait()
                                _queue.task_done()
                                if jt == "news":
                                    _enqueued_ids.discard(jid)
                                else:
                                    await _queue.put((1, jt, jid))
                            except asyncio.QueueEmpty:
                                break
                        await asyncio.sleep(60)
                        continue
                    # 큐에 대기 중인 추가 뉴스 ID를 모아 배치 처리
                    news_ids = [job_id]
                    while len(news_ids) < BATCH_SIZE:
                        try:
                            _, jt, jid = _queue.get_nowait()
                            _queue.task_done()
                            if jt == "news":
                                news_ids.append(jid)
                            else:
                                # 뉴스가 아닌 항목은 재삽입
                                await _queue.put((1, jt, jid))
                        except asyncio.QueueEmpty:
                            break
                    await _handle_news_batch(news_ids)
                    # 배치 간 간격 (RPM 분산: 10 RPM = 6초/요청 최소)
                    await asyncio.sleep(8)

                else:
                    logger.warning(f"Unknown job_type={job_type}")

            except Exception as e:
                logger.error(f"Worker job error: {e}")

        except asyncio.CancelledError:
            logger.info("AI worker cancelled")
            break
        except Exception as e:
            logger.error(f"Unexpected worker error: {e}")
            await asyncio.sleep(1)


def start_worker() -> asyncio.Task:
    global _worker_task
    _worker_task = asyncio.create_task(ai_worker())
    return _worker_task


def stop_worker() -> None:
    global _worker_task
    if _worker_task and not _worker_task.done():
        _worker_task.cancel()


async def enqueue_pending_news(limit: int = 20) -> int:
    """그룹 대표 기사만 enqueue (같은 그룹 내 중복 AI 호출 방지)."""
    from services.news_service import get_top_pending_news_ids
    top_ids = await get_top_pending_news_ids(limit=limit)
    count = 0
    for nid in top_ids:
        await enqueue_summarize(nid, priority=2)
        count += 1
    return count


def get_queue_status() -> dict:
    return {
        "queue_size": _queue.qsize(),
        "worker_running": bool(_worker_task and not _worker_task.done()),
    }
