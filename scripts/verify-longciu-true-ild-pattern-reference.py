#!/usr/bin/env python3
"""Real published independent expert GGO/consolidation mask comparison.

LongCIU v2024, 90 INDEPENDENT 2D patient slices concatenated into 3D
NIfTI storage, never a genuine contiguous 3D chest CT. Compare each of
three blind manual expert annotations with the STAPLE consensus and the
authors' already stored MedPSeg predictions, by ORIGINAL published test
split (40 cases) and ALL (90). No weights executed and no clinical ILD
or honeycombing claims. Only original numeric evidence exported.
"""
from __future__ import annotations
import hashlib,json,math,tempfile
from pathlib import Path
from urllib.request import urlopen,Request

REV="c4b975090c16fabe59079a528dd920d956e16c66"
BASE=f"https://huggingface.co/datasets/MedOtter/LongCIU/resolve/{REV}/"
FILES={
 "one":("longciu_1_tgt.nii.gz","f9cd0e605f6fcd701a64a262ba15d43a46fe2f1b62a4045e83195e4962f022ed",280000),
 "two":("longciu_2_tgt.nii.gz","4e54ec5add75b2ee48f34be6bd25c74f23d550a96430ff10c04e711383f9647f",280000),
 "three":("longciu_3_tgt.nii.gz","aee04feddb18cbbe717418ce8b6838b58fc415f0b5b13b97b1c682faed1bb7cd",280000),
 "staple":("longciu_STAPLE_tgt.nii.gz","6f0d64315c5010b296285f81a54adec0c6eae5fc643c4e21f4546129d743ea13",280000),
 "medpseg":("longciu_medpseg_output.nii.gz","4ca7efa23b1df672833efe9017290581289289a1d68c9a7b46c0c5ebd82644c6",850000),
}
SHAPE=(512,512,90)
TEST=tuple([*range(0,10),*range(40,50),*range(60,70),*range(80,90)])
SCHEMA="opus-real-longciu-hrct-ggo-consolidation-expert-benchmark/v1"
DOI="10.25820/data.007301"


def admit(name,root):
    fname,expected,limit=FILES[name]
    uri=BASE+fname
    dest=root/fname
    digest=hashlib.sha256()
    size=0
    with urlopen(Request(uri,headers={"User-Agent":"OpusRadiologyAcademicResearch/1"}),timeout=60) as r, dest.open("xb") as f:
        if not r.url.startswith("https://"):
            raise ValueError("source_redirect_downgraded")
        while block:=r.read(65536):
            size+=len(block)
            if size>limit:
                raise ValueError("source_reference_over_bound:"+fname)
            digest.update(block)
            f.write(block)
    if digest.hexdigest()!=expected:
        raise ValueError("original_published_mask_sha_mismatch:"+fname)
    return dest


def dice(x,y):
    import numpy as np
    x,y=np.asarray(x,dtype=bool),np.asarray(y,dtype=bool)
    a=int(np.count_nonzero(x));b=int(np.count_nonzero(y))
    if not (a or b):
        return None # both absent: not a proved segmentation success
    inter=int(np.count_nonzero(x & y))
    return round(2*inter/(a+b),8)


def evaluate_volume(root):
    import nibabel as nib
    import numpy as np
    masks={}
    for name in FILES:
        nii=nib.load(str(root/FILES[name][0]))
        if nii.shape!=SHAPE or nii.ndim!=3:
            raise ValueError("expected_90_independent_2d_cases_not_3d_study")
        if nii.header.get_data_dtype().kind not in ("i","u"):
            raise ValueError("original_mask_must_be_integer_labelmap")
        array=np.asanyarray(nii.dataobj)
        if not np.isin(array,[0,1,2]).all():
            raise ValueError("unknown_ild_pattern_labels:"+name+":"+str(np.unique(array).astype(int).tolist()[:16]))
        masks[name]=array
    out={}
    for scope,slices in (("authorsOriginalTest40",TEST),("all90Independent2DSlices",tuple(range(90)))):
        data={}
        for label,key in ((1,"groundGlassOpacity"),(2,"consolidation")):
            cls={}
            for name in ("one","two","three","medpseg"):
                scores=[dice(masks[name][:,:,k]==label,masks["staple"][:,:,k]==label) for k in slices]
                present=[v for v in scores if v is not None]
                cls[name]={
                    "comparedSlices":len(slices),
                    "nonEmptyUnionSlices":len(present),
                    "bothEmptyExcluded":len(slices)-len(present),
                    "mean2DSliceDice":round(sum(present)/len(present),6) if present else None,
                    "modelInferencePerformedByOpus":False,
                }
            data[key]=cls
        out[scope]=data
    return {
        "schema":SCHEMA,
        "dataSource":"University of Iowa LongCIU original expert CT slice annotations",
        "doi":DOI,
        "rights":"ODC-By 1.0",
        "pinnedHuggingFaceMirrorRevision":REV,
        "originalFileSha256":{k:v[1] for k,v in FILES.items()},
        "published2DSliceCount":90,
        "authorsOriginalTestSplitSliceCount":40,
        "source3DVolumetricContinuousCT":False,
        "sourceSlicesRepresentIndependentSubjects":True,
        "referenceSTAPLEConsensusFromThreeIndependentAnnotators":True,
        "originalClassOntology":{"1":"ground_glass_opacity","2":"consolidation"},
        "includedFiles":"only_expert_binary_class_masks_and_precomputed_published_medpseg_output",
        "originalCTImagePixelsDownloaded":False,
        "pretrainedMEDPSegInferencePerformedByOpus":False,
        "precomputedMEDPSegModelTrainingHeldoutAuditedByOpus":False,
        "result":out,
        "modelGenuineILDClassificationClinicallyValidated":False,
        "sufficientToDiagnoseFibrosingInterstitialLungDisease":False,
        "honeycombingAndTractionBronchiectasisMeasured":False,
        "limitations":[
           "90 axial slices are independent subjects, NOT 90 adjacent CT volume slices. No 3D disease volume can be inferred.",
           "GGO/consolidation reflect post-COVID changes and are not equivalent to fibrotic ILD diagnosis.",
           "Human STAPLE consensus shares the annotator masks; reader-vs-STAPLE Dice is not independent reference.",
           "MEDPSeg masks are authors' PRECOMPUTED model predictions, not a second pretrained model run by Opus.",
           "Mean Dice excludes both-empty 2D slices, and no trained-checkpoint generalization/holdout is independently audited."
        ]
    }


def main():
    import os
    with tempfile.TemporaryDirectory(prefix="opus-longciu-real-") as work:
        root=Path(work)
        for key in FILES:
            admit(key,root)
        report=evaluate_volume(root)
    print(json.dumps({
       "status":"REAL_ORIGINAL_EXPERT_MASKS_AND_PUBLISHED_MODEL_OUTPUT_COMPARE",
       "test40GGO":{k:v["mean2DSliceDice"] for k,v in report["result"]["authorsOriginalTest40"]["groundGlassOpacity"].items()},
       "test40Consolidation":{k:v["mean2DSliceDice"] for k,v in report["result"]["authorsOriginalTest40"]["consolidation"].items()},
       "modelExecuted":False,
       "realExpertMasksCompared":True},ensure_ascii=False))
    out=Path(os.environ.get("OPUS_LONGCIU_REPORT","/tmp/opus-longciu-real-reference-only.json"))
    if out.exists() or out.suffix!=".json":
        raise ValueError("only_new_bounded_numeric_json")
    out.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")


if __name__=="__main__":
    main()
