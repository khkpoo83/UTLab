"""블로그 라우터 — CRUD, 이미지 업로드, AI 생성, 공개 API"""
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import base64
import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from models.database import get_db, BlogPost
from routers.auth import get_current_user

router = APIRouter()

BLOG_IMAGES_DIR = Path("/app/data/blog_images")
BLOG_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB


def _strip_html(html: str) -> str:
    return re.sub(r"<[^>]+>", "", html or "").strip()


def _count_words(html: str) -> int:
    text = _strip_html(html)
    return len(text.split()) if text else 0


def _post_to_dict(post: BlogPost) -> dict:
    return {
        "id": post.id,
        "title": post.title,
        "content": post.content,
        "cover_image": f"/api/blog/images/{post.cover_image}" if post.cover_image else None,
        "visibility": post.visibility,
        "tags": json.loads(post.tags) if post.tags else [],
        "ai_generated": post.ai_generated,
        "word_count": post.word_count,
        "created_at": post.created_at.isoformat() if post.created_at else None,
        "updated_at": post.updated_at.isoformat() if post.updated_at else None,
        "excerpt": _strip_html(post.content or "")[:200] if post.content else "",
    }


# ── 인증 CRUD ──────────────────────────────────────────────────────────────────

@router.get("/api/blog/posts")
async def list_posts(
    visibility: str = "all",
    q: str = "",
    tag: str = "",
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    stmt = select(BlogPost).order_by(desc(BlogPost.created_at))
    if visibility in ("public", "private"):
        stmt = stmt.where(BlogPost.visibility == visibility)
    if q:
        stmt = stmt.where(BlogPost.title.contains(q))
    if tag:
        stmt = stmt.where(BlogPost.tags.contains(tag))
    stmt = stmt.offset(offset).limit(limit)
    result = await db.execute(stmt)
    posts = result.scalars().all()
    return [_post_to_dict(p) for p in posts]


@router.get("/api/blog/posts/{post_id}")
async def get_post(
    post_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    post = await db.get(BlogPost, post_id)
    if not post:
        raise HTTPException(404, "포스트를 찾을 수 없습니다")
    return _post_to_dict(post)


class PostCreate(BaseModel):
    title: str = "제목 없음"
    content: Optional[str] = None
    cover_image: Optional[str] = None
    visibility: str = "private"
    tags: list[str] = []
    ai_generated: bool = False


@router.post("/api/blog/posts", status_code=201)
async def create_post(
    body: PostCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    post = BlogPost(
        title=body.title,
        content=body.content,
        cover_image=body.cover_image,
        visibility=body.visibility,
        tags=json.dumps(body.tags, ensure_ascii=False),
        ai_generated=body.ai_generated,
        word_count=_count_words(body.content or ""),
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)
    return _post_to_dict(post)


class PostUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    cover_image: Optional[str] = None
    visibility: Optional[str] = None
    tags: Optional[list[str]] = None
    ai_generated: Optional[bool] = None


@router.put("/api/blog/posts/{post_id}")
async def update_post(
    post_id: int,
    body: PostUpdate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    post = await db.get(BlogPost, post_id)
    if not post:
        raise HTTPException(404, "포스트를 찾을 수 없습니다")
    if body.title is not None:
        post.title = body.title
    if body.content is not None:
        post.content = body.content
        post.word_count = _count_words(body.content)
    if body.cover_image is not None:
        post.cover_image = body.cover_image
    if body.visibility is not None:
        post.visibility = body.visibility
    if body.tags is not None:
        post.tags = json.dumps(body.tags, ensure_ascii=False)
    if body.ai_generated is not None:
        post.ai_generated = body.ai_generated
    post.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()
    await db.refresh(post)
    return _post_to_dict(post)


@router.delete("/api/blog/posts/{post_id}")
async def delete_post(
    post_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    post = await db.get(BlogPost, post_id)
    if not post:
        raise HTTPException(404, "포스트를 찾을 수 없습니다")
    # 커버이미지 파일 삭제
    if post.cover_image:
        img_path = BLOG_IMAGES_DIR / post.cover_image
        if img_path.exists():
            img_path.unlink(missing_ok=True)
    await db.delete(post)
    await db.commit()
    return {"ok": True}


# ── 이미지 업로드 ──────────────────────────────────────────────────────────────

@router.post("/api/blog/upload")
async def upload_image(
    file: UploadFile = File(...),
    _user=Depends(get_current_user),
):
    from PIL import Image as PilImage
    import io as _io

    raw = await file.read()
    if len(raw) > MAX_IMAGE_SIZE:
        raise HTTPException(400, "파일 크기가 10MB를 초과합니다")

    try:
        img = PilImage.open(_io.BytesIO(raw))
        fmt = (img.format or "").upper()

        if fmt == "GIF":
            # GIF는 애니메이션 보존을 위해 원본 유지
            ext, out = ".gif", raw
        else:
            # 투명 채널 여부 확인 → PNG / JPEG 분기
            has_alpha = img.mode in ("RGBA", "LA", "PA") or "transparency" in img.info
            buf = _io.BytesIO()
            if has_alpha:
                img.convert("RGBA").save(buf, format="PNG", optimize=True)
                ext = ".png"
            else:
                img.convert("RGB").save(buf, format="JPEG", quality=92, optimize=True)
                ext = ".jpg"
            out = buf.getvalue()
    except Exception:
        raise HTTPException(
            400,
            "이미지를 열 수 없습니다. JPG·PNG·GIF·WEBP·BMP 파일인지 확인해주세요 (HEIC 미지원)",
        )

    filename = f"{uuid.uuid4().hex}{ext}"
    (BLOG_IMAGES_DIR / filename).write_bytes(out)
    return {"filename": filename, "url": f"/api/blog/images/{filename}"}


@router.get("/api/blog/images/{filename}")
async def serve_image(filename: str, request: Request, db: AsyncSession = Depends(get_db)):
    path = BLOG_IMAGES_DIR / filename
    if not path.exists() or not path.is_file():
        raise HTTPException(404, "이미지를 찾을 수 없습니다")
    # 인증된 요청(관리자)은 모든 이미지 접근 허용
    is_authed = request.headers.get("authorization", "").startswith("Bearer ")
    if not is_authed:
        result = await db.execute(select(BlogPost).where(BlogPost.cover_image == filename))
        post = result.scalar_one_or_none()
        if post and post.visibility != "public":
            raise HTTPException(404, "이미지를 찾을 수 없습니다")
    return FileResponse(str(path))


# ── AI 생성 ────────────────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    title: str
    topic: str = ""
    style: str = "casual"        # casual | formal | technical | creative
    length: str = "medium"       # short | medium | long
    language: str = "ko"         # ko | en
    keywords: str = ""           # 쉼표 구분 키워드
    audience: str = "general"    # general | developer | investor | student
    structure: str = "free"      # free | listicle | howto | analysis
    include_examples: bool = False
    append_mode: bool = False
    current_content: str = ""    # append_mode 시 기존 내용


@router.post("/api/blog/generate")
async def generate_content(
    body: GenerateRequest,
    _user=Depends(get_current_user),
):
    try:
        from services.gemini_service import call_gemini

        length_map = {"short": "500자 이내", "medium": "1000~1500자", "long": "2000자 이상"}
        style_map = {
            "casual": "친근하고 대화체로",
            "formal": "격식체, 전문적으로",
            "technical": "기술적이고 분석적으로",
            "creative": "창의적이고 감성적으로",
        }
        audience_map = {
            "general": "일반 독자",
            "developer": "개발자/기술자",
            "investor": "투자자/금융인",
            "student": "학생/입문자",
        }
        structure_map = {
            "free": "자유로운 에세이 형식으로",
            "listicle": "목록형 (번호 또는 불릿 중심)으로",
            "howto": "단계별 하우투 가이드 형식으로",
            "analysis": "분석/리뷰 형식 (장단점 비교 등)으로",
        }
        language_note = "한국어로 작성해주세요." if body.language == "ko" else "Please write in English."
        keywords_note = f"다음 키워드를 자연스럽게 포함해주세요: {body.keywords}" if body.keywords.strip() else ""
        examples_note = "관련 예시나 구체적인 사례를 포함해주세요." if body.include_examples else ""

        append_section = ""
        if body.append_mode and body.current_content.strip():
            existing = re.sub(r"<[^>]+>", "", body.current_content)[:600].strip()
            append_section = f"""
기존 내용에 이어서 자연스럽게 연결되도록 추가 내용을 작성해주세요.
기존 내용 (참고용):
---
{existing}
---
"""

        extras = "\n".join(filter(None, [keywords_note, examples_note]))

        prompt = f"""다음 조건으로 블로그 포스트 본문을 작성해주세요.
{language_note}

제목: {body.title}
주제/내용: {body.topic or body.title}
문체: {style_map.get(body.style, '자연스러운')}
분량: {length_map.get(body.length, '1000~1500자')}
타겟 독자: {audience_map.get(body.audience, '일반 독자')}
구조: {structure_map.get(body.structure, '자유로운 형식으로')}
{extras}
{append_section}
요구사항:
- HTML 형식으로 작성 (<p>, <h2>, <h3>, <strong>, <em>, <ul>, <li>, <ol>, <blockquote>, <code> 태그 사용)
- 자연스러운 단락 구성, 적절한 소제목 활용
- 마크다운 없이 순수 HTML만 반환 (```html 코드 블록 금지)"""

        result = await call_gemini(
            prompt,
            max_tokens=6000,
            force_json_mime=False,
            use_llm_key=True,
            system_prompt="당신은 전문 블로그 작가입니다. 요청된 조건에 맞춰 고품질 블로그 본문 HTML을 작성합니다.",
            temperature=0.75,
        )
        if not result:
            raise HTTPException(500, "AI 생성 실패: 응답 없음")
        # HTML 마크다운 코드 블록 래퍼 제거
        content = result.strip()
        content = re.sub(r'^```(?:html)?\s*\n?', '', content)
        content = re.sub(r'\n?```\s*$', '', content)
        return {"content": content.strip()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"AI 생성 실패: {str(e)}")


# ── AI 썸네일 생성 ─────────────────────────────────────────────────────────────

class CoverGenRequest(BaseModel):
    title: str
    tags: list[str] = []
    excerpt: str = ""


@router.post("/api/blog/generate-cover")
async def generate_cover_image(
    body: CoverGenRequest,
    _user=Depends(get_current_user),
):
    """블로그 내용을 기반으로 Imagen 3 AI 썸네일 생성"""
    try:
        from services.gemini_service import call_gemini, _llm_key

        # Step 1: 블로그 내용 → 이미지 프롬프트 생성
        meta_prompt = f"""Create a concise image generation prompt for a blog post thumbnail.

Title: {body.title}
Tags: {', '.join(body.tags) if body.tags else 'general'}
Content: {body.excerpt[:300] if body.excerpt else ''}

Write a single English image prompt (1-2 sentences) that:
- Creates a professional, visually appealing blog thumbnail
- Uses abstract, metaphorical or conceptual imagery (NO human faces, NO text/letters/words in image)
- Has a wide 16:9 landscape composition
- Matches the topic/mood of the blog post
- Has modern, clean aesthetic with strong visual impact

Return ONLY the image prompt, no explanations."""

        image_prompt = await call_gemini(
            meta_prompt,
            max_tokens=200,
            force_json_mime=False,
            use_llm_key=True,
            temperature=0.8,
        )
        if not image_prompt:
            raise HTTPException(500, "이미지 프롬프트 생성 실패")
        image_prompt = image_prompt.strip().strip('"').strip("'")

        # Step 2: Imagen 3 API로 이미지 생성
        api_key = _llm_key()
        if not api_key:
            raise HTTPException(500, "Gemini API 키가 설정되지 않았습니다")

        imagen_url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"imagen-3.0-generate-002:predict?key={api_key}"
        )
        payload = {
            "instances": [{"prompt": image_prompt}],
            "parameters": {
                "sampleCount": 1,
                "aspectRatio": "16:9",
                "safetyFilterLevel": "block_some",
            },
        }

        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(imagen_url, json=payload)
            if resp.status_code in (400, 403, 404):
                err_msg = ""
                try:
                    err_msg = resp.json().get("error", {}).get("message", resp.text[:300])
                except Exception:
                    err_msg = resp.text[:300]
                raise HTTPException(502, f"Imagen API 오류: {err_msg}")
            resp.raise_for_status()
            result_data = resp.json()

        predictions = result_data.get("predictions", [])
        if not predictions or "bytesBase64Encoded" not in predictions[0]:
            raise HTTPException(500, "이미지 생성 결과를 받지 못했습니다")

        img_bytes = base64.b64decode(predictions[0]["bytesBase64Encoded"])
        mime_type = predictions[0].get("mimeType", "image/png")
        ext = ".png" if "png" in mime_type else ".jpg"

        filename = f"ai_{uuid.uuid4().hex}{ext}"
        (BLOG_IMAGES_DIR / filename).write_bytes(img_bytes)

        return {
            "url": f"/api/blog/images/{filename}",
            "filename": filename,
            "prompt": image_prompt,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"썸네일 생성 실패: {str(e)}")


# ── 공개 API (비인증) ──────────────────────────────────────────────────────────

@router.get("/api/public/blog")
async def public_list(
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(BlogPost)
        .where(BlogPost.visibility == "public")
        .order_by(desc(BlogPost.created_at))
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    posts = result.scalars().all()
    return [_post_to_dict(p) for p in posts]


@router.get("/api/public/blog/{post_id}")
async def public_get_post(post_id: int, db: AsyncSession = Depends(get_db)):
    post = await db.get(BlogPost, post_id)
    if not post or post.visibility != "public":
        raise HTTPException(404, "포스트를 찾을 수 없습니다")
    return _post_to_dict(post)
