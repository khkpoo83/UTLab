"""Alembic migration environment for the Stock backend.

Design notes
------------
* Single source of truth for the DB URL: we import ``DATABASE_URL`` and
  ``Base`` from ``models.database`` rather than reading ``alembic.ini``.  The
  app already derives ``DATABASE_URL`` from the environment (Phase 1), so
  migrations always target the same DB the app uses.

* Async-aware: the app uses ``sqlite+aiosqlite``.  Offline mode emits SQL with
  no DB connection; online mode runs migrations through an async engine and
  bridges to Alembic's synchronous ``context`` via ``connection.run_sync``.

* We build a dedicated async engine here (NullPool) instead of reusing the
  app's StaticPool engine, so migrations get a clean, independently-disposed
  connection and never interfere with the running app's pooled connection.

* ``render_as_batch=True`` is enabled for SQLite so that ALTER-style ops (which
  SQLite doesn't support natively) are emitted as batch table-rebuilds.
"""

import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# Import the app's metadata and DB URL (single source of truth).
from models.database import DATABASE_URL, Base

# Alembic Config object, providing access to values within alembic.ini.
config = context.config

# Inject the runtime DB URL so engine creation below picks it up.  Escape '%'
# because ConfigParser treats it as interpolation syntax.
config.set_main_option("sqlalchemy.url", DATABASE_URL.replace("%", "%%"))

# Configure Python logging from alembic.ini, if present.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Target metadata for autogenerate support.
target_metadata = Base.metadata


def _is_sqlite() -> bool:
    return DATABASE_URL.startswith("sqlite")


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emit SQL, no live DB connection)."""
    context.configure(
        url=DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=_is_sqlite(),
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=_is_sqlite(),
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Create an async engine and run migrations through it."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    If a live (synchronous) connection was injected via
    ``config.attributes["connection"]`` -- as ``db_migrate`` does from inside an
    ``AsyncConnection.run_sync`` callback -- reuse it directly rather than
    opening a second engine.  Otherwise create our own async engine (the path
    taken by the ``alembic`` CLI).
    """
    connection = config.attributes.get("connection", None)
    if connection is not None:
        do_run_migrations(connection)
    else:
        asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
