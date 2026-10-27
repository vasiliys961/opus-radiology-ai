#!/usr/bin/env python3
"""Synthetic contract only; actual pretrained forward requires provisioned research host."""
import importlib.util
from pathlib import Path

p=Path(__file__).with_name("run-public-ich-dicom-evidence.py")
spec=importlib.util.spec_from_file_location("real_public_dicom_ich",p)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
sha="a"*64
native=[{"slicePositionMm":float(i),"seriesUid":"1.2.3","sopInstanceUid":f"1.2.3.{i+4}"} for i in range(9)]
base={
 "schema":"opus-ianpan-genuine-public-ich-research/v1",
 "status":"genuine_pretrained_inference_requires_independent_validation",
 "model":{"id":"ianpan/ct-head-hemorrhage-detection","checkpointSha256Verified":True,"revision":"e6d89c2"},
 "source":{"niftiSha256":sha,"sourceOriginalDicomHURescaleIndependentlyVerified":True,
           "modelOrderedSliceCount":len(native)},
 "readyForClinicalUse":False,
 "candidates":[{"class":"intraparenchymal","rawUncalibratedScore":0.68,
                "sourceVoxelProjection":{"boundingBoxNativeNiftiXYZ":[20,30,4,90,110,4],
                  "projectionMethod":"vendor_e6d89c2_lps_reorientation_center_pad_inverse_v1"}}],
}

def deny(bad,order=native,digest=sha):
 try:
  mod.bind_model_to_native_evidence(bad,order,digest)
 except (ValueError,KeyError,TypeError):
  return
 raise AssertionError("unverified model, source, or geometry accepted")

result=mod.bind_model_to_native_evidence(base,native,sha)
assert result["schema"]=="opus-evidence/v1"
assert result["coverage"]=="partially_assessed"
assert len(result["findings"])==1
assert result["findings"][0]["source"]["sopInstanceUid"]=="1.2.3.8"
assert result["findings"][0]["status"]=="requires_recheck"
assert result["findings"][0]["measurements"]["volumeMl"] is None
assert result["findings"][0]["model"]["provider"]=="local"
assert len(result["seriesReviewed"])==1
assert mod.bind_model_to_native_evidence({**base,"candidates":[]},native,sha)["coverage"]=="not_assessed"
assert not mod.bind_model_to_native_evidence({**base,"candidates":[{
 **base["candidates"][0],"sourceVoxelProjection":None}]},native,sha)["findings"]
for key,val in (
 ("schema","invalid"),("status","fake"),("readyForClinicalUse",True),
 ("model",{"id":"unrecognized","checkpointSha256Verified":True,"revision":"e6d89c2"}),
 ("source",{"niftiSha256":"b"*64,"sourceOriginalDicomHURescaleIndependentlyVerified":True,"modelOrderedSliceCount":9}),
 ("candidates",[{**base["candidates"][0],"sourceVoxelProjection":{
     **base["candidates"][0]["sourceVoxelProjection"],"boundingBoxNativeNiftiXYZ":[0,0,12,0,0,12]}}]),
 ("candidates",[{**base["candidates"][0],"sourceVoxelProjection":{
     **base["candidates"][0]["sourceVoxelProjection"],"boundingBoxNativeNiftiXYZ":[0,0,1,0,0,2]}}]),
 ("candidates",[{**base["candidates"][0],"class":"benign"}]),
):
 deny({**base,key:val})
deny(base,native,"b"*64)
deny(base,native[:-1])
deny(base,[{**x,"sopInstanceUid":"same"} for x in native])
print("PASS original ICH report to source DICOM SOP Evidence contract (synthetic fixture only)")
