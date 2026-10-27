#!/usr/bin/env python3
"""Synthetic physical-plane contract; no pretrained model executed in CI."""
import importlib.util
from pathlib import Path
import numpy as np

p=Path(__file__).with_name("run-public-ich-dicom-evidence.py")
spec=importlib.util.spec_from_file_location("real_public_dicom_ich",p)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
sha="a"*64
dims=[128,128,9]
affine=np.diag([-1.,-1.,1.,1.])
native=[{
  "slicePositionMm":float(i),
  "seriesUid":"1.2.3","sopInstanceUid":f"1.2.3.{i+4}",
  "imagePositionLpsMm":[0.,0.,float(i)],
  "rowDirectionLps":[1.,0.,0.],"columnDirectionLps":[0.,1.,0.],
  "pixelSpacingMm":[1.,1.],"rows":128,"columns":128,
} for i in range(9)]
roi={
  "boundingBoxNativeNiftiXYZ":[20,30,2,90,110,2],
  "boundingBoxWorldRasMm":[-90.,-110.,2.,-20.,-30.,2.],
  "projectionMethod":"vendor_e6d89c2_lps_reorientation_center_pad_inverse_v1",
}
candidate={"class":"intraparenchymal","rawUncalibratedScore":0.68,"sourceVoxelProjection":roi}
base={
 "schema":"opus-ianpan-genuine-public-ich-research/v1",
 "status":"genuine_pretrained_inference_requires_independent_validation",
 "model":{"id":"ianpan/ct-head-hemorrhage-detection","checkpointSha256Verified":True,"revision":"e6d89c2"},
 "source":{"niftiSha256":sha,"sourceOriginalDicomHURescaleIndependentlyVerified":True,
           "modelOrderedSliceCount":len(native),"sourceDimensionsXYZ":dims},
 "readyForClinicalUse":False,
 "candidates":[candidate],
}

def bind(report=base,order=native,digest=sha,geometry=affine,dims_=dims):
 return mod.bind_model_to_native_evidence(report,order,digest,geometry,dims_)

def deny(report=base,order=native,digest=sha,geometry=affine,dims_=dims):
 try:
  bind(report,order,digest,geometry,dims_)
 except (ValueError,KeyError,TypeError,IndexError):
  return
 raise AssertionError("unverified model, source, or physical DICOM slice accepted")

result=bind()
assert result["schema"]=="opus-evidence/v1"
assert result["coverage"]=="partially_assessed"
assert len(result["findings"])==1
assert result["findings"][0]["source"]["sopInstanceUid"]=="1.2.3.6"
assert result["findings"][0]["status"]=="requires_recheck"
assert result["findings"][0]["measurements"]["volumeMl"] is None
assert result["findings"][0]["model"]["provider"]=="local"
assert len(result["seriesReviewed"])==1
# Reverse file/order arrays and still select the EXACT native physical SOP plane.
assert bind(order=list(reversed(native)))["findings"][0]["source"]["sopInstanceUid"]=="1.2.3.6"
assert bind({**base,"candidates":[]})["coverage"]=="not_assessed"
assert not bind({**base,"candidates":[{**candidate,"sourceVoxelProjection":None}]})["findings"]
for key,value in (
 ("schema","invalid"),("status","fake"),("readyForClinicalUse",True),
 ("model",{"id":"unrecognized","checkpointSha256Verified":True,"revision":"e6d89c2"}),
 ("source",{"niftiSha256":"b"*64,"sourceOriginalDicomHURescaleIndependentlyVerified":True,"modelOrderedSliceCount":9,"sourceDimensionsXYZ":dims}),
 ("candidates",[{**candidate,"sourceVoxelProjection":{**roi,"boundingBoxNativeNiftiXYZ":[0,0,12,0,0,12]}}]),
 ("candidates",[{**candidate,"sourceVoxelProjection":{**roi,"boundingBoxNativeNiftiXYZ":[0,0,1,0,0,2]}}]),
 ("candidates",[{**candidate,"sourceVoxelProjection":{**roi,"boundingBoxWorldRasMm":[-90.,-110.,3.,-20.,-30.,3.]}}]),
 ("candidates",[{**candidate,"class":"benign"}]),
):
 deny({**base,key:value})
deny(digest="b"*64)
deny(order=native[:-1])
deny(dims_=[128,128,10])
deny(geometry=np.diag([-1.,-1.,1.,1.]) @ np.array([
  [1,0,0,0],[0,1,0,0],[0,0,1,100],[0,0,0,1]],dtype=float))
deny(order=[{**x,"sopInstanceUid":"same"} for x in native])
# Co-located duplicate planes must be rejected instead of silently choosing a SOP.
deny(order=[native[2],*native])
# A false same-z label but different in-plane FOV is not a valid mapped plane.
deny(order=[{**x,"imagePositionLpsMm":[500.,500.,x["slicePositionMm"]]} for x in native])
print("PASS verified physical LPS/RAS to native DICOM SOP binding and inverse-order rejection")
