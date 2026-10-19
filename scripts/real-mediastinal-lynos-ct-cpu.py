#!/usr/bin/env python3
"""Original pretrained Bouget UNet-SW32 on ONE source-licensed LyNoS contrast CT.

GitHub Linux CPU research only; NO patient CT, no Mac, no API, no custom mimic
of publisher architecture or preprocessing. Actual forward runs in ORIGINAL
publisher Docker v1, with non-networked 5.5 GiB capped process.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import shutil
import stat
import subprocess
import sys
import zipfile

SCHEMA="opus-real-original-mediastinal-nodes-lynos-cpu/v1"
PUBLISHER_REPO="https://github.com/dbouget/ct_mediastinal_structures_segmentation"
PUBLISHER_COMMIT="f1eedfe117da9fe5377daa3b2e72fc268e5c7867"
WEIGHTS_DRIVE_ID="1DBIl8JyXEo6YdM9uNyo3vrv5T2WsYSXT"  # author setup.py
WEIGHTS_MD5="434775bebd64910e01f4198eab251666"  # author setup.py
LYNOS_URL="https://zenodo.org/records/10102261/files/LyNoS.zip?download=1"
ORIGINAL_IMAGE="dbouget/ct_mediastinal_structures_segmentation:v1"
MODEL="UNet-SW32"
MAX_WEIGHTS_ZIP=1400*1024*1024
MAX_ZIP_MEMBER=800*1024*1024
MAX_CT_FILE=600*1024*1024
MAX_EXPANDED_MODELS=1650*1024*1024
MIN_FREE_DISK=6*1024**3
MIN_FREE_RAM=6*1024**3
RUNTIME_SECONDS=1600

def digest(path:Path,kind="sha256")->str:
    h=hashlib.new(kind)
    with path.open("rb") as f:
        for b in iter(lambda:f.read(1024*1024),b""):h.update(b)
    return h.hexdigest()

def work_dir(work:Path)->Path:
    root=work.resolve()
    if not root.is_dir() or root.is_symlink():
        raise ValueError("existing_non_symlink_work_directory_required")
    if any(root.iterdir()):
        raise ValueError("work_must_be_initially_empty")
    if shutil.disk_usage(root).free<MIN_FREE_DISK:
        raise ValueError("insufficient_free_disk_on_host")
    if sys.platform!="linux":
        raise ValueError("original_cpu_only_Linux_research_required")
    mem=0
    with open("/proc/meminfo",encoding="ascii") as f:
        for line in f:
            if line.startswith("MemAvailable:"):
                mem=int(line.split()[1])*1024
                break
    if mem<MIN_FREE_RAM:
        raise ValueError("insufficient_cpu_runner_memory")
    return root

def validate_archive_member(info:zipfile.ZipInfo)->bool:
    name=info.filename
    p=Path(name)
    if p.is_absolute() or ".." in p.parts or "\\" in name or not name or "\0" in name:
        raise ValueError("untrusted_archive_member_name")
    if info.file_size<0 or info.file_size>MAX_ZIP_MEMBER:
        raise ValueError("oversized_model_zip_member")
    if (info.external_attr>>16)&0o170000==stat.S_IFLNK:
        raise ValueError("archive_symlinks_forbidden")
    return not info.is_dir()

def verify_publisher_zip(archive:Path,model_dest:Path)->dict:
    if not archive.is_file() or archive.stat().st_size<50000 or archive.stat().st_size>MAX_WEIGHTS_ZIP:
        raise ValueError("original_weights_archive_unbounded")
    if digest(archive,"md5")!=WEIGHTS_MD5:
        raise ValueError("publisher_original_zip_md5_mismatch")
    wanted={"CT_Lungs","UNet-SW32"}
    model_sha={}
    model_dest.mkdir(parents=True,exist_ok=False)
    with zipfile.ZipFile(archive) as z:
        files=z.infolist()
        selected={}
        for info in files:
            if not validate_archive_member(info):continue
            path=Path(info.filename)
            for model in wanted:
                if model not in path.parts:continue
                idx=path.parts.index(model)
                if idx!=len(path.parts)-2:continue
                leaf=path.name
                if leaf in ("model.h5","model.hd5","model.hdf5","model.hdf","model.ckpt","pre_processing.ini"):
                    key=(model,leaf)
                    if key in selected:raise ValueError("duplicate_publisher_model_files")
                    selected[key]=info
        for model in wanted:
            if (model,"pre_processing.ini") not in selected or not any(
                (model,leaf) in selected for leaf in
                ("model.h5","model.hd5","model.hdf5","model.hdf","model.ckpt")):
                raise ValueError("required_original_CT_Lungs_or_UNet_SW32_weights_missing")
        if sum(x.file_size for x in selected.values())>MAX_EXPANDED_MODELS:
            raise ValueError("model_expansion_memory_or_disk_limit")
        for (model,leaf),info in selected.items():
            path=model_dest/model/leaf
            path.parent.mkdir(parents=True,exist_ok=True)
            with z.open(info) as f,path.open("wb") as out:
                shutil.copyfileobj(f,out,1024*1024)
            if path.stat().st_size!=info.file_size:
                raise ValueError("model_archive_extraction_incomplete")
            model_sha[model+"/"+leaf]=digest(path)
    return model_sha

def fetch_original_weights(work:Path)->dict:
    import gdown
    archive=work/"original-publisher-models.zip"
    # Linux file size ceiling stops unexpected huge file, including after redirects.
    resource.setrlimit(resource.RLIMIT_FSIZE,(MAX_WEIGHTS_ZIP,MAX_WEIGHTS_ZIP))
    result=gdown.download(id=WEIGHTS_DRIVE_ID,output=str(archive),quiet=False,fuzzy=False)
    if not result or not archive.is_file():
        raise ValueError("original_Google_Drive_weights_unavailable")
    sha=digest(archive)
    file_hashes=verify_publisher_zip(archive,work/"resources"/"models")
    archive.unlink()
    return {"originalPublisherModelsArchiveMd5":WEIGHTS_MD5,
            "originalPublisherModelsArchiveSha256":sha,"originalPublisherFileSha256":file_hashes}

def fetch_one_expert_case(work:Path)->dict:
    import requests
    from remotezip import RemoteZip
    import nibabel as nib
    import numpy as np
    # Require HTTP range; NEVER fall back to downloading a 2.9 GB whole corpus.
    response=requests.get(LYNOS_URL,headers={"Range":"bytes=0-0"},stream=True,timeout=45)
    try:
        if response.status_code!=206 or not response.headers.get("Content-Range","").startswith("bytes 0-0/"):
            raise ValueError("LyNoS_Zenodo_range_unavailable_do_not_download_whole_2_9GB_zip")
    finally:response.close()
    dest=work/"resources"/"data"
    dest.mkdir(parents=True,exist_ok=True)
    with RemoteZip(LYNOS_URL,timeout=90) as z:
        infos=z.infolist()
        ct=[x for x in infos if x.filename.lower().endswith("/pat1_data.nii.gz")]
        ref=[x for x in infos if x.filename.lower().endswith("/pat1_labels_lymphnodes.nii.gz")]
        if len(ct)!=1 or len(ref)!=1:
            raise ValueError("exact_one_LyNoS_Pat1_original_CT_expert_mask_pair_required")
        for info in (ct[0],ref[0]):
            if not validate_archive_member(info) or info.file_size>MAX_CT_FILE:
                raise ValueError("public_LyNoS_case_too_large")
        for info,target in [(ct[0],dest/"public-source.nii.gz"),
                            (ref[0],work/"expert-lymph-node-mask.nii.gz")]:
            with z.open(info) as inp,target.open("wb") as out:
                shutil.copyfileobj(inp,out,1024*1024)
            if target.stat().st_size!=info.file_size:
                raise ValueError("incomplete_original_CT_or_reference")
    source=nib.load(str(dest/"public-source.nii.gz"))
    reference=nib.load(str(work/"expert-lymph-node-mask.nii.gz"))
    if len(source.shape)!=3 or source.shape!=reference.shape or (
        np.max(np.abs(source.affine-reference.affine))>.001):
        raise ValueError("LyNoS_CT_expert_mask_grid_mismatch")
    if np.prod(source.shape)>200_000_000:
        raise ValueError("LyNoS_case_unbounded_voxels")
    mask=np.asanyarray(reference.dataobj)
    positives=int(np.count_nonzero(mask))
    if positives<20:
        raise ValueError("selected_public_CT_not_expert_positive_for_nodes")
    return {"sourceSha256":digest(dest/"public-source.nii.gz"),
            "expertMaskSha256":digest(work/"expert-lymph-node-mask.nii.gz"),
            "shape":list(source.shape),"expertPositiveVoxelCount":positives}

def prepare(work:Path)->None:
    root=work_dir(work)
    weights=fetch_original_weights(root)
    case=fetch_one_expert_case(root)
    (root/"resources"/"out").mkdir(parents=True,exist_ok=False)
    (root/"resources"/"data"/"runtime_config.ini").write_text(
        "[Predictions]\nnon_overlapping=true\n"
        "reconstruction_method=thresholding\nreconstruction_order=resample_first\n"
        "probability_threshold=0.4\n",encoding="ascii")
    manifest={"schema":SCHEMA,"originalVendorCommit":PUBLISHER_COMMIT,
        "originalPublisherRepo":PUBLISHER_REPO,"originalDockerImageTag":ORIGINAL_IMAGE,
        "originalModel":MODEL,"originalArchiveMD5Verified":True,
        "source": "LyNoS Pat1 source and expert lymph node segmentation",
        "originalExpertReferenceAvailable":True,
        "trainingPopulationIndependenceAudited":False,
        "forwardRunCompleted":False,**weights,**case}
    (root/"verified-preflight.json").write_text(json.dumps(manifest,indent=2)+"\n")
    print("REAL PUBLISHER WEIGHTS + POSITIVE HUMAN MASK VERIFIED",flush=True)
    print(json.dumps({k:v for k,v in manifest.items() if k not in ("originalPublisherFileSha256",)},indent=2))

def evaluate(work:Path,output:Path,docker_digest:str)->None:
    import numpy as np
    import nibabel as nib
    manifest=json.loads((work/"verified-preflight.json").read_text())
    if manifest.get("schema")!=SCHEMA or manifest.get("forwardRunCompleted") is not False or not (
        manifest.get("originalArchiveMD5Verified") is True):
        raise ValueError("original_pretrained_model_source_not_verified")
    target=work/"resources"/"out"
    outputs=[f for f in target.glob("source-*.nii.gz") if (
        "LymphNodes" in f.name or "argmax" in f.name)]
    if len(outputs)!=1:
        raise ValueError("no_unique_original_UNet_SW32_predicted_lymph_node_mask")
    source=work/"resources"/"data"/"public-source.nii.gz"
    reference=work/"expert-lymph-node-mask.nii.gz"
    if digest(source)!=manifest["sourceSha256"] or digest(reference)!=manifest["expertMaskSha256"]:
        raise ValueError("public_lynos_CT_or_expert_reference_sha_changed")
    original=nib.load(str(source));expert=nib.load(str(reference))
    pred=nib.load(str(outputs[0]))
    if pred.shape!=expert.shape or np.max(np.abs(pred.affine-expert.affine))>.001:
        raise ValueError("original_forward_mask_not_on_expert_native_CT_grid")
    p=np.asanyarray(pred.dataobj)>=.5
    y=np.asanyarray(expert.dataobj)>0
    tp=int(np.logical_and(p,y).sum())
    fp=int(np.logical_and(p,~y).sum())
    fn=int(np.logical_and(~p,y).sum())
    if tp+fn<20:raise ValueError("expert_positive_mask_missing")
    dice=(2*tp)/(2*tp+fp+fn) if tp+fp+fn else None
    report={"schema":SCHEMA,"model":"Original Bouget UNet-SW32",
      "originalVendorCommit":PUBLISHER_COMMIT,
      "originalDockerImageDigest":docker_digest,
      "originalArchiveMD5":WEIGHTS_MD5,
      "originalArchiveSha256":manifest["originalPublisherModelsArchiveSha256"],
      "originalCheckpointsSha256":manifest["originalPublisherFileSha256"],
      "sourceCTSha256":manifest["sourceSha256"],"expertMaskSha256":manifest["expertMaskSha256"],
      "sourceCase":"LyNoS benchmark Pat1","sourceShape":manifest["shape"],
      "actualOriginalPretrainedModelForwardCompleted":True,
      "voxelTP":tp,"voxelFP":fp,"voxelFN":fn,"voxelDice":round(dice,6),
      "independentHoldoutProven":False,"radiologistValidation":False,
      "clinicalSensitivitySpecificity":None,"lesionLevelRecall":None,
      "metastaticDiseaseClassification":None,"primaryMediastinalTumorDetection":None,
      "clinicallyValidated":False,"patientUseAllowed":False,
      "originalPatientOrDICOMCloudTransmission":False,
      "limitations":["One LyNoS expert-positive contrast CT is not an independent holdout with exclusion proved.",
        "Published trained UNet-SW32 is a lymph node segmentation model, not a tumor malignancy classifier.",
        "Dice and voxel counts do not establish lesion-level sensitivity or FP/CT.",
        "Research code and original TensorFlow 1.14 remain isolated from browser and main app.",
        "Model output geometry matched original reference affine; no DICOM image identity present."]}
    if output.exists() or not output.parent.is_dir() or output.suffix!=".json":
        raise ValueError("numeric_only_new_output_file_required")
    output.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({k:report[k] for k in
      ("actualOriginalPretrainedModelForwardCompleted","voxelTP","voxelFP","voxelFN","voxelDice")},indent=2))

def run_original_docker(work:Path)->str:
    m=json.loads((work/"verified-preflight.json").read_text())
    if m.get("schema")!=SCHEMA or m.get("forwardRunCompleted") is not False:
        raise ValueError("verified_publisher_preflight_required")
    image_info=subprocess.run(["docker","image","inspect",ORIGINAL_IMAGE,
                  "--format","{{json .RepoDigests}}"],capture_output=True,text=True,check=True,timeout=15)
    from_json=json.loads(image_info.stdout)
    digests=[d for d in from_json if d.startswith("dbouget/ct_mediastinal_structures_segmentation@sha256:")]
    if len(digests)!=1:raise ValueError("original_docker_image_digest_not_available")
    cmd=["docker","run","--rm","--network","none","--cpus","2",
         "--memory","5500m","--memory-swap","5500m","--pids-limit","192",
         "--security-opt","no-new-privileges","--cap-drop","ALL",
         "--user",f"{os.getuid()}:{os.getgid()}",
         "-v",str((work/"resources").resolve())+":/home/ubuntu/resources",
         "--workdir","/home/ubuntu","--entrypoint","python3",
         ORIGINAL_IMAGE,"/home/ubuntu/main.py",
         "-i","/home/ubuntu/resources/data/public-source.nii.gz",
         "-o","/home/ubuntu/resources/out/source","-m",MODEL]
    subprocess.run(cmd,check=True,timeout=RUNTIME_SECONDS)
    return digests[0]

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--mode",choices=("contract","prepare","docker","evaluate"),required=True)
    p.add_argument("--work",type=Path)
    p.add_argument("--output",type=Path)
    p.add_argument("--docker-digest",default="")
    a=p.parse_args()
    if a.mode=="contract":
        assert len(PUBLISHER_COMMIT)==40 and re.fullmatch("[a-f0-9]{32}",WEIGHTS_MD5)
        assert ORIGINAL_IMAGE.endswith(":v1") and MODEL=="UNet-SW32"
        assert LYNOS_URL.startswith("https://zenodo.org/records/10102261/")
        print("Original publisher+LyNoS research contract PASS, real forward NOT executed")
        return
    if a.work is None:raise ValueError("work_is_required")
    if a.mode=="prepare":prepare(a.work)
    if a.mode=="docker":print("DOCKER_DIGEST "+run_original_docker(a.work))
    if a.mode=="evaluate":
        if a.output is None or not a.docker_digest:
            raise ValueError("numeric_output_and_original_docker_digest_required")
        evaluate(a.work,a.output,a.docker_digest)

if __name__=="__main__":main()
