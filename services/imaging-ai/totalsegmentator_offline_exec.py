"""Opt-in TotalSegmentator CT fast executor, intended ONLY for network-isolated container."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
from totalsegmentator_input import inspect_input

def normalize_model_mask(path, dimensions, affine_lps, allowed_labels):
    """Canonicalize genuine, geometrically matching NIfTI to strict uint8 native NIfTI.

    Does not interpolate, relabel, crop, or make a failed mask appear valid.
    """
    import os
    import numpy as np
    import nibabel as nib
    path=Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size>700*1024*1024:
        raise ValueError("invalid_mask_file")
    try:
        image=nib.load(str(path),mmap=True)
        if tuple(image.shape)!=tuple(dimensions):
            raise ValueError("mask_geometry_mismatch")
        expected=np.asarray(affine_lps,dtype=np.float64).reshape(3,4).copy()
        expected[:2,:]*=-1
        actual=np.asarray(image.affine[:3,:],dtype=np.float64)
        corners=np.array([[x,y,z,1] for x in (0,dimensions[0]-1)
                          for y in (0,dimensions[1]-1)
                          for z in (0,dimensions[2]-1)],dtype=np.float64)
        if not np.all(np.isfinite(actual)) or np.max(np.linalg.norm(
                corners @ (actual-expected).T,axis=1))>0.05:
            raise ValueError("mask_geometry_mismatch")
        if image.get_data_dtype().kind not in "iu":
            raise ValueError("invalid_mask_header")
        # Validate the entire native voxel array, without any resampling.
        array=np.asanyarray(image.dataobj)
        if not np.isin(array,list(allowed_labels)+[0]).all():
            raise ValueError("unexpected_mask_label")
        canonical=np.asarray(array,dtype=np.uint8)
        header=nib.Nifti1Header()
        header.set_data_dtype(np.uint8)
        result=nib.Nifti1Image(canonical,image.affine,header=header)
        temp=path.with_name(path.name+".normalized.nii")
        if temp.exists() or temp.is_symlink():
            raise ValueError("invalid_mask_file")
        try:
            nib.save(result,str(temp))
            os.replace(temp,path)
        finally:
            temp.unlink(missing_ok=True)
    except (OSError,EOFError) as exc:
        raise ValueError("invalid_mask_file") from exc

def run(input_path, output_path, *, confirmed=False, expected_source_sha=None, stage=None):
    def reached(name):
        if stage is not None:
            stage[0] = name
    if not confirmed:
        raise ValueError("explicit_research_confirmation_required")
    source, output = Path(input_path), Path(output_path)
    if (source.is_symlink() or not source.is_file() or output.exists() or
            output.is_symlink() or source.resolve() == output.resolve() or
            source.suffix != ".nii" or output.suffix != ".nii"):
        raise ValueError("invalid_paths")
    # Reject malformed or oversized CT before importing heavy medical dependencies.
    reached("input_preflight")
    inspected = inspect_input(source)
    reached("input_nifti_load")
    import nibabel as nib
    img = nib.load(str(source), mmap=True)
    dims = tuple(int(n) for n in img.shape)
    if dims != inspected["dimensions"]:
        raise ValueError("input_geometry_mismatch")
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
    reached("runtime_cache")
    # Third-party libraries require writable cache locations under tmpfs.
    import os
    for key in ("HOME", "XDG_CACHE_HOME", "MPLCONFIGDIR", "TORCH_HOME", "TOTALSEG_HOME_DIR"):
        cache = Path(os.environ.get(key, ""))
        if not cache.is_absolute() or not cache.is_relative_to("/tmp"):
            raise ValueError("invalid_runtime_cache_path")
        cache.mkdir(parents=True, exist_ok=True)
        probe = cache / ".opus-write-probe"
        with probe.open("xb") as handle:
            handle.write(b"ok")
        probe.unlink()
    from totalsegmentator_audit import LUNG_LOBES
    from totalsegmentator_result import validate_native_mask
    reached("model_import")
    from totalsegmentator.python_api import totalsegmentator
    try:
        reached("model_inference")
        totalsegmentator(input=source,output=output,task="total",fast=True,
                         roi_subset=list(LUNG_LOBES.values()),ml=True,device="cpu",
                         quiet=True)
        reached("mask_validation")
        try:
            report=validate_native_mask(output,dims,lps,source_sha,list(LUNG_LOBES))
        except ValueError as exc:
            if str(exc)!="invalid_mask_file":
                raise
            normalize_model_mask(output,dims,lps,set(LUNG_LOBES))
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

MASK_REJECTION_CODES = frozenset({
    "invalid_dimensions", "invalid_affine", "invalid_source_identity",
    "invalid_label_set", "invalid_mask_file", "invalid_mask_header",
    "mask_geometry_mismatch", "truncated_mask", "unexpected_mask_label",
    "oversized_mask", "empty_mask_needs_review",
})

def safe_mask_rejection(exc, stage):
    if stage != "mask_validation" or not isinstance(exc, ValueError):
        return None
    message = str(exc)
    return message if message in MASK_REJECTION_CODES else "unrecognized_validation_error"

def main(argv=None):
    p=argparse.ArgumentParser()
    p.add_argument("--input",required=True,type=Path)
    p.add_argument("--output",required=True,type=Path)
    p.add_argument("--research-confirmed",action="store_true")
    p.add_argument("--source-sha256")
    args=p.parse_args(argv)
    stage=["arguments"]
    try:
        report=run(args.input,args.output,confirmed=args.research_confirmed,stage=stage,
                   expected_source_sha=args.source_sha256)
    except Exception as exc:
        payload={"status":"failed","error":type(exc).__name__,"stage":stage[0]}
        mask_code=safe_mask_rejection(exc,stage[0])
        if mask_code is not None:
            payload["maskRejection"]=mask_code
        print(json.dumps(payload),file=sys.stderr)
        return 2
    print(json.dumps(report,sort_keys=True))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
