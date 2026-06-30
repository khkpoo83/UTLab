"""Alembic migration tests (Phase 2).

These verify the three startup paths ``db_migrate.run_migrations`` handles, so
that wiring it into ``init_db`` is safe for both fresh installs and the live
legacy (pre-Alembic) production DB:

* fresh DB        -> ``upgrade head`` builds a schema byte-equal to
                     ``Base.metadata.create_all`` (the baseline migration is
                     the canonical reproduction of the ORM models);
* legacy prod DB  -> app tables exist but no ``alembic_version`` -> ``stamp``
                     at head WITHOUT dropping/recreating, data preserved;
* managed DB      -> running again is an idempotent no-op.

They build their own throwaway temp-file engines and do NOT touch the shared
conftest engine, so they are independent of the rest of the suite.
"""

import os
import tempfile

import pytest
import pytest_asyncio
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.ext.asyncio import create_async_engine

from db_migrate import current_revision, run_migrations
from models.database import Base

HEAD = "94982b843fee"  # baseline revision


def _table_index_map(sync_url):
    """Return {table: set(index columns tuples)} for a sync sqlite URL."""
    eng = create_engine(sync_url)
    try:
        insp = inspect(eng)
        out = {}
        for t in insp.get_table_names():
            if t == "alembic_version":
                continue
            idx = {tuple(ix["column_names"]) for ix in insp.get_indexes(t)}
            out[t] = idx
        return out
    finally:
        eng.dispose()


@pytest_asyncio.fixture
async def tmp_db():
    """Yield (async_url, sync_url, path) for a disposable temp-file DB."""
    fd, path = tempfile.mkstemp(prefix="alembic_test_", suffix=".db")
    os.close(fd)
    os.unlink(path)  # start with a truly absent file
    yield f"sqlite+aiosqlite:///{path}", f"sqlite:///{path}", path
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(path + suffix)
        except OSError:
            pass


async def test_fresh_upgrade_builds_full_schema(tmp_db):
    async_url, sync_url, _ = tmp_db
    engine = create_async_engine(async_url)
    try:
        action = await run_migrations(engine, database_url=async_url)
    finally:
        await engine.dispose()

    assert action == "upgrade"

    # Schema built by Alembic must match Base.metadata.create_all table-for-table.
    fd2, meta_path = tempfile.mkstemp(prefix="alembic_meta_", suffix=".db")
    os.close(fd2)
    os.unlink(meta_path)
    meta_eng = create_engine(f"sqlite:///{meta_path}")
    try:
        Base.metadata.create_all(meta_eng)
    finally:
        meta_eng.dispose()

    alembic_tables = _table_index_map(sync_url)
    meta_tables = _table_index_map(f"sqlite:///{meta_path}")
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(meta_path + suffix)
        except OSError:
            pass

    assert set(alembic_tables) == set(meta_tables), (
        f"table set differs: only-in-alembic={set(alembic_tables) - set(meta_tables)}, "
        f"only-in-metadata={set(meta_tables) - set(alembic_tables)}"
    )
    # Every metadata index must be present in the Alembic-built schema.
    for tbl, meta_idx in meta_tables.items():
        assert meta_idx <= alembic_tables[tbl], (
            f"{tbl}: indexes missing from Alembic build: {meta_idx - alembic_tables[tbl]}"
        )


async def test_legacy_stamp_preserves_data(tmp_db):
    async_url, sync_url, _ = tmp_db

    # Simulate a legacy pre-Alembic prod DB: schema via create_all, a real row,
    # and NO alembic_version table.
    seed_eng = create_engine(sync_url)
    try:
        Base.metadata.create_all(seed_eng)
        with seed_eng.begin() as c:
            c.execute(
                text(
                    "INSERT INTO portfolio (ticker,name,avg_price,quantity,created_at,source) "
                    "VALUES ('005930.KS','삼성전자',70000,10,CURRENT_TIMESTAMP,'manual')"
                )
            )
        insp = inspect(seed_eng)
        assert "alembic_version" not in insp.get_table_names()
    finally:
        seed_eng.dispose()

    engine = create_async_engine(async_url)
    try:
        action = await run_migrations(engine, database_url=async_url)
    finally:
        await engine.dispose()

    assert action == "stamp"

    check_eng = create_engine(sync_url)
    try:
        with check_eng.connect() as c:
            assert current_revision(c) == HEAD
            n = c.execute(text("SELECT COUNT(*) FROM portfolio")).scalar()
        assert n == 1, "legacy data lost during stamp"
    finally:
        check_eng.dispose()


async def test_second_run_is_idempotent(tmp_db):
    async_url, _, _ = tmp_db
    engine = create_async_engine(async_url)
    try:
        first = await run_migrations(engine, database_url=async_url)
        second = await run_migrations(engine, database_url=async_url)
    finally:
        await engine.dispose()
    assert first == "upgrade"
    assert second == "upgrade"  # already managed -> upgrade head, no-op
