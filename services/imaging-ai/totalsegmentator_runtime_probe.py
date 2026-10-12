"""Package/version probe: no model import, weights download, image load, or inference."""
import argparse
import importlib.metadata
import json
import sys

PINNED = {"torch": "2.6.0", "TotalSegmentator": "2.18.0"}

def inspect_runtime(version_lookup=importlib.metadata.version):
    versions = {}
    for name, expected in PINNED.items():
        try:
            actual = version_lookup(name)
        except importlib.metadata.PackageNotFoundError:
            actual = None
        versions[name] = {"installed": actual, "expected": expected,
                          "matched": actual is not None and actual.split("+", 1)[0] == expected}
    return {"schema": "opus-totalsegmentator-runtime-probe/v1",
            "packages": versions, "dependenciesReady": all(x["matched"] for x in versions.values()),
            "weightsVerified": False, "hardwareBenchmarked": False,
            "inferenceEnabled": False, "clinicalStatus": "not_validated"}

def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-only", action="store_true", required=True)
    args = parser.parse_args(argv)
    report = inspect_runtime()
    print(json.dumps(report, sort_keys=True))
    return 0 if report["dependenciesReady"] else 2

if __name__ == "__main__":
    sys.exit(main())
