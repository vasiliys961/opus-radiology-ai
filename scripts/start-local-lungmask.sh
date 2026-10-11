#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
install_requested=false
accepted=false
origin="http://localhost:3000"
profile="safe"
task_python="${OPUS_LUNGMASK_PYTHON:-python3}"
while (( $# )); do
  case "$1" in
    --install) install_requested=true; shift ;;
    --accept-research-license) accepted=true; shift ;;
    --origin) origin="$2"; shift 2 ;;
    --profile) profile="$2"; shift 2 ;;
    --python) task_python="$2"; shift 2 ;;
    *) echo "Use --install --accept-research-license [--python python3.11] [--profile safe|balanced] [--origin http://localhost:3000]" >&2; exit 2 ;;
  esac
done
if "$install_requested"; then
  if ! "$accepted"; then
    echo "Review docs/LOCAL_LUNGMASK_WORKER.md and add --accept-research-license for research-only installation." >&2
    exit 2
  fi
  if [[ -x .venv-lungmask/bin/python ]]; then task_python="$project_root/.venv-lungmask/bin/python"; fi
  "$task_python" -c 'import sys; assert (3,11) <= sys.version_info[:2] <= (3,12), "Use Python 3.11 or 3.12; pass --python python3.11"'
  if [[ ! -x .venv-lungmask/bin/python ]]; then "$task_python" -m venv .venv-lungmask; fi
  .venv-lungmask/bin/python -m pip install -r services/imaging-ai/requirements-lungmask.txt
  .venv-lungmask/bin/python -m pip check
  .venv-lungmask/bin/python scripts/install-r231.py --output "$HOME/Models/Opus/unet_r231.pth" --accept-research-license
fi
if [[ ! -x .venv-lungmask/bin/python ]]; then
  echo "Optional Lungmask environment missing. See docs/LOCAL_LUNGMASK_WORKER.md." >&2; exit 1
fi
exec .venv-lungmask/bin/python services/imaging-ai/worker.py --weights "$HOME/Models/Opus/unet_r231.pth" --origin "$origin" --profile "$profile"
