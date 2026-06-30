"""Settings router: GET returns DEFAULT_SETTINGS merged, PUT round-trips."""

from routers.settings import DEFAULT_SETTINGS


async def test_settings_requires_auth(client, seed_user):
    resp = await client.get("/api/settings")
    assert resp.status_code == 401


async def test_get_returns_defaults(client, auth_headers):
    resp = await client.get("/api/settings", headers=auth_headers)
    assert resp.status_code == 200
    cfg = resp.json()
    # every default key present with its default value (nothing in DB yet)
    for key, val in DEFAULT_SETTINGS.items():
        assert key in cfg
        assert cfg[key] == val


async def test_put_round_trips(client, auth_headers):
    update = {"settings": {"stock_interval_minutes": 30, "news_retention_days": 7}}
    resp = await client.put("/api/settings", json=update, headers=auth_headers)
    assert resp.status_code == 200
    cfg = resp.json()
    assert cfg["stock_interval_minutes"] == 30
    assert cfg["news_retention_days"] == 7

    # persisted: a fresh GET reflects the change merged over defaults
    again = await client.get("/api/settings", headers=auth_headers)
    body = again.json()
    assert body["stock_interval_minutes"] == 30
    assert body["news_retention_days"] == 7
    # untouched default stays default
    assert body["ai_summary_max_items"] == DEFAULT_SETTINGS["ai_summary_max_items"]


async def test_put_ignores_unknown_keys(client, auth_headers):
    update = {"settings": {"not_a_real_setting": "x", "stock_interval_minutes": 45}}
    resp = await client.put("/api/settings", json=update, headers=auth_headers)
    assert resp.status_code == 200
    cfg = resp.json()
    assert "not_a_real_setting" not in cfg
    assert cfg["stock_interval_minutes"] == 45


async def test_put_json_value_round_trips(client, auth_headers):
    """A dict-valued setting (news_schedule) survives json serialize/parse."""
    schedule = {"0": [9, 10, 11], "1": [9]}
    resp = await client.put(
        "/api/settings", json={"settings": {"news_schedule": schedule}}, headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json()["news_schedule"] == schedule


async def test_public_settings_no_auth(client, seed_user):
    """Public settings endpoint is reachable without a token."""
    resp = await client.get("/api/settings/public")
    assert resp.status_code == 200
    body = resp.json()
    assert body["blog_title"] == DEFAULT_SETTINGS["blog_title"]
