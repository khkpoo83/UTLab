"""플래너 라우터 - OCR + LLM 시나리오 채팅 (얇은 HTTP 계층)

도메인 로직·프롬프트·LLM 오케스트레이션·후처리는 services/planner_service.py에 있다.
"""
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from routers.auth import get_current_user
from services.planner_service import (
    ALLOWED_MIME,
    PROMPTS,
    PlannerContext,
    PlannerServiceError,
    run_chat,
    run_ocr,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/planner", tags=["planner"])


@router.post("/ocr")
async def planner_ocr(
    item: str = Form(...),  # dc_irp | nps | mortgage | private_pension
    file: UploadFile = File(...),
    _: dict = Depends(get_current_user),
):
    """스크린샷 이미지 → Gemini Vision → 필드 값 추출"""
    if item not in PROMPTS:
        raise HTTPException(400, f"Unknown item: {item}. Allowed: {list(PROMPTS)}")

    content_type = file.content_type or ""
    if content_type not in ALLOWED_MIME:
        raise HTTPException(400, f"Unsupported file type: {content_type}. Allowed: JPEG, PNG, WebP")

    image_bytes = await file.read()
    if len(image_bytes) > 10 * 1024 * 1024:  # 10MB
        raise HTTPException(400, "File too large (max 10MB)")

    try:
        return await run_ocr(item, content_type, image_bytes)
    except PlannerServiceError as e:
        raise HTTPException(e.status_code, e.detail)


@router.post("/chat")
async def planner_chat(
    ctx: PlannerContext,
    model: str = "gemini",   # groq | gemini
    _: dict = Depends(get_current_user),
):
    """플래너 LLM 채팅 - 명확화 질문 또는 은퇴 시나리오 3-4가지 생성

    ?model=gemini → Gemini 2.5 Flash (기본, 수치 정확도 우수)
    ?model=groq   → Groq llama-3.3-70b (폴백)
    """
    try:
        return await run_chat(ctx, model)
    except PlannerServiceError as e:
        raise HTTPException(e.status_code, e.detail)
