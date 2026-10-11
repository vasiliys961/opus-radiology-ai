#!/usr/bin/env python3
"""Explicit one-time official checkpoint acquisition; never called by inference."""
import argparse
from pathlib import Path
import os
import sys
import tempfile
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services/imaging-ai"))
from r231 import WEIGHTS_URL, check_weights


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--accept-research-license", action="store_true", required=True)
    args = parser.parse_args()
    destination = args.output.expanduser().absolute()
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if destination.exists() or destination.is_symlink():
        check_weights(destination)
        print("Official R231 already verified; no download.")
        return
    fd, temporary = tempfile.mkstemp(prefix="r231-", dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as stream, urllib.request.urlopen(WEIGHTS_URL, timeout=60) as response:
            count = 0
            while chunk := response.read(1024 * 1024):
                count += len(chunk)
                if count > 150 * 1024**2:
                    raise ValueError("Checkpoint exceeds download guard")
                stream.write(chunk)
        check_weights(temporary)
        # Exclusive final file, refusing overwrite/symlink races.
        os.link(temporary, destination)
        print("Official R231 installed; full SHA-256 verified.")
    finally:
        Path(temporary).unlink(missing_ok=True)


if __name__ == "__main__":
    main()
