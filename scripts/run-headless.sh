#!/usr/bin/env bash
# Launch Exva main process in headless mode (no BrowserWindow).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
export EXVA_HEADLESS=1
# electron-forge start boots the same main entry; index.ts skips the window
# when EXVA_HEADLESS=1 and keeps the process alive without a GUI.
exec bun run start
