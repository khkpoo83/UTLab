import os
import re
import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/photos", tags=["photos"])

_HANGUL = re.compile(r"[가-힣]")
_translate_cache: dict[str, str] = {}


def _key() -> str:
    return os.getenv("UNSPLASH_ACCESS_KEY", "").strip()


def _pexels_key() -> str:
    return os.getenv("PEXELS_API_KEY", "").strip()


def _pixabay_key() -> str:
    return os.getenv("PIXABAY_API_KEY", "").strip()


async def _fetch_google_cse(client: httpx.AsyncClient, q: str, per_page: int, page: int) -> list[dict]:
    """Google Programmable Search (이미지) — 고유명사/연예인 등 관련도 높은 웹 이미지.
    무료 일 100건 제한. GOOGLE_CSE_API_KEY + GOOGLE_CSE_CX 필요."""
    key = os.getenv("GOOGLE_CSE_API_KEY", "").strip()
    cx  = os.getenv("GOOGLE_CSE_CX", "").strip()
    if not (key and cx):
        return []
    num = min(max(per_page, 1), 10)          # CSE는 요청당 최대 10건
    eff_page = ((page - 1) % 3) + 1          # 상위 30건 내에서만 회전(관련도 유지)
    start = (eff_page - 1) * num + 1
    res = await client.get(
        "https://www.googleapis.com/customsearch/v1",
        params={
            "key": key, "cx": cx, "q": q, "searchType": "image",
            "num": num, "start": start, "safe": "active",
        },
    )
    res.raise_for_status()
    data = res.json()
    items: list[dict] = []
    for it in data.get("items", []):
        link = it.get("link")
        if not link:
            continue
        img = it.get("image") or {}
        items.append({
            "id": "g_" + str(abs(hash(link)) % (10 ** 12)),
            "title": it.get("title") or q,
            "artist": it.get("displayLink") or "",
            "artistUrl": img.get("contextLink") or link,
            "imageUrl": link,
            "source": "google",
        })
    return items


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


async def _fetch_pexels(client: httpx.AsyncClient, q: str, per_page: int, page: int, orientation: str) -> list[dict]:
    """Pexels — 현대적 라이프스타일/인물 사진 (무료 API 키 필요)."""
    key = _pexels_key()
    if not key:
        return []
    # our orientation(landscape/portrait/squarish) → Pexels(landscape/portrait/square)
    px_orient = "square" if orientation == "squarish" else orientation
    res = await client.get(
        "https://api.pexels.com/v1/search",
        params={"query": q, "per_page": per_page, "page": page, "orientation": px_orient},
        headers={"Authorization": key},
    )
    res.raise_for_status()
    data = res.json()
    return [
        {
            "id": "px_" + str(p["id"]),
            "title": (p.get("alt") or q).strip() or q,
            "artist": p.get("photographer") or "",
            "artistUrl": p.get("photographer_url") or p.get("url"),
            "imageUrl": (p.get("src") or {}).get("large") or (p.get("src") or {}).get("medium"),
            "source": "pexels",
        }
        for p in data.get("photos", [])
        if (p.get("src") or {}).get("large")
    ]


async def _fetch_pixabay(client: httpx.AsyncClient, q: str, per_page: int, page: int, orientation: str) -> list[dict]:
    """Pixabay — 범용 사진/일러스트 (무료 API 키 필요)."""
    key = _pixabay_key()
    if not key:
        return []
    # our orientation → Pixabay(horizontal/vertical/all)
    pb_orient = {"landscape": "horizontal", "portrait": "vertical"}.get(orientation, "all")
    res = await client.get(
        "https://pixabay.com/api/",
        params={
            "key": key, "q": q, "per_page": max(3, min(per_page, 200)), "page": page,
            "image_type": "photo", "orientation": pb_orient, "safesearch": "true",
        },
    )
    res.raise_for_status()
    data = res.json()
    return [
        {
            "id": "pb_" + str(h["id"]),
            "title": (h.get("tags") or q).split(",")[0].strip() or q,
            "artist": h.get("user") or "",
            "artistUrl": h.get("pageURL"),
            "imageUrl": h.get("largeImageURL") or h.get("webformatURL"),
            "source": "pixabay",
        }
        for h in data.get("hits", [])
        if h.get("largeImageURL") or h.get("webformatURL")
    ]


async def _fetch_naver(client: httpx.AsyncClient, q: str, per_page: int, page: int) -> list[dict]:
    """네이버 이미지 검색 — 한국 고유명사·연예인 관련도 최상. 원본 한글 q 사용.
    NAVER_CLIENT_ID + NAVER_CLIENT_SECRET 필요 (무료 일 25,000건)."""
    cid = os.getenv("NAVER_CLIENT_ID", "").strip()
    csec = os.getenv("NAVER_CLIENT_SECRET", "").strip()
    if not (cid and csec):
        return []
    display = min(max(per_page, 1), 100)
    start = min((page - 1) * display + 1, 1000)
    res = await client.get(
        "https://openapi.naver.com/v1/search/image",
        params={"query": q, "display": display, "start": start, "sort": "sim", "filter": "large"},
        headers={"X-Naver-Client-Id": cid, "X-Naver-Client-Secret": csec},
    )
    res.raise_for_status()
    data = res.json()
    items: list[dict] = []
    for it in data.get("items", []):
        link = it.get("link")
        if not link:
            continue
        title = re.sub(r"<[^>]+>", "", it.get("title") or "").strip() or q
        items.append({
            "id": "nv_" + str(abs(hash(link)) % (10 ** 12)),
            "title": title,
            "artist": "",
            "artistUrl": link,
            "imageUrl": link,
            "source": "naver",
        })
    return items


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
            # 1순위: 네이버 이미지 — 한국 고유명사/연예인 관련도 최상 (원본 q 사용)
            try:
                nv = await _fetch_naver(client, q, per_page, page)
                if nv:
                    items.extend(nv)
                    sources.add("naver")
            except Exception:
                pass

            # 2순위: Google CSE (네이버 미설정/0건일 때). 원본 q — "뉴진스"→"New Jeans" 오역 방지
            if not items:
                try:
                    g = await _fetch_google_cse(client, q, per_page, page)
                    if g:
                        items.extend(g)
                        sources.add("google")
                except Exception:
                    pass

            # 3순위(폴백): 위가 전부 0건일 때 사진 스톡 소스
            if not items:
                for name, coro in (
                    ("unsplash", _fetch_unsplash(client, query, per_page, page, orientation)),
                    ("pexels",   _fetch_pexels(client, query, per_page, page, orientation)),
                    ("pixabay",  _fetch_pixabay(client, query, per_page, page, orientation)),
                ):
                    try:
                        got = await coro
                        if got:
                            items.extend(got)
                            sources.add(name)
                    except Exception:
                        pass

            # 4순위(폴백): 그래도 비면 Openverse (박물관 포함 → 최후순위)
            if not items:
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
