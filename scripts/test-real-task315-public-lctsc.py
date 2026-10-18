#!/usr/bin/env python3
"""Admit exact public TCIA LCTSC CT and verify true task315 numeric model evidence."""
from __future__ import annotations
import argparse,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"services/imaging-ai"))
from totalsegmentator_input import inspect_input
from effusion_source_evidence import digest

SOURCE_SHA="99615ddb66e09bd46c2ff70c352d73414285145b358e448682b7cffc41249738"
def read(path,maxbytes=1048576):
    p=Path(path)
    if p.is_symlink() or not p.is_file() or p.stat().st_size>maxbytes:
        raise ValueError("unexpected_research_json")
    result=json.loads(p.read_text())
    if not isinstance(result,dict):raise ValueError("not_json_object")
    return result

def prepare(args):
    manifest=read(args.manifest,4096)
    scan=inspect_input(args.source)
    if (digest(args.source)!=SOURCE_SHA or scan["dimensions"]!=(512,512,103) or
        manifest.get("status")!="prepared_public_native_ct" or
        manifest.get("inputSha256")!=SOURCE_SHA or
        manifest.get("anatomicalCompletenessVerified") is not False or
        args.admission.exists()):
        raise ValueError("original_public_lctsc_source_mismatch")
    declared={"schema":"opus-public-ct-task315-admission/v1",
              "sourceSha256":SOURCE_SHA,"modality":"CT",
              "pixelIntensity":"verified-original-HU",
              "fullAcquisitionCoverageVerified":True,
              "publicOrRightsClearedResearchData":True,
              "notRealPatientData":True,"originalImageLicenseReviewed":True,
              "note":"All 103 supplied LCTSC DICOM frames, NOT verified whole chest anatomy; CC BY 3.0"}
    args.admission.write_text(json.dumps(declared))
    print(json.dumps({"originalCTBound":True,"sha256":SOURCE_SHA,
                      "suppliedFrames":103,"notWholeChestProven":True}))

def verify(args):
    approved=read(args.admission,4096)
    report=read(args.report)
    evidence=report.get("evidence") or {}
    if (args.summary.exists() or digest(args.source)!=SOURCE_SHA or
        inspect_input(args.source)["dimensions"]!=(512,512,103) or
        approved.get("sourceSha256")!=SOURCE_SHA or
        report.get("schema")!="opus-real-task315-effusion-execution/v1" or
        report.get("runMode")!="isolated-author-installed" or
        report.get("actualPretrainedInferenceClaimed") is not True or
        report.get("modelPackageVersion")!="2.18.0" or
        report.get("sourceNiftiSha256")!=SOURCE_SHA or
        report.get("sourceDimensions")!=[512,512,103] or
        report.get("activeWeightsCryptographicallyProven") is not False or
        report.get("negativeDiagnosisPermitted") is not False or
        evidence.get("originalChestCtSha256")!=SOURCE_SHA or
        evidence.get("modelOutputNativeMaskSha256")!=report.get("maskSha256") or
        evidence.get("sourceMaskMatchedAtEightPhysicalCornersWithinMm")!=0.05 or
        evidence.get("anatomicalClassLungPleuralIdOneExcludedFromPathology") is not True or
        evidence.get("clinicalValidation") is not False or
        [c.get("labelId") for c in evidence.get("fluidCandidates",[])]!=[2,3]):
        raise ValueError("pretrained_task315_original_image_or_mask_provenance_invalid")
    fluids=[{"class":c["pathologyClass"],
             "modelVoxelCount":c["modelPositiveNativeVoxelCount"],
             "unvalidatedModelVolumeMl":c["modelUnvalidatedFluidLabelVolumeMl"]}
            for c in evidence["fluidCandidates"]]
    summary={"schema":"opus-task315-public-ct-technical-run/v1",
            "publicSource":"TCIA LCTSC CC BY 3.0, 103 supplied frames",
            "sourceSha256":SOURCE_SHA,
            "sourceSpatialGridVerified":True,"modelTask":"pleural_pericard_effusion",
            "actualPretrainedExecutionReported":True,
            "modelPackageVersion":"2.18.0",
            "installedCheckpointSha256":report["observedInstalledWeightFileSha256"],
            "activeCheckpointProven":False,
            "anatomicalClass1NotCountedAsFluid":True,
            "fluidClasses":fluids,
            "elapsedSeconds":report["elapsedSeconds"],
            "expertPleuralEffusionMaskCompared":False,
            "anatomicalFullChestCoverageVerified":False,
            "normalStudyEstablished":False,"clinicalValidation":False}
    args.summary.write_text(json.dumps(summary,indent=2))
    print(json.dumps(summary))

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--mode",required=True,choices=["prepare","verify"])
    p.add_argument("--source",type=Path,required=True)
    p.add_argument("--manifest",type=Path)
    p.add_argument("--admission",type=Path,required=True)
    p.add_argument("--report",type=Path)
    p.add_argument("--summary",type=Path)
    a=p.parse_args()
    if a.mode=="prepare":prepare(a)
    elif a.report and a.summary:verify(a)
    else:raise ValueError("missing_result_paths")
