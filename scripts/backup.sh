#!/usr/bin/env bash
#
# backup.sh — take a consistent backup of LabelBench.
#
# Two things hold state: the SQLite database and the uploaded assets. Both are
# captured here, without stopping the app.
#
# The database is snapshotted with SQLite's online backup API rather than
# copied. The database runs in WAL mode, so recent transactions live in the
# -wal file and not in the main file: a plain copy of labelbench.db can
# produce a file with no tables in it at all. Measured on the reference host,
# the naive copy was 4096 bytes and raised "no such table: template", while
# the snapshot below was 81920 bytes and passed PRAGMA integrity_check.
#
# Usage:
#   ./scripts/backup.sh [destination-directory]
#
# The destination defaults to ./backups. Files are named with a UTC stamp.
# The script is safe to run while the app is up, and safe to run twice.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:-$REPO_DIR/backups}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DB_FILE="$DEST/labelbench-$STAMP.db"
ASSET_FILE="$DEST/assets-$STAMP.tgz"

cd "$REPO_DIR"

if ! docker compose ps --status running --services 2>/dev/null | grep -qx app; then
  echo "ERROR: the app service is not running. Start it with 'docker compose up -d'." >&2
  exit 1
fi

mkdir -p "$DEST"
chmod 750 "$DEST"

echo "==> snapshotting the database"
docker compose exec -T app node -e '
const D = require("better-sqlite3");
const db = new D("/data/labelbench.db", { readonly: true });
db.backup("/tmp/labelbench-backup.db")
  .then(() => { db.close(); })
  .catch((e) => { console.error(e); process.exit(1); });
'
docker compose cp app:/tmp/labelbench-backup.db "$DB_FILE"
docker compose exec -T app rm -f /tmp/labelbench-backup.db

echo "==> archiving the assets"
docker compose exec -T app tar czf - -C /data assets > "$ASSET_FILE"

echo "==> verifying the snapshot"
docker compose cp "$DB_FILE" app:/tmp/labelbench-verify.db
docker compose exec -T app node -e '
const D = require("better-sqlite3");
const db = new D("/tmp/labelbench-verify.db", { readonly: true });
const integrity = db.pragma("integrity_check", { simple: true });
const templates = db.prepare("select count(*) c from template").get().c;
db.close();
console.log("    integrity:", integrity);
console.log("    templates:", templates);
if (integrity !== "ok") { process.exit(1); }
'
docker compose exec -T app rm -f /tmp/labelbench-verify.db

ls -l "$DB_FILE" "$ASSET_FILE"
echo "==> done: $DB_FILE"
echo "    a backup that has not been opened is not a backup — check the integrity line above."
