#!/usr/bin/env python3
"""Genuine pretrained CT effusion mask -> native source clinical-research evidence.

Task 315 'pleural_pericard_effusion' has three classes:
  1 = lung_pleural, *NOT pathological fluid*
  2 = pleural_effusion, 3 = pericardial_effusion.
Only classes 2 and 3 are fluid proposals. Empty values cannot rule out
effusion. Original source NIfTI and the true output mask must share
physical geometry; no resampling, no invented diagnoses or reference Dice.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

SCHEMA="opus-real-totalseg-ct-effusion-source-proposals/v1"
LABELS={1:"lung_pleural_anatomical_not_fluid",
        2:"pleural_effusion",3:"pericardial_effusion"}
MAX_CT_BYTES=512*1024**2
MAX_SEGMENTATION_BYTES=256*1024**2
MAX_VOXELS=512*512*300


def digest(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda:stream.read(1024*1024),b""):
            h.update(block)
    return h.hexdigest()


def ordinary_nifti(path,byte_limit):
    path=Path(path)
    if (path.is_symlink() or not path.is_file() or
        path.stat().st_size<352 or path.stat().st_size>byte_limit or
        not path.name.endswith((".nii",".nii.gz"))):
        raise ValueError("bounded_original_nifti_file_required")
    return path


def run(source,mask,source_hash,model_weights_sha,authorization):
    import nibabel as nib
    import numpy as np
    if authorization!="PUBLIC-OR-AUTHORIZED-CHEST-CT-RESEARCH-OK":
        raise ValueError("explicit_authorized_chest_ct_research_required")
    if (not isinstance(source_hash,str) or len(source_hash)!=64 or
        not isinstance(model_weights_sha,str) or len(model_weights_sha)!=64 or
        any(ch not in "0123456789abcdef" for ch in source_hash+model_weights_sha)):
        raise ValueError("source_and_model_immutable_sha256_required")
    original=ordinary_nifti(source,MAX_CT_BYTES)
    predicted=ordinary_nifti(mask,MAX_SEGMENTATION_BYTES)
    if original.resolve()==predicted.resolve() or digest(original)!=source_hash:
        raise ValueError("different_real_original_ct_source_required")
    src=nib.load(str(original));seg=nib.load(str(predicted))
    if (src.ndim!=3 or seg.ndim!=3 or src.shape!=seg.shape or
        not (1<=src.shape[0]<=512 and 1<=src.shape[1]<=512 and 8<=src.shape[2]<=300) or
        np.prod(src.shape)>MAX_VOXELS or
        src.header.get_xyzt_units()[0]!="mm" or seg.header.get_xyzt_units()[0]!="mm"):
        raise ValueError("source_and_effusion_segmentation_must_share_full_native_mm_grid")
    a=np.asarray(src.affine,dtype=np.float64)
    b=np.asarray(seg.affine,dtype=np.float64)
    if (not np.all(np.isfinite(a)) or not np.all(np.isfinite(b)) or
        abs(np.linalg.det(a[:3,:3]))<.00001):
        raise ValueError("invalid_original_patient_space_geometry")
    for i in (0,src.shape[0]-1):
      for j in (0,src.shape[1]-1):
        for k in (0,src.shape[2]-1):
          p=np.array([i,j,k,1],dtype=float)
          if np.linalg.norm((a@p)[:3]-(b@p)[:3])>.05:
              raise ValueError("model_mask_not_registered_to_source_ct_mm")
    if seg.header.get_data_dtype().kind not in ("u","i"):
        raise ValueError("source_mask_must_be_integer_model_labels")
    slope=float(seg.dataobj.slope);inter=float(seg.dataobj.inter)
    if not np.isclose(slope,1,atol=1e-9) or not np.isclose(inter,0,atol=1e-9):
        raise ValueError("rescaled_model_labels_not_allowed")
    array=np.asarray(seg.dataobj)
    if not set(int(x) for x in np.unique(array)).issubset({0,1,2,3}):
        raise ValueError("unexpected_model_label_not_original_task315")
    volume_ml=abs(np.linalg.det(a[:3,:3]))/1000.
    proposals=[]
    for idx in (2,3):
        xyz=np.array(np.nonzero(array==idx),dtype=np.int32)
        count=int(xyz.shape[1])
        if count:
            low=xyz.min(axis=1).astype(int).tolist()
            high=xyz.max(axis=1).astype(int).tolist()
            slices=np.unique(xyz[2]).astype(int).tolist()
            corner_world=[]
            for x in (low[0],high[0]):
                for y in (low[1],high[1]):
                    for z in (low[2],high[2]):
                        world=a@np.array([x,y,z,1],dtype=float)
                        corner_world.append(world[:3].tolist())
            world_low=[round(min(p[q] for p in corner_world),4) for q in range(3)]
            world_high=[round(max(p[q] for p in corner_world),4) for q in range(3)]
        else:
            low=high=None;slices=[];world_low=world_high=None
        proposals.append({
            "labelId":idx,"pathologyClass":LABELS[idx],
            "modelPositiveNativeVoxelCount":count,
            "modelUnvalidatedFluidLabelVolumeMl":round(count*volume_ml,6),
            "nativeSourceSliceIndicesK":slices,
            "nativeIndexBoundsXYZMin":low,"nativeIndexBoundsXYZMax":high,
            "worldRasBoundsMmMin":world_low,"worldRasBoundsMmMax":world_high,
            "clinicalEffusionConfirmed":False,
            "clinicalAbsenceIfEmptyEstablished":False,
        })
    return {
      "schema":SCHEMA,
      "model":"TotalSegmentator",
      "modelTask":"pleural_pericard_effusion","officialTaskId":315,
      "modelCheckpointSha256ObservedNotSignedPublisherProof":model_weights_sha,
      "originalChestCtSha256":source_hash,
      "modelOutputNativeMaskSha256":digest(predicted),
      "originalCTDimensionsXYZ":list(src.shape),
      "nativeSpatialUnits":"millimeters",
      "sourceMaskMatchedAtEightPhysicalCornersWithinMm":.05,
      "voxelVolumeMl":round(volume_ml,10),
      "anatomicalClassLungPleuralIdOneExcludedFromPathology":True,
      "anatomicalClassLungPleuralVoxelCountNotFluid":int(np.count_nonzero(array==1)),
      "fluidCandidates":proposals,
      "sourceDICOMRescaleIndependentlyVerified":False,
      "clinicalValidation":False,
      "clinicalNormalityCanBeConcluded":False,
      "actualPretrainedInferenceProvenByThisMaskAlone":False,
      "limitations":[
        "Original model provenance requires separately audited checkpoint execution.",
        "Label 1 is an ANATOMICAL lung-pleural region and must never be counted as effusion.",
        "Pleural/pericardial model masks are unvalidated proposals, not proven pathological fluid.",
        "No external expert mask, patient DICOM SOP binding or independent clinical sensitivity."
      ],
    }


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ("source","mask","source-sha256","model-weights-sha256","output","research-authorization"):
        p.add_argument("--"+name,required=True)
    args=p.parse_args()
    evidence=run(args.source,args.mask,args.source_sha256,
                 args.model_weights_sha256,args.research_authorization)
    output=Path(args.output)
    if output.exists() or output.suffix!=".json":
        raise ValueError("new_numeric_research_report_only")
    output.write_text(json.dumps(evidence,indent=2),encoding="utf-8")
    print(json.dumps({"task":evidence["modelTask"],
      "fluidClassVoxels":[c["modelPositiveNativeVoxelCount"] for c in evidence["fluidCandidates"]],
      "anatomicalClassNotFluid":True,"clinicalValidation":False}))


if __name__=="__main__":main()
