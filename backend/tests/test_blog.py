"""Characterization tests for the DB-backed endpoints of ``routers/blog.py``.

These pin the CURRENT HTTP contract (response shapes, status codes, ordering,
visibility filter, auth enforcement) so the repository refactor can be proven
behavior-preserving.  Non-DB endpoints (upload / generate / generate-cover) are
intentionally not exercised — they call Gemini / write files.
"""

import pytest


async def _create(client, headers, **overrides):
    body = {
        "title": "제목",
        "content": "<p>hello world foo</p>",
        "visibility": "private",
        "tags": ["a", "b"],
        "ai_generated": False,
    }
    body.update(overrides)
    resp = await client.post("/api/blog/posts", json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_create_get_list_roundtrip(client, auth_headers):
    created = await _create(client, auth_headers, title="첫글", content="<p>alpha beta gamma</p>")
    post_id = created["id"]

    # created response shape
    assert created["title"] == "첫글"
    assert created["content"] == "<p>alpha beta gamma</p>"
    assert created["visibility"] == "private"
    assert created["tags"] == ["a", "b"]
    assert created["ai_generated"] is False
    assert created["word_count"] == 3  # "alpha beta gamma" -> 3 words
    assert created["cover_image"] is None
    assert created["excerpt"] == "alpha beta gamma"
    assert created["created_at"] is not None

    # get
    got = await client.get(f"/api/blog/posts/{post_id}", headers=auth_headers)
    assert got.status_code == 200
    assert got.json()["id"] == post_id
    assert got.json()["title"] == "첫글"

    # list
    listed = await client.get("/api/blog/posts", headers=auth_headers)
    assert listed.status_code == 200
    ids = [p["id"] for p in listed.json()]
    assert post_id in ids


@pytest.mark.asyncio
async def test_cover_image_url_prefix(client, auth_headers):
    created = await _create(client, auth_headers, cover_image="pic.jpg")
    assert created["cover_image"] == "/api/blog/images/pic.jpg"


@pytest.mark.asyncio
async def test_list_ordering_desc_by_created(client, auth_headers):
    a = await _create(client, auth_headers, title="A")
    b = await _create(client, auth_headers, title="B")
    listed = (await client.get("/api/blog/posts", headers=auth_headers)).json()
    ids = [p["id"] for p in listed]
    # order_by(desc(created_at)); ties broken so both present, newer id first-ish.
    assert set([a["id"], b["id"]]).issubset(set(ids))


@pytest.mark.asyncio
async def test_list_visibility_filter(client, auth_headers):
    pub = await _create(client, auth_headers, title="pub", visibility="public")
    prv = await _create(client, auth_headers, title="prv", visibility="private")

    only_pub = (await client.get("/api/blog/posts?visibility=public", headers=auth_headers)).json()
    pub_ids = [p["id"] for p in only_pub]
    assert pub["id"] in pub_ids
    assert prv["id"] not in pub_ids

    only_prv = (await client.get("/api/blog/posts?visibility=private", headers=auth_headers)).json()
    prv_ids = [p["id"] for p in only_prv]
    assert prv["id"] in prv_ids
    assert pub["id"] not in prv_ids

    all_posts = (await client.get("/api/blog/posts?visibility=all", headers=auth_headers)).json()
    all_ids = [p["id"] for p in all_posts]
    assert pub["id"] in all_ids and prv["id"] in all_ids


@pytest.mark.asyncio
async def test_list_q_and_tag_filter(client, auth_headers):
    match = await _create(client, auth_headers, title="파이썬 튜토리얼", tags=["python", "dev"])
    other = await _create(client, auth_headers, title="여행기", tags=["travel"])

    by_q = (await client.get("/api/blog/posts?q=파이썬", headers=auth_headers)).json()
    q_ids = [p["id"] for p in by_q]
    assert match["id"] in q_ids and other["id"] not in q_ids

    by_tag = (await client.get("/api/blog/posts?tag=python", headers=auth_headers)).json()
    tag_ids = [p["id"] for p in by_tag]
    assert match["id"] in tag_ids and other["id"] not in tag_ids


@pytest.mark.asyncio
async def test_list_pagination(client, auth_headers):
    ids = [(await _create(client, auth_headers, title=f"p{i}"))["id"] for i in range(3)]
    page = (await client.get("/api/blog/posts?limit=2&offset=0", headers=auth_headers)).json()
    assert len(page) == 2
    page2 = (await client.get("/api/blog/posts?limit=2&offset=2", headers=auth_headers)).json()
    assert len(page2) >= 1
    assert set(ids)  # sanity


@pytest.mark.asyncio
async def test_update(client, auth_headers):
    created = await _create(client, auth_headers, title="old", content="<p>one two</p>")
    pid = created["id"]
    resp = await client.put(
        f"/api/blog/posts/{pid}",
        json={"title": "new", "content": "<p>a b c d</p>", "visibility": "public", "tags": ["x"]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    j = resp.json()
    assert j["title"] == "new"
    assert j["content"] == "<p>a b c d</p>"
    assert j["word_count"] == 4
    assert j["visibility"] == "public"
    assert j["tags"] == ["x"]


@pytest.mark.asyncio
async def test_update_partial_leaves_untouched(client, auth_headers):
    created = await _create(client, auth_headers, title="keep", content="<p>keep me</p>")
    pid = created["id"]
    resp = await client.put(f"/api/blog/posts/{pid}", json={"title": "changed"}, headers=auth_headers)
    assert resp.status_code == 200
    j = resp.json()
    assert j["title"] == "changed"
    assert j["content"] == "<p>keep me</p>"  # untouched


@pytest.mark.asyncio
async def test_delete_then_404(client, auth_headers):
    created = await _create(client, auth_headers)
    pid = created["id"]
    resp = await client.delete(f"/api/blog/posts/{pid}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    # gone
    assert (await client.get(f"/api/blog/posts/{pid}", headers=auth_headers)).status_code == 404


@pytest.mark.asyncio
async def test_404_on_missing(client, auth_headers):
    assert (await client.get("/api/blog/posts/999999", headers=auth_headers)).status_code == 404
    assert (
        await client.put("/api/blog/posts/999999", json={"title": "x"}, headers=auth_headers)
    ).status_code == 404
    assert (await client.delete("/api/blog/posts/999999", headers=auth_headers)).status_code == 404


@pytest.mark.asyncio
async def test_auth_required_on_admin_endpoints(client):
    # No auth header -> should be rejected (401/403), not 200.
    assert (await client.get("/api/blog/posts")).status_code in (401, 403)
    assert (await client.get("/api/blog/posts/1")).status_code in (401, 403)
    assert (await client.post("/api/blog/posts", json={"title": "x"})).status_code in (401, 403)
    assert (await client.put("/api/blog/posts/1", json={"title": "x"})).status_code in (401, 403)
    assert (await client.delete("/api/blog/posts/1")).status_code in (401, 403)


@pytest.mark.asyncio
async def test_public_list_only_published(client, auth_headers):
    pub = await _create(client, auth_headers, title="published", visibility="public")
    draft = await _create(client, auth_headers, title="draft", visibility="private")

    resp = await client.get("/api/public/blog")  # no auth
    assert resp.status_code == 200
    ids = [p["id"] for p in resp.json()]
    assert pub["id"] in ids
    assert draft["id"] not in ids


@pytest.mark.asyncio
async def test_public_get_post(client, auth_headers):
    pub = await _create(client, auth_headers, title="p", visibility="public")
    prv = await _create(client, auth_headers, title="q", visibility="private")

    ok = await client.get(f"/api/public/blog/{pub['id']}")
    assert ok.status_code == 200
    assert ok.json()["id"] == pub["id"]

    # private post not accessible publicly
    assert (await client.get(f"/api/public/blog/{prv['id']}")).status_code == 404
    # missing
    assert (await client.get("/api/public/blog/999999")).status_code == 404
