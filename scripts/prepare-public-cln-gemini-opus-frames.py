#!/usr/bin/env python3
"""Prepare only PNG rasters from PINNED PUBLIC MSD Lung CT for a licensed research E2E.
Source is the exact CT verified in real CLN worker run 41231610839.
NOT patient data input or a DICOM SOP registration validation.
"""
import argparse,hashlib,json
from pathlib import Path
import nibabel as nib
import numpy as np
from PIL import Image
from huggingface_hub import hf_hub_download

SHA_CT="08b7aa88ee9946b0bf0a5fcd08af1d9b7720c4295e4f900a3e2f13d5c3b6b694"
SHA_NATIVE="941745d629a2242abd373ebfe440bfaa557073233db7693ecb209f41489f8c88"
SHA_MODEL="8c08ec796fa2b786fe99ddfad4fe6314e98fdd8820c59527be3c4105f7955d87"
REVISION="8788e7233406875cf5f2366cf27f8f155fb7a8cf"

def sha(path):
 h=hashlib.sha256()
 with path.open("rb") as f:
  for part in iter(lambda:f.read(1024*1024),b""): h.update(part)
 return h.hexdigest()

def main():
 p=argparse.ArgumentParser()
 p.add_argument("--numeric",type=Path,required=True)
 p.add_argument("--dest",type=Path,required=True)
 a=p.parse_args()
 evidence=json.loads(a.numeric.read_text())
 if (evidence.get("schema")!="opus-original-cln-private-http-positive-public-ct/v1"
     or evidence.get("sourceSha256Compressed")!=SHA_CT
     or evidence.get("sourceSha256UploadedNative")!=SHA_NATIVE
     or evidence.get("publisherCheckpointSHA256")!=SHA_MODEL
     or evidence.get("originalWeightsVerified") is not True
     or evidence.get("realOriginalModelForwardCompleted") is not True
     or evidence.get("testedViaAuthenticatedLocalHttpWorker") is not True
     or evidence.get("candidateCount")!=1
     or len(evidence.get("candidates",[]))!=1
     or evidence.get("clinicalAccuracyValidated") is not False
     or evidence.get("originalDicomSopRegistrationVerified") is not False):
  raise SystemExit("refuse_nonoriginal_or_unbound_CLN_worker_evidence")
 center=evidence["candidates"][0]["sourceVoxelCentroidIJK"]
 volume=evidence["candidates"][0]["candidateVolumeMl"]
 if (not isinstance(center,list) or len(center)!=3
     or any(not isinstance(x,(float,int)) for x in center)
     or not isinstance(volume,(int,float)) or not 0<volume<10000):
  raise SystemExit("invalid_original_candidate")
 ct=Path(hf_hub_download(repo_id="MedOtter/msd-lung",repo_type="dataset",
                         filename="imagesTr/lung_043.nii.gz",revision=REVISION,token=False))
 if ct.stat().st_size>300*1024**2 or sha(ct)!=SHA_CT:
  raise SystemExit("published_MSD_source_checksum_mismatch")
 scan=nib.load(str(ct))
 if len(scan.shape)!=3 or not all(20<n<1000 for n in scan.shape):
  raise SystemExit("unexpected_public_CT_geometry")
 z=int(round(center[2]))
 indices=[min(max(z+delta,0),scan.shape[2]-1) for delta in (-6,-2,2,6)]
 if len(set(indices))!=4: raise SystemExit("insufficient_distinct_public_CT_slices")
 a.dest.mkdir(parents=True,exist_ok=False)
 for i,k in enumerate(indices,1):
  plane=np.asarray(scan.dataobj[:,:,k],dtype=np.float32)
  if not np.isfinite(plane).all():raise SystemExit("CT_NIfTI_not_finite")
  window=(np.clip(plane,-1000,400)+1000)*(255/1400)
  pixels=np.uint8(np.round(window))
  # Public pixel-only PNG with no annotations, NIfTI headers, names or UID.
  Image.fromarray(np.flipud(pixels.T)).convert("RGB").save(a.dest/f"frame-{i}.png",optimize=True)
 print("PINNED MSD SOURCE FRAMES VERIFIED",json.dumps({
  "case":"public-MSD-Lung-043","sourceSHA256":SHA_CT,
  "checkpointSHA256":SHA_MODEL,"sliceCount":4,
  "sourceNiftiOnly":True,"dicomSopRegistrationVerified":False,
  "clinicalAccuracyValidated":False,"license":"CC-BY-SA-4.0"}),flush=True)

if __name__=="__main__":main()
