#!/usr/bin/env python3
"""One command: public original DICOM MR FLAIR -> genuine original WMH fold0 CPU.

No DICOM protocol guessing. An authorized research operator must independently
confirm FLAIR, deidentification and usage rights before invoking.
"""
from __future__ import annotations
import argparse,importlib.util,json,tempfile
from pathlib import Path
from types import SimpleNamespace
from mr_flair_dicom_to_nifti import convert_mr_flair

def load_runner():
    path=Path(__file__).resolve().parents[2]/"scripts/real-brain-flair-wmh-cpu.py"
    spec=importlib.util.spec_from_file_location("original_wmh_cpu",path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

def analyze(*,dicom_folder,model_dir,checkpoint_sha256,report,mask_out,
            public_source_url,public_source_license,authorized=False,
            flair_confirmed=False):
    if not authorized or not flair_confirmed:
        raise ValueError("independent_public_source_and_FLAIR_protocol_confirmation_required")
    if not public_source_url.startswith("https://") or not public_source_license.strip():
        raise ValueError("source_license_and_https_provenance_required")
    report=Path(report);mask_out=Path(mask_out)
    if report.exists() or mask_out.exists() or not report.parent.is_dir() or not mask_out.parent.is_dir():
        raise ValueError("new_results_in_existing_private_directory_required")
    with tempfile.TemporaryDirectory(prefix="opus-original-flair-") as directory:
        source=Path(directory)/"original-flair.nii"
        converted=convert_mr_flair(Path(dicom_folder),source)
        runner=load_runner()
        runner.safe_scan(source)
        args=SimpleNamespace(
            approved_public_research=True,flair_protocol_confirmed=True,
            public_source_url=public_source_url,public_source_license=public_source_license,
            flair=source,flair_sha256=converted["sha256"],
            model_dir=Path(model_dir),checkpoint_sha256=checkpoint_sha256,
            mask_out=mask_out,expert=None,expert_sha256=None,
            rss_limit_gib=6.0,timeout_sec=2400)
        result=runner.execute(args)
        if (result.get("realTrainedOriginalWMHModelForwardCompleted") is not True or
            result.get("sourceFLAIRSHA256")!=converted["sha256"] or
            result.get("checkpointSHA256")!=checkpoint_sha256.lower()):
            raise ValueError("true_model_output_did_not_match_converted_FLAIR_and_weights")
        report.write_text(json.dumps(result,indent=2)+"\n")
        return {"schema":"opus-native-dicom-flair-wmh/v1",
                "realOriginalModelForward":True,
                "sourceSha256":converted["sha256"],
                "candidateComponents":result["candidateComponentCount"],
                "clinicalValidation":False,"report":str(report)}
def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ("dicom-folder","model-dir","report","mask-out"):
        p.add_argument("--"+key,type=Path,required=True)
    for key in ("checkpoint-sha256","public-source-url","public-source-license"):
        p.add_argument("--"+key,required=True)
    p.add_argument("--approved-public-research",action="store_true")
    p.add_argument("--flair-protocol-confirmed",action="store_true")
    a=p.parse_args()
    print(json.dumps(analyze(dicom_folder=a.dicom_folder,model_dir=a.model_dir,
        checkpoint_sha256=a.checkpoint_sha256,report=a.report,
        mask_out=a.mask_out,public_source_url=a.public_source_url,
        public_source_license=a.public_source_license,
        authorized=a.approved_public_research,flair_confirmed=a.flair_protocol_confirmed)))
if __name__=="__main__":main()
