#!/usr/bin/env python3
"""Verify one REAL FLAIR+expert WMH mask from the original public challenge mirror.

No model forward in this step; cannot claim independence from model training.
No MRI/mask or patient tags uploaded as artifacts.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np

REPO="MedOtter/wmh-segmentation"
FLAIR="data/nii/WMH_Segmentation_Challenge/dataverse_files/test/Singapore/85/orig/FLAIR.nii.gz"
EXPERT="data/nii/WMH_Segmentation_Challenge/dataverse_files/test/Singapore/85/wmh.nii.gz"
MAX_FILE=300*1024**2

def sha(path):
 h=hashlib.sha256()
 with Path(path).open("rb") as f:
  for block in iter(lambda:f.read(1024*1024),b""):h.update(block)
 return h.hexdigest()

def verify(source,truth):
 import nibabel as nib
 image=nib.load(str(source));mask=nib.load(str(truth))
 if len(image.shape)!=3 or image.shape!=mask.shape or np.prod(image.shape)>80_000_000:
  raise ValueError("original_FLAIR_expert_shape_not_aligned")
 if (not np.allclose(image.affine,mask.affine,atol=.02,rtol=0) or
     not np.isfinite(image.affine).all()):
  raise ValueError("original_FLAIR_expert_physical_affine_not_aligned")
 count=0
 for k in range(image.shape[2]):
  block=np.asarray(mask.dataobj[:,:,k])
  if not np.isfinite(block).all() or not np.isin(block,(0,1)).all():
   raise ValueError("expert_WMH_label_ontology_not_binary")
  count+=int(np.count_nonzero(block))
 if count<=0:raise ValueError("expert_reference_not_WMH_positive")
 return {"expertPositiveVoxels":count,"originalShape":list(image.shape),
         "sourceFLAIRSHA256":sha(source),"originalExpertWMHSHA256":sha(truth),
         "sameNativePhysicalGrid":True,"expertMaskIsNotModelPrediction":True,
         "sourceVoxelVolumeMm3":abs(float(np.linalg.det(image.affine[:3,:3])))}

def execute():
 from huggingface_hub import dataset_info,hf_hub_download
 info=dataset_info(REPO,files_metadata=True,token=False)
 if not info.sha or len(info.sha)!=40:raise ValueError("unversioned_source_dataset")
 items={x.rfilename:x for x in info.siblings}
 out={}
 for file,key in ((FLAIR,"source"),(EXPERT,"expert")):
  if file not in items:raise ValueError("actual_public_WMH_file_unavailable")
  entry=items[file]
  if entry.size and entry.size>MAX_FILE:raise ValueError("unbounded_source_MRI")
  path=Path(hf_hub_download(repo_id=REPO,repo_type="dataset",filename=file,revision=info.sha,token=False))
  if path.stat().st_size>MAX_FILE:raise ValueError("oversized_public_FLAIR")
  published=getattr(entry,"lfs",None)
  if published and published.get("sha256") and published["sha256"]!=sha(path):
   raise ValueError("source_dataset_LFS_hash_mismatch")
  out[key]=path
 checked=verify(out["source"],out["expert"])
 return {"schema":"opus-public-original-WMH-expert-FLAIR-admission/v1",
         "dataset":REPO,"sourceRevision":info.sha,"caseReference":"Singapore/85",
         "sourceFLAIRRelativePath":FLAIR,"sourceExpertRelativePath":EXPERT,
         "reportedDatasetLicense":"CC BY 4.0 (mirror card, not independently audited upstream)",
         "officialSplitReportedByMirror":"test",
         "modelTrainingOverlapIndependentlyExcluded":False,
         "realModelForwardCompleted":False,"clinicallyValidated":False,
         "patientCloudTransfer":False,**checked}

def main():
 p=argparse.ArgumentParser()
 p.add_argument("--report",type=Path,required=True)
 a=p.parse_args()
 result=execute()
 if a.report.exists() or a.report.is_symlink():p.error("new_report_path_required")
 a.report.parent.mkdir(parents=True,exist_ok=True)
 a.report.write_text(json.dumps(result,indent=2)+"\n")
 print(json.dumps({"expertPositiveVoxels":result["expertPositiveVoxels"],
                   "sourceFLAIRSHA256":result["sourceFLAIRSHA256"],
                   "realForward":False}))
if __name__=="__main__":main()
