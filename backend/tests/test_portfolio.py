"""Portfolio router: auth gate, create -> list -> summary round-trip."""


async def test_list_requires_auth(client, seed_user):
    resp = await client.get("/api/portfolio")
    assert resp.status_code == 401


async def test_create_list_summary(client, auth_headers):
    # create
    payload = {
        "ticker": "005930",
        "name": "삼성전자",
        "avg_price": 70000.0,
        "quantity": 10.0,
        "sector": "반도체",
    }
    created = await client.post("/api/portfolio", json=payload, headers=auth_headers)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["ticker"] == "005930"  # upper() no-op for digits
    assert body["quantity"] == 10.0
    holding_id = body["id"]

    # list reflects the new holding (price fields come from mocked services)
    listed = await client.get("/api/portfolio", headers=auth_headers)
    assert listed.status_code == 200
    rows = listed.json()
    assert any(r["id"] == holding_id for r in rows)
    row = next(r for r in rows if r["id"] == holding_id)
    assert row["current_price"] == 100.0  # from mock_external

    # summary aggregates
    summary = await client.get("/api/portfolio/summary", headers=auth_headers)
    assert summary.status_code == 200
    s = summary.json()
    assert s["count"] == 1
    # cost = 70000 * 10 = 700000
    assert s["total_cost"] == 700000.0


async def test_summary_empty(client, auth_headers):
    summary = await client.get("/api/portfolio/summary", headers=auth_headers)
    assert summary.status_code == 200
    s = summary.json()
    assert s["count"] == 0
    assert s["total_value"] == 0


async def test_delete_holding(client, auth_headers):
    created = await client.post(
        "/api/portfolio",
        json={"ticker": "AAPL", "name": "Apple", "avg_price": 150.0, "quantity": 2.0},
        headers=auth_headers,
    )
    hid = created.json()["id"]
    deleted = await client.delete(f"/api/portfolio/{hid}", headers=auth_headers)
    assert deleted.status_code == 204

    listed = await client.get("/api/portfolio", headers=auth_headers)
    assert all(r["id"] != hid for r in listed.json())
