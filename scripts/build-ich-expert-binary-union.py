#!/usr/bin/env python3
"""Derive a binary ICH expert union from an authorized multiclass source mask.

Converts only EXPLICITLY source-documented hemorrhage label IDs (IPH, IVH, SAH,
SDH, EDH). Rejects unknown nonzero IDs, mismatched source grids, and ambiguity.
No inferred hemorrhage type, model inference, resampling or invented annotation.
Only runs on external research Linux, never automatically on Mac M1.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
from pathlib import Path
import re
import sys
from urllib.parse import urlparse

CATEGORIES = frozenset(("IPH", "IVH", "SAH", "SDH", "EDH"))
SCHEMA = "opus-ich-expert-binary-union/v1"
MAX_VOXELS = 30_000_000


def evaluator_module():
    source = Path(__file__).with_name("evaluate-ich-public-mask.py")
    spec = importlib.util.spec_from_file_location("ich_reference", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def check_ontology(data):
    if not isinstance(data, dict) or set(data) != {"sourceUrl", "labelMeaning"}:
        raise ValueError("original_dataset_label_ontology_required")
    url = data["sourceUrl"]
    if not isinstance(url, str) or len(url) > 512:
        raise ValueError("original_label_documentation_url_required")
    parsed = urlparse(url)
    if (parsed.scheme != "https" or not parsed.hostname
            or parsed.username or parsed.password or parsed.query or parsed.fragment):
        raise ValueError("original_label_documentation_https_required")
    mapping = data["labelMeaning"]
    if not isinstance(mapping, dict) or not 1 <= len(mapping) <= 32:
        raise ValueError("explicit_hemorrhage_label_meanings_required")
    parsed_mapping = {}
    for label, subtype in mapping.items():
        if (not isinstance(label, str) or not re.fullmatch(r"[1-9][0-9]{0,4}", label)
                or int(label) > 65535 or subtype not in CATEGORIES):
            raise ValueError("unsupported_or_undocumented_hemorrhage_label")
        parsed_mapping[int(label)] = subtype
    return parsed_mapping


def binary_union(source_labels, meaning):
    import numpy as np
    if (source_labels.ndim != 3 or math.prod(source_labels.shape) > MAX_VOXELS
            or source_labels.dtype.kind not in "iu"):
        raise ValueError("bounded_integer_3d_reference_required")
    unique = np.unique(source_labels)
    if any(int(v) < 0 or int(v) > 65535 or
           (int(v) and int(v) not in meaning) for v in unique):
        raise ValueError("unknown_nonzero_label_refuse_to_guess_hemorrhage_status")
    binary = np.isin(source_labels, tuple(meaning)).astype(np.uint8)
    counts = {str(label):int(np.count_nonzero(source_labels == label))
              for label in sorted(meaning)}
    return binary, counts


def run(args):
    if sys.platform == "darwin":
        raise ValueError("use_external_research_host_not_mac")
    if (args.public_research_authorization != "PUBLIC-ICH-LABEL-UNION"
            or not args.rights_attested or not args.ontology_reviewed):
        raise ValueError("explicit_source_rights_and_label_ontology_review_required")
    evaluator = evaluator_module()
    source = evaluator.check_file(Path(args.source_ct))
    expert = evaluator.check_file(Path(args.expert_labelmap))
    if source == expert:
        raise ValueError("source_ct_and_labelmap_must_be_separate")
    if (evaluator.sha256(source) != evaluator.check_sha(args.source_sha256)
            or evaluator.sha256(expert) != evaluator.check_sha(args.expert_sha256)):
        raise ValueError("source_or_expert_original_sha256_mismatch")
    ontology_path = Path(args.label_ontology_json)
    if (ontology_path.is_symlink() or not ontology_path.is_file()
            or not 0 < ontology_path.stat().st_size <= 64 * 1024):
        raise ValueError("bounded_original_ontology_json_required")
    ontology = json.loads(ontology_path.read_text(encoding="utf-8"))
    meanings = check_ontology(ontology)

    ct_nii, ct_affine, voxel_ml = evaluator.load_geometry(source)
    label_nii, label_affine, label_ml = evaluator.load_geometry(expert, ct_nii.shape)
    if math.prod(ct_nii.shape) > MAX_VOXELS or abs(voxel_ml-label_ml)>1e-6:
        raise ValueError("bounded_native_voxel_grid_required")
    evaluator.assert_same_grid(ct_affine,label_affine,ct_nii.shape)
    import nibabel as nib
    import numpy as np

    dtype = label_nii.header.get_data_dtype()
    if dtype.kind not in "iu":
        raise ValueError("expert_reference_must_have_integer_label_data")
    proxy = label_nii.dataobj
    if not math.isclose(float(proxy.slope), 1., abs_tol=1e-9) or not math.isclose(
            float(proxy.inter), 0., abs_tol=1e-9):
        raise ValueError("scaled_source_expert_labels_cannot_be_trusted")
    array = np.asanyarray(proxy)
    binary, counts = binary_union(array, meanings)
    outmask, outmanifest = Path(args.output_mask), Path(args.manifest)
    if (outmask.exists() or outmask.is_symlink() or outmanifest.exists()
            or outmanifest.is_symlink() or not outmask.parent.is_dir()
            or not outmanifest.parent.is_dir() or
            outmask.parent.is_symlink() or outmanifest.parent.is_symlink()
            or outmask.resolve() == outmanifest.resolve() or
            not outmask.name.endswith((".nii", ".nii.gz"))):
        raise ValueError("new_distinct_derived_mask_and_manifest_required")
    img = nib.Nifti1Image(binary, label_affine, header=label_nii.header.copy())
    img.header.set_data_dtype(np.uint8)
    img.header.set_slope_inter(1.,0.)
    img.header.set_xyzt_units("mm")
    img.set_sform(label_affine, code=int(label_nii.header["sform_code"]))
    img.set_qform(label_affine, code=int(label_nii.header["qform_code"]))
    nib.save(img, str(outmask))
    # Verify written output geometry and exact binary voxels again.
    read,read_affine,_ = evaluator.load_geometry(evaluator.check_file(outmask),ct_nii.shape)
    evaluator.assert_same_grid(ct_affine,read_affine,ct_nii.shape)
    derived = evaluator.binary_mask(read, label=1)
    if not np.array_equal(derived, binary.astype(bool)):
        outmask.unlink(missing_ok=True)
        raise ValueError("persisted_binary_union_did_not_match_source_labels")
    output = {
        "schema": SCHEMA,
        "status": "derived_binary_union_from_operator_reviewed_expert_labelmap",
        "sourceCtSha256": args.source_sha256,
        "originalExpertMaskSha256": args.expert_sha256,
        "derivedBinaryMaskSha256": evaluator.sha256(outmask),
        "ontologySourceUrl": ontology["sourceUrl"],
        "ontologySha256": evaluator.sha256(ontology_path),
        "hemorrhageLabelMeaning": {str(k):meanings[k] for k in sorted(meanings)},
        "hemorrhageLabelVoxelCounts": counts,
        "binaryPositiveVoxelCount": int(np.count_nonzero(binary)),
        "nativeGeometryMatched": True,
        "resamplingPerformed": False,
        "sourceDicomSopMapped": False,
        "independentOntologyAuthenticityVerified": False,
        "operatorAttestedSourceAndAnnotationRights": True,
        "clinicalValidation": False,
        "limitations": [
            "The binary union is a derived expert mask, not an original radiologist annotation.",
            "Source dataset ontology must be manually checked; the program cannot prove class names.",
            "Binary union deliberately discards subtype labels for comparison with binary SAMIHS.",
            "No patient/cloud processing, diagnosis, missing-ICH conclusion or model inference."
        ]
    }
    outmanifest.write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding="utf-8")
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("source-ct","expert-labelmap","label-ontology-json","output-mask",
                  "manifest","source-sha256","expert-sha256","public-research-authorization"):
        parser.add_argument("--"+field,required=True)
    parser.add_argument("--rights-attested",action="store_true")
    parser.add_argument("--ontology-reviewed",action="store_true")
    args=parser.parse_args()
    try:
        out=run(args)
        print(json.dumps({
            "status":out["status"],"binaryVoxels":out["binaryPositiveVoxelCount"],
            "sourceBound":True,"clinicalValidation":False
        }))
    except Exception as exc:
        print("ICH expert union not completed: "+type(exc).__name__+": "+
              str(exc).split("/")[0][:120],file=sys.stderr)
        raise SystemExit(2)


if __name__=="__main__":
    main()
