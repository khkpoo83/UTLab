import os
import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/photos", tags=["photos"])

def _key() -> str:
    return os.getenv("UNSPLASH_ACCESS_KEY", "").strip()

@router.get("/search")
async def search_photos(
    q: str = "nature",
    per_page: int = 30,
    page: int = 1,
    orientation: str = "landscape",
):
    key = _key()
    if not key:
        return {"items": [], "source": "none"}

    per_page = min(max(per_page, 1), 30)
    page = max(page, 1)
    valid_orientations = {"landscape", "portrait", "squarish"}
    orientation = orientation if orientation in valid_orientations else "landscape"
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            res = await client.get(
                "https://api.unsplash.com/search/photos",
                params={"query": q, "per_page": per_page, "page": page, "orientation": orientation},
                headers={"Authorization": f"Client-ID {key}"},
            )
            res.raise_for_status()
            data = res.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Unsplash timeout")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail="Unsplash error")

    items = [
        {
            "id": p["id"],
            "title": p.get("alt_description") or p.get("description") or q,
            "artist": p["user"]["name"],
            "artistUrl": p["user"]["links"]["html"] + "?utm_source=ut_lab&utm_medium=referral",
            "imageUrl": p["urls"]["regular"],
            "downloadLocation": p["links"]["download_location"],
        }
        for p in data.get("results", [])
        if p.get("urls", {}).get("regular")
    ]
    return {"items": items, "source": "unsplash"}


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
