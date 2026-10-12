#!/usr/bin/env bash
# Opt-in reproducible public reference test. No model/dependency auto-install.
set -euo pipefail
if [[ "${1:-}" != "--download-public-reference" || $# -gt 2 || ( $# -eq 2 && "$2" != "--full-series" ) ]]; then
  echo "Usage: bash scripts/test-r231-browser.sh --download-public-reference [--full-series]"
  echo "Downloads public CC BY 3.0 LCTSC; tests 32 slices by default or all 103 with --full-series; anatomy unverified."
  exit 2
fi
project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"
task_python="${OPUS_LUNGMASK_PYTHON:-$project_root/.venv-lungmask/bin/python}"
task_weights="${OPUS_R231_WEIGHTS:-$HOME/Models/Opus/unet_r231.pth}"
if [[ ! -x "$task_python" || ! -f "$task_weights" ]]; then
  echo "Install the separate R231 environment/checkpoint first: docs/LOCAL_LUNGMASK_WORKER.md"
  exit 2
fi
task_destination="${OPUS_R231_REFERENCE_RUN:-$HOME/Downloads/opus-r231-browser-$(date +%Y%m%d-%H%M%S)-$RANDOM}"
if [[ -e "$task_destination" ]]; then
  echo "Choose a new OPUS_R231_REFERENCE_RUN directory. Existing files are never overwritten."
  exit 2
fi
mkdir -m 700 "$task_destination"
"$task_python" scripts/download-r231-browser-reference.py --download-public-reference --output "$task_destination/reference" "${@:2}"
(
  cd web
  npm ci --no-audit --no-fund
  NEXT_TELEMETRY_DISABLED=1 npm run build
  npx playwright install chromium
)
node scripts/check-r231-browser.mjs --python "$task_python" --weights "$task_weights" \
  --reference "$task_destination/reference" --report "$task_destination/metrics.json" "${@:2}"
echo "Verification report: $task_destination/metrics.json"
echo "Public reference preserved locally; full-series tests all 103 supplied frames, anatomical completeness unverified. M1/Safari/total system RAM acceptance remains separate."
