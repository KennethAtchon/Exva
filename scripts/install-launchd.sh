#!/usr/bin/env bash
# Install launchd agent so Exva runs headless from login (doc 04 T4).
set -euo pipefail

LABEL="com.exva.headless"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$HOME/.exva/logs"
mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

# Prefer packaged Electron binary when present; otherwise bun headless entry.
HEADLESS_CMD="$REPO_ROOT/scripts/run-headless.sh"
if [[ ! -x "$HEADLESS_CMD" ]]; then
  chmod +x "$HEADLESS_CMD" 2>/dev/null || true
fi

cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${HEADLESS_CMD}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${REPO_ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/headless.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/headless.stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>EXVA_HEADLESS</key>
    <string>1</string>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:${HOME}/.bun/bin</string>
  </dict>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/${LABEL}" 2>/dev/null || launchctl load "$PLIST"

echo "Installed ${PLIST}"
echo "Headless logs: ${LOG_DIR}/headless.*.log"
echo "Uninstall with: bun run scripts/uninstall-launchd.sh"
