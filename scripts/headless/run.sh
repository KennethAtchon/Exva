#!/usr/bin/env bash
# Launch Exva main process in headless mode (no BrowserWindow).
#
# Prefer the packaged binary at ~/.exva/runtime (outside ~/Documents).
# Dev fallback uses bun, but electron-forge start is unreliable under launchd
# (no TTY / immediate Electron exit). Install script packages by default.
set -euo pipefail

PACKAGED_BIN="${EXVA_PACKAGED_BIN:-$HOME/.exva/runtime/exva.app/Contents/MacOS/exva}"
REPO_ROOT="${EXVA_REPO_ROOT:-}"
SUPPRESS="$HOME/.exva/suppress-headless"
LOCK="$HOME/.exva/instance.lock"

# Always keep cwd outside TCC-protected folders (Documents/Desktop/Downloads).
cd "$HOME/.exva"

if [[ -f "$SUPPRESS" ]]; then
  echo "Headless suppressed (GUI owns session): $SUPPRESS"
  exit 0
fi
if [[ -f "$LOCK" ]] && grep -q '"mode": "gui"' "$LOCK" 2>/dev/null; then
  echo "GUI instance lock present; not starting headless."
  exit 0
fi

export EXVA_HEADLESS=1

if [[ -x "$PACKAGED_BIN" ]]; then
  echo "Starting packaged headless: $PACKAGED_BIN"
  # Do not pass --headless: Electron treats unknown flags as fatal.
  exec "$PACKAGED_BIN"
fi

if [[ -z "$REPO_ROOT" ]]; then
  echo "No packaged binary at $PACKAGED_BIN and EXVA_REPO_ROOT unset." >&2
  echo "Re-run: bash scripts/headless/install-launchd.sh" >&2
  exit 1
fi

echo "WARN: packaged binary missing; falling back to bun/dev (may fail under launchd)." >&2
exec bun run --cwd "$REPO_ROOT" start
