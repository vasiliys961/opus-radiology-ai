#!/usr/bin/env python3
"""Audit explicitly installed optional assets; prints technical data only, no downloads."""
import argparse
from pathlib import Path
import json
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'services/imaging-ai'))
from totalsegmentator_audit import audit

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--weights-root', type=Path, required=True)
    parser.add_argument('--config', type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(audit(args.weights_root,args.config),indent=2))
    except Exception:
        print(json.dumps({'schema':'opus-totalsegmentator-install-audit/v1','canRun':False,'error':'audit-failed'}))
        sys.exit(2)
