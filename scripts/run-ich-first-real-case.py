#!/usr/bin/env python3
"""ONE real authorized public head-CT + pretrained SAMIHS + expert-mask evaluation.

External GPU research host only. Runs existing real SAMIHS trained adapter, 3D
expert comparison, native-slice audit, and 3D component localization. Produces a
COMPLETE manifest only after all outputs agree. No data, weights or models are
downloaded or trained; no patient data, remote API call, or Mac M1 job permitted.
An operator's rights attestation is NOT a substitute for legal permission.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlparse

COMPLETE_SCHEMA = "opus-ich-first-trained-public-case/v1"
SHA = re.compile(r"^[a-f0-9]{64}$")
MODEL_MASK = "samihs-public-ich-mask.nii.gz"
MODEL_REPORT = "opus-ich-samihs-public-report.json"


def validate_requested_case(args) -> None:
    # This command must never spin up heavyweight Torch on the user's 8GB Mac.
    if sys.platform == "darwin":
        raise ValueError("use_authorized_external_cuda_host_not_mac")
    if (args.public_research_authorization != "PUBLIC-ICH-FULL-CASE"
            or not args.rights_attested or not args.upstream_model_audited):
        raise ValueError("explicit_public_rights_and_audited_model_required")
    parsed = urlparse(args.dataset_citation_url)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment
            or len(args.dataset_citation_url) > 512):
        raise ValueError("public_dataset_citation_url_must_be_plain_https")
    if parsed.hostname in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("public_dataset_citation_required")
    for value in (args.source_sha256, args.reference_sha256,
                  args.checkpoint_sha256, args.wrapper_sha256):
        if not SHA.fullmatch(value):
            raise ValueError("all_four_immutable_source_and_model_sha256_required")
    if args.slice_axis not in (0, 1, 2) or args.batch_size not in (1, 2, 4, 8):
        raise ValueError("explicit_bounded_source_axis_and_batch_required")
    if not 0.05 <= args.threshold <= 0.95:
        raise ValueError("unsupported_model_threshold")
    if not 60 <= args.max_model_seconds <= 7200:
        raise ValueError("model_timeout_out_of_bounds")
    if not 1 <= args.reference_label <= 65535:
        raise ValueError("reference_positive_label_required")
    for path in (args.input, args.expert_mask):
        value = Path(path)
        if (value.is_symlink() or not value.is_file()
                or not value.name.endswith((".nii", ".nii.gz"))
                or not 0 < value.stat().st_size <= 512 * 1024 * 1024):
            raise ValueError("regular_bounded_nifti_required")
    output = Path(args.output_dir)
    if (output.exists() or output.is_symlink() or not output.parent.is_dir()
            or output.parent.is_symlink()):
        raise ValueError("new_isolated_result_directory_required")
    if Path(args.input).resolve() == Path(args.expert_mask).resolve():
        raise ValueError("ct_and_expert_mask_must_be_different")
    if Path(args.model_dir).is_symlink() or not Path(args.model_dir).is_dir():
        raise ValueError("audited_model_directory_required")
    if output.resolve() == Path(args.input).resolve().parent:
        raise ValueError("output_is_not_isolated_from_input")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as reader:
        for chunk in iter(lambda: reader.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()



def verify_original_expert_provenance(args, source: Path, derived_expert: Path):
    """Bind the derived binary expert mask to its ORIGINAL expert file/ontology.

    Called BEFORE expensive CUDA inference. All three optional paths are
    required together; unsupported or inconsistent manifests fail closed.
    Does not claim the author's ontology/clinical rights have been audited.
    """
    names = ("derived_expert_manifest", "original_expert_mask", "label_ontology_json")
    values = [getattr(args, name, None) for name in names]
    if not any(values):
        return None
    if not all(values):
        raise ValueError("derived_expert_provenance_requires_all_original_files")
    derived_manifest = Path(values[0])
    original = Path(values[1])
    ontology = Path(values[2])
    for file, limit in ((derived_manifest, 128 * 1024),
                        (original, 512 * 1024 * 1024), (ontology, 64 * 1024)):
        if (file.is_symlink() or not file.is_file()
                or not 0 < file.stat().st_size <= limit):
            raise ValueError("invalid_original_expert_provenance_file")
    if (not original.name.endswith((".nii", ".nii.gz"))
            or len({source, derived_expert, original.resolve()}) != 3
            or args.reference_label != 1):
        raise ValueError("derived_binary_expert_requires_original_and_label_one")
    m = json.loads(derived_manifest.read_text(encoding="utf-8"))
    o = json.loads(ontology.read_text(encoding="utf-8"))
    if not isinstance(m, dict) or not isinstance(o, dict):
        raise ValueError("invalid_original_expert_metadata")
    if (m.get("schema") != "opus-ich-expert-binary-union/v1"
            or m.get("status") != "derived_binary_union_from_operator_reviewed_expert_labelmap"
            or m.get("sourceCtSha256") != args.source_sha256
            or m.get("derivedBinaryMaskSha256") != args.reference_sha256
            or m.get("originalExpertMaskSha256") != sha256_file(original)
            or m.get("ontologySha256") != sha256_file(ontology)
            or m.get("ontologySourceUrl") != o.get("sourceUrl")
            or m.get("nativeGeometryMatched") is not True
            or m.get("resamplingPerformed") is not False
            or m.get("sourceDicomSopMapped") is not False
            or m.get("independentOntologyAuthenticityVerified") is not False
            or m.get("operatorAttestedSourceAndAnnotationRights") is not True
            or m.get("clinicalValidation") is not False):
        raise ValueError("derived_expert_and_original_mask_provenance_mismatch")
    from importlib.util import module_from_spec, spec_from_file_location
    label_script = Path(__file__).with_name("build-ich-expert-binary-union.py")
    if label_script.is_symlink() or not label_script.is_file():
        raise ValueError("missing_original_ontology_verifier")
    spec = spec_from_file_location("ich_union_ontology", label_script)
    verifier = module_from_spec(spec)
    spec.loader.exec_module(verifier)
    meaning = verifier.check_ontology(o)
    canonical = {str(k): meaning[k] for k in sorted(meaning)}
    counts = m.get("hemorrhageLabelVoxelCounts")
    if (m.get("hemorrhageLabelMeaning") != canonical
            or not isinstance(counts, dict) or set(counts) != set(canonical)
            or any(type(v) is not int or v < 0 for v in counts.values())
            or m.get("binaryPositiveVoxelCount") != sum(counts.values())
            or m["binaryPositiveVoxelCount"] < 0):
        raise ValueError("derived_expert_ontology_or_counts_inconsistent")
    return {
        "derivedFromMulticlassExpert": True,
        "originalExpertMaskSha256": m["originalExpertMaskSha256"],
        "originalOntologySha256": m["ontologySha256"],
        "originalOntologySourceUrl": m["ontologySourceUrl"],
        "derivedUnionManifestSha256": sha256_file(derived_manifest),
        "perHemorrhageClassVoxels": counts,
        "independentOntologyAuthenticityVerified": False,
    }


def executable(script: str) -> str:
    target = Path(__file__).resolve().with_name(script)
    if target.is_symlink() or not target.is_file():
        raise ValueError("missing_required_real_inference_script")
    return str(target)


def real_command(args, script, extra):
    command = [sys.executable, executable(script), *extra]
    # Suppress stdout and stderr from potentially sensitive upstream model code.
    subprocess.run(
        command, check=True, timeout=args.max_model_seconds + 300,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        env={**os.environ, "HF_HUB_OFFLINE":"1", "TRANSFORMERS_OFFLINE":"1"},
    )


def run(args):
    validate_requested_case(args)
    source = Path(args.input).resolve()
    expert = Path(args.expert_mask).resolve()
    out = Path(args.output_dir).resolve()
    if (sha256_file(source) != args.source_sha256
            or sha256_file(expert) != args.reference_sha256):
        raise ValueError("unverified_public_source_or_expert_annotation_sha256")
    original_expert = verify_original_expert_provenance(args, source, expert)

    real_command(args, "run-samihs-ich-public.py", [
        "--model-dir", str(Path(args.model_dir).resolve()),
        "--input", str(source), "--output-dir", str(out),
        "--source-sha256", args.source_sha256,
        "--checkpoint-sha256", args.checkpoint_sha256,
        "--wrapper-sha256", args.wrapper_sha256,
        "--slice-axis", str(args.slice_axis),
        "--batch-size", str(args.batch_size),
        "--threshold", str(args.threshold),
        "--device", "cuda:0",
        "--timeout-seconds", str(args.max_model_seconds),
        "--public-research-authorization", "PUBLIC-ICH-RESEARCH-ONLY",
    ])
    mask = out / MODEL_MASK
    inference = out / MODEL_REPORT
    comparison_file = out / "ich-expert-3d-comparison.json"
    component_file = out / "ich-expert-components.json"
    slice_comparison = out / "ich-expert-3d-for-slices.json"
    slice_file = out / "ich-expert-native-slices.json"

    common = [
        "--source", str(source), "--prediction", str(mask),
        "--reference", str(expert), "--report", str(inference),
        "--reference-sha256", args.reference_sha256,
        "--reference-label", str(args.reference_label),
        "--rights-attested",
        "--public-research-authorization", "PUBLIC-ICH-REFERENCE-REVIEW",
    ]
    real_command(args, "ich-expert-component-contact.py", [
        *common, "--output", str(comparison_file),
        "--component-output", str(component_file),
    ])
    real_command(args, "ich-native-slice-evidence.py", [
        *common, "--output", str(slice_comparison),
        "--slice-output", str(slice_file),
    ])

    model = json.loads(inference.read_text(encoding="utf-8"))
    compare = json.loads(comparison_file.read_text(encoding="utf-8"))
    components = json.loads(component_file.read_text(encoding="utf-8"))
    slices = json.loads(slice_file.read_text(encoding="utf-8"))
    second = json.loads(slice_comparison.read_text(encoding="utf-8"))

    hashes = compare["evidenceHashes"]
    if (model.get("researchStatus") != "trained_upstream_adapter_executed_public_only"
            or model["model"]["modelWeightsUsed"] is not True
            or model["model"]["checkpointSha256"] != args.checkpoint_sha256
            or model["model"]["wrapperSha256"] != args.wrapper_sha256
            or model["source"]["sha256"] != args.source_sha256
            or hashes["sourceSha256"] != args.source_sha256
            or hashes["expertMaskSha256"] != args.reference_sha256
            or hashes["predictionSha256"] != model["prediction"]["maskSha256"]
            or hashes["predictionSha256"] != sha256_file(mask)
            or components["evidenceHashes"] != hashes
            or slices["evidenceHashes"] != hashes
            or second["evidenceHashes"] != hashes
            or second["metrics"] != compare["metrics"]
            or model["source"]["geometry"]["sliceAxis"] != args.slice_axis
            or compare["caseCount"] != 1 or components["caseCount"] != 1
            or slices["caseCount"] != 1
            or compare["clinicalValidation"] is not False
            or components["clinicalValidation"] is not False
            or slices["clinicalValidation"] is not False):
        raise ValueError("model_source_and_independent_evidence_chain_mismatch")

    # Restore per-class expert information lost by binary union ONLY if the
    # original source ontology and original expert NIfTI are already verified.
    # This never assigns a hemorrhage subtype to a SAMIHS prediction.
    subtype_coverage = None
    subtype_file = out / "ich-original-expert-subtype-coverage.json"
    if original_expert is not None:
        import importlib.util
        module_file = Path(__file__).with_name("ich-expert-subtype-coverage.py")
        spec = importlib.util.spec_from_file_location("ich_subtype_coverage", module_file)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        subtype_coverage = mod.score_source_bound_case(
            source, mask, expert, Path(args.original_expert_mask),
            Path(args.label_ontology_json),
            original_expert["perHemorrhageClassVoxels"], compare["metrics"])
        subtype_file.write_text(
            json.dumps(subtype_coverage, ensure_ascii=False, indent=2), encoding="utf-8")

    # This file, unlike incomplete intermediate files, means all executables ran.
    complete = {
        "schema": COMPLETE_SCHEMA,
        "status": "real_trained_model_and_one_authorized_public_mask_pair_completed",
        "modelId": "samihs-ich-binary-ct",
        "sourceDatasetCitationUrl": args.dataset_citation_url,
        "legalRightsIndependentlyVerifiedByOpus": False,
        "operatorAttestedRights": True,
        "upstreamModelAuditAttested": True,
        "sourceNativeIndexGridMatch": True,
        "evidenceHashes": hashes,
        "expertMaskProvenance": original_expert if original_expert is not None else {
            "derivedFromMulticlassExpert": False,
            "originalExpertMaskSha256": args.reference_sha256,
            "sourceExpertMaskAuthenticityIndependentlyVerified": False,
        },
        "expertSubtypeCoverage": subtype_coverage,
        "checkpointSha256": args.checkpoint_sha256,
        "wrapperSha256": args.wrapper_sha256,
        "modelExecutionSeconds": model["execution"]["seconds"],
        "device": model["execution"]["device"],
        "inputFullVolumeProcessed": model["source"]["fullVolumeProcessed"],
        "metrics": {
            "dice": compare["metrics"]["dice"],
            "iou": compare["metrics"]["iou"],
            "hd95Mm": compare["metrics"]["hd95Mm"],
            "predictedVolumeMl": compare["metrics"]["predictedVolumeMl"],
            "expertMaskVolumeMl": compare["metrics"]["expertMaskVolumeMl"],
            "falseNegativeVoxels": compare["metrics"]["falseNegativeVoxels"],
            "falsePositiveVoxels": compare["metrics"]["falsePositiveVoxels"],
            "expertFragmentsWithoutContact": components["componentEvidence"]["expertFragmentsWithZeroOverlap"],
            "modelFragmentsWithoutContact": components["componentEvidence"]["predictedFragmentsWithZeroOverlap"],
            "expertPositiveSlicesWithoutOverlap": len(
                slices["sliceAudit"]["expertPositiveSlicesWithoutOverlap"]),
        },
        "files": {
            "modelMask": MODEL_MASK, "modelInference": MODEL_REPORT,
            "expertComparison": comparison_file.name,
            "componentContact": component_file.name,
            "sliceComparison": slice_comparison.name,
            "nativeSliceAudit": slice_file.name,
            "originalExpertSubtypeCoverage": subtype_file.name if subtype_coverage is not None else None,
        },
        "clinicalValidation": False,
        "heldOutFromTrainingProven": False,
        "originalDicomSopMapped": False,
        "publicPatientDataMustNotBePublished": True,
    }
    complete_path = out / "opus-ich-first-public-case-complete.json"
    complete_path.write_text(json.dumps(complete, ensure_ascii=False, indent=2),
                             encoding="utf-8")
    return complete


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("model-dir", "input", "expert-mask", "output-dir", "source-sha256",
                  "reference-sha256", "checkpoint-sha256", "wrapper-sha256",
                  "dataset-citation-url", "public-research-authorization"):
        parser.add_argument("--" + field, required=True)
    parser.add_argument("--derived-expert-manifest", default=None,
                        help="Binary expert union provenance JSON, with original mask and ontology")
    parser.add_argument("--original-expert-mask", default=None,
                        help="Unchanged original multiclass expert NIfTI")
    parser.add_argument("--label-ontology-json", default=None,
                        help="Original label dictionary used to construct the binary expert union")
    parser.add_argument("--slice-axis", type=int, choices=(0, 1, 2), required=True)
    parser.add_argument("--reference-label", type=int, default=1)
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--batch-size", type=int, choices=(1, 2, 4, 8), default=1)
    parser.add_argument("--max-model-seconds", type=int, default=3600)
    parser.add_argument("--rights-attested", action="store_true")
    parser.add_argument("--upstream-model-audited", action="store_true")
    args = parser.parse_args()
    try:
        report = run(args)
        print(json.dumps({
            "status": report["status"],
            "genuineModelRun": True,
            "dice": report["metrics"]["dice"],
            "hd95Mm": report["metrics"]["hd95Mm"],
            "expertFragmentsWithoutContact": report["metrics"]["expertFragmentsWithoutContact"],
            "clinicalValidation": False,
        }))
    except Exception as exc:
        # No raw paths, model logs, dataset identifiers or PHI in stdout/stderr.
        print("ICH case not completed: " + type(exc).__name__ + ": " +
              str(exc).split("/")[0][:120], file=sys.stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
