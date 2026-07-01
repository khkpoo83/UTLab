#!/usr/bin/env bash
#
# backup_pg.sh — Consistent PostgreSQL snapshot of the UT Lab stock DB.
#
# Replaces backup_db.sh after the SQLite -> PostgreSQL cutover (2026-07-01):
# the live source of truth is now the `postgres` container, so backups must
# come from pg_dump, NOT the (now stale) SQLite file.
#
# Runs pg_dump INSIDE the postgres container (custom format -Fc, which is
# compressed and restorable with pg_restore), writes a timestamped file to
# BACKUP_DIR, and prunes old backups by age.
#
#   PG_CONTAINER  postgres container name (default: stock-postgres-1)
#   BACKUP_DIR    destination dir         (default: /data/utlab/backups)
#   RETENTION_DAYS  prune age (days)      (default: 14)
#   Credentials are read from the project .env (POSTGRES_USER/PASSWORD/DB).
#
# Run with sudo (docker access) from the project root, or set ENV_FILE:
#   sudo /home/ec2-user/Dev/Stock/scripts/backup_pg.sh
#
# CRON (host crontab — add manually). Daily 04:30 KST (off-market):
#   30 4 * * * /home/ec2-user/Dev/Stock/scripts/backup_pg.sh >> /data/utlab/backups/backup_pg.log 2>&1
#
# Restore (into an empty DB):
#   gunzip -c utlab_pg_YYYYMMDD_HHMMSS.dump.gz | \
#     docker exec -i stock-postgres-1 pg_restore -U <user> -d <db> --clean --if-exists
#
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-stock-postgres-1}"
BACKUP_DIR="${BACKUP_DIR:-/data/utlab/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
ENV_FILE="${ENV_FILE:-$(dirname "$0")/../.env}"

log() { echo "[backup_pg] $(date '+%Y-%m-%d %H:%M:%S') $*"; }

if [ ! -f "$ENV_FILE" ]; then
    echo "[backup_pg] ERROR: env file not found: $ENV_FILE" >&2
    exit 1
fi

PG_USER="$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2-)"
PG_PW="$(grep -E '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
PG_DB="$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2-)"

if [ -z "$PG_USER" ] || [ -z "$PG_DB" ]; then
    echo "[backup_pg] ERROR: POSTGRES_USER/POSTGRES_DB missing in $ENV_FILE" >&2
    exit 1
fi

mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
SNAPSHOT="${BACKUP_DIR}/utlab_pg_${TIMESTAMP}.dump.gz"

log "dumping db=$PG_DB (container=$PG_CONTAINER) -> $SNAPSHOT"
# -Fc custom format (compressed, restorable). Pipe through gzip for parity
# with the old script's .gz naming and extra compression is negligible but
# keeps one consistent artifact convention.
docker exec -e PGPASSWORD="$PG_PW" "$PG_CONTAINER" \
    pg_dump -U "$PG_USER" -d "$PG_DB" -Fc | gzip > "$SNAPSHOT"

SIZE="$(stat -c%s "$SNAPSHOT" 2>/dev/null || echo '?')"
if [ "$SIZE" = "0" ] || [ "$SIZE" = "?" ]; then
    echo "[backup_pg] ERROR: snapshot is empty/missing" >&2
    rm -f "$SNAPSHOT"
    exit 1
fi
log "wrote $SNAPSHOT ($SIZE bytes)"

# Prune old PG backups (leave the old SQLite .db.gz backups untouched).
find "$BACKUP_DIR" -name 'utlab_pg_*.dump.gz' -type f -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true
log "done"
