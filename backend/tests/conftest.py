"""Test harness for the FastAPI backend (Track α — backend safety net).

Wiring decisions (see TASK report / DONE doc for rationale):

* The single most important trick: we point ``DATABASE_URL`` at an in-memory
  SQLite DB *before* any project module is imported.  ``models.database``
  builds ``engine`` and ``AsyncSessionLocal`` at import time, and many service
  modules do ``from models.database import AsyncSessionLocal`` (binding the
  object by value).  Setting the env var first means there is exactly one
  in-memory engine, shared via ``StaticPool``, that *both* the ``get_db``
  dependency path and auth.py's direct ``AsyncSessionLocal()`` path use.  No
  per-module monkeypatching of session references is required.

* We do NOT run the production ``lifespan``.  ``httpx.ASGITransport`` does not
  fire lifespan events, so the scheduler / KIS / Gemini / calendar / backfill
  wiring never starts — no network, no background threads.  We replicate only
  the two lifespan side-effects the tests actually need: create the schema and
  ``configure`` the auth module so JWTs can be signed.

* External service functions are mocked at the service-function level (see
  ``mock_external`` autouse fixture) for determinism and speed.
"""

import os
import tempfile

# ---------------------------------------------------------------------------
# MUST run before importing models.database / main.  Order matters.
# ---------------------------------------------------------------------------
# A temp *file* DB (not ``:memory:``) is used deliberately: pytest-asyncio runs
# each test in its own event loop, and an in-memory SQLite connection is bound
# to the loop that opened it — across loops the connection is invalidated and
# the DB appears empty / schema collides.  A file-backed DB has none of that
# fragility while staying fast and disposable.  The file lives in the system
# temp dir and is unlinked at session end.
_DB_FD, _DB_PATH = tempfile.mkstemp(prefix="stock_test_", suffix=".db")
os.close(_DB_FD)
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_DB_PATH}"
os.environ.setdefault("JWT_SECRET", "test-secret-key-not-for-prod")
os.environ.setdefault("APP_USERNAME", "admin")
os.environ.setdefault("APP_PASSWORD", "testpassword123")
# blog.py creates this dir at import time; redirect off the hardcoded /app path.
os.environ.setdefault(
    "BLOG_IMAGES_DIR", os.path.join(tempfile.gettempdir(), "stock_test_blog_images")
)

import httpx  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402

# Importing main pulls in the app + all routers.  Safe now that DATABASE_URL
# is in-memory and lifespan won't run under ASGITransport.
import main  # noqa: E402
import routers.auth as auth_module  # noqa: E402
from models.database import AsyncSessionLocal, Base, engine  # noqa: E402

TEST_USERNAME = "admin"
TEST_PASSWORD = "testpassword123"


@pytest_asyncio.fixture
async def _schema():
    """Reset the in-memory DB to an empty, freshly-created schema per test.

    StaticPool keeps a single SQLite connection alive for the whole process, so
    the ``:memory:`` database (and its tables) persist between tests.  We
    drop-then-create at the *start* of each test for clean isolation; doing it
    at setup (rather than relying on teardown) makes the first test and a
    leftover-from-a-crash run both start clean.
    """
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


@pytest.fixture(autouse=True)
def configure_auth():
    """Inject a JWT secret so tokens can be signed without running lifespan."""
    auth_module.configure(
        secret_key=os.environ["JWT_SECRET"],
        expire_minutes=60,
        username=TEST_USERNAME,
        password=TEST_PASSWORD,
    )
    yield


@pytest.fixture(autouse=True)
def mock_external(monkeypatch):
    """Neuter every external network boundary at the service-function level.

    These are imported lazily inside route handlers / services in most cases,
    so we patch the canonical service module attributes.  Centralised here so
    individual router tests stay declarative.
    """
    import services.news_service as news_service
    import services.stock_service as stock_service

    async def _fake_price_detail(ticker, *a, **k):
        return {"price": 100.0, "day_change": 1.5, "day_change_pct": 1.52}

    async def _fake_current_price(ticker, *a, **k):
        return 100.0

    async def _fake_sparkline(ticker, *a, **k):
        return [98.0, 99.0, 100.0]

    async def _fake_fundamentals(ticker, *a, **k):
        return {"market_cap": 1_000_000, "per": 10.0, "pbr": 1.0, "eps": 500.0}

    async def _fake_search(q, *a, **k):
        return [{"ticker": "005930.KS", "name": "삼성전자"}]

    async def _fake_chart(*a, **k):
        return []

    async def _fake_ticker_news(*a, **k):
        return []

    # stock_service price/search boundaries (yfinance / KIS)
    monkeypatch.setattr(stock_service, "fetch_price_detail", _fake_price_detail, raising=False)
    monkeypatch.setattr(stock_service, "fetch_current_price", _fake_current_price, raising=False)
    monkeypatch.setattr(stock_service, "get_sparkline", _fake_sparkline, raising=False)
    monkeypatch.setattr(stock_service, "search_stocks", _fake_search, raising=False)
    monkeypatch.setattr(stock_service, "get_chart_data", _fake_chart, raising=False)
    monkeypatch.setattr(
        stock_service, "fetch_stock_fundamentals", _fake_fundamentals, raising=False
    )

    # portfolio.py imported these names directly into its own namespace, so
    # patch there too (it does ``from services.stock_service import ...``).
    import routers.portfolio as portfolio_router

    monkeypatch.setattr(portfolio_router, "fetch_price_detail", _fake_price_detail, raising=False)
    monkeypatch.setattr(
        portfolio_router, "fetch_current_price", _fake_current_price, raising=False
    )
    monkeypatch.setattr(portfolio_router, "get_sparkline", _fake_sparkline, raising=False)
    monkeypatch.setattr(portfolio_router, "search_stocks", _fake_search, raising=False)
    monkeypatch.setattr(portfolio_router, "get_ticker_news", _fake_ticker_news, raising=False)

    # news RSS collection boundary (feedparser)
    async def _fake_collect(*a, **k):
        return []

    monkeypatch.setattr(news_service, "collect_and_save_news", _fake_collect, raising=False)
    monkeypatch.setattr(news_service, "get_ticker_news", _fake_ticker_news, raising=False)

    yield


@pytest_asyncio.fixture
async def app(_schema):
    """The FastAPI app, schema-prepared.  Lifespan is intentionally not run."""
    return main.app


@pytest_asyncio.fixture
async def client(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as ac:
        yield ac


@pytest_asyncio.fixture
async def seed_user():
    """Insert one bcrypt-hashed user directly into the test DB.

    Uses the auth module's own pwd_context so the stored hash verifies against
    TEST_PASSWORD via the real login path.
    """
    from sqlalchemy import select

    from models.database import User

    hashed = auth_module.pwd_context.hash(TEST_PASSWORD)
    async with AsyncSessionLocal() as session:
        existing = await session.execute(select(User).where(User.username == TEST_USERNAME))
        if existing.scalar_one_or_none() is None:
            session.add(User(username=TEST_USERNAME, hashed_password=hashed))
            await session.commit()
    return {"username": TEST_USERNAME, "password": TEST_PASSWORD}


@pytest_asyncio.fixture
async def auth_token(client, seed_user):
    """Log in and return a bearer token string."""
    resp = await client.post(
        "/api/auth/login",
        data={"username": seed_user["username"], "password": seed_user["password"]},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


@pytest.fixture
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}"}


def pytest_sessionfinish(session, exitstatus):
    """Remove the temp SQLite file (and WAL/SHM sidecars) at session end."""
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(_DB_PATH + suffix)
        except OSError:
            pass
