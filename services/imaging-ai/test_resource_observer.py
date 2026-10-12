"""Observer reports only aggregates and handles container PID namespaces."""
import json
import os
from pathlib import Path
import subprocess
import sys


def test_resource_observer_direct_parent_and_no_identifiers():
    script = Path(__file__).resolve().parents[2] / 'scripts/observe-r231-resources.py'
    process = subprocess.Popen([sys.executable, str(script), '--parent', str(os.getpid())],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    output, _ = process.communicate('stop\n', timeout=5)
    assert process.returncode == 0
    record = json.loads(output)
    assert record['samples'] >= 1
    assert record['minimumAvailableRamBytes'] >= 0
    assert record['peakProcessTreeRssBytes'] > 0
    assert record['peakSwapGrowthBytes'] == max(0, record['peakSwapUsedBytes'] - record['initialSwapUsedBytes'])
    assert record['finalSwapChangeBytes'] == record['finalSwapUsedBytes'] - record['initialSwapUsedBytes']
    assert not any(key in record for key in ('pid', 'processes', 'arguments', 'token', 'files'))
