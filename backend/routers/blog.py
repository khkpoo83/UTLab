"""블로그 라우터 — CRUD, 이미지 업로드, AI 생성, 공개 API"""
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
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
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"허용되지 않는 파일 형식: {ext}")
    data = await file.read()
    if len(data) > MAX_IMAGE_SIZE:
        raise HTTPException(400, "파일 크기가 10MB를 초과합니다")
    filename = f"{uuid.uuid4().hex}{ext}"
    (BLOG_IMAGES_DIR / filename).write_bytes(data)
    return {"filename": filename, "url": f"/api/blog/images/{filename}"}


@router.get("/api/blog/images/{filename}")
async def serve_image(filename: str, db: AsyncSession = Depends(get_db)):
    path = BLOG_IMAGES_DIR / filename
    if not path.exists() or not path.is_file():
        raise HTTPException(404, "이미지를 찾을 수 없습니다")
    # 비공개 글의 cover image는 직접 접근 차단
    result = await db.execute(
        select(BlogPost).where(BlogPost.cover_image == filename)
    )
    post = result.scalar_one_or_none()
    if post and post.visibility != "public":
        raise HTTPException(404, "이미지를 찾을 수 없습니다")
    return FileResponse(str(path))


# ── AI 생성 ────────────────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    title: str
    topic: str = ""
    style: str = "casual"   # casual | formal | technical | creative
    length: str = "medium"  # short | medium | long


@router.post("/api/blog/generate")
async def generate_content(
    body: GenerateRequest,
    _user=Depends(get_current_user),
):
    try:
        from services.gemini_service import call_gemini

        length_map = {"short": "500자 이내", "medium": "1000~1500자", "long": "2000자 이상"}
        style_map = {
            "casual": "친근하고 대화체",
            "formal": "격식체, 전문적",
            "technical": "기술적, 분석적",
            "creative": "창의적, 감성적",
        }
        prompt = f"""다음 조건으로 블로그 포스트 본문을 작성해주세요.

제목: {body.title}
주제/내용: {body.topic or body.title}
문체: {style_map.get(body.style, '자연스러운')}
분량: {length_map.get(body.length, '1000~1500자')}

요구사항:
- HTML 형식으로 작성 (<p>, <h2>, <h3>, <strong>, <em>, <ul>, <li> 태그 사용)
- 자연스러운 단락 구성
- 제목과 연관된 내용으로 작성
- 마크다운이나 코드 블록 없이 순수 HTML만 반환"""

        result = await call_gemini(
            prompt,
            max_tokens=4096,
            force_json_mime=False,
            use_llm_key=True,
            system_prompt="당신은 전문 블로그 작가입니다.",
            temperature=0.7,
        )
        if not result:
            raise HTTPException(500, "AI 생성 실패: 응답 없음")
        return {"content": result.strip()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"AI 생성 실패: {str(e)}")


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
