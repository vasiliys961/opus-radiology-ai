#!/bin/bash
# Opus Radiology AI stage chime — Mac LaunchAgent installer.
# Requires Python 3; uses public GitHub metadata and macOS afplay.
set -euo pipefail

LABEL="com.opus.radiology.stage-chime"
APP_DIR="$HOME/Library/Application Support/OpusRadiologyAI"
AGENTS_DIR="$HOME/Library/LaunchAgents"
LOGS_DIR="$HOME/Library/Logs"
PLIST="$AGENTS_DIR/$LABEL.plist"
STATE="$APP_DIR/stage-chime-state.json"
RAW_BASE="https://raw.githubusercontent.com/vasiliys961/opus-radiology-ai/main/macos"

if [[ "$*" == "--uninstall" ]]; then
  /bin/launchctl bootout "gui/$(/usr/bin/id -u)" "$PLIST" >/dev/null 2>&1 || true
  /bin/rm -f "$PLIST" "$APP_DIR/stage_chime.py"
  printf 'Opus stage chime removed. Previous notification IDs remain in %s\n' "$STATE"
  exit 0
fi
if [[ "$*" != "" && "$*" != "--install" ]]; then
  printf 'Usage: bash install-stage-chime.sh [--install|--uninstall]\n' >&2
  exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
  printf 'Python 3 was not found. Install Python 3 and retry.\n' >&2
  exit 1
fi
PYTHON="$(command -v python3)"
if [[ "$PYTHON" != /* || ! -x "$PYTHON" ]]; then
  printf 'Python must resolve to an absolute executable path.\n' >&2
  exit 1
fi
/bin/mkdir -p "$APP_DIR" "$AGENTS_DIR" "$LOGS_DIR"
ORIGIN="$(cd "$(dirname "$0")" && /bin/pwd)"
if [[ -f "$ORIGIN/stage_chime.py" ]]; then
  /bin/cp "$ORIGIN/stage_chime.py" "$APP_DIR/stage_chime.py"
else
  printf 'Getting watcher from official public GitHub main branch...\n'
  /usr/bin/curl --fail --location --silent --show-error \
    "$RAW_BASE/stage_chime.py" --output "$APP_DIR/stage_chime.py"
fi
/bin/chmod 600 "$APP_DIR/stage_chime.py"

# Generate plist with Python to handle filenames containing spaces.
export OPUS_CHIME_PYTHON="$PYTHON"
export OPUS_CHIME_SCRIPT="$APP_DIR/stage_chime.py"
export OPUS_CHIME_LOG="$LOGS_DIR/OpusRadiologyAI-stage-chime.log"
export OPUS_CHIME_PLIST="$PLIST"
"$PYTHON" - <<'PY'
import os
import plistlib
from pathlib import Path
plist = {
    "Label": "com.opus.radiology.stage-chime",
    "ProgramArguments": [
        os.environ["OPUS_CHIME_PYTHON"], os.environ["OPUS_CHIME_SCRIPT"], "--once"
    ],
    "RunAtLoad": True,
    "StartInterval": 180,
    "StandardOutPath": os.environ["OPUS_CHIME_LOG"],
    "StandardErrorPath": os.environ["OPUS_CHIME_LOG"],
    "ProcessType": "Background",
}
path = Path(os.environ["OPUS_CHIME_PLIST"])
with path.open("wb") as handle:
    plistlib.dump(plist, handle)
path.chmod(0o644)
PY

/usr/bin/touch "$LOGS_DIR/OpusRadiologyAI-stage-chime.log"
/bin/launchctl bootout "gui/$(/usr/bin/id -u)" "$PLIST" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "gui/$(/usr/bin/id -u)" "$PLIST"

printf '\nOpus Radiology AI: stage chime installed.\n'
printf 'Polling GitHub every 3 minutes; only merged PRs with an explicit stage marker ring.\n'
printf 'Earlier completed stages will be silently remembered on first poll.\n'
printf '\nPlaying an immediate test chime through Mac speakers...\n'
"$PYTHON" "$APP_DIR/stage_chime.py" --test
printf '\nFor status: python3 "%s/stage_chime.py" --status\n' "$APP_DIR"
printf 'Logs: %s/OpusRadiologyAI-stage-chime.log\n' "$LOGS_DIR"
printf 'Uninstall: bash install-stage-chime.sh --uninstall\n'
