"""Alembic-driven schema management for the Stock backend.

This module is the single entry point the app uses to bring a database to the
current schema version.  It is import-safe (no side effects at import) and
testable in isolation.

Decision matrix (see ``run_migrations``):

  * ``alembic_version`` table present
        -> a managed DB; run ``upgrade head`` to apply any pending revisions.
  * ``alembic_version`` absent BUT app tables exist
        -> a legacy/pre-Alembic prod DB that already HAS the schema.  We must
           NOT recreate it; ``stamp head`` records that it is at the current
           revision, then ``upgrade head`` applies anything newer (no-op for a
           prod DB already at baseline).
  * empty DB (no app tables, no alembic_version)
        -> fresh install; ``upgrade head`` builds the whole schema.

Everything routes through ``upgrade head`` after the stamp decision, so adding
future migrations needs no change here.
"""

from __future__ import annotations

import os

from sqlalchemy import inspect

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext

# Directory containing this file == the backend root, where alembic.ini lives.
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_ALEMBIC_INI = os.path.join(_BACKEND_DIR, "alembic.ini")
_ALEMBIC_DIR = os.path.join(_BACKEND_DIR, "alembic")

# A table that, if present, proves the app schema already exists.  Picked
# because it is one of the oldest core tables and never conditionally created.
_SENTINEL_APP_TABLE = "portfolio"


def make_alembic_config(database_url: str | None = None) -> Config:
    """Build an Alembic ``Config`` independent of the process CWD.

    ``script_location`` is set to an absolute path so migrations resolve no
    matter where the app is launched from.  If ``database_url`` is given it is
    injected (mainly for tests); otherwise ``env.py`` derives it from
    ``models.database.DATABASE_URL`` as usual.
    """
    cfg = Config(_ALEMBIC_INI)
    cfg.set_main_option("script_location", _ALEMBIC_DIR)
    if database_url is not None:
        cfg.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    return cfg


def _decide(sync_connection) -> str:
    """Return the action to take for a live (sync) DBAPI connection.

    One of: ``"upgrade"`` (alembic_version present, or empty DB) or ``"stamp"``
    (legacy DB with app tables but no alembic_version).
    """
    insp = inspect(sync_connection)
    tables = set(insp.get_table_names())
    has_version = "alembic_version" in tables
    has_app_tables = _SENTINEL_APP_TABLE in tables

    if has_version:
        return "upgrade"
    if has_app_tables:
        return "stamp"
    return "upgrade"  # empty DB -> build from scratch


def _run_sync(sync_connection, cfg: Config) -> str:
    """Synchronous worker: decide + stamp (if needed) + upgrade.

    Returns the decision string for observability/testing.  Runs Alembic with
    the *existing* connection bound into the config's attributes so env.py can
    reuse it instead of opening a second one.
    """
    action = _decide(sync_connection)

    # Share the live connection with env.py via config attributes.
    cfg.attributes["connection"] = sync_connection

    if action == "stamp":
        command.stamp(cfg, "head")
    # In all cases, apply any pending migrations (no-op once at head).
    command.upgrade(cfg, "head")
    return action


def current_revision(sync_connection) -> str | None:
    """Return the DB's current Alembic revision, or None if unmanaged."""
    ctx = MigrationContext.configure(sync_connection)
    return ctx.get_current_revision()


async def run_migrations(engine, database_url: str | None = None) -> str:
    """Bring ``engine``'s database to head, async-safe.

    Opens one connection on the given async engine, runs the stamp/upgrade
    decision inside ``run_sync`` (Alembic's command layer is synchronous), and
    returns the action taken (``"stamp"`` or ``"upgrade"``).
    """
    cfg = make_alembic_config(database_url)
    async with engine.begin() as conn:
        return await conn.run_sync(_run_sync, cfg)
