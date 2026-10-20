#!/usr/bin/env python3
"""Original two-stage TotalSpineSeg MRI discs/cord/canal CPU research bridge.

Official pinned v20260807 code and exact two 20260730 author ZIP checkpoints
must be supplied externally. NO implicit model download, patient/cloud mode,
or diagnoses of disk herniation, stenosis, spinal cord compression or MS.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import zipfile

PUBLISHER="https://github.com/neuropoly/totalspineseg"
PUBLISHER_COMMIT="4502d41bcb4a12e44f4be666411461ca81b02d89"
VERSION="20260807"
RELEASE="r20260730"
ZIPS={
 "Dataset101_TotalSpineSeg_step1":"781f81e8c94feccd3cef17d819ba5c293b506e9b1f2b106fc5e31b9dd85887b0",
 "Dataset102_TotalSpineSeg_step2":"494c640ab8cb25475bd0fc4338c0931d37079af9dd19403879335c3908c06b46",
}
# From publisher's pinned totalspineseg/resources/labels_maps/tss_map.json.
LUMBAR_DISCS={"T12-L1":91,"L1-L2":92,"L2-L3":93,"L3-L4":94,"L4-L5":95,"L5-S":100}
ALLOWED={0,1,2,*range(11,18),*range(21,33),*range(41,48),50,
         *range(63,68),*range(71,82),*LUMBAR_DISCS.values()}
MAX_MRI_BYTES=900*1024**2
MAX_VOXELS=120_000_000


def digest(path):
 h=hashlib.sha256()
 with Path(path).open("rb") as source:
  for chunk in iter(lambda:source.read(1024*1024),b""):
   h.update(chunk)
 return h.hexdigest()


def source_image(path):
 import nibabel as nib
 import numpy as np
 if path.is_symlink() or not path.is_file() or not path.name.endswith((".nii.gz",".nii")):
  raise ValueError("original_spine_MRI_NIfTI_required")
 if not 256<=path.stat().st_size<=MAX_MRI_BYTES:
  raise ValueError("unbounded_original_MRI")
 m=nib.load(str(path))
 a=m.affine
 if (len(m.shape)!=3 or np.prod(m.shape,dtype=np.int64)>MAX_VOXELS
     or not np.isfinite(a).all() or not np.allclose(a[3],[0,0,0,1])):
  raise ValueError("invalid_MRI_native_geometry")
 mm=np.linalg.norm(a[:3,:3],axis=0)
 if np.any(mm<.2) or np.any(mm>8) or abs(np.linalg.det(a[:3,:3]))<.01:
  raise ValueError("improbable_MRI_physical_units")
 return m


def verify_archive_and_installed_model(dataset,original_archive,model_dir):
 if dataset not in ZIPS:
  raise ValueError("unrecognized_original_model_task")
 if original_archive.is_symlink() or not original_archive.is_file():
  raise ValueError("original_author_archive_missing")
 if original_archive.stat().st_size>2*1024**3:
  raise ValueError("oversized_model_archive")
 if digest(original_archive)!=ZIPS[dataset]:
  raise ValueError("publisher_GitHub_release_SHA256_mismatch")
 root=model_dir/"nnUNet"/"results"/RELEASE/dataset
 if not root.is_dir() or root.is_symlink():
  raise ValueError("unprovisioned_original_publisher_dataset")
 candidates=list(root.glob("*/fold_0"))
 if len(candidates)!=1 or candidates[0].is_symlink():
  raise ValueError("original_model_fold0_not_unique")
 fold=candidates[0]
 model_name="checkpoint_best.pth" if (fold/"checkpoint_best.pth").is_file() else "checkpoint_final.pth"
 checkpoint=fold/model_name
 if checkpoint.is_symlink() or not checkpoint.is_file():
  raise ValueError("required_original_publisher_checkpoint_missing")
 # Prove the ACTUAL installed model bytes came from the pinned author's ZIP,
 # not merely that a separate official ZIP also existed nearby.
 with zipfile.ZipFile(original_archive) as archive:
  entries=[e for e in archive.infolist() if not e.is_dir()
           and e.filename.replace("\\","/").endswith("/fold_0/"+model_name)]
  if len(entries)!=1 or entries[0].file_size>2*1024**3:
   raise ValueError("official_archive_fold0_checkpoint_ambiguous")
  h=hashlib.sha256()
  with archive.open(entries[0]) as stream:
   for block in iter(lambda:stream.read(1024*1024),b""):
    h.update(block)
  genuine=h.hexdigest()
 if digest(checkpoint)!=genuine:
  raise ValueError("installed_original_checkpoint_not_publisher_zip_bytes")
 for p in (fold.parent/"dataset.json",fold.parent/"plans.json"):
  if p.is_symlink() or not p.is_file():
   raise ValueError("original_dataset_label_map_or_nnunet_plan_missing")
 return {"dataset":dataset,"authorZipSHA256":ZIPS[dataset],
         "installedFold0CheckpointSHA256":genuine,"fold0File":model_name}


def inspect_disc_mask(original,segmentation):
 import numpy as np
 orig=source_image(original)
 mask=source_image(segmentation)
 if orig.shape!=mask.shape or not np.allclose(orig.affine,mask.affine,atol=.02,rtol=0):
  raise ValueError("spine_original_MRI_segmentation_affine_mismatch")
 if mask.get_data_dtype().kind not in "biu":
  raise ValueError("spine_segmentation_mask_not_integer")
 vox=np.asarray(mask.dataobj)
 if not np.isin(vox,list(ALLOWED)).all():
  raise ValueError("not_official_TotalSpineSeg_v20260807_labels")
 volume_unit=abs(float(np.linalg.det(orig.affine[:3,:3])))/1000
 discs=[]
 for name,label in LUMBAR_DISCS.items():
  indices=np.argwhere(vox==label)
  if not indices.size:
   discs.append({"disc":name,"label":label,"present":False,
                 "absenceIsNotANegativeDiagnosis":True})
   continue
  centre=indices.mean(axis=0)
  world=orig.affine@np.r_[centre,1]
  discs.append({"disc":name,"label":label,"present":True,
                "volumeMl":round(len(indices)*volume_unit,5),
                "sourceVoxelBoundsInclusive":[indices.min(axis=0).tolist(),
                                               indices.max(axis=0).tolist()],
                "centroidNiftiRasMm":[round(float(x),3) for x in world[:3]],
                "doesNotMeasureHerniationOrDegenerativeGrade":True})
 return {"sourceMRI_SHA256":digest(original),"originalMaskSHA256":digest(segmentation),
         "labelMapVersion":"publisher TotalSpineSeg r20260730 step2 map",
         "discCandidates":discs,
         "spinalCordMaskVoxels":int(np.count_nonzero(vox==1)),
         "spinalCanalMaskVoxels":int(np.count_nonzero(vox==2)),
         "modelSegmentedAnatomyNotDiskPathologyDetector":True,
         "noSpinalCordCompressionOrStenosisAssessment":True,
         "absenceOfLabelNeverMeansNormal":True,
         "originalRawDICOMFrameMappingVerified":False}


def bounded_cpu(command,env,memory_gib,seconds):
 import psutil
 if not 12<=memory_gib<=30 or not 300<=seconds<=7200:
  raise ValueError("unsafe_original_spine_CPU_limits")
 p=subprocess.Popen(command,env=env,start_new_session=True,
                    stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 start=time.monotonic()
 peak=0
 try:
  while p.poll() is None:
   try:
    root=psutil.Process(p.pid)
    allprocs=[root]+root.children(recursive=True)
    peak=max(peak,sum(x.memory_info().rss for x in allprocs if x.is_running()))
   except (psutil.NoSuchProcess,psutil.AccessDenied):
    pass
   if peak>memory_gib*1024**3:
    raise MemoryError("original_spine_CPU_memory_budget")
   if time.monotonic()-start>seconds:
    raise TimeoutError("original_spine_two_stage_CPU_timeout")
   time.sleep(.25)
  if p.returncode:
   raise RuntimeError("original_TotalSpineSeg_forward_failed")
 finally:
  if p.poll() is None:
   os.killpg(p.pid,signal.SIGKILL)
  p.wait()
 return peak


def execute(a):
 import importlib.metadata
 import shutil
 if not (a.approved_public_research and a.original_MRI_protocol_confirmed
         and a.public_source_url.startswith("https://")
         and a.public_source_license.strip()):
  raise ValueError("approved_public_spine_MRI_research_required")
 source_image(a.mri)
 if digest(a.mri)!=a.mri_sha256.lower():
  raise ValueError("original_MRI_SHA256_unverified")
 if importlib.metadata.version("totalspineseg")!=VERSION:
  raise ValueError("not_pinned_original_publisher_version")
 archive_info=[
  verify_archive_and_installed_model(ds,Path(ar),a.model_dir)
  for ds,ar in ((list(ZIPS)[0],a.step1_zip),(list(ZIPS)[1],a.step2_zip))
 ]
 if a.output_dir.exists() or a.output_dir.is_symlink():
  raise ValueError("refuse_overwriting_existing_original_spine_run")
 cli=shutil.which("totalspineseg")
 if not cli:
  raise RuntimeError("original_TotalSpineSeg_CLI_not_installed")
 env=dict(os.environ,CUDA_VISIBLE_DEVICES="-1",OMP_NUM_THREADS="2",
          MKL_NUM_THREADS="2",TOTALSPINESEG_DATA=str(a.model_dir.resolve()),
          HF_HUB_OFFLINE="1",TRANSFORMERS_OFFLINE="1")
 command=[cli,str(a.mri.resolve()),str(a.output_dir.resolve()),"--device","cpu",
          "--data-dir",str(a.model_dir.resolve()),"--max-workers","1",
          "--max-workers-nnunet","1","--quiet"]
 peak=bounded_cpu(command,env,a.memory_gib,a.timeout_sec)
 masks=list((a.output_dir/"step2_output").glob("*.nii.gz"))
 if len(masks)!=1:
  raise ValueError("no_single_original_final_spine_step2_mask")
 findings=inspect_disc_mask(a.mri,masks[0])
 return {"schema":"opus-true-original-TotalSpineSeg-disc-cord-MRI/v1",
         "publisher":PUBLISHER,"publisherPinnedCommit":PUBLISHER_COMMIT,
         "originalRelease":RELEASE,"publisherModelArchives":archive_info,
         "realTwoStagePretrainedCPUMRIForwardCompleted":True,
         "peakObservedProcessTreeRSSBytes":peak,
         "clinicallyValidated":False,"patientCloudTransfer":False,
         "noMRIStenosisOrDiscHerniationDiagnosis":True,
         **findings}


def main():
 p=argparse.ArgumentParser()
 for key in ("mri","model-dir","step1-zip","step2-zip","output-dir","report"):
  p.add_argument("--"+key,type=Path,required=True)
 p.add_argument("--mri-sha256",required=True)
 p.add_argument("--public-source-url",required=True)
 p.add_argument("--public-source-license",required=True)
 p.add_argument("--approved-public-research",action="store_true")
 p.add_argument("--original-MRI-protocol-confirmed",action="store_true")
 p.add_argument("--memory-gib",type=float,default=16)
 p.add_argument("--timeout-sec",type=int,default=3600)
 a=p.parse_args()
 report=execute(a)
 if a.report.exists() or a.report.is_symlink():
  p.error("numeric_report_must_be_new")
 a.report.parent.mkdir(parents=True,exist_ok=True)
 a.report.write_text(json.dumps(report,indent=2)+"\n")
 print(json.dumps({"realForward":True,"discsFound":
                   sum(int(x["present"]) for x in report["discCandidates"]),
                   "diagnosticallyValidated":False}))


if __name__=="__main__":
 main()
