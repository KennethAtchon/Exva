#!/usr/bin/env bash
# Install launchd agent so Exva runs headless from Mac login (doc 04 T4).
#
# macOS TCC blocks launchd from *executing* scripts under ~/Documents.
# electron-forge start also exits immediately under launchd (no durable Electron).
# So we: package → copy app to ~/.exva/runtime → LaunchAgent runs that binary.
set -euo pipefail

LABEL="com.exva.headless"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="$HOME/.exva/logs"
BIN_DIR="$HOME/.exva/bin"
RUNTIME_DIR="$HOME/.exva/runtime"
INSTALLED_RUNNER="$BIN_DIR/run-headless.sh"
SOURCE_RUNNER="$REPO_ROOT/scripts/headless/run.sh"
PACKAGED_APP_SRC="$REPO_ROOT/out/exva-darwin-arm64/exva.app"
PACKAGED_APP_DST="$RUNTIME_DIR/exva.app"
PACKAGED_BIN="$PACKAGED_APP_DST/Contents/MacOS/exva"

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR" "$BIN_DIR" "$RUNTIME_DIR"

if [[ ! -f "$SOURCE_RUNNER" ]]; then
  echo "Missing runner: $SOURCE_RUNNER" >&2
  exit 1
fi
chmod +x "$SOURCE_RUNNER" 2>/dev/null || true
cp "$SOURCE_RUNNER" "$INSTALLED_RUNNER"
chmod +x "$INSTALLED_RUNNER"

# shellcheck disable=SC1091
[[ -s "$HOME/.nvm/nvm.sh" ]] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true

resolve_bin_dir() {
  local bin="$1"
  if command -v "$bin" >/dev/null 2>&1; then
    dirname "$(command -v "$bin")"
    return 0
  fi
  local candidate
  local nvm_dirs=("$HOME"/.nvm/versions/node/*/bin)
  for candidate in "${nvm_dirs[@]}" /opt/homebrew/bin /usr/local/bin; do
    if [[ -x "${candidate}/${bin}" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

EXTRA_PATH_PARTS=()
if NODE_BIN_DIR="$(resolve_bin_dir node)"; then
  EXTRA_PATH_PARTS+=("$NODE_BIN_DIR")
fi
if BUN_BIN_DIR="$(resolve_bin_dir bun)"; then
  EXTRA_PATH_PARTS+=("$BUN_BIN_DIR")
else
  EXTRA_PATH_PARTS+=("$HOME/.bun/bin")
fi
LAUNCH_PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
for part in "${EXTRA_PATH_PARTS[@]}"; do
  case ":$LAUNCH_PATH:" in
    *":$part:"*) ;;
    *) LAUNCH_PATH="${LAUNCH_PATH}:${part}" ;;
  esac
done

package_and_stage() {
  if [[ "${EXVA_HEADLESS_SKIP_PACKAGE:-}" == "1" && -x "$PACKAGED_APP_SRC/Contents/MacOS/exva" ]]; then
    echo "Skipping package (EXVA_HEADLESS_SKIP_PACKAGE=1); using existing $PACKAGED_APP_SRC"
  else
    echo "Packaging Exva (bun run package)…"
    (
      cd "$REPO_ROOT"
      export PATH="$LAUNCH_PATH"
      bun run package
    )
  fi
  if [[ ! -x "$PACKAGED_APP_SRC/Contents/MacOS/exva" ]]; then
    echo "Packaged app missing at $PACKAGED_APP_SRC" >&2
    exit 1
  fi
  echo "Staging packaged app → $PACKAGED_APP_DST"
  rm -rf "$PACKAGED_APP_DST"
  cp -R "$PACKAGED_APP_SRC" "$PACKAGED_APP_DST"
}

package_and_stage

if [[ ! -x "$PACKAGED_BIN" ]]; then
  echo "Staged binary missing: $PACKAGED_BIN" >&2
  exit 1
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
    <string>${INSTALLED_RUNNER}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${HOME}/.exva</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/headless.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/headless.stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>EXVA_HEADLESS</key>
    <string>1</string>
    <key>EXVA_REPO_ROOT</key>
    <string>${REPO_ROOT}</string>
    <key>EXVA_PACKAGED_BIN</key>
    <string>${PACKAGED_BIN}</string>
    <key>PATH</key>
    <string>${LAUNCH_PATH}</string>
  </dict>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/${LABEL}" 2>/dev/null || launchctl load "$PLIST"

echo "Installed ${PLIST}"
echo "Packaged binary: ${PACKAGED_BIN}"
echo "Runner: ${INSTALLED_RUNNER}"
echo "Headless logs: ${LOG_DIR}/headless.*.log"
echo "Uninstall with: bash scripts/headless/uninstall-launchd.sh"
echo ""
echo "Note: opening the Exva GUI takes over and stops headless (instance lock)."
echo "Verify: launchctl print \"gui/\$(id -u)/com.exva.headless\" | head -20"
echo "        cat ~/.exva/instance.lock"
