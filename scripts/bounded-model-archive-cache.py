#!/usr/bin/env python3
"""Bounded, opt-in cache eviction for *verified downloadable model archives*.

Only regular direct-child .zip model archives registered in an explicit manifest
are eligible. Never touches DICOM, NIfTI, model runtime folders or active files.
Dry-run by default; execution requires --apply and reports freed bytes.
"""
import argparse
import json
from pathlib import Path

def plan_eviction(cache_dir, records, max_bytes, active_ids=()):
    root = Path(cache_dir).resolve(strict=True)
    if not root.is_dir() or max_bytes < 0:
        raise ValueError("invalid cache root or budget")
    active = set(active_ids)
    candidates = []
    seen = set()
    total = 0
    for record in records:
        mid, name = record["id"], record["filename"]
        if mid in seen or mid.count("/") or name != Path(name).name or not name.endswith(".zip"):
            raise ValueError("unsafe or duplicate model archive")
        seen.add(mid)
        p = root / name
        if p.is_symlink() or not p.is_file() or p.parent.resolve() != root:
            raise ValueError("model cache entry missing or unsafe")
        size = p.stat().st_size
        if size != record["bytes"] or not 0 <= size <= 30_000_000_000:
            raise ValueError("unexpected archive size")
        total += size
        candidates.append((record.get("lastUsedUnix", 0), mid, p, size))
    excess = max(0, total - max_bytes)
    evict = []
    for _, mid, p, size in sorted(candidates):
        if excess <= 0:
            break
        if mid in active:
            continue
        evict.append({"id": mid, "filename": p.name, "bytes": size})
        excess -= size
    return {"beforeBytes": total, "budgetBytes": max_bytes,
            "evict": evict, "afterBytes": total - sum(x["bytes"] for x in evict),
            "unresolvedExcessBytes": max(0, excess), "activeProtected": sorted(active)}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--max-gib", type=int, default=10)
    parser.add_argument("--active", action="append", default=[])
    parser.add_argument("--apply", action="store_true")
    a = parser.parse_args()
    if not 1 <= a.max_gib <= 1000:
        raise ValueError("budget must be between 1 and 1000 GiB")
    records = json.loads(Path(a.manifest).read_text())["archives"]
    result = plan_eviction(a.cache_dir, records, a.max_gib * 1024**3, a.active)
    if a.apply:
        if result["unresolvedExcessBytes"]:
            raise RuntimeError("cache exceeds budget but active archives cannot be evicted safely")
        root = Path(a.cache_dir).resolve(strict=True)
        for item in result["evict"]:
            file = root / item["filename"]
            if file.is_symlink() or not file.is_file() or file.stat().st_size != item["bytes"]:
                raise RuntimeError("archive changed since plan")
            file.unlink()
    print(json.dumps({**result, "applied": bool(a.apply)}, indent=2))

if __name__ == "__main__":
    main()
