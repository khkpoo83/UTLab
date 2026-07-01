"""Dialect-aware INSERT ... ON CONFLICT helper.

Both SQLite and PostgreSQL expose ``insert(...).on_conflict_do_update(
index_elements=..., set_=...)`` with the same signature, but via different
dialect modules. This picks the right one based on the bound engine's dialect
so upsert code stays portable across the SQLite→Postgres migration.
"""

from sqlalchemy.dialects.postgresql import insert as _pg_insert
from sqlalchemy.dialects.sqlite import insert as _sqlite_insert

from models.database import engine


def dialect_insert(table):
    """Return a dialect-appropriate ``insert(table)`` construct.

    The returned statement supports ``.on_conflict_do_update(index_elements=,
    set_=)`` identically on both backends.
    """
    if engine.dialect.name == "postgresql":
        return _pg_insert(table)
    return _sqlite_insert(table)
