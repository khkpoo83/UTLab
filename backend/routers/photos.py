import os
import re
import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/photos", tags=["photos"])

_HANGUL = re.compile(r"[가-힣]")
_translate_cache: dict[str, str] = {}


def _key() -> str:
    return os.getenv("UNSPLASH_ACCESS_KEY", "").strip()


async def _translate_ko_en(text: str) -> str:
    """한글이 포함된 키워드를 영어로 번역 (무료 MyMemory, 키 불필요). 실패 시 원문 반환."""
    if not _HANGUL.search(text):
        return text
    if text in _translate_cache:
        return _translate_cache[text]
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            res = await client.get(
                "https://api.mymemory.translated.net/get",
                params={"q": text, "langpair": "ko|en"},
            )
            data = res.json()
            translated = ((data.get("responseData") or {}).get("translatedText") or "").strip()
            result = translated or text
            _translate_cache[text] = result
            return result
    except Exception:
        return text


async def _fetch_unsplash(client: httpx.AsyncClient, q: str, per_page: int, page: int, orientation: str) -> list[dict]:
    key = _key()
    if not key:
        return []
    res = await client.get(
        "https://api.unsplash.com/search/photos",
        params={"query": q, "per_page": per_page, "page": page, "orientation": orientation},
        headers={"Authorization": f"Client-ID {key}"},
    )
    res.raise_for_status()
    data = res.json()
    return [
        {
            "id": p["id"],
            "title": p.get("alt_description") or p.get("description") or q,
            "artist": p["user"]["name"],
            "artistUrl": p["user"]["links"]["html"] + "?utm_source=ut_lab&utm_medium=referral",
            "imageUrl": p["urls"]["regular"],
            "downloadLocation": p["links"]["download_location"],
            "source": "unsplash",
        }
        for p in data.get("results", [])
        if p.get("urls", {}).get("regular")
    ]


async def _fetch_openverse(client: httpx.AsyncClient, q: str, per_page: int, page: int) -> list[dict]:
    """Openverse — CC 이미지 통합 검색 (키 불필요, Flickr·박물관 등 다출처)."""
    res = await client.get(
        "https://api.openverse.org/v1/images/",
        params={"q": q, "page_size": per_page, "page": page, "mature": "false"},
        headers={"User-Agent": "ut_lab/1.0 (personal dashboard)"},
    )
    res.raise_for_status()
    data = res.json()
    items: list[dict] = []
    for r in data.get("results", []):
        img = r.get("thumbnail") or r.get("url")
        if not img:
            continue
        items.append({
            "id": "ov_" + str(r.get("id")),
            "title": r.get("title") or q,
            "artist": r.get("creator") or "",
            "artistUrl": r.get("creator_url") or r.get("foreign_landing_url"),
            "imageUrl": img,
            "source": "openverse",
        })
    return items


@router.get("/search")
async def search_photos(
    q: str = "nature",
    per_page: int = 30,
    page: int = 1,
    orientation: str = "landscape",
):
    per_page = min(max(per_page, 1), 30)
    page = max(page, 1)
    valid_orientations = {"landscape", "portrait", "squarish"}
    orientation = orientation if orientation in valid_orientations else "landscape"

    # 한글 키워드 → 영어 번역 (모든 소스가 영어 기반이므로)
    query = await _translate_ko_en(q)

    items: list[dict] = []
    sources: set[str] = set()
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            # Unsplash (키 있을 때) + Openverse (항상)
            try:
                us = await _fetch_unsplash(client, query, per_page, page, orientation)
                if us:
                    items.extend(us)
                    sources.add("unsplash")
            except Exception:
                pass
            try:
                ov = await _fetch_openverse(client, query, per_page, page)
                if ov:
                    items.extend(ov)
                    sources.add("openverse")
            except Exception:
                pass
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="photo source timeout")

    if not items:
        return {"items": [], "source": "none", "query": query, "original_query": q}

    source = "mixed" if len(sources) > 1 else next(iter(sources))
    return {"items": items, "source": source, "query": query, "original_query": q}


@router.post("/download")
async def trigger_download(url: str = Query(..., description="Unsplash download_location URL")):
    """Unsplash 가이드라인 필수: 사진 사용 시 download 이벤트 트리거."""
    key = _key()
    if not key:
        return {"ok": False}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            res = await client.get(url, headers={"Authorization": f"Client-ID {key}"})
            return {"ok": res.is_success}
    except Exception:
        return {"ok": False}
