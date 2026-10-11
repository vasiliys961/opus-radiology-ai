#!/usr/bin/env python3
"""Opus Radiology AI: macOS chime once for each explicitly completed GitHub stage.

No external Python dependencies, API keys, microphones, patient files or browser tabs.
A stage is a MERGED PR whose body contains <!-- OPUS_STAGE_COMPLETE -->.
Run by launchd every three minutes. First run silently records earlier stages.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

REPO = "vasiliys961/opus-radiology-ai"
STAGE_MARKER = "<!-- OPUS_STAGE_COMPLETE -->"
API = "https://api.github.com/repos/" + REPO + "/pulls?state=closed&sort=updated&direction=desc&per_page=50"
APP_DIR = Path.home() / "Library" / "Application Support" / "OpusRadiologyAI"
STATE_FILE = APP_DIR / "stage-chime-state.json"
SOUNDS = (
    Path("/System/Library/Sounds/Glass.aiff"),
    Path("/System/Library/Sounds/Ping.aiff"),
    Path("/System/Library/Sounds/Pop.aiff"),
)


def fetch_pull_requests() -> list[dict[str, Any]]:
    request = urllib.request.Request(
        API,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "OpusRadiologyAI-stage-chime/1.0",
            "Cache-Control": "no-cache",
        },
    )
    with urllib.request.urlopen(request, timeout=18) as response:
        payload = json.load(response)
    if not isinstance(payload, list):
        raise ValueError("GitHub returned an unexpected API response")
    return [x for x in payload if isinstance(x, dict)]


def completed_stages(pulls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merged + explicit marker only: ordinary commits and PRs never ring."""
    results = []
    for pull in pulls:
        if not pull.get("merged_at"):
            continue
        if STAGE_MARKER not in (pull.get("body") or ""):
            continue
        number = pull.get("number")
        if not isinstance(number, int) or number < 1:
            continue
        results.append(pull)
    return sorted(results, key=lambda pr: (str(pr["merged_at"]), int(pr["number"])))


def load_seen(path: Path) -> set[int] | None:
    """None means first install; create baseline without ringing for old merges."""
    try:
        data = json.loads(path.read_text("utf-8"))
        if data.get("version") != 1 or not isinstance(data.get("seen"), list):
            raise ValueError("Invalid watcher state")
        values = data["seen"]
        if not all(isinstance(x, int) and x > 0 for x in values):
            raise ValueError("Invalid watcher state")
        return set(values)
    except FileNotFoundError:
        return None


def save_seen(path: Path, numbers: set[int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Write atomically, permission 0600, so crash/restart doesn't corrupt state.
    fd, tmp = tempfile.mkstemp(prefix=".stage-chime-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(
                {"version": 1, "seen": sorted(numbers),
                 "checked_at": datetime.now(timezone.utc).isoformat()},
                handle, ensure_ascii=False,
            )
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass


def chime() -> None:
    sound = next((p for p in SOUNDS if p.is_file()), None)
    if sound is None:
        raise FileNotFoundError("macOS system sounds were not found")
    subprocess.run(["/usr/bin/afplay", str(sound)], check=True, timeout=12)


def mac_notification(pr_number: int) -> None:
    """Notification is optional; chime works even if notifications are disabled."""
    message = f"Этап разработки завершён — GitHub PR #{pr_number}"
    # Quote a fixed-format message, never raw PR body/title from GitHub.
    escaped = message.replace("\\", "\\\\").replace('"', '\\"')
    script = 'display notification "' + escaped + '" with title "Opus Radiology AI"'
    try:
        subprocess.run(["/usr/bin/osascript", "-e", script],
                       check=False, timeout=8, capture_output=True)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass


def poll_once(
    state_path: Path = STATE_FILE,
    pull_fetcher: Callable[[], list[dict[str, Any]]] = fetch_pull_requests,
    bell: Callable[[], None] = chime,
    notifier: Callable[[int], None] = mac_notification,
) -> int:
    """Return how many new stages rang. Network failure does not touch saved state."""
    pulls = pull_fetcher()
    stages = completed_stages(pulls)
    seen = load_seen(state_path)
    if seen is None:
        save_seen(state_path, {int(x["number"]) for x in stages})
        print(f"Initial baseline: {len(stages)} earlier stages recorded (no sound).", flush=True)
        return 0
    newer = [stage for stage in stages if int(stage["number"]) not in seen]
    if not newer:
        print("No newly completed stages.", flush=True)
        return 0
    for stage in newer:
        number = int(stage["number"])
        # Mark before bell to avoid repeat rings after launchd restart.
        seen.add(number)
        save_seen(state_path, seen)
        try:
            bell()
            notifier(number)
            print(f"🔔 Stage completed: PR #{number}", flush=True)
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            # Keep state at-most-once; report so the user can test output volume.
            print(f"Stage #{number} recorded, but audio failed: {exc}", file=sys.stderr, flush=True)
    return len(newer)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--once", action="store_true", help="Poll GitHub and ring for new merged stages")
    group.add_argument("--test", action="store_true", help="Ring now to test Mac speakers (doesn't alter stage state)")
    group.add_argument("--status", action="store_true", help="Show the last watcher state")
    args = parser.parse_args()
    if args.test:
        chime()
        print("🔔 Test chime played via macOS afplay. Check output volume.", flush=True)
        return 0
    if args.status:
        seen = load_seen(STATE_FILE)
        print(json.dumps(
            {"installed": STATE_FILE.exists(), "recorded_stage_pr_numbers": sorted(seen or []),
             "state_path": str(STATE_FILE)}, ensure_ascii=False, indent=2))
        return 0
    try:
        poll_once()
    except (OSError, ValueError, urllib.error.URLError, json.JSONDecodeError) as exc:
        print(f"GitHub watcher error (retry on next interval): {exc}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
