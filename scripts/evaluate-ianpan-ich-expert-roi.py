#!/usr/bin/env python3
"""Spatially compare authentic ICH detector ROIs with an AUTHORIZED blood mask.

Important: original pretrained ianpan outputs 512² *research heatmaps* and
source-voxel BOUNDING BOXES, not binary source-space blood segmentations.
We may quantify how much independent expert-labeled BLOOD falls INSIDE those
geometrical envelopes. This is NOT Dice, voxel segmentation recall,
clinical TP, measured model hematoma volume, FROC or clinical sensitivity.

The existing PHE-SICH-CT-IDS reference masks are EDEMA, NOT hematoma;
they are categorically rejected as hemorrhage ground truth. All files stay
local to a rights-authorized, separately provisioned research environment.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
from urllib.parse import urlparse

MAX_BYTES=256*1024*1024
MAX_VOXELS=512*512*128
MODEL_SOURCE_HASH="9792e50ad1d863e80a549d391ee53c5031d490abb75acba42d471b02a83fbafb"
SUPPORTED_CLASSES={"IPH":"intraparenchymal","IVH":"intraventricular",
                   "SAH":"subarachnoid","SDH":"subdural","EDH":"epidural"}
REPORT_SCHEMA="opus-ianpan-expert-hemorrhage-roi-spatial-comparison/v1"
SOURCE_REPORT_SCHEMA="opus-ianpan-genuine-public-ich-research/v1"


def evaluator_module():
    path=Path(__file__).with_name("evaluate-ich-public-mask.py")
    spec=importlib.util.spec_from_file_location("ich_mask_reference",path)
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def union_module():
    path=Path(__file__).with_name("build-ich-expert-binary-union.py")
    spec=importlib.util.spec_from_file_location("ich_expert_label_ontology",path)
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def approved_https(value:str):
    if not isinstance(value,str) or not 10<len(value)<=512:
        raise ValueError("expert_reference_public_citation_url_required")
    parsed=urlparse(value)
    if (parsed.scheme!="https" or not parsed.hostname or
        parsed.username or parsed.password or parsed.query or parsed.fragment):
        raise ValueError("expert_reference_citation_requires_clean_https")
    if parsed.hostname.lower() in ("localhost","127.0.0.1","::1"):
        raise ValueError("external_reference_provenance_required")
    return value


def safe_json(path:Path,maxsize=65536):
    if (path.is_symlink() or not path.is_file() or
        not 1<=path.stat().st_size<=maxsize):
        raise ValueError("bounded_regular_json_required")
    return json.loads(path.read_text(encoding="utf-8"))


def check_expert_provenance(doc,source_hash,mask_hash,ontology_hash,ontology):
    """Operator-attested metadata: NOT an external independent annotation audit."""
    if not isinstance(doc,dict) or doc.get("schema")!="opus-ich-external-hematoma-reference-admission/v1":
        raise ValueError("independent_expert_blood_reference_manifest_required")
    if (doc.get("sourceCtSha256")!=source_hash or
        doc.get("originalExpertMaskSha256")!=mask_hash or
        doc.get("originalOntologySha256")!=ontology_hash or
        doc.get("annotationTissue")!="HEMORRHAGE_BLOOD_NOT_EDEMA" or
        doc.get("maskWasDrawnIndependentlyOfEvaluatedModel") is not True or
        doc.get("originalExpertLabelmapUnmodified") is not True or
        doc.get("referenceDatasetResearchRightsReviewed") is not True or
        doc.get("researchUseAuthorized") is not True or
        doc.get("expertReferenceAuthenticityIndependentlyAuditedByOpus") is not False or
        doc.get("sourceNiftiGridResampledForEvaluation") is not False or
        doc.get("labelOntology")!=ontology["labelMeaning"]):
        raise ValueError("original_expert_hemorrhage_reference_provenance_not_satisfied")
    url=approved_https(doc.get("originalExpertMaskCitationUrl"))
    # A published edema mask MUST NEVER be relabeled as an expert hemorrhage mask.
    url_lower=url.lower()
    forbidden=("phe-sich-ct-ids","23957937","perihematomal","edema","oedema")
    if any(token in url_lower for token in forbidden):
        raise ValueError("published_perihematomal_edema_is_not_hematoma_reference")
    if doc.get("originalExpertMaskCitationUrl")==doc.get("sourceDatasetUrl") and         any(token in str(doc.get("sourceDatasetUrl","")).lower() for token in forbidden):
        raise ValueError("source_dataset_edema_mask_cannot_be_blood_truth")
    return True


def check_real_model_report(report,source_hash,source_dims):
    if (not isinstance(report,dict) or report.get("schema")!=SOURCE_REPORT_SCHEMA or
        report.get("status")!="genuine_pretrained_inference_requires_independent_validation" or
        report.get("model",{}).get("id")!="ianpan/ct-head-hemorrhage-detection" or
        report["model"].get("revision")!="e6d89c2" or
        report["model"].get("sha256ByArtifact",{}).get("inference.py")!=MODEL_SOURCE_HASH or
        report["model"].get("checkpointSha256Verified") is not True or
        report.get("source",{}).get("niftiSha256")!=source_hash or
        report["source"].get("sourceDimensionsXYZ")!=list(source_dims) or
        report["source"].get("modelOrderedSliceCount") not in range(8,129) or
        report["source"].get("researchRoiVoxelGeometryProjectionAvailable") is not True or
        report.get("externalExpertHemorrhageLocalizationComparisonPerformed") is not False or
        report.get("readyForClinicalUse") is not False or
        report.get("modelInputHeatmapsAreSourceAligned") is not False or
        report.get("dice") is not None or
        report.get("sensitivity") is not None or
        not isinstance(report.get("candidates"),list) or len(report["candidates"])>768):
        raise ValueError("genuine_trained_ich_report_not_bound_to_original_source")
    for c in report["candidates"]:
        if (not isinstance(c,dict) or c.get("class") not in
            (*SUPPORTED_CLASSES.values(),"any") or
            not isinstance(c.get("sliceIndexModelOrdered"),int) or
            not 0<=c["sliceIndexModelOrdered"]<report["source"]["modelOrderedSliceCount"] or
            c.get("clinicallyConfirmed") is not False or
            not isinstance(c.get("rawUncalibratedScore"),(int,float)) or
            not math.isfinite(c["rawUncalibratedScore"]) or
            not .5<=c["rawUncalibratedScore"]<=1):
            raise ValueError("invalid_trained_ich_candidate")
    return True


def check_mask_types_and_ontology(ref_nii,meanings):
    import numpy as np
    if ref_nii.header.get_data_dtype().kind not in ("u","i"):
        raise ValueError("expert_labelmap_requires_original_integer_masks")
    proxy=ref_nii.dataobj
    if (not math.isclose(float(proxy.slope),1.,abs_tol=1e-9) or
        not math.isclose(float(proxy.inter),0.,abs_tol=1e-9)):
        raise ValueError("expert_labelmap_must_not_be_rescaled")
    arr=np.asanyarray(proxy)
    if arr.size>MAX_VOXELS:
        raise ValueError("expert_labelmap_too_large")
    labels=set(int(x) for x in np.unique(arr))
    if not labels.issubset({0,*meanings.keys()}):
        raise ValueError("unknown_or_edema_label_cannot_be_interpreted_as_blood")
    if all(x==0 for x in labels):
        raise ValueError("independently_annotated_blood_reference_must_be_nonempty")
    return arr


def evaluate_roi_geometry(report,expert,meanings,voxel_ml):
    import numpy as np
    from scipy import ndimage
    if expert.ndim!=3 or not math.prod(expert.shape)<=MAX_VOXELS:
        raise ValueError("unsupported_original_3d_expert_mask")
    result=[]
    for label,category in sorted(meanings.items()):
        class_name=SUPPORTED_CLASSES[category]
        match=expert==label
        ref_count=int(np.count_nonzero(match))
        if ref_count==0:
            result.append({"referenceClass":category,"label":label,
                           "referencePositiveVoxels":0,"expertReferenceVolumeMl":0.,
                           "subtypeCandidateBoxes":0,
                           "expertVoxelShareInsideModelBoxes":None,
                           "expertComponentsWithBoxIntersection":0,
                           "expertComponentsTotal":0,
                           "modelPredictedHematomaVolumeMl":None})
            continue
        proposed=np.zeros(expert.shape,dtype=np.bool_)
        model_scores=[]
        for c in report["candidates"]:
            if c["class"]!=class_name:continue
            projection=c.get("sourceVoxelProjection")
            if projection is None:continue
            if (not isinstance(projection,dict) or
                projection.get("independentlyClinicallyVerified") is not False or
                projection.get("expertMaskCompared") is not False or
                projection.get("projectionMethod")!="vendor_e6d89c2_lps_reorientation_center_pad_inverse_v1"):
                raise ValueError("model_source_bbox_is_not_verified_for_spatial_audit")
            b=projection.get("boundingBoxNativeNiftiXYZ")
            if (not isinstance(b,list) or len(b)!=6 or
                any(type(x) is not int or x<0 or x>=expert.shape[i%3] for i,x in enumerate(b)) or
                any(b[i]>b[i+3] for i in range(3)) or
                b[2]!=b[5]):
                raise ValueError("model_bbox_is_not_a_valid_original_native_slice")
            proposed[b[0]:b[3]+1,b[1]:b[4]+1,b[2]:b[5]+1]=True
            model_scores.append(c["rawUncalibratedScore"])
        contact=match&proposed
        contact_count=int(np.count_nonzero(contact))
        # 6-connected ORIGINAL expert fragments are not automatically separate
        # clinical lesions. Contact means only overlap with a model BOX.
        structure=ndimage.generate_binary_structure(3,1)
        labels,total=ndimage.label(match,structure=structure)
        touched=len(set(int(v) for v in np.unique(labels[contact]))-{0})
        result.append({
           "referenceClass":category,"label":label,
           "referencePositiveVoxels":ref_count,
           "expertReferenceVolumeMl":round(ref_count*voxel_ml,6),
           "subtypeCandidateBoxes":len(model_scores),
           "maxRawUncalibratedScore":round(max(model_scores),6) if model_scores else None,
           "expertVoxelsInsideModelBoxUnion":contact_count,
           "expertVoxelShareInsideModelBoxes":round(contact_count/ref_count,8),
           "expertComponentsWithBoxIntersection":touched,
           "expertComponentsTotal":int(total),
           "modelBoundingBoxVoxelCountNotAValidHematomaVolume":
               int(np.count_nonzero(proposed)),
           "expertReferenceNotCoveredVoxels":ref_count-contact_count,
           "modelPredictedHematomaVolumeMl":None,
           "modelVoxelsSegmentedWithIndependentExpertMask":False,
           "geometricBoxContactIsClinicalTruePositive":False,
        })
    return result


def run(args):
    e=evaluator_module()
    source=e.check_file(Path(args.source))
    expert=e.check_file(Path(args.expert_mask))
    if source==expert:raise ValueError("source_ct_and_blood_reference_must_be_distinct")
    if e.sha256(source)!=e.check_sha(args.source_sha256) or        e.sha256(expert)!=e.check_sha(args.expert_sha256):
        raise ValueError("immutable_original_ct_or_expert_mask_sha256_mismatch")
    report=safe_json(Path(args.genuine_model_report),2*1024*1024)
    ontology_path=Path(args.original_ontology)
    ontology=safe_json(ontology_path)
    meanings=union_module().check_ontology(ontology)
    source_nii,source_affine,voxel_ml=e.load_geometry(source)
    if math.prod(source_nii.shape)>MAX_VOXELS:
        raise ValueError("bounded_original_ct_for_ich_audit_required")
    expert_nii,expert_affine,_=e.load_geometry(expert,source_nii.shape)
    e.assert_same_grid(source_affine,expert_affine,source_nii.shape)
    check_real_model_report(report,args.source_sha256,source_nii.shape)
    if args.permission_token!="REVIEW-TRUE-HEMORRHAGE-REFERENCE" or not args.rights_attested:
        raise ValueError("public_research_and_original_hematoma_rights_required")
    provenance=safe_json(Path(args.reference_manifest))
    check_expert_provenance(provenance,args.source_sha256,args.expert_sha256,
                           e.sha256(ontology_path),ontology)
    mask=check_mask_types_and_ontology(expert_nii,meanings)
    spatial=evaluate_roi_geometry(report,mask,meanings,voxel_ml)
    out=Path(args.output)
    if (out.exists() or out.is_symlink() or out.suffix!=".json"
        or out.parent.is_symlink() or not out.parent.is_dir()):
        raise ValueError("new_research_json_output_required")
    result={
      "schema":REPORT_SCHEMA,
      "status":"authentic_model_roi_vs_operator_attested_original_hemorrhage_mask",
      "referenceDescription":"HEMORRHAGE_BLOOD_NOT_EDEMA",
      "evidenceHashes":{
         "sourceCtSha256":args.source_sha256,
         "originalExpertMaskSha256":args.expert_sha256,
         "originalOntologySha256":e.sha256(ontology_path),
         "modelResearchReportSha256":e.sha256(Path(args.genuine_model_report)),
      },
      "originalNativeShapeXYZ":list(source_nii.shape),
      "referenceGridMatchesSourceWithin005Mm":True,
      "allOriginalCtSlicesAvailable":True,
      "sourceResampled":False,
      "modelCheckpointSha256VerifiedInSourceReport":True,
      "referenceAnnotationAuthenticityIndependentlyAuditedByOpus":False,
      "referenceRightsAttestedByOperator":True,
      "comparisonMethod":"expert_blood_voxel_fraction_inside_union_of_model_source_bbox_envelopes",
      "referenceClasses":spatial,
      "falsePositivePerCase":None,
      "clinicalTruePositiveCount":None,
      "modelPredictedHematomaVolumeMl":None,
      "hematomaSegmentationDice":None,
      "clinicalSensitivity":None,
      "heldOutFromTrainingProven":False,
      "sourceDICOMRescaleIndependentlyAudited":False,
      "clinicalValidation":False,
      "patientDiagnosticUseAllowed":False,
      "limitations":[
        "The independent blood-mask annotation and its ontology are operator attested, not audited by Opus.",
        "A model's rectangular bounding envelopes do not segment blood. Even perfect box coverage is NOT Dice, sensitivity, or a proven true positive.",
        "Published PHE-SICH-CT-IDS perihematomal EDEMA masks are prohibited as blood reference.",
        "Only one authorized case; no external cohort-level performance or clinical diagnosis.",
      ],
    }
    out.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"sourceVerified":True,"classes":len(spatial),
                      "expertSpatialContactMeasured":True,
                      "hematomaDice":None,"clinicalValidation":False}))
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ("source","expert-mask","source-sha256","expert-sha256",
                "genuine-model-report","original-ontology","reference-manifest",
                "permission-token","output"):
        parser.add_argument("--"+key,required=True)
    parser.add_argument("--rights-attested",action="store_true")
    args=parser.parse_args()
    run(args)


if __name__=="__main__":main()
