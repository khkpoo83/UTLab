#!/usr/bin/env bash
#
# backup_db.sh — Consistent SQLite snapshot of the UT Lab stock DB.
#
# Uses SQLite's online backup API (`.backup`) which produces a single
# consistent file even while the DB is open in WAL mode (it folds the
# -wal contents into the snapshot). The result is gzip-compressed and
# old backups are pruned by age.
#
# Portable: paths are parameterized via env vars so this works on the
# current EC2 host and on a future home server unchanged.
#
#   DB_PATH      source DB           (default: /data/utlab/utlab.db)
#   BACKUP_DIR   destination dir     (default: /data/utlab/backups)
#   RETENTION_DAYS  prune age (days) (default: 14)
#
# The DB is root-owned, so run with sudo (or as a user that can read it
# and write BACKUP_DIR):
#
#   sudo /home/ec2-user/Dev/Stock/scripts/backup_db.sh
#
# CRON (host crontab — add manually, do NOT let scripts edit crontab):
# Daily at 04:30 KST (off-market), `sudo crontab -e`:
#
#   30 4 * * * /home/ec2-user/Dev/Stock/scripts/backup_db.sh >> /data/utlab/backups/backup.log 2>&1
#
set -euo pipefail

DB_PATH="${DB_PATH:-/data/utlab/utlab.db}"
BACKUP_DIR="${BACKUP_DIR:-/data/utlab/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
SNAPSHOT="${BACKUP_DIR}/utlab_${TIMESTAMP}.db"

if [ ! -f "$DB_PATH" ]; then
    echo "[backup_db] ERROR: source DB not found: $DB_PATH" >&2
    exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "[backup_db] $(date '+%F %T') snapshotting $DB_PATH -> ${SNAPSHOT}.gz"

# Prefer the sqlite3 CLI; fall back to Python's sqlite3 module (same engine).
# Both use the online backup API for a WAL-consistent snapshot.
if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB_PATH" ".backup '${SNAPSHOT}'"
elif command -v python3 >/dev/null 2>&1; then
    python3 - "$DB_PATH" "$SNAPSHOT" <<'PY'
import sqlite3, sys
src_path, dst_path = sys.argv[1], sys.argv[2]
src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
dst = sqlite3.connect(dst_path)
with dst:
    src.backup(dst)
dst.close()
src.close()
PY
else
    echo "[backup_db] ERROR: neither sqlite3 nor python3 found" >&2
    exit 1
fi

gzip -f "$SNAPSHOT"

SIZE="$(stat -c%s "${SNAPSHOT}.gz" 2>/dev/null || echo '?')"
echo "[backup_db] wrote ${SNAPSHOT}.gz (${SIZE} bytes)"

# Retention prune: delete gzipped snapshots older than RETENTION_DAYS.
find "$BACKUP_DIR" -name 'utlab_*.db.gz' -type f -mtime "+${RETENTION_DAYS}" -print -delete

echo "[backup_db] done"
