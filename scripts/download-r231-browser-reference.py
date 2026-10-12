#!/usr/bin/env python3
"""Opt-in TCIA LCTSC reference: 32 unchanged central slices, NOT full chest.

Pixels remain outside the repository. This downloads public de-identified data,
not user patient files. CC BY 3.0 attribution: docs/R231_BROWSER_REFERENCE.md.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import tempfile
import urllib.request
import zipfile

import numpy as np
import pydicom

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://services.cancerimagingarchive.net/nbia-api/services/v1/"
# Public archive identifier, not a user/patient identifier.
SERIES = "1.3.6.1.4.1.14519.5.2.1.7014.4598.513033543073296044615683479554"
CONTENT_CHAIN = "bb4b90496cf2d83dac83e729ef271091962d532a18db201c6e2d99d42dcb5f61"
FIRST, COUNT, TOTAL = 35, 32, 103


def nifti_header(affine, count=COUNT):
    h = bytearray(352)
    struct.pack_into("<i", h, 0, 348)
    struct.pack_into("<4h", h, 40, 3, 512, 512, count)
    struct.pack_into("<hh", h, 70, 16, 32)
    struct.pack_into("<4f", h, 76, 1, abs(affine[0]), abs(affine[5]), abs(affine[10]))
    struct.pack_into("<ff", h, 108, 352, 1)
    h[123] = 2
    struct.pack_into("<h", h, 254, 1)
    struct.pack_into("<12f", h, 280, *[-float(v) if i < 8 else float(v) for i, v in enumerate(affine)])
    h[344:348] = b"n+1\0"
    return h


def prepare(archive, output, full_series=False):
    output = Path(output).resolve()
    if output.is_relative_to(ROOT) or output.exists():
        raise ValueError("Choose a new directory outside the repository")
    with zipfile.ZipFile(archive) as z:
        entries = z.infolist()
        if len(entries) != TOTAL + 1 or sum(e.file_size for e in entries) > 60 * 1024**2:
            raise ValueError("Unexpected archive size/count")
        frames = []
        for e in entries:
            if not e.filename.endswith(".dcm"):
                if e.filename != "LICENSE":
                    raise ValueError("Unexpected archive member")
                continue
            if e.file_size > 2 * 1024**2:
                raise ValueError("Unexpected DICOM size")
            with z.open(e) as stream:
                d = pydicom.dcmread(stream, stop_before_pixels=True)
            if (d.Modality != "CT" or str(d.SeriesInstanceUID) != SERIES
                    or (d.Rows, d.Columns) != (512, 512)
                    or list(map(float, d.ImageOrientationPatient)) != [1, 0, 0, 0, 1, 0]
                    or float(d.RescaleSlope) != 1 or float(d.RescaleIntercept) != -1000):
                raise ValueError("Unsupported reference technical metadata")
            frames.append((float(d.ImagePositionPatient[2]), e, d))
        frames.sort(key=lambda f: f[0])
        if len(frames) != TOTAL or len({str(f[2].SOPInstanceUID) for f in frames}) != TOTAL:
            raise ValueError("Missing or duplicate source frame")
        if not np.allclose(np.diff([f[0] for f in frames]), 3, atol=1e-6):
            raise ValueError("Unexpected source spacing")
        hashes = [hashlib.sha256(z.read(e)).digest() for _, e, _ in frames]
        if hashlib.sha256(b"".join(hashes)).hexdigest() != CONTENT_CHAIN:
            raise ValueError("Reference DICOM content changed; review before use")
        first_index, count = (0, TOTAL) if full_series else (FIRST, COUNT)
        chosen = frames[first_index:first_index+count]
        first = chosen[0][2]
        candidates = []
        for reverse in (False, True):
            ordered = list(reversed(chosen)) if reverse else chosen
            origin = list(map(float, ordered[0][2].ImagePositionPatient))
            affine = [float(first.PixelSpacing[1]), 0, 0, origin[0], 0, float(first.PixelSpacing[0]), 0, origin[1], 0, 0, -3 if reverse else 3, origin[2]]
            digest = hashlib.sha256(nifti_header(affine, count))
            for _, e, _ in ordered:
                with z.open(e) as stream:
                    d = pydicom.dcmread(stream)
                hu = d.pixel_array.astype(np.float32) - 1000
                if not np.isfinite(hu).all() or hu.min() < -2048 or hu.max() > 65535:
                    raise ValueError("Unsupported reference quantitative values")
                digest.update(hu.astype("<f4").tobytes())
            candidates.append({"affineLps": affine, "inputSha256": digest.hexdigest()})
        # Never extract arbitrary ZIP paths; write only pinned, unmodified bytes.
        output.mkdir(mode=0o700)
        (output / "dicom").mkdir(mode=0o700)
        for i, (_, e, _) in enumerate(chosen):
            (output / "dicom" / f"reference-{i:03}.dcm").write_bytes(z.read(e))
        manifest = {"schema": "opus-r231-browser-reference/v1", "collection": "TCIA LCTSC",
                    "license": "CC BY 3.0", "collectionUrl": "https://www.cancerimagingarchive.net/collection/lctsc/",
                    "doi": "10.7937/K9/TCIA.2017.3R3FVZ08", "sourceContentChainSha256": CONTENT_CHAIN,
                    "originalFrames": TOTAL, "selectedFrames": count,
                    "selectedIndicesZeroBased": [first_index, first_index+count-1], "fullChest": False,
                    "allSourceFrames": full_series,
                    "selection": (f"All {TOTAL} unchanged source frames; anatomical completeness unverified" if full_series else
                                  "32 unchanged consecutive central source slices; no resampling, pixel crop or repeated frames"),
                    "dimensions": [512, 512, count], "niftiCandidates": candidates,
                    "selectedFileSha256": [h.hex() for h in hashes[first_index:first_index+count]]}
        (output / "reference.json").write_text(json.dumps(manifest, indent=2))
        return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--full-series", action="store_true", help="Prepare all 103 source frames for the separate full-CT v2 UI; not a clinical coverage claim")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--download-public-reference", action="store_true")
    source.add_argument("--archive", type=Path, help="Previously downloaded public reference ZIP; content still verified")
    args = parser.parse_args()
    if args.archive:
        manifest = prepare(args.archive, args.output, args.full_series)
    else:
        metadata = json.load(urllib.request.urlopen(BASE+"getSeries?SeriesInstanceUID="+SERIES, timeout=30))
        if len(metadata) != 1 or metadata[0].get("Collection") != "LCTSC" or metadata[0].get("LicenseURI") != "http://creativecommons.org/licenses/by/3.0/":
            raise ValueError("Public reference licence/source changed; review required")
        with tempfile.TemporaryDirectory(prefix="opus-public-reference-") as temporary:
            archive = Path(temporary) / "reference.zip"
            with urllib.request.urlopen(BASE+"getImage?SeriesInstanceUID="+SERIES, timeout=45) as response, archive.open("xb") as stream:
                size = 0
                for chunk in iter(lambda: response.read(1024*1024), b""):
                    size += len(chunk)
                    if size > 30 * 1024**2:
                        raise ValueError("Reference download limit")
                    stream.write(chunk)
            manifest = prepare(archive, args.output, args.full_series)
    print(json.dumps({"status": "prepared", "originalFrames": TOTAL, "selectedFrames": manifest["selectedFrames"],
                      "fullChest": False, "sourceContentChainSha256": manifest["sourceContentChainSha256"]}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import sys
        print("Public reference preparation failed; check archive, licence and a new external destination.", file=sys.stderr)
        sys.exit(1)
