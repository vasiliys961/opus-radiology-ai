#!/usr/bin/env python3
"""REAL official Raidionics ONNX CT_LymphNodes, on vendor public CT, bounded Linux CPU.

Original model, release archive SHA256, publisher raidionicsseg preprocessing,
ONNX Runtime CPU. Model coordinates must match source CT or test fails.
The vendor *test* reference is NOT a clinically independent expert validation.
"""
from __future__ import annotations
import argparse
import configparser
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import time
import zipfile

SCHEMA="opus-original-raidionics-mediastinal-lymphnodes-onnx-research/v1"
MODEL_URL="https://github.com/raidionics/Raidionics-models/releases/download/v1.3.0-rc/Raidionics-CT_LymphNodes-v13.zip"
MODEL_SHA256="922c0e99cb637a872d18b83300a648eb0d782b1ef874c5d33a551285e52ccb08"
MODEL_ARCHIVE_SIZE=105186900
SAMPLE_URL="https://github.com/raidionics/Raidionics-models/releases/download/v1.3.0-rc/Samples-RaidionicsSegLib-UnitTest-Mediastinum-v1.5.zip"
SAMPLE_SHA256="3bc452580051dbea0f67caa52c4eb09c75eafdde9e8e7ff60c3a143ec94dce1f"
SAMPLE_ARCHIVE_SIZE=27321314
MODEL_LIBRARY_VERSION="1.5.2"
MAX_FILE=600*1024**2
MAX_TOTAL_EXPANDED=1250*1024**2
MAX_VOXELS=115_000_000
CPU_RSS_BUDGET=4800*1024**2
TIME_LIMIT=1100

def sha(path:Path):
 h=hashlib.sha256()
 with path.open("rb") as f:
  for c in iter(lambda:f.read(1024*1024),b""):h.update(c)
 return h.hexdigest()

def download(url:str,path:Path,expected_size:int,expected_sha:str):
 import requests
 if path.exists() or url not in (MODEL_URL,SAMPLE_URL):
  raise ValueError("download_invalid_original_resource")
 with requests.get(url,stream=True,timeout=(25,100),allow_redirects=True) as r:
  r.raise_for_status()
  if r.headers.get("Content-Length") and int(r.headers["Content-Length"])>expected_size+1024:
   raise ValueError("unexpected_original_release_asset_size")
  count=0
  with path.open("xb") as f:
   for b in r.iter_content(1024*1024):
    count+=len(b)
    if count>expected_size+1024:raise ValueError("unbounded_vendor_release_download")
    f.write(b)
 if path.stat().st_size!=expected_size or sha(path)!=expected_sha:
  raise ValueError("official_Raidionics_release_asset_SHA256_mismatch")
 print(f"VERIFIED ORIGINAL {path.name} size={expected_size} SHA256={expected_sha}",flush=True)

def safe_extract(archive:Path,destination:Path):
 destination.mkdir(parents=True,exist_ok=False)
 total=0
 with zipfile.ZipFile(archive) as z:
  for item in z.infolist():
   p=Path(item.filename)
   if not item.filename or p.is_absolute() or ".." in p.parts or "\\" in item.filename:
    raise ValueError("untrusted_release_archive_member")
   if ((item.external_attr>>16)&0o170000)==stat.S_IFLNK:
    raise ValueError("original_release_archive_has_symlink")
   if item.file_size>MAX_FILE:raise ValueError("release_asset_member_too_large")
   total+=item.file_size
   if total>MAX_TOTAL_EXPANDED:raise ValueError("release_asset_unbounded_expansion")
   if item.is_dir():continue
   path=destination.joinpath(*p.parts)
   path.parent.mkdir(parents=True,exist_ok=True)
   with z.open(item) as f,path.open("xb") as w:
    shutil.copyfileobj(f,w,1024*1024)
   if path.stat().st_size!=item.file_size:
    raise ValueError("original_model_or_public_CT_incomplete")
 return total

def require_linux_admission(work:Path):
 if sys.platform!="linux":raise ValueError("isolated_Linux_CPU_worker_required")
 if not work.is_dir() or work.is_symlink() or any(work.iterdir()):
  raise ValueError("empty_preexisting_work_directory_required")
 if shutil.disk_usage(work).free<4*1024**3:
  raise ValueError("CPU_worker_insufficient_disk")
 with open("/proc/meminfo",encoding="ascii") as f:
  mem=int(next(x.split()[1] for x in f if x.startswith("MemAvailable:")))*1024
 if mem<5500*1024**2:raise ValueError("CPU_worker_insufficient_RAM")

def find_model(root:Path):
 ini=list(root.rglob("pre_processing.ini"))
 if not ini:raise ValueError("original_Raidionics_model_preprocessing_missing")
 candidates=[]
 for file in ini:
  if list(file.parent.rglob("*.onnx")):candidates.append(file.parent)
 if len(candidates)!=1:
  raise ValueError("original_Raidionics_ONNX_model_dir_ambiguous")
 return candidates[0]

def find_mediastinum_case(root:Path):
 import nibabel as nib
 import numpy as np
 dirs=[p for p in root.rglob("inputs") if p.is_dir() and "mediastinum" in str(p).lower()]
 if len(dirs)!=1:raise ValueError("one_original_vendor_mediastinum_CT_required")
 folder=dirs[0]
 ct=[p for p in folder.glob("*.nii.gz") if "input0" in p.name.lower() and
     "label" not in p.name.lower() and "mask" not in p.name.lower()]
 lungs=[p for p in folder.glob("*.nii.gz") if ("lung" in p.name.lower() and "label" in p.name.lower())]
 if len(ct)!=1 or len(lungs)!=1:
  raise ValueError("vendor_source_CT_and_original_lung_mask_required")
 source=nib.load(str(ct[0]))
 lung=nib.load(str(lungs[0]))
 if len(source.shape)!=3 or source.shape!=lung.shape or np.prod(source.shape)>MAX_VOXELS:
  raise ValueError("vendor_reference_CT_over_resource_budget")
 if not np.allclose(source.affine,lung.affine,atol=.001):
  raise ValueError("source_and_native_lung_mask_geometry_mismatch")
 if np.count_nonzero(np.asanyarray(lung.dataobj))<1000:
  raise ValueError("original_vendor_lung_mask_empty")
 return folder,ct[0],lungs[0],list(source.shape)

def prepare(work:Path):
 require_linux_admission(work)
 model_zip=work/"release-CT_LymphNodes-v13.zip"
 sample_zip=work/"public-vendor-mediastinum-test.zip"
 download(MODEL_URL,model_zip,MODEL_ARCHIVE_SIZE,MODEL_SHA256)
 download(SAMPLE_URL,sample_zip,SAMPLE_ARCHIVE_SIZE,SAMPLE_SHA256)
 safe_extract(model_zip,work/"model-contents")
 safe_extract(sample_zip,work/"sample-contents")
 model=find_model(work/"model-contents")
 inputs,source,lungs,shape=find_mediastinum_case(work/"sample-contents")
 model_sha={str(p.relative_to(model)):sha(p) for p in model.rglob("*.onnx")}
 if len(model_sha)<1 or len(model_sha)>8:raise ValueError("unexpected_original_onnx_count")
 output=(work/"outputs");output.mkdir()
 config=configparser.ConfigParser()
 config["System"]={"gpu_id":"-1","acceleration":"cpu","inputs_folder":str(inputs),
                   "output_folder":str(output),"model_folder":str(model)}
 config["Runtime"]={"batch_size":"1","folds_ensembling":"False",
                   "ensembling_strategy":"average","overlapping_ratio":"0.",
                   "reconstruction_method":"thresholding",
                   "reconstruction_order":"resample_first",
                   "use_preprocessed_data":"False",
                   "test_time_augmentation_iteration":"0",
                   "test_time_augmentation_fusion_mode":"average"}
 config["Mediastinum"]={"lungs_segmentation_filename":str(lungs)}
 cfg=work/"original-model-config.ini"
 with cfg.open("w",encoding="utf-8") as f:config.write(f)
 meta={"schema":SCHEMA,"originalPublisher":"raidionics/Raidionics-models",
       "originalRelease":"v1.3.0-rc","originalModelSHA256":MODEL_SHA256,
       "sourceSampleSHA256":SAMPLE_SHA256,"originalModelFilesSHA256":model_sha,
       "sampleType":"publisher_unittest_not_independent_expert",
       "sourceShape":shape,"sourceSha256":sha(source),"lungMaskSha256":sha(lungs),
       "modelLibraryVersionRequired":MODEL_LIBRARY_VERSION,
       "actualOriginalModelForwardCompleted":False}
 (work/"verified-original-source.json").write_text(json.dumps(meta,indent=2)+"\n")
 model_zip.unlink();sample_zip.unlink()
 print("ORIGINAL ONNX AND ORIGINAL VENDOR PUBLIC CT VERIFIED",flush=True)
 print(json.dumps({k:v for k,v in meta.items() if k!="originalModelFilesSHA256"},indent=2))

def original_ct_file(inputs:Path)->Path:
 candidates=[p for p in inputs.glob("*input0*.nii.gz") if
             "label" not in p.name.lower() and "mask" not in p.name.lower()]
 if len(candidates)!=1:
  raise ValueError("one_original_CT_required_no_lung_mask_confusion")
 return candidates[0]

def inference(work:Path):
 import psutil
 import importlib.metadata
 if importlib.metadata.version("raidionicsseg")!=MODEL_LIBRARY_VERSION:
  raise ValueError("publisher_library_version_not_pinned")
 manifest=json.loads((work/"verified-original-source.json").read_text())
 if manifest.get("schema")!=SCHEMA or manifest.get("actualOriginalModelForwardCompleted") is not False:
  raise ValueError("actual_original_model_preflight_not_verified")
 cfg=work/"original-model-config.ini"
 config=configparser.ConfigParser();config.read(cfg)
 model=Path(config["System"]["model_folder"])
 source=original_ct_file(Path(config["System"]["inputs_folder"]))
 if sha(source)!=manifest["sourceSha256"]:
  raise ValueError("original_CT_source_drift")
 for name,value in manifest["originalModelFilesSHA256"].items():
  if sha(model/name)!=value:raise ValueError("original_ONNX_checkpoint_drift")
 cmd=[sys.executable,"-m","raidionicsseg",str(cfg)]
 env={**os.environ,"OMP_NUM_THREADS":"2","OPENBLAS_NUM_THREADS":"1",
      "MKL_NUM_THREADS":"2","ORT_NUM_THREADS":"2","HF_HUB_OFFLINE":"1",
      "TOKENIZERS_PARALLELISM":"false"}
 now=time.monotonic()
 proc=subprocess.Popen(cmd,env=env,cwd=work,start_new_session=True)
 peak=0
 try:
  while proc.poll() is None:
   peak=max(peak,psutil.Process(proc.pid).memory_info().rss)
   if peak>CPU_RSS_BUDGET:raise MemoryError("publisher_ONNX_cpu_process_RSS_over_4_8GiB")
   if time.monotonic()-now>TIME_LIMIT:raise TimeoutError("publisher_ONNX_CPU_time_cap")
   time.sleep(1)
  if proc.returncode:raise RuntimeError("original_raidionicsseg_CPU_inference_failed")
 finally:
  if proc.poll() is None:
   os.killpg(proc.pid,signal.SIGKILL);proc.wait()
 (work/"inference-completed.json").write_text(json.dumps({"realForward":True,
     "peakMainProcessRSSBytes":peak,"elapsedSeconds":round(time.monotonic()-now,2)}))
 print("PUBLISHER ONNX CPU REAL FORWARD COMPLETED",flush=True)

def evaluate(work:Path,out:Path):
 import nibabel as nib
 import numpy as np
 manifest=json.loads((work/"verified-original-source.json").read_text())
 execution=json.loads((work/"inference-completed.json").read_text())
 if not execution.get("realForward") or out.exists():raise ValueError("no_verified_forward_or_output_not_fresh")
 predictions=list((work/"outputs").glob("labels_LymphNodes.nii.gz"))
 if len(predictions)!=1:
  raise ValueError("publisher_LymphNodes_native_prediction_missing")
 cfg=configparser.ConfigParser();cfg.read(work/"original-model-config.ini")
 inputs=Path(cfg["System"]["inputs_folder"])
 source=original_ct_file(inputs)
 volume=nib.load(str(source));pred=nib.load(str(predictions[0]))
 if sha(source)!=manifest["sourceSha256"]:
  raise ValueError("source_changed_after_forward")
 if pred.shape!=volume.shape or not np.allclose(pred.affine,volume.affine,atol=.001):
  raise ValueError("UNet_source_native_geometry_not_verified")
 x=np.asanyarray(pred.dataobj)
 if x.ndim!=3 or x.dtype.kind not in "iu" or np.any((x!=0)&(x!=1)):
  raise ValueError("original_lymph_node_label_mask_not_binary")
 voxel_count=int(np.count_nonzero(x))
 result={"schema":SCHEMA,"originalModel":"Raidionics CT_LymphNodes ONNX v13",
   "modelLibrary":"raidionicsseg "+MODEL_LIBRARY_VERSION,
   "publisherRelease":"v1.3.0-rc",
   "originalModelAssetSHA256":MODEL_SHA256,
   "originalVendorSampleAssetSHA256":SAMPLE_SHA256,
   "sourceCTSHA256":manifest["sourceSha256"],
   "originalONNXFileSha256":manifest["originalModelFilesSHA256"],
   "actualOriginalPretrainedModelForwardCompleted":True,
   "sourceNativeGridMatch":True,"sourceShape":list(volume.shape),
   "candidateMaskVoxelCount":voxel_count,
   "candidateMaskVolumeMl":round(voxel_count*abs(np.linalg.det(volume.affine[:3,:3]))/1000,3),
   "originalOutputMaskSha256":sha(predictions[0]),
   "peakMainProcessRSSBytes":execution["peakMainProcessRSSBytes"],
   "elapsedSeconds":execution["elapsedSeconds"],
   "sourceType":"vendor_unit_test_sample_not_independent_human_ground_truth",
   "sourceExpertLymphNodeMaskAvailable":False,
   "voxelDiceVsIndependentExpert":None,"lesionLevelRecall":None,
   "caseCount":1,"clinicalValidation":False,"clinicallyUsable":False,
   "metastasisOrCancerEstablished":False,
   "sourceDICOMUIDsOrPatientPHITransferred":False,
   "limitations":[
     "Publisher unit test source, not independently expert-labeled positive case.",
     "Valid original ONNX inference and source voxel mask alone do not establish clinical detection accuracy.",
     "Lymph node segmentation cannot classify malignant vs inflammatory nodes.",
     "One source run cannot exclude other mediastinal masses or lymph node pathology.",
     "Only researcher-controlled Linux CPU execution, not browser patient imaging."
   ]}
 out.write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
 print(json.dumps({k:result[k] for k in ["actualOriginalPretrainedModelForwardCompleted",
   "sourceNativeGridMatch","candidateMaskVoxelCount","candidateMaskVolumeMl",
   "peakMainProcessRSSBytes","elapsedSeconds"]},indent=2),flush=True)

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument("--mode",required=True,choices=("contract","prepare","infer","evaluate"))
 parser.add_argument("--work",type=Path)
 parser.add_argument("--output",type=Path)
 a=parser.parse_args()
 if a.mode=="contract":
  assert re.fullmatch(r"[a-f0-9]{64}",MODEL_SHA256)
  assert re.fullmatch(r"[a-f0-9]{64}",SAMPLE_SHA256)
  assert MODEL_ARCHIVE_SIZE<120*1024**2 and SAMPLE_ARCHIVE_SIZE<35*1024**2
  print("Publisher ONNX release exact SHA and bounded CPU source contract PASS")
  return
 if a.work is None:raise ValueError("work_required")
 if a.mode=="prepare":prepare(a.work)
 if a.mode=="infer":inference(a.work)
 if a.mode=="evaluate":
  if not a.output:raise ValueError("numeric_output_required")
  evaluate(a.work,a.output)
if __name__=="__main__":main()
