"""Resolve only own/direct-child RSS, including Linux outer /proc namespaces."""
import os
from pathlib import Path
import sys

import psutil


def own_pid():
    if sys.platform == "linux":
        # /proc/self is resolved by the kernel; unlike os.getpid(), its Pid may
        # belong to the namespace that the mounted /proc/psutil actually sees.
        for line in Path('/proc/self/status').read_text().splitlines():
            if line.startswith('Pid:'):
                return int(line.split(':', 1)[1])
        raise psutil.NoSuchProcess(os.getpid())
    return os.getpid()


def own_process():
    return psutil.Process(own_pid())


def child_process(pid):
    if own_pid() == os.getpid():
        return psutil.Process(pid)
    # Never interpret an inner child PID as an unrelated outer PID. Restrict
    # resolution to immediate children of this worker, without reading argv.
    for child in own_process().children():
        try:
            for line in Path(f'/proc/{child.pid}/status').read_text().splitlines():
                if line.startswith('NSpid:') and int(line.split()[-1]) == pid:
                    return child
        except (OSError, ValueError, psutil.Error):
            continue
    raise psutil.NoSuchProcess(pid)
