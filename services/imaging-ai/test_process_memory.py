import os
from pathlib import Path
import subprocess
import sys
from unittest.mock import Mock

import psutil
import pytest
import process_memory as memory


def test_actual_own_and_direct_child_rss():
    own = memory.own_process()
    assert own.memory_info().rss > 0
    child = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(5)'])
    try:
        assert memory.child_process(child.pid).ppid() == own.pid
    finally:
        child.terminate()
        child.wait(timeout=5)


def test_namespace_collision_resolves_only_direct_child(monkeypatch):
    monkeypatch.setattr(memory, 'own_pid', lambda: os.getpid()+1000)
    expected = Mock(pid=54321)
    monkeypatch.setattr(memory, 'own_process', lambda: Mock(children=lambda:[expected]))
    monkeypatch.setattr(Path, 'read_text', lambda self:'NSpid:\t54321\t17\n')
    assert memory.child_process(17) is expected
    with pytest.raises(psutil.NoSuchProcess):
        memory.child_process(18)
