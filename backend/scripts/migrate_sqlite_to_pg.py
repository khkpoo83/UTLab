"""One-shot data migration: SQLite -> PostgreSQL.

Re-runnable (truncates the target first), model-driven (copies every table in
``Base.metadata``), FK-safe (disables FK checks on the target for the copy),
and self-validating (compares per-table row counts, resets id sequences).

Usage (inside the backend container, which has both drivers + models):
    SQLITE_URL=sqlite+aiosqlite:///./data/utlab.db \
    PG_URL=postgresql+asyncpg://user:pw@postgres:5432/db \
    python scripts/migrate_sqlite_to_pg.py

Exit code 0 = all tables validated (counts match). Non-zero = mismatch.
Does NOT modify the SQLite source. Does NOT flip the app over — that is the
cutover step (change DATABASE_URL + restart), done separately.
"""

import asyncio
import os
import sys

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import create_async_engine

from models.database import Base

SQLITE_URL = os.environ.get("SQLITE_URL", "sqlite+aiosqlite:///./data/utlab.db")
PG_URL = os.environ["PG_URL"]


async def _count(conn, table) -> int:
    return await conn.scalar(select(func.count()).select_from(table))


async def main() -> int:
    src = create_async_engine(SQLITE_URL)
    dst = create_async_engine(PG_URL)
    tables = list(Base.metadata.sorted_tables)  # FK-dependency order (parents first)

    copied: dict[str, int] = {}
    async with src.connect() as sconn, dst.begin() as dconn:
        # Disable FK enforcement on the target for the bulk copy + truncate.
        await dconn.execute(text("SET session_replication_role = replica"))

        # Truncate all target tables first (reverse dep order), so the copy is
        # idempotent across re-runs.
        for table in reversed(tables):
            await dconn.execute(text(f'TRUNCATE TABLE "{table.name}" RESTART IDENTITY CASCADE'))

        # Copy each table in dependency order.
        for table in tables:
            rows = (await sconn.execute(table.select())).mappings().all()
            if rows:
                await dconn.execute(table.insert(), [dict(r) for r in rows])
            copied[table.name] = len(rows)

        # Reset id sequences so new inserts don't collide with copied ids.
        for table in tables:
            if "id" in table.c:
                seq_sql = (
                    f"SELECT setval(pg_get_serial_sequence('\"{table.name}\"', 'id'), "
                    f"COALESCE((SELECT MAX(id) FROM \"{table.name}\"), 1), true)"
                )
                # Only tables whose id is backed by a sequence (SERIAL/IDENTITY).
                serial = await dconn.scalar(
                    text(f"SELECT pg_get_serial_sequence('\"{table.name}\"', 'id')")
                )
                if serial:
                    await dconn.execute(text(seq_sql))

    # Validate: per-table counts must match between source and target.
    mismatches = []
    async with src.connect() as sconn, dst.connect() as dconn:
        for table in tables:
            s = await _count(sconn, table)
            d = await _count(dconn, table)
            flag = "OK" if s == d else "MISMATCH"
            if s != d:
                mismatches.append((table.name, s, d))
            print(f"  {flag:8} {table.name:28} sqlite={s:<7} pg={d}")

    await src.dispose()
    await dst.dispose()

    total = sum(copied.values())
    print(f"\nCopied {total} rows across {len(tables)} tables.")
    if mismatches:
        print(f"❌ {len(mismatches)} table(s) mismatched: {mismatches}")
        return 1
    print("✅ All table row counts match. Migration validated.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
