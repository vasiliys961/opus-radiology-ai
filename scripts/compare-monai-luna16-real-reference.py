#!/usr/bin/env python3
"""Real MONAI output ↔ separate radiologists' LUNA16 reference (one public CT).

No neural network inference or CT pixels are loaded. The detector ALREADY ran
with authentic pretrained weights on the public CT in GitHub Actions run
38436406805. This computes a narrow world-coordinate evidence comparison
against a separately published expert center+diameter, NEVER a voxel mask,
external holdout sensitivity, full FROC, or diagnostic efficacy.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
from pathlib import Path
from urllib.request import Request, urlopen

UID="1.3.6.1.4.1.14519.5.2.1.6279.6001.395623571499047043765181005112"
UID_SHA="0e70f7a05cf8963ea61614a599ebb6fb59ad661bd03299d3058ad14d485b2d76"
ANNOTATIONS_SHA="db9adb75b381f3e95b1f601d9b63f2e42bd6536ab5a06dc539c5ec8a4005cec7"
MHD_SHA="5a1320abf573d50422961f5340e3f8f6391c23f3a13e29a18322034958f6ac1c"
RAW_SHA="ca3c712205e3e8a2d9f5cbc19615a7b47c757ccf2a6b5b9b6a4e15ec0d70afc5"
MODEL_SHA="b5e79231466adae93a6fe8e8594029e9add142914e223b879aa0343bb2402d01"
MODEL_REV="7226a40a4c3713f7d5469559b7f2fc296fd54825"
CSV_URL="https://huggingface.co/datasets/MedOtter/LUNA16/resolve/fb396557c4e23feaf9c432cea7fc8426214648fb/annotations.csv"
MHD_URL="https://huggingface.co/datasets/Yousra0x0/LUNA16_RAW/resolve/af8fdf04c27dcaa97ccfd755043d8096299d6a40/subset0/"+UID+".mhd"
MODEL_CONFIG_URL="https://huggingface.co/MONAI/lung_nodule_ct_detection/resolve/"+MODEL_REV+"/configs/inference.json"
MODEL_REPORT=Path(__file__).resolve().parents[1]/"web/public/examples/luna16-monai-cpu-run-38436406805.json"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch_pinned(url: str, digest: str|None, max_bytes: int) -> bytes:
    if not url.startswith("https://huggingface.co/"):
        raise ValueError("not_a_pinned_huggingface_public_source")
    with urlopen(Request(url,headers={"User-Agent":"OpusRadiologyPublicReferenceResearch/1"}),timeout=35) as response:
        raw=response.read(max_bytes+1)
    if not 30<len(raw)<=max_bytes or (digest is not None and sha256(raw)!=digest):
        raise ValueError("immutable_public_reference_integrity_failure")
    return raw


def _triple(raw: str, name: str):
    parts=raw.strip().split()
    if len(parts)!=3:
        raise ValueError("invalid_"+name)
    vals=tuple(float(x) for x in parts)
    if not all(math.isfinite(x) for x in vals):
        raise ValueError("invalid_"+name)
    return vals


def parse_metaimage(raw: bytes) -> dict:
    if len(raw)>2048 or b"\0" in raw:
        raise ValueError("invalid_mhd_header")
    fields={}
    for line in raw.decode("ascii").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):continue
        if "=" not in line:raise ValueError("malformed_mhd")
        name,val=map(str.strip,line.split("=",1))
        if name in fields:raise ValueError("duplicate_mhd_key")
        fields[name]=val
    if (fields.get("NDims")!="3" or fields.get("ElementType")!="MET_SHORT"
        or fields.get("ElementDataFile")!=UID+".raw" or
        fields.get("DimSize")!="512 512 109"):
        raise ValueError("unexpected_public_source_geometry")
    spacing=_triple(fields.get("ElementSpacing",""),"spacing")
    if any(abs(v-p)>1e-5 for v,p in zip(spacing,(0.78125,0.78125,2.5))):
        raise ValueError("source_spacing_changed")
    origins=[name for name in ("Offset","Origin","Position") if name in fields]
    if len(origins)!=1:raise ValueError("unknown_source_origin")
    origin=_triple(fields[origins[0]],"origin")
    orient=fields.get("TransformMatrix","").split()
    if len(orient)!=9:raise ValueError("missing_mhd_orientation")
    matrix=[[float(v) for v in orient[i*3:(i+1)*3]] for i in range(3)]
    if not all(math.isfinite(v) for row in matrix for v in row):
        raise ValueError("nonfinite_source_direction")
    for col in range(3):
        for other in range(3):
            dot=sum(row[col]*row[other] for row in matrix)
            if abs(dot-(1 if col==other else 0))>1e-4:
                raise ValueError("nonorthonormal_source_mhd")
    return {"origin":origin,"spacing":spacing,"matrix":matrix,"dimensions":[512,512,109]}


def voxel_index(world, geometry):
    delta=[world[i]-geometry["origin"][i] for i in range(3)]
    return [sum(geometry["matrix"][r][axis]*delta[r] for r in range(3))/
            geometry["spacing"][axis] for axis in range(3)]


def independent_reference(raw: bytes):
    rows=csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    if rows.fieldnames!=["seriesuid","coordX","coordY","coordZ","diameter_mm"]:
        raise ValueError("unknown_expert_csv_columns")
    selected=[]
    for item in rows:
        if item["seriesuid"]!=UID:continue
        center=[float(item[k]) for k in ("coordX","coordY","coordZ")]
        size=float(item["diameter_mm"])
        if not all(map(math.isfinite,center+[size])) or not 3<=size<=150:
            raise ValueError("invalid_independent_expert_reference")
        selected.append({"centerLpsMm":center,"diameterMm":size})
    if len(selected)!=1:
        raise ValueError("one_independent_expert_nodule_expected")
    return selected[0]


def check_published_coordinate_transform(config):
    """Confirm vendor's original ITK→world LPS conversion contract.
    Readable bundle source pinned to the same exact pretrained revision.
    """
    preprocessing=config["preprocessing"]["transforms"]
    postprocessing=config["postprocessing"]["transforms"]
    inputs=[x for x in preprocessing
            if x.get("_target_")=="LoadImaged" and x.get("reader")=="itkreader"]
    outputs=[x for x in postprocessing
             if x.get("_target_")=="AffineBoxToWorldCoordinated"]
    modes=[x for x in postprocessing if x.get("_target_")=="ConvertBoxModed"]
    if (len(inputs)!=1 or inputs[0].get("affine_lps_to_ras") is not True or
        len(outputs)!=1 or outputs[0].get("affine_lps_to_ras") is not True or
        len(modes)!=1 or modes[0].get("dst_mode")!="cccwhd" or
        modes[0].get("src_mode")!="xyzxyz" or
        config.get("num_classes")!=1):
        raise ValueError("upstream_world_lps_transform_not_confirmed")
    # MONAI 1.4.0 AffineBoxToWorldCoordinated converts the ITK RAS
    # affine back to LPS when affine_lps_to_ras=True. LUNA16 annotations.csv
    # uses ITK/LPS world mm (see original challenge release).
    return "official_monai_itkreader_lps_to_ras_then_affine_box_to_world_lps"


def compare(report,reference,geometry,config):
    frame=check_published_coordinate_transform(config)
    study=report.get("publicStudy",{})
    model=report.get("model",{})
    cov=report.get("coverage",{})
    if (report.get("schema")!="opus-monai-luna16-real-single-ct-inference/v1"
        or report.get("status")!="genuine_trained_checkpoint_executed_on_public_ct"
        or study.get("sourceSeriesIdSha256")!=UID_SHA
        or study.get("sourceMhdSha256")!=MHD_SHA
        or study.get("sourceRawSha256")!=RAW_SHA
        or study.get("dimensions")!=[512,512,109]
        or study.get("luna16GroundTruthNoduleCount")!=1
        or model.get("weightsSha256")!=MODEL_SHA
        or model.get("revision")!=MODEL_REV
        or model.get("modelCheckpointActualSha256Verified") is not True
        or cov.get("sourceFullCtProcessed") is not True
        or not isinstance(report.get("candidates"),list)
        or report.get("candidateCount")!=len(report["candidates"])):
        raise ValueError("recorded_genuine_inference_unbound_to_reference")
    ref_center=reference["centerLpsMm"]
    ref_voxel=voxel_index(ref_center,geometry)
    if any(x<0 or x>dim-1 for x,dim in zip(ref_voxel,[512,512,109])):
        raise ValueError("expert_annotation_outside_original_ct")
    output=[]
    for c in report["candidates"]:
        center=c["centerMonaiWorldMm"]
        if (len(center)!=3 or any(type(x) not in (int,float) or not math.isfinite(x) for x in center)
            or c.get("coordinateFrameVerifiedAgainstSource") is not False):
            raise ValueError("candidate_world_coordinate_unverified_input")
        native=voxel_index(center,geometry)
        if any(x<0 or x>dim-1 for x,dim in zip(native,[512,512,109])):
            raise ValueError("model_candidate_outside_original_source_ct")
        distance=math.dist(center,ref_center)
        radius=reference["diameterMm"]/2
        research_center_hit=distance<=radius
        score=c["rawClassificationScore"]
        if type(score) not in (int,float) or not math.isfinite(score) or not 0<=score<=1:
            raise ValueError("invalid_model_score")
        output.append({
            "candidateIndex":c["candidateIndex"],
            "rawUncalibratedScore":score,
            "sourceNativeVoxelIndex":[round(v,3) for v in native],
            "centerDistanceToExpertMm":round(distance,3),
            "withinExpertReferenceRadius":research_center_hit,
            "acceptedAtResearchScorePoint5":score>=0.5,
            "referenceCenterMatchAtScorePoint5":research_center_hit and score>=0.5,
        })
    matches=[c for c in output if c["referenceCenterMatchAtScorePoint5"]]
    return {
        "schema":"opus-monai-luna16-independent-expert-center-comparison/v1",
        "status":"genuine_pretrained_predictions_vs_published_expert_center",
        "study":{"sourceSeriesIdSha256":UID_SHA,"sourceMhdSha256":MHD_SHA,
                 "sourceRawSha256":RAW_SHA,"annotationsSha256":ANNOTATIONS_SHA},
        "model":{"id":"monai-lung-nodule-ct-retinanet","revision":MODEL_REV,
                 "checkpointSha256":MODEL_SHA,"previousGenuineCpuRun":38436406805},
        "geometry":{"sourceOriginalDimensions":[512,512,109],
                    "lpsWorldTransformConfirmedByPinnedVendorBundle":True,
                    "transformContract":frame,
                    "noduleReferenceSourceVoxel":[round(x,3) for x in ref_voxel],
                    "clinicalLesionContoursAvailable":False},
        "independentPublishedLuna16ExpertReference":{
            "centerLpsMm":[round(v,5) for v in ref_center],
            "diameterMm":round(reference["diameterMm"],5),
            "standard":"published_centroid_and_diameter_not_expert_voxel_mask",
        },
        "researchScoreThreshold":0.5,
        "modelCandidatesCompared":output,
        "candidateCount":len(output),
        "researchReferenceCenterHitAtScorePoint5":bool(matches),
        "researchCenterHitCandidateIndices":[x["candidateIndex"] for x in matches],
        "referenceLesions":1,
        "datasetHoldoutFromModelTrainingVerified":False,
        "independentClinicalValidation":False,
        "externalValidationSensitivity":None,
        "fullFroc":None,
        "dice":None,
        "falsePositiveClinicalRate":None,
        "patientUseAllowed":False,
        "negativeDiagnosticConclusionAllowed":False,
    }


def main():
    import argparse
    p=argparse.ArgumentParser()
    p.add_argument("--out",type=Path,required=True)
    args=p.parse_args()
    if args.out.exists() or args.out.suffix!=".json":
        raise ValueError("new_json_evidence_output_required")
    raw_csv=fetch_pinned(CSV_URL,ANNOTATIONS_SHA,512000)
    raw_header=fetch_pinned(MHD_URL,MHD_SHA,2048)
    config=json.loads(fetch_pinned(MODEL_CONFIG_URL,None,65536))
    result=compare(json.loads(MODEL_REPORT.read_text()),
                   independent_reference(raw_csv),parse_metaimage(raw_header),config)
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(json.dumps(result,indent=2,ensure_ascii=False))
    print(json.dumps(result,ensure_ascii=False))
    print("Genuine pretrained MONAI output independently compared to LUNA16 center reference; clinical validation FALSE")

if __name__=="__main__":
    main()
