#!/usr/bin/env bash
# Remove Exva headless launchd agent (doc 04 T4).
set -euo pipefail

LABEL="com.exva.headless"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "Removed ${LABEL} (plist deleted if present)."
