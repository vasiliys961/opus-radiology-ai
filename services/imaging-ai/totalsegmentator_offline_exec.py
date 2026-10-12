"""Opt-in TotalSegmentator CT fast executor, intended ONLY for network-isolated container."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

def run(input_path, output_path, *, confirmed=False, expected_source_sha=None):
    if not confirmed:
        raise ValueError("explicit_research_confirmation_required")
    source, output = Path(input_path), Path(output_path)
    if (source.is_symlink() or not source.is_file() or output.exists() or
            output.is_symlink() or source.resolve() == output.resolve() or
            source.suffix != ".nii" or output.suffix != ".nii"):
        raise ValueError("invalid_paths")
    import nibabel as nib
    img = nib.load(str(source), mmap=True)
    dims = tuple(int(n) for n in img.shape)
    if len(dims)!=3 or any(n<1 or n>cap for n,cap in zip(dims,(512,512,300))):
        raise ValueError("unsupported_input_shape")
    sha=hashlib.sha256()
    with source.open("rb") as f:
        while part:=f.read(131072):
            sha.update(part)
    source_sha=sha.hexdigest()
    if expected_source_sha is not None and source_sha != expected_source_sha:
        raise ValueError("source_sha_mismatch")
    affine=img.affine.copy()
    affine[:2,:]*=-1
    lps=[float(affine[row,col]) for row in range(3) for col in range(4)]
    from totalsegmentator_audit import LUNG_LOBES
    from totalsegmentator_result import validate_native_mask
    from totalsegmentator.python_api import totalsegmentator
    try:
        totalsegmentator(input=source,output=output,task="total",fast=True,
                         roi_subset=list(LUNG_LOBES.values()),ml=True,device="cpu",
                         quiet=True)
        report=validate_native_mask(output,dims,lps,source_sha,list(LUNG_LOBES))
        return {"schema":"opus-totalseg-offline-research-execution/v1",
                "execution":"real-model-call","networkIsolation":"must-be-enforced-by-host",
                "modelWeightProvenance":"not-independently-verified",
                "clinicalStatus":"not_validated","readyForClinicalUse":False,
                "result":report}
    except BaseException:
        if output.is_file() and not output.is_symlink():
            output.unlink()
        raise

def main(argv=None):
    p=argparse.ArgumentParser()
    p.add_argument("--input",required=True,type=Path)
    p.add_argument("--output",required=True,type=Path)
    p.add_argument("--research-confirmed",action="store_true")
    p.add_argument("--source-sha256")
    args=p.parse_args(argv)
    try:
        report=run(args.input,args.output,confirmed=args.research_confirmed,
                   expected_source_sha=args.source_sha256)
    except Exception as exc:
        print(json.dumps({"status":"failed","error":type(exc).__name__}),file=sys.stderr)
        return 2
    print(json.dumps(report,sort_keys=True))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
