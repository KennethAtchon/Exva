#!/usr/bin/env bash
# Backup Exva SQLite DB before migrations / risky phases.
set -euo pipefail
SRC="${EXVA_DB_PATH:-$HOME/.exva/exva.sqlite}"
DEST_DIR="${EXVA_DB_BACKUP_DIR:-$HOME/.exva/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DEST_DIR"
if [[ ! -f "$SRC" ]]; then
  echo "No DB at $SRC — nothing to back up."
  exit 0
fi
DEST="$DEST_DIR/exva-$STAMP.sqlite"
cp "$SRC" "$DEST"
# Also copy WAL/SHM if present so restore is consistent.
[[ -f "$SRC-wal" ]] && cp "$SRC-wal" "$DEST-wal" || true
[[ -f "$SRC-shm" ]] && cp "$SRC-shm" "$DEST-shm" || true
echo "Backed up $SRC → $DEST"
