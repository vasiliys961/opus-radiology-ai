#!/usr/bin/env python3
"""No-network tests for the stage watcher. Safe to run on Linux CI or macOS."""
from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

MODULE = Path(__file__).resolve().with_name("stage_chime.py")
SPEC = importlib.util.spec_from_file_location("stage_chime", MODULE)
assert SPEC and SPEC.loader
chime = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(chime)


def pr(number: int, *, merged: bool = True, complete: bool = True) -> dict:
    return {
        "number": number,
        "merged_at": "2026-10-11T10:10:00Z" if merged else None,
        "body": "Done and accepted\n" + chime.STAGE_MARKER if complete else "Work in progress",
        "title": "Test stage",
    }


class StageChimeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name) / "App Data" / "state.json"
        self.bell = Mock()
        self.notify = Mock()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_first_poll_baselines_previous_stages_silently(self) -> None:
        pulls = [pr(4), pr(5), pr(6, merged=False)]
        result = chime.poll_once(self.state, lambda: pulls, self.bell, self.notify)
        self.assertEqual(result, 0)
        self.assertEqual(chime.load_seen(self.state), {4, 5})
        self.bell.assert_not_called()
        self.notify.assert_not_called()

    def test_newly_merged_marked_stage_rings_once_only(self) -> None:
        chime.poll_once(self.state, lambda: [pr(4)], self.bell, self.notify)
        new = [pr(4), pr(5), pr(8, complete=False), pr(9, merged=False)]
        self.assertEqual(chime.poll_once(self.state, lambda: new, self.bell, self.notify), 1)
        self.assertEqual(chime.poll_once(self.state, lambda: new, self.bell, self.notify), 0)
        self.bell.assert_called_once()
        self.notify.assert_called_once_with(5)
        self.assertEqual(chime.load_seen(self.state), {4, 5})

    def test_commits_unmarked_and_open_prs_do_not_ring(self) -> None:
        chime.poll_once(self.state, lambda: [], self.bell, self.notify)
        self.assertEqual(chime.poll_once(self.state, lambda: [
            pr(4, complete=False), pr(5, merged=False),
        ], self.bell, self.notify), 0)
        self.bell.assert_not_called()

    def test_multiple_stages_ring_in_completion_order(self) -> None:
        chime.poll_once(self.state, lambda: [], self.bell, self.notify)
        newer = [pr(8), pr(7), pr(6, complete=False)]
        self.assertEqual(chime.poll_once(self.state, lambda: newer, self.bell, self.notify), 2)
        self.assertEqual(self.notify.call_args_list[0].args, (7,))
        self.assertEqual(self.notify.call_args_list[1].args, (8,))

    def test_network_failure_never_corrupts_history(self) -> None:
        chime.poll_once(self.state, lambda: [pr(4)], self.bell, self.notify)
        before = self.state.read_bytes()
        def offline() -> list[dict]:
            raise OSError("Network offline")
        with self.assertRaises(OSError):
            chime.poll_once(self.state, offline, self.bell, self.notify)
        self.assertEqual(self.state.read_bytes(), before)

    def test_no_repeat_after_transient_audio_failure(self) -> None:
        chime.poll_once(self.state, lambda: [], self.bell, self.notify)
        failing = Mock(side_effect=OSError("Speaker not accessible"))
        self.assertEqual(chime.poll_once(
            self.state, lambda: [pr(11)], failing, self.notify,
        ), 1)
        self.assertEqual(chime.poll_once(self.state, lambda: [pr(11)], self.bell, self.notify), 0)
        self.assertEqual(chime.load_seen(self.state), {11})
        self.bell.assert_not_called()

    def test_malformed_state_fails_closed(self) -> None:
        self.state.parent.mkdir(parents=True, exist_ok=True)
        self.state.write_text(json.dumps({"version": 2, "seen": [11]}), encoding="utf-8")
        with self.assertRaises(ValueError):
            chime.poll_once(self.state, lambda: [pr(12)], self.bell, self.notify)
        self.bell.assert_not_called()


if __name__ == "__main__":
    unittest.main()
