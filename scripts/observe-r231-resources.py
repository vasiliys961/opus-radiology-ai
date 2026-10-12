#!/usr/bin/env python3
"""1 Hz technical-only observation; no process names, arguments, files or tokens."""
import argparse
import json
import os
from pathlib import Path
import select
import sys

import psutil


def observe(parent):
    own_pid = os.getpid()
    fallback = False
    # Some Linux containers expose outer /proc PIDs to an inner PID namespace.
    # Follow only this observer's direct parent; never scan process arguments.
    if sys.platform == "linux":
        fields = dict(line.split(":", 1) for line in Path("/proc/self/status").read_text().splitlines() if ":" in line)
        own_pid = int(fields["Pid"])
        if own_pid != os.getpid():
            if parent != os.getppid():
                raise ValueError("Observer must follow its direct controller")
            parent = int(fields["PPid"])
            fallback = True
    owner = psutil.Process(parent)
    start_swap = psutil.swap_memory().used
    record = {"pidNamespaceFallback": fallback, "sampleIntervalSeconds": 1, "samples": 0, "minimumAvailableRamBytes": None,
              "peakProcessTreeRssBytes": 0, "initialSwapUsedBytes": start_swap,
              "peakSwapUsedBytes": start_swap, "finalSwapUsedBytes": start_swap,
              "limitations": ["Summed RSS double-counts shared pages; not private or physical memory.",
                              "System available RAM and swap include unrelated applications.",
                              "One-second sampling can miss short peaks; responsiveness is not evaluated."]}
    stopping = False
    while True:
        available = psutil.virtual_memory().available
        swap = psutil.swap_memory().used
        rss = 0
        try:
            processes = [owner, *owner.children(recursive=True)]
        except psutil.Error:
            break
        for process in processes:
            if process.pid == own_pid:
                continue
            try:
                rss += process.memory_info().rss
            except psutil.Error:
                pass
        record["samples"] += 1
        record["minimumAvailableRamBytes"] = min(available, record["minimumAvailableRamBytes"] or available)
        record["peakProcessTreeRssBytes"] = max(rss, record["peakProcessTreeRssBytes"])
        record["peakSwapUsedBytes"] = max(swap, record["peakSwapUsedBytes"])
        record["finalSwapUsedBytes"] = swap
        if stopping:
            break
        stopping = bool(select.select([sys.stdin], [], [], 1)[0])
    record["peakSwapGrowthBytes"] = max(0, record["peakSwapUsedBytes"] - start_swap)
    record["finalSwapChangeBytes"] = record["finalSwapUsedBytes"] - start_swap
    return record


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--parent", required=True, type=int)
    print(json.dumps(observe(parser.parse_args().parent)))
