#!/usr/bin/env python3
"""Isolated public-research AI-CAC model executor: real publisher checkpoint only.

This is intentionally NOT the Mac/web viewer or patient worker. The published
1.2GB checkpoint needs an isolated high-memory runtime. No fake model fallback.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import urllib.request

MODEL_REPO = "Raffi-Hagopian/AI-CAC"
MODEL_CODE_COMMIT = "5f33f2419d60774f8a160200a70bd057b4d61b2a"
MODEL_RELEASE = "v1.0.0"
MODEL_NAME = "va_non_gated_ai_cac_model.pth"
MODEL_BYTES = 1205817465
# SHA256 observed on real publisher release download in GitHub Actions #39216540464.
MODEL_SHA256 = "cfded8253e64b81b963a314cb5adc90d30a1f21574638366b80c783676c1733d"
MODEL_URL = f"https://github.com/{MODEL_REPO}/releases/download/{MODEL_RELEASE}/{MODEL_NAME}"
SCHEMA = "opus-ai-cac-original-public-ct/v1"
MAX_SLICES = 384
MIN_SLICES = 16

def checksum(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as source:
        for data in iter(lambda: source.read(4 * 1024**2), b""):
            h.update(data)
    return h.hexdigest()

def fetch_published_model(folder):
    """Opt-in network operation; no automatic download at inference or startup."""
    if folder.exists() or folder.is_symlink():
        raise ValueError("new_private_research_model_directory_required")
    folder.mkdir(parents=True, mode=0o700)
    target = folder / MODEL_NAME
    temp = folder / (MODEL_NAME + ".part")
    manifest = folder / "publisher.json"
    try:
        request = urllib.request.Request(MODEL_URL, headers={"User-Agent": "opus-public-research/1"})
        with urllib.request.urlopen(request, timeout=90) as res, temp.open("xb") as f:
            if res.status != 200:
                raise ValueError("published_checkpoint_download_not_successful")
            size = 0
            digest = hashlib.sha256()
            while True:
                buf = res.read(4 * 1024**2)
                if not buf:
                    break
                size += len(buf)
                if size > MODEL_BYTES:
                    raise ValueError("unexpected_publisher_weights_size")
                f.write(buf)
                digest.update(buf)
        if size != MODEL_BYTES or digest.hexdigest() != MODEL_SHA256:
            raise ValueError("original_published_checkpoint_digest_not_matching_pinned_real_release")
        temp.replace(target)
        manifest.write_text(json.dumps({
            "schema": "opus-ai-cac-official-release/v1",
            "publisher": MODEL_REPO,
            "publisherCodeCommit": MODEL_CODE_COMMIT,
            "release": MODEL_RELEASE,
            "releaseAssetUrl": MODEL_URL,
            "releaseAssetBytes": MODEL_BYTES,
            "checkpointSha256Observed": digest.hexdigest(),
            "repositoryPinnedObservedSha256": MODEL_SHA256,
            "checkpointSignatureVerified": False,
            "publicResearchOnly": True
        }, indent=2) + "\n")
    except BaseException:
        temp.unlink(missing_ok=True)
        target.unlink(missing_ok=True)
        manifest.unlink(missing_ok=True)
        raise
    return manifest

def verify_weights(folder):
    """A SHA binds bytes to a downloaded publisher asset, not to a signed model."""
    if folder.is_symlink():
        raise ValueError("model_directory_must_not_be_symlink")
    manifest = json.loads((folder / "publisher.json").read_text())
    weight = folder / MODEL_NAME
    if (weight.is_symlink() or not weight.is_file() or weight.stat().st_size != MODEL_BYTES
        or manifest.get("schema") != "opus-ai-cac-official-release/v1"
        or manifest.get("publisher") != MODEL_REPO
        or manifest.get("publisherCodeCommit") != MODEL_CODE_COMMIT
        or manifest.get("release") != MODEL_RELEASE
        or manifest.get("releaseAssetUrl") != MODEL_URL
        or manifest.get("releaseAssetBytes") != MODEL_BYTES
        or manifest.get("publicResearchOnly") is not True
        or manifest.get("repositoryPinnedObservedSha256") != MODEL_SHA256
        or manifest.get("checkpointSha256Observed") != MODEL_SHA256
        or checksum(weight) != MODEL_SHA256):
        raise ValueError("original_official_checkpoint_integrity_failed")
    return weight, manifest

def select_public_ct_slices(root):
    """Only one explicit series, original axial noncontrast DICOM with stable HU/geometry."""
    import numpy as np
    import pydicom
    if root.is_symlink() or not root.is_dir():
        raise ValueError("public_original_dicom_directory_required")
    files = sorted(p for p in root.iterdir() if p.is_file() and not p.is_symlink())
    if not MIN_SLICES <= len(files) <= MAX_SLICES:
        raise ValueError("full_public_CT_series_16_to_384_slices_required")
    rows = []
    uids = set()
    orientations = []
    for path in files:
        if path.stat().st_size > 20 * 1024**2:
            raise ValueError("original_dicom_exceeds_bound")
        ds = pydicom.dcmread(str(path), stop_before_pixels=True)
        if (getattr(ds, "Modality", None) != "CT"
            or int(getattr(ds, "Rows", 0)) != 512 or int(getattr(ds, "Columns", 0)) != 512
            or len(getattr(ds, "ImagePositionPatient", [])) != 3
            or len(getattr(ds, "ImageOrientationPatient", [])) != 6
            or len(getattr(ds, "PixelSpacing", [])) != 2
            or not hasattr(ds, "SeriesInstanceUID")
            or not hasattr(ds, "FrameOfReferenceUID")
            or not hasattr(ds, "SOPInstanceUID")
            or not hasattr(ds, "RescaleSlope") or not hasattr(ds, "RescaleIntercept")
            or hasattr(ds, "ContrastBolusAgent")
            and str(ds.ContrastBolusAgent).strip()):
            raise ValueError("not_supported_noncontrast_axial_512_CT")
        descriptors = " ".join(str(getattr(ds, k, "")) for k in (
            "StudyDescription", "SeriesDescription", "ProtocolName")).lower()
        if any(word in descriptors for word in (
            "with contrast", "post contrast", "post-contrast", "angiogram",
            "cta ", "contrast enhanced", "iv contrast", "arterial phase", "venous phase")):
            raise ValueError("contrast_enhanced_CT_not_supported")
        orient = np.asarray(ds.ImageOrientationPatient, dtype=np.float64)
        if (not np.allclose(orient, (1,0,0,0,1,0), atol=0.025, rtol=0)
            or not np.isfinite(orient).all()):
            raise ValueError("publisher_requires_native_axial_CT")
        spacing = [float(x) for x in ds.PixelSpacing]
        thickness = float(getattr(ds, "SliceThickness", 0))
        if (not all(math.isfinite(x) and 0.25 <= x <= 2.0 for x in spacing)
            or not 2.5 <= thickness <= 5.0):
            raise ValueError("unsupported_CAC_CT_spacing")
        if str(ds.SOPInstanceUID) in uids:
            raise ValueError("duplicate_DICOM_SOP")
        uids.add(str(ds.SOPInstanceUID))
        orientations.append((str(ds.SeriesInstanceUID), str(ds.FrameOfReferenceUID),
                             tuple(spacing), thickness, float(ds.RescaleSlope),
                             float(ds.RescaleIntercept), str(getattr(ds,"ConvolutionKernel",""))))
        pos = np.asarray(ds.ImagePositionPatient, dtype=np.float64)
        if not np.isfinite(pos).all():
            raise ValueError("nonfinite_CT_origin")
        rows.append((float(pos[2]), path, pos))
    if len(set(orientations)) != 1:
        raise ValueError("mixed_geometry_or_rescale_slices")
    rows.sort(key=lambda x: x[0])
    positions = np.array([row[2] for row in rows])
    dz = np.diff(positions[:, 2])
    if (np.any(dz <= 0) or not np.allclose(dz, np.median(dz), rtol=0.1, atol=0.25)
        or not 2 <= float(np.median(dz)) <= 6
        or not np.allclose(positions[:, :2], positions[0, :2], atol=0.25, rtol=0)):
        raise ValueError("irregular_or_oblique_original_CT_slice_stack")
    if abs(float(np.median(dz)) - orientations[0][3]) > 0.5:
        raise ValueError("slice_spacing_does_not_match_thickness")
    src = hashlib.sha256()
    for _, path, _ in rows:
        src.update(bytes.fromhex(checksum(path)))
    # Output array coordinates are (DICOM row, column, ascending slice).
    row_mm, col_mm = orientations[0][2]
    origin = positions[0]
    affine_lps = np.eye(4)
    affine_lps[:3,0] = [0,row_mm,0]
    affine_lps[:3,1] = [col_mm,0,0]
    affine_lps[:3,2] = positions[1]-positions[0]
    affine_lps[:3,3] = origin
    return {
        "files": [p for _,p,_ in rows],
        "sourceSha256": src.hexdigest(),
        "shape": (512,512,len(rows)),
        "voxelSpacingMm": [row_mm,col_mm,float(np.median(dz))],
        "affineLPS": affine_lps,
        "seriesProtocolVerified": True
    }

def agatston_like(hounsfield, binary_mask, spacing):
    """Reproduce publisher's 3D component/3mm thickness-normalized algorithm.

    This is NOT independently calibrated ECG-gated 2D Agatston scoring.
    """
    import numpy as np
    from scipy import ndimage
    if (hounsfield.shape != binary_mask.shape or hounsfield.ndim != 3
        or binary_mask.dtype != np.uint8
        or not np.isin(binary_mask, [0,1]).all()):
        raise ValueError("unmatched_original_CT_and_binary_AI_CAC_mask")
    labeled, count = ndimage.label(binary_mask > 0)
    regions = ndimage.find_objects(labeled)
    score = 0
    objects = []
    voxel_scale = math.prod(spacing) / 3.0
    for idx, sl in enumerate(regions, 1):
        if sl is None:
            continue
        local_mask = labeled[sl] == idx
        nvox = int(local_mask.sum())
        if nvox <= 1:  # publisher exact exclusion of <= min_calc_object_pixels 1
            continue
        hu_peak = float(hounsfield[sl][local_mask].max())
        weight = 1 if 130 <= hu_peak < 200 else 2 if 200 <= hu_peak < 300 else (
            3 if 300 <= hu_peak < 400 else 4 if hu_peak >= 400 else 0)
        subtotal = round(nvox * voxel_scale * weight)
        score += subtotal
        if weight:
            objects.append({"voxels":nvox, "peakHU":round(hu_peak,2),
                            "publisherLikeComponentScore":subtotal,
                            "voxelBBox": [[int(s.start), int(s.stop-1)] for s in sl]})
    objects.sort(key=lambda v:v["voxels"], reverse=True)
    return score, objects

def read_expert_same_grid(path, expected_shape, affine_lps):
    """Optional positive expert mask, only when verified EXACT source grid."""
    import nibabel as nib
    import numpy as np
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 250*1024**2:
        raise ValueError("expert_mask_missing_or_too_large")
    im=nib.load(str(path))
    ras=np.diag([-1.,-1.,1.,1.])
    expected=ras @ affine_lps
    if (im.ndim!=3 or im.shape != expected_shape
        or im.header.get_xyzt_units()[0]!="mm"
        or not np.allclose(im.affine,expected,rtol=0,atol=0.1)
        or im.header.get_data_dtype().kind not in "iu"):
        raise ValueError("expert_mask_not_on_exact_original_DICOM_RAS_grid")
    binary=np.asarray(im.dataobj)
    if not np.isin(binary,(0,1)).all():
        raise ValueError("expert_CAC_mask_not_binary")
    return binary.astype(np.uint8,copy=False)

def available_ram_bytes():
    # Linux worker only; never force allocation on user's 8 GB Mac.
    from pathlib import Path
    mem=Path("/proc/meminfo")
    if not mem.is_file():
        raise RuntimeError("large_volume_AI_CAC_requires_resource_measured_Linux")
    line=next(x for x in mem.read_text().splitlines() if x.startswith("MemAvailable:"))
    return int(line.split()[1])*1024

def infer(a):
    import numpy as np
    import pydicom
    import torch
    from monai.networks.nets import SwinUNETR
    if a.output.exists() or a.output.is_symlink():
        raise ValueError("new_numeric_output_required")
    weights, publisher = verify_weights(a.model_dir)
    info=select_public_ct_slices(a.public_dicom_dir)
    if available_ram_bytes()<18*1024**3:
        raise RuntimeError("AI_CAC_requires_isolated_worker_with_at_least_18GiB_available_RAM")
    if a.device == "cuda":
        if not torch.cuda.is_available() or torch.cuda.mem_get_info()[0] < 12*1024**3:
            raise RuntimeError("CUDA_GPU_with_12GiB_free_VRAM_required")
    elif a.device != "cpu":
        raise ValueError("only_explicit_CPU_or_CUDA_research_executor")
    torch.set_num_threads(2)
    device=torch.device(a.device)
    model=SwinUNETR(spatial_dims=2, img_size=(512,512),in_channels=1,
                    out_channels=1,feature_size=96,use_checkpoint=True,drop_rate=0.2)
    checkpoint=torch.load(str(weights),map_location="cpu",weights_only=True)
    if not isinstance(checkpoint,dict) or not isinstance(checkpoint.get("model_state_dict"),dict):
        raise ValueError("original_AI_CAC_checkpoint_unexpected_structure")
    original=checkpoint["model_state_dict"]
    if not all(k.startswith("module.") for k in original):
        raise ValueError("publisher_DataParallel_model_state_keys_missing")
    model.load_state_dict({k[7:]:v for k,v in original.items()},strict=True)
    del checkpoint,original
    model.to(device).eval()
    volume=np.empty(info["shape"],dtype=np.float32)
    mask=np.empty(info["shape"],dtype=np.uint8)
    with torch.inference_mode():
        for k,path in enumerate(info["files"]):
            d=pydicom.dcmread(str(path))
            image=d.pixel_array.astype(np.float32)
            image=image*float(d.RescaleSlope)+float(d.RescaleIntercept)
            if image.shape!=(512,512) or not np.isfinite(image).all():
                raise ValueError("bad_public_original_HU_pixel_slice")
            volume[:,:,k]=image
            data=torch.from_numpy(image.copy())[None,None].to(device)
            out=model(data)
            if out.shape!=(1,1,512,512) or not torch.isfinite(out).all():
                raise ValueError("AI_CAC_trained_model_invalid_output")
            mask[:,:,k]=(out[0,0]>0).to("cpu",dtype=torch.uint8).numpy()
            del data,out
    score,components=agatston_like(volume,mask,info["voxelSpacingMm"])
    audit={"schema":SCHEMA,"task":"coronary_artery_calcium_non_gated_noncontrast_CT",
           "publisher":MODEL_REPO,"publisherCodeCommit":MODEL_CODE_COMMIT,
           "publishedModelVersion":MODEL_RELEASE,"originalModelSha256":publisher["checkpointSha256Observed"],
           "publisherWeightSignatureVerified":False,
           "trueTrainedModelInferenceCompleted":True,
           "sourceDICOMSeriesSha256":info["sourceSha256"],
           "originalNativeShape":list(info["shape"]),
           "nativeVoxelSpacingMm":info["voxelSpacingMm"],
           "nativeAffineLPS": info["affineLPS"].round(5).tolist(),
           "predictedMaskVoxelCount":int(mask.sum()),
           "publisherStyleThicknessNormalizedCACScore":score,
           "notStandardECGGatedAgatstonScore":True,
           "estimatedCalciumComponentCount":len(components),
           "largestComponentNativeVoxelBoxes":components[:100],
           "expertMaskAvailable":a.expert_mask is not None,
           "expertReferenceMatch":None,
           "trainingHoldoutIndependentlyVerified":False,
           "medicalDiagnosticValidation":False,"patientUseAllowed":False,
           "researchOnly":True,
           "limitations":["Non-ECG-gated noncontrast CT only; not a CCTA stenosis detector.",
                          "Publisher 3D connected-component surrogate differs from standard gated Agatston.",
                          "Publisher download size/hash observed, no publisher signature or independent SHA.",
                          "No independent clinical validity or patient authorization is claimed."]}
    if a.expert_mask:
        e=read_expert_same_grid(a.expert_mask,mask.shape,info["affineLPS"])==1
        p=mask==1
        tp=int(np.count_nonzero(p&e))
        fp=int(np.count_nonzero(p&~e))
        fn=int(np.count_nonzero(~p&e))
        audit["expertReferenceMatch"]={
            "expertSha256":checksum(a.expert_mask),
            "TP":tp,"FP":fp,"FN":fn,
            "voxelDice":round(2*tp/(2*tp+fp+fn),6) if (2*tp+fp+fn) else None,
            "expertInExactNativeSourceGrid":True}
    a.output.write_text(json.dumps(audit,indent=2)+"\n")
    print(json.dumps({k:audit[k] for k in
        ("task","predictedMaskVoxelCount","publisherStyleThicknessNormalizedCACScore",
         "trueTrainedModelInferenceCompleted","medicalDiagnosticValidation")}))

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--mode",choices=("fetch-weights","infer"),required=True)
    parser.add_argument("--model-dir",type=Path,required=True)
    parser.add_argument("--public-dicom-dir",type=Path)
    parser.add_argument("--output",type=Path)
    parser.add_argument("--expert-mask",type=Path)
    parser.add_argument("--device",choices=("cpu","cuda"),default="cpu")
    parser.add_argument("--public-research-consent",action="store_true")
    args=parser.parse_args()
    if not args.public_research_consent:
        raise ValueError("explicit_deidentified_licensed_public_research_study_acknowledgement_required")
    if args.mode=="fetch-weights":
        fetch_published_model(args.model_dir)
    elif args.public_dicom_dir and args.output:
        infer(args)
    else:
        raise ValueError("original_DICOM_series_and_numeric_output_required")

if __name__=="__main__":
    main()
