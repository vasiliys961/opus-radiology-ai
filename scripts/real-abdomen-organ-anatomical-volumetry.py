#!/usr/bin/env python3
"""Source-native abdominal organ volume and location from prior ORIGINAL anatomy masks.

Stomach, gallbladder, liver, spleen, pancreas, kidneys and adrenals are
anatomic structures, NOT tumor, cirrhosis, stones, hemorrhage or lymph nodes.
"""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path

SUPPORTED={
 "stomach","gallbladder","liver","spleen","pancreas",
 "kidney_left","kidney_right","adrenal_gland_left","adrenal_gland_right"
}
SCHEMA="opus-abdomen-original-CT-anatomical-volumetry/v1"


def base_module():
    # Reuse native NIfTI grid/low-memory slab validation rather than adding
    # a divergent duplicated geometry engine for yet another body region.
    path=Path(__file__).with_name("real-cardiovascular-anatomy-native-ct.py")
    spec=importlib.util.spec_from_file_location("opus_original_ct_morphometry",path)
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def evaluate(ct_path, masks, ct_sha, source_url, license_):
    if (len(ct_sha)!=64 or any(ch not in "0123456789abcdef"
                             for ch in ct_sha.lower()) or
        not source_url.startswith("https://") or not license_.strip()):
        raise ValueError("licensed_original_public_CT_SHA_required")
    mod=base_module()
    if mod.sha256(ct_path)!=ct_sha.lower():
        raise ValueError("original_source_CT_SHA256_mismatch")
    if not masks or len(masks)>len(SUPPORTED):
        raise ValueError("source_bound_anatomical_masks_required")
    ct=mod.checked_image(ct_path)
    results={}
    for name,path in masks:
        if name not in SUPPORTED or name in results:
            raise ValueError("unsupported_or_duplicate_original_organ")
        geometry=mod.measure(ct,name,path)
        # Clinical false-positive guard: a missing organ mask cannot be a
        # true negative examination or estimated zero organ volume.
        if geometry["maskEmpty"]:
            results[name]={"presentMask":False,"volumeMl":None,
                           "sourceMaskSHA256":geometry["sourceMaskSHA256"],
                           "notNormalOrMissingOrganDiagnosis":True}
            continue
        results[name]={
          "presentMask":True,"sourceMaskSHA256":geometry["sourceMaskSHA256"],
          "anatomicalMaskVolumeMl":geometry["volumeMl"],
          "sourceVoxelBoundsInclusive":geometry["sourceVoxelBoundingBoxInclusive"],
          "centroidNiftiRasMm":geometry["centroidRasMm"],
          "maskTouchesSourceFieldOfView":geometry["touchesSourceVolumeBoundary"],
          "fullOrganCoverageIndependentlyConfirmed":False,
        }
    l=results.get("liver")
    sp=results.get("spleen")
    ratio=None
    if (l and sp and l["presentMask"] and sp["presentMask"] and
        not l["maskTouchesSourceFieldOfView"] and
        not sp["maskTouchesSourceFieldOfView"] and
        l["anatomicalMaskVolumeMl"]>0):
        ratio=round(sp["anatomicalMaskVolumeMl"]/l["anatomicalMaskVolumeMl"],4)
    return {
      "schema":SCHEMA,"sourceCTSHA256":ct_sha.lower(),
      "originalPublicResearchSource":source_url,
      "sourceRightsClaim":license_,
      "separatelyTrainedAnatomyMasksRequired":True,
      "genuineAnatomicalModelForwardExecutedByThisScript":False,
      "organMasks":results,"spleenToLiverMaskVolumeRatio":ratio,
      "stomachMaskIncludesLumenAndWallNotMeasuredGastricContents":True,
      "noSteatosisOrCirrhosisOrPortalHypertensionDiagnosis":True,
      "noGastricTumorOrWallThickeningDiagnosis":True,
      "noAdrenalOrPancreaticMassDiagnosis":True,
      "noGallstonesOrCholecystitisDiagnosis":True,
      "noNeoplasmOrRetroperitonealLymphNodeAssessment":True,
      "noOriginalDicomFrameMapping":True,
      "clinicallyValidated":False,"patientCloudTransfer":False,
    }


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--ct",required=True,type=Path)
    p.add_argument("--ct-sha256",required=True)
    p.add_argument("--mask",required=True,action="append",
                   help="stomach=/external-original-mask/stomach.nii.gz")
    p.add_argument("--public-source-url",required=True)
    p.add_argument("--public-source-license",required=True)
    p.add_argument("--approved-public-research",action="store_true")
    p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    if not a.approved_public_research:
        p.error("public_deidentified_anatomical_research_only")
    pairs=[]
    for item in a.mask:
        name,sep,filename=item.partition("=")
        if not sep or not filename:
            p.error("--mask must be anatomical_name=/path/to/source_native_mask")
        pairs.append((name,Path(filename)))
    report=evaluate(a.ct,pairs,a.ct_sha256,
                    a.public_source_url,a.public_source_license)
    if a.output.is_symlink() or a.output.exists():
        p.error("numeric_output_must_be_new")
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps({"reportedOrgans":sorted(report["organMasks"]),
                      "clinicallyValidated":False,"trainedForward":False}))


if __name__=="__main__":
    main()
