#!/usr/bin/env bash
# Backup Exva SQLite DB before migrations / risky ops.
# Prefer sqlite3 .backup; fall back to cp. Prune to last 30 backups.
# DB path resolution matches the app (EXVA_DB_PATH → Application Support/exva.db).
set -euo pipefail

HOME_DIR="${HOME:-$(eval echo ~)}"
BACKUP_DIR="${EXVA_DB_BACKUP_DIR:-$HOME_DIR/.exva/backups}"
KEEP=30

resolve_db_path() {
  if [[ -n "${EXVA_DB_PATH:-}" ]]; then
    echo "$EXVA_DB_PATH"
    return
  fi
  local candidates=(
    "$HOME_DIR/Library/Application Support/exva/exva.db"
    "$HOME_DIR/Library/Application Support/Exva/exva.db"
    "$HOME_DIR/Library/Application Support/com.exva.app/exva.db"
    "$HOME_DIR/.config/Exva/exva.db"
    # Legacy default from an earlier script revision — still checked.
    "$HOME_DIR/.exva/exva.sqlite"
  )
  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      echo "$candidate"
      return
    fi
  done
  echo "${candidates[0]}"
}

SRC="$(resolve_db_path)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"

if [[ ! -f "$SRC" ]]; then
  echo "No DB at $SRC — nothing to back up."
  exit 0
fi

DEST="$BACKUP_DIR/exva-$STAMP.db"
META="$HOME_DIR/.exva/last-backup.json"
mkdir -p "$HOME_DIR/.exva"

if command -v sqlite3 >/dev/null 2>&1; then
  if sqlite3 "$SRC" ".backup '$DEST'"; then
    echo "Backed up (sqlite3 .backup) $SRC → $DEST"
  else
    echo "sqlite3 .backup failed; falling back to cp" >&2
    cp "$SRC" "$DEST"
    [[ -f "$SRC-wal" ]] && cp "$SRC-wal" "$DEST-wal" || true
    [[ -f "$SRC-shm" ]] && cp "$SRC-shm" "$DEST-shm" || true
    echo "Backed up (cp) $SRC → $DEST"
  fi
else
  cp "$SRC" "$DEST"
  [[ -f "$SRC-wal" ]] && cp "$SRC-wal" "$DEST-wal" || true
  [[ -f "$SRC-shm" ]] && cp "$SRC-shm" "$DEST-shm" || true
  echo "Backed up (cp; sqlite3 not found) $SRC → $DEST"
fi

# Prune to last KEEP backups (newest first). Portable on macOS bash 3.
COUNT=0
# shellcheck disable=SC2012
ls -1t "$BACKUP_DIR"/exva-*.db "$BACKUP_DIR"/exva-*.sqlite 2>/dev/null | while read -r stale; do
  COUNT=$((COUNT + 1))
  if ((COUNT > KEEP)); then
    rm -f "$stale" "${stale}-wal" "${stale}-shm"
  fi
done

BACKED_UP_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat >"$META" <<EOF
{
  "backedUpAt": "$BACKED_UP_AT",
  "sourcePath": "$SRC",
  "backupPath": "$DEST",
  "trigger": "script"
}
EOF
echo "Wrote last-backup meta → $META"
