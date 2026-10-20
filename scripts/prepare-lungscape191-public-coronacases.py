#!/usr/bin/env python3
"""Admit one public CoronaCases chest CT + annotation for LungSCAPE research.

This does NOT run Model191 or score infection labels against high attenuation.
No actual CT pixels are included in JSON or CI artifacts. Treat original
upstream noncommercial license terms as governing if mirrors disagree.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys

DATASET = "MedOtter/covid19-ct-seg"
PUBLIC_CASES = tuple(f"coronacases_{i:03d}" for i in range(1, 11))
MAX_CT_BYTES = 240 * 1024**2
MAX_LABEL_BYTES = 30 * 1024**2
MAX_VOXELS = 512 * 512 * 512


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1048576), b""):
            h.update(block)
    return h.hexdigest()


def audit_pair(source, reference):
    import nibabel as nib
    import numpy as np

    for path, ceiling in ((source, MAX_CT_BYTES), (reference, MAX_LABEL_BYTES)):
        if not path.is_file() or not 1024 <= path.stat().st_size <= ceiling:
            raise ValueError("public NIfTI absent or exceeds bounded original file size")
    ct, expert = nib.load(str(source)), nib.load(str(reference))
    if (ct.ndim != 3 or expert.ndim != 3 or ct.shape != expert.shape
            or min(ct.shape) < 8 or max(ct.shape) > 1500
            or int(np.prod(ct.shape)) > MAX_VOXELS):
        raise ValueError("CT / annotation incompatible 3D shapes")
    if (not np.isfinite(ct.affine).all()
            or not np.isfinite(expert.affine).all()
            or abs(float(np.linalg.det(ct.affine[:3, :3]))) < 1e-8):
        raise ValueError("CT or annotation has nonfinite or degenerate affine")
    if not np.allclose(ct.affine, expert.affine, atol=1e-3, rtol=0):
        raise ValueError(
            "CT and expert annotation do not share physical geometry: "
            "sourceShape=" + repr(ct.shape) +
            " expertShape=" + repr(expert.shape) +
            " sourceUnit=" + repr(ct.header.get_xyzt_units()[0]) +
            " expertUnit=" + repr(expert.header.get_xyzt_units()[0]) +
            " sourceAffine=" + repr(ct.affine.round(4).tolist()) +
            " expertAffine=" + repr(expert.affine.round(4).tolist()) +
            " maxAffineDelta=" + str(float(np.max(np.abs(ct.affine - expert.affine)))))
    if expert.header.get_data_dtype().kind not in ("i", "u", "f"):
        raise ValueError("annotation not numeric")
    observed = {}
    for z in range(ct.shape[2]):
        ct_slice = np.asarray(ct.dataobj[:, :, z])
        mask_slice = np.asarray(expert.dataobj[:, :, z])
        if not np.isfinite(ct_slice).all() or not np.isfinite(mask_slice).all():
            raise ValueError("CT or annotation contains nonfinite values")
        if np.any(mask_slice != np.floor(mask_slice)):
            raise ValueError("annotation contains fractional labels")
        for v, n in zip(*np.unique(mask_slice, return_counts=True)):
            label = int(v)
            if label < 0 or label > 16:
                raise ValueError("unrecognized annotation integer labels")
            observed[str(label)] = observed.get(str(label), 0) + int(n)
    if not any(int(k) > 0 and n > 0 for k, n in observed.items()):
        raise ValueError("no positive expert annotation classes found")
    return {
        "sourceShape": list(ct.shape),
        "sourceSpatialUnit": ct.header.get_xyzt_units()[0],
        "expertSpatialUnit": expert.header.get_xyzt_units()[0],
        "spatialUnitCodesMatch": ct.header.get_xyzt_units()[0] == expert.header.get_xyzt_units()[0],
        "sourceMillimetresVerified": ct.header.get_xyzt_units()[0] == expert.header.get_xyzt_units()[0] == "mm",
        "nativePhysicalVolumesSuppressedWhenUnitsUnknown": True,
        "matchingSourceAndExpertNiftiGrid": True,
        "observedAnnotationValueCountsNoSemanticMapping": observed,
        "trainingOverlapWithOriginalNineCoronaCasesExcluded": False,
        "expertMaskSemanticallyEquivalentToHighAttenuation": False,
        "lesionDiceNotComputed": True,
        "truePretrainedModelForwardCompleted": False,
        "clinicalValidation": False,
    }


def fetch_case(case, directory):
    from huggingface_hub import HfApi, hf_hub_download

    if case not in PUBLIC_CASES:
        raise ValueError("not a published CoronaCases example")
    if directory.exists():
        raise ValueError("private output must not exist before download")
    dataset = HfApi().repo_info(DATASET, repo_type="dataset", token=False)
    rev = dataset.sha
    if len(rev) != 40 or any(c not in "0123456789abcdef" for c in rev):
        raise ValueError("public dataset revision not pinned")
    paths = {
        "CT": f"{case}.nii.gz",
        "combinedExpert": f"Lung_and_Infection_Mask/{case}.nii.gz",
    }
    sources = {k: Path(hf_hub_download(
        repo_id=DATASET, repo_type="dataset", filename=name,
        revision=rev, token=False)) for k, name in paths.items()}
    directory.mkdir(mode=0o700, parents=True)
    (directory / "in").mkdir(mode=0o700)
    (directory / "reference").mkdir(mode=0o700)
    # Raw original bytes are copied, never transposed, intensity-normalized,
    # or used as part of an inference mask input.
    ct = directory / "in" / "lungcase001_0000.nii.gz"
    expert = directory / "reference" / "lungcase001_expert.nii.gz"
    shutil.copyfile(sources["CT"], ct)
    shutil.copyfile(sources["combinedExpert"], expert)
    report = audit_pair(ct, expert)
    report.update({
        "schema": "opus-lungscape191-public-ct-admission/v1",
        "dataset": DATASET, "datasetRevisionSha": rev,
        "upstream": "Ma et al. COVID-19 CT Segmentation, Zenodo 3757476",
        "publicResearchCase": case,
        "rights": "Original upstream conditions require review; conservative noncommercial research only",
        "mirrorAdvertisedLicense": "CC BY 4.0",
        "originalBenchmarkAdvertisedLicense": "CC BY-NC-SA; conflicting terms: no commercial assertion",
        "sourceSha256": sha256(ct),
        "combinedExpertSha256": sha256(expert),
        "expertWasNotSuppliedToModel": True,
    })
    (directory / "numeric-public-ct-manifest.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return report


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--case", choices=PUBLIC_CASES, default="coronacases_003")
    ap.add_argument("--output-private", required=True, type=Path)
    ap.add_argument("--execute-download", action="store_true")
    a = ap.parse_args()
    if not a.execute_download:
        print("No download; use --execute-download for an explicitly public source case")
        return 0
    try:
        report = fetch_case(a.case, a.output_private.expanduser().resolve())
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0
    except (OSError, ValueError, ImportError, RuntimeError) as e:
        print("Public CoronaCases research source rejected: " + str(e), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
