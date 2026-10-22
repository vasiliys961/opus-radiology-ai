#!/usr/bin/env python3
"""Check publisher Git LFS provenance for original NIH bone lesion nnU-Net folds.

This is NOT lesion inference. Refuse lightweight Git LFS pointer stubs as weights.
Downloads one genuine checkpoint only if --download-original is explicitly used.
"""
import argparse
import hashlib
import json
import urllib.request
from pathlib import Path

REPO = "NIH-MIP/DL_BoneModel2025"
PATH = "nnUNetTrainer__nnUNetPlans__3d_fullres"
API = f"https://api.github.com/repos/{REPO}"
MAX_CHECKPOINT = 2_500_000_000


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json", "User-Agent": "opus-research-audit"
    }), timeout=45) as response:
        return json.load(response)


def inspect_fold(revision, fold):
    item = get_json(f"{API}/contents/{PATH}/fold_{fold}/checkpoint_final.pth?ref={revision}")
    if item.get("size", 0) > 1024:
        raise ValueError("Expected Git LFS pointer metadata in GitHub content API")
    raw = f"https://raw.githubusercontent.com/{REPO}/{revision}/{PATH}/fold_{fold}/checkpoint_final.pth"
    with urllib.request.urlopen(raw, timeout=45) as response:
        head = response.read(250)
    text = head.decode("ascii", errors="replace")
    lines = dict(line.split(" ", 1) for line in text.splitlines()[1:] if " " in line)
    if not text.startswith("version https://git-lfs.github.com/spec/v1"):
        raise ValueError(f"fold{fold}: original Git LFS pointer format not verified")
    oid = lines.get("oid", "")
    size = int(lines.get("size", "0"))
    if not oid.startswith("sha256:") or len(oid) != 71 or not (1024 * 1024 < size < MAX_CHECKPOINT):
        raise ValueError("Invalid original checkpoint LFS sha or size")
    return {"fold": fold, "lfsSha256": oid.split(":")[1], "lfsBytes": size,
            "originalBytesChecked": False}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--download-original", action="store_true")
    a = p.parse_args()
    info = get_json(f"{API}/commits/main")
    revision = info["sha"]
    entries = [inspect_fold(revision, f) for f in range(5)]
    if a.download_original:
        for entry in entries[:1]:
            f = entry["fold"]
            url = f"https://media.githubusercontent.com/media/{REPO}/{revision}/{PATH}/fold_{f}/checkpoint_final.pth"
            h = hashlib.sha256()
            total = 0
            with urllib.request.urlopen(url, timeout=90) as resp:
                while chunk := resp.read(1024 * 1024):
                    h.update(chunk)
                    total += len(chunk)
                    if total > MAX_CHECKPOINT:
                        raise ValueError("Original LFS checkpoint exceeds admission cap")
            if total != entry["lfsBytes"] or h.hexdigest() != entry["lfsSha256"]:
                raise ValueError("Downloaded original bytes fail publisher LFS digest")
            entry["originalBytesChecked"] = True
    evidence = {"schema": "opus-nih-bone-ct-original-weights/v1",
                "publisher": REPO, "revision": revision,
                "target": "CT lytic/blastic benign/malignant bone lesion segmentation",
                "folds": entries, "positiveCaseForward": False,
                "clinicalValidation": False, "patientCloudTransfer": False}
    a.output.write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps(evidence))


if __name__ == "__main__":
    main()
