#!/usr/bin/env bash
# Launch Exva main process in headless mode (no BrowserWindow).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

SUPPRESS="$HOME/.exva/suppress-headless"
LOCK="$HOME/.exva/instance.lock"
if [[ -f "$SUPPRESS" ]]; then
  echo "Headless suppressed (GUI owns session): $SUPPRESS"
  exit 0
fi
if [[ -f "$LOCK" ]] && grep -q '"mode": "gui"' "$LOCK" 2>/dev/null; then
  echo "GUI instance lock present; not starting headless."
  exit 0
fi

export EXVA_HEADLESS=1
# electron-forge start boots the same main entry; index.ts skips the window
# when EXVA_HEADLESS=1 and keeps the process alive without a GUI.
exec bun run start
