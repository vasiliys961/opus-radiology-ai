#!/usr/bin/env python3
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/"services"/"imaging-ai"))
from totalsegmentator_fetch import main
if __name__ == "__main__":
    raise SystemExit(main())
