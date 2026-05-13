"""SSE (Server-Sent Events) 브로드캐스터 — 서버 → 브라우저 실시간 푸시"""
import asyncio
import json
import logging
from collections import defaultdict
from typing import AsyncIterator

logger = logging.getLogger(__name__)


class SSEBroker:
    """
    유저별 SSE 연결을 관리하는 인메모리 브로커.

    사용법:
      # 백엔드 이벤트 발생 시
      await broker.publish(user_id, "calendar_updated", {"changed": 3})

      # FastAPI SSE 엔드포인트에서
      async for chunk in broker.subscribe(user_id):
          yield chunk
    """

    def __init__(self):
        # user_id → set of asyncio.Queue
        self._queues: dict[int, set[asyncio.Queue]] = defaultdict(set)

    async def subscribe(self, user_id: int) -> AsyncIterator[str]:
        """SSE 스트림 — 연결 유지하며 이벤트 수신"""
        q: asyncio.Queue = asyncio.Queue(maxsize=50)
        self._queues[user_id].add(q)
        logger.debug(f"SSE client connected: user={user_id}, total={len(self._queues[user_id])}")

        try:
            # 연결 직후 ping 전송 (keep-alive + 연결 확인)
            yield _sse_format("ping", {"ts": _now_iso()})

            while True:
                try:
                    # 30초마다 keep-alive ping (프록시/방화벽 연결 유지)
                    event_data = await asyncio.wait_for(q.get(), timeout=30.0)
                    yield event_data
                except asyncio.TimeoutError:
                    yield _sse_format("ping", {"ts": _now_iso()})
        except asyncio.CancelledError:
            pass
        except GeneratorExit:
            pass
        finally:
            self._queues[user_id].discard(q)
            if not self._queues[user_id]:
                del self._queues[user_id]
            logger.debug(f"SSE client disconnected: user={user_id}")

    async def publish(self, user_id: int, event: str, data: dict) -> int:
        """
        특정 유저의 모든 SSE 연결에 이벤트 브로드캐스트.
        Returns: 전달된 연결 수
        """
        queues = list(self._queues.get(user_id, set()))
        if not queues:
            return 0

        payload = _sse_format(event, data)
        sent = 0
        for q in queues:
            try:
                q.put_nowait(payload)
                sent += 1
            except asyncio.QueueFull:
                logger.warning(f"SSE queue full for user={user_id}, dropping event={event}")
        return sent

    async def publish_all(self, event: str, data: dict) -> int:
        """연결된 모든 유저에게 브로드캐스트"""
        total = 0
        for uid in list(self._queues.keys()):
            total += await self.publish(uid, event, data)
        return total

    def connected_users(self) -> list[int]:
        return list(self._queues.keys())

    def connection_count(self, user_id: int) -> int:
        return len(self._queues.get(user_id, set()))


def _sse_format(event: str, data: dict) -> str:
    """SSE 포맷: 'event: xxx\\ndata: {...}\\n\\n'"""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


# 전역 싱글톤 — 앱 전체에서 단일 브로커 공유
broker = SSEBroker()
