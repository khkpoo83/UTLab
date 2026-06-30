"""Auth router happy + unhappy paths: login token, bad password, lockout."""

import pytest


async def test_login_success_returns_token(client, seed_user):
    resp = await client.post(
        "/api/auth/login",
        data={"username": seed_user["username"], "password": seed_user["password"]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert isinstance(body["access_token"], str) and body["access_token"]


async def test_login_bad_password_401(client, seed_user):
    resp = await client.post(
        "/api/auth/login",
        data={"username": seed_user["username"], "password": "wrong-password"},
    )
    assert resp.status_code == 401
    assert "Invalid username or password" in resp.text


async def test_login_unknown_user_401(client, seed_user):
    resp = await client.post(
        "/api/auth/login",
        data={"username": "nobody", "password": "whatever"},
    )
    assert resp.status_code == 401


async def test_me_requires_token(client, seed_user, auth_headers):
    # without token
    unauth = await client.get("/api/auth/me")
    assert unauth.status_code == 401
    # with token
    authed = await client.get("/api/auth/me", headers=auth_headers)
    assert authed.status_code == 200
    assert authed.json()["username"] == seed_user["username"]


async def test_lockout_after_five_failures(client, seed_user):
    """5 bad attempts -> account locked -> 6th attempt returns 429."""
    for _ in range(5):
        r = await client.post(
            "/api/auth/login",
            data={"username": seed_user["username"], "password": "bad"},
        )
        assert r.status_code == 401

    # account is now locked; even a correct password is rejected with 429
    locked = await client.post(
        "/api/auth/login",
        data={"username": seed_user["username"], "password": seed_user["password"]},
    )
    assert locked.status_code == 429
    assert "locked" in locked.text.lower()


async def test_failed_counter_resets_on_success(client, seed_user):
    """A few failures then a success should clear the counter (no lockout)."""
    for _ in range(3):
        await client.post(
            "/api/auth/login",
            data={"username": seed_user["username"], "password": "bad"},
        )
    ok = await client.post(
        "/api/auth/login",
        data={"username": seed_user["username"], "password": seed_user["password"]},
    )
    assert ok.status_code == 200

    # counter reset -> 4 more failures must not lock yet
    for _ in range(4):
        r = await client.post(
            "/api/auth/login",
            data={"username": seed_user["username"], "password": "bad"},
        )
        assert r.status_code == 401  # still 401, not 429
