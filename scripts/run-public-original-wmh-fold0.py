#!/usr/bin/env python3
"""Actual original WMH fold-0 CPU inference on publicly annotated Singapore/85 MRI.

Downloads no patient content; runs one authorized public WMH Challenge case.
No image, label, model weights, file paths or per-patient identifiers in artifacts.
Do not claim independent test data or clinical validity.
"""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
from types import SimpleNamespace

AUTHOR_FOLD0_SHA256 = "f7ef9747eb73ef8a927c07e4227bc4b9bfab761e0f7c60f2fd09ac9cf1a5fd3a"
PUBLIC_DATASET = "MedOtter/wmh-segmentation"
DATASET_DOI = "https://doi.org/10.34894/AECRSD"


def local_script(filename):
    path = Path(__file__).with_name(filename)
    spec = importlib.util.spec_from_file_location(filename.replace("-", "_").replace(".", "_"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(workdir: Path, report: Path):
    from huggingface_hub import hf_hub_download
    if not workdir.is_dir() or not report.parent.is_dir() or report.exists() or report.is_symlink():
        raise ValueError("fresh_private_worker_workspace_and_report_required")
    source = local_script("verify-public-wmh-expert-flair.py")
    provision = local_script("provision-real-author-wmh-fold0.py")
    engine = local_script("real-brain-flair-wmh-cpu.py")
    # The public downloader checks original SHA of each actual NIfTI,
    # native physical image/expert grid, bounded dimensions and WMH-positive label.
    metadata = source.execute()
    revision = metadata["sourceRevision"]
    if metadata["dataset"] != PUBLIC_DATASET or not metadata["sameNativePhysicalGrid"]:
        raise ValueError("untrusted_original_public_WMH_case")
    flair = Path(hf_hub_download(repo_id=PUBLIC_DATASET,repo_type="dataset",
                                 filename=source.FLAIR,revision=revision,token=False))
    expert = Path(hf_hub_download(repo_id=PUBLIC_DATASET,repo_type="dataset",
                                  filename=source.EXPERT,revision=revision,token=False))
    if engine.digest(flair) != metadata["sourceFLAIRSHA256"] or engine.digest(expert) != metadata["originalExpertWMHSHA256"]:
        raise ValueError("public_WMH_source_or_expert_hash_changed_between_checks")
    # hf_hub_download may return a cache symlink. Never weaken safe_scan():
    # copy only SHA-verified source bytes to fresh regular files on the
    # ephemeral isolated research worker, then hash the copies again.
    def verified_regular_copy(cache_path: Path, filename: str, expected: str) -> Path:
        target = workdir / filename
        if target.exists() or target.is_symlink() or cache_path.stat().st_size > 300*1024**2:
            raise ValueError("nonempty_or_unbounded_private_WMH_research_copy")
        with cache_path.open("rb") as inp, target.open("xb") as out:
            shutil.copyfileobj(inp, out, 1024*1024)
        if target.is_symlink() or not target.is_file() or engine.digest(target) != expected:
            raise ValueError("native_public_WMH_research_copy_SHA_mismatch")
        return target
    flair = verified_regular_copy(flair, "original-wmh-flair.nii.gz", metadata["sourceFLAIRSHA256"])
    expert = verified_regular_copy(expert, "original-wmh-expert.nii.gz", metadata["originalExpertWMHSHA256"])
    model = provision.provision(workdir/"original-author-fold0")
    if model["localCheckpointSHA256"] != AUTHOR_FOLD0_SHA256:
        raise ValueError("published_original_WMH_fold0_reproducible_SHA_mismatch")
    args = SimpleNamespace(
        approved_public_research=True,
        flair_protocol_confirmed=True,  # Annotated public archive's FLAIR path; no DICOM protocol audit
        public_source_url=f"https://huggingface.co/datasets/{PUBLIC_DATASET}/tree/{revision}",
        public_source_license="Non-commercial research only; original WMH Challenge CC BY-NC 4.0, mirror claims CC BY 4.0",
        flair=flair,
        flair_sha256=metadata["sourceFLAIRSHA256"],
        model_dir=workdir/"original-author-fold0",
        checkpoint_sha256=AUTHOR_FOLD0_SHA256,
        mask_out=workdir/"wmh-fold0-result.nii.gz",
        expert=expert,
        expert_sha256=metadata["originalExpertWMHSHA256"],
        rss_limit_gib=6.0, timeout_sec=1500)
    result = engine.execute(args)
    overlap = result["originalExpertOverlap"]
    if not result["realTrainedOriginalWMHModelForwardCompleted"] or not overlap:
        raise ValueError("genuine_original_WMH_positive_reference_forward_missing")
    result.update({
        "referenceDatasetDOI": DATASET_DOI,
        "mirrorRevision": revision,
        "originalPublicExpertWMHVoxels": metadata["expertPositiveVoxels"],
        "originalPublicExpertOtherPathologyVoxels": metadata["expertOtherPathologyVoxels"],
        "originalRightsConflictResolvedForCommercialUse": False,
        "evaluationTrainingIndependenceVerified": False,
        "realNativePublicFLAIRAndExpertVerified": True,
    })
    if result["originalPublicExpertWMHVoxels"] != overlap["tp"]+overlap["fn"]:
        raise ValueError("WMH_expert_voxel_count_inconsistent_with_scored_forward")
    # Only numeric evidence. Source, expert image, trained weights and predicted mask
    # remain on temporary GH runner disk; not copied into public artifacts.
    report.write_text(json.dumps(result,indent=2,ensure_ascii=False)+"\n")
    print(json.dumps({"realOriginalFold0":True,
                      "expertVoxels":result["originalPublicExpertWMHVoxels"],
                      "tp":overlap["tp"],"fp":overlap["fp"],"fn":overlap["fn"],
                      "dice":round(overlap["dice"],6),"clinicalValidation":False}))


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--workdir",type=Path,required=True)
    p.add_argument("--report",type=Path,required=True)
    a=p.parse_args()
    run(a.workdir,a.report)


if __name__=="__main__":
    main()
