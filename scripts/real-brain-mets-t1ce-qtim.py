#!/usr/bin/env python3
"""Isolated genuine QTIM Brain-Mets-Seg 5-fold T1CE MRI research inference.

Runs *publisher's* TensorFlow/NVIDIA pretrained ensemble from a locally built,
explicitly SHA-pinned vendor Docker image. No fake model, no patient mode,
no automatic model download, no raw pixels or identifiers in output.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

PUBLISHER="QTIM-Lab/Brain-Mets-Seg"
PUBLISHER_SHA="02d100e106b7076c66293ebcf6e122f8eb8e6e9e"
PUBLISHER_URL="https://github.com/QTIM-Lab/Brain-Mets-Seg"
MODEL_LICENSE="Apache-2.0"
SCHEMA="opus-brain-mets-qtim-5fold-t1ce/v1"
INPUT_NAME="t1ce_preprocessed.nii.gz"
OUTPUT_MASK="model_ensemble-label.nii.gz"
OUTPUT_PROB="model_ensemble_probability_map.nii.gz"
OUTPUT_UNCERTAINTY="model_ensemble_uncertainty_entropy_map.nii.gz"
MAX_BYTES=650*1024**2
MAX_VOXELS=512*512*320

def sha(path):
    h=hashlib.sha256()
    with open(path,"rb") as f:
        for chunk in iter(lambda:f.read(4*1024**2),b""):
            h.update(chunk)
    return h.hexdigest()

def parse_public_manifest(path,source):
    if path.is_symlink() or not path.is_file() or path.stat().st_size>40_000:
        raise ValueError("require_small_public_research_manifest")
    j=json.loads(path.read_text())
    if not isinstance(j,dict):
        raise ValueError("invalid_source_manifest")
    required={
        "schema":"opus-public-mri-t1ce-source/v1",
        "modality":"MR",
        "sequence":"T1-CE",
        "publisherCheckpointTrainingOverlapIndependentlyExcluded":False,
        "originalRawDicomGeometryIndependentlyVerified":False,
    }
    for key,value in required.items():
        if j.get(key)!=value:
            raise ValueError("missing_or_unverified_public_T1CE_source_provenance_"+key)
    if j.get("originalT1ContrastAgentConfirmedBySourceDocumentation") is not True:
        raise ValueError("no_independently_documented_contrast_enhanced_T1")
    if j.get("preprocessedSkullStrippedIsotropicN4RegisteredZNormalized") is not True:
        raise ValueError("QTIM_model_expects_verified_upstream_preprocessing")
    if j.get("inputNiftiSha256")!=sha(source):
        raise ValueError("public_source_bytes_not_matching_manifest")
    if j.get("publicLicense") not in ("CC BY 3.0","CC BY 4.0","CC BY-NC 4.0","CC0","UCSF-BMSR noncommercial research"):
        raise ValueError("unapproved_public_MRI_license")
    url=j.get("publicDatasetURL")
    if not isinstance(url,str) or not url.startswith("https://") or len(url)>1000:
        raise ValueError("publisher_dataset_URL_required")
    return j

def validate_volume(path):
    import nibabel as nib
    import numpy as np
    if (path.is_symlink() or not path.is_file() or
        not 1000<=path.stat().st_size<=MAX_BYTES or
        not str(path).endswith(".nii.gz")):
        raise ValueError("require_bounded_original_preprocessed_T1CE_NIFTI")
    im=nib.load(str(path))
    if (im.ndim!=3 or min(im.shape)<32 or max(im.shape)>512
        or math.prod(im.shape)>MAX_VOXELS
        or im.header.get_xyzt_units()[0]!="mm"
        or not np.isfinite(im.affine).all()
        or abs(float(np.linalg.det(im.affine[:3,:3])))<1e-4):
        raise ValueError("invalid_original_T1CE_MRI_physical_grid")
    v=np.asarray(im.dataobj,dtype=np.float32)
    if not np.isfinite(v).all() or not np.any(v!=0):
        raise ValueError("MRI_must_contain_finite_preprocessed_foreground")
    return im

def same_grid(reference,prediction,tolerance_mm=.15):
    import numpy as np
    if (reference.shape!=prediction.shape
        or prediction.ndim!=3
        or not np.isfinite(prediction.affine).all()
        or not np.allclose(reference.affine,prediction.affine,atol=tolerance_mm,rtol=0)):
        raise ValueError("model_output_not_in_same_preprocessed_MRI_physical_grid")

def summarize_prediction(reference,mask,prob,unc,expert=None):
    """Measured masks, spatial extents and independent expert overlap; no pixels."""
    import numpy as np
    from scipy.ndimage import label,find_objects,center_of_mass
    for im in (mask,prob,unc):
        same_grid(reference,im)
    predicted=np.asarray(mask.dataobj)
    if not np.isin(predicted,(0,1)).all():
        raise ValueError("original_binary_metastasis_mask_expected")
    probs=np.asarray(prob.dataobj,dtype=np.float32)
    ent=np.asarray(unc.dataobj,dtype=np.float32)
    if (not np.isfinite(probs).all() or not np.isfinite(ent).all()
        or probs.min() < -1e-5 or probs.max() > 1+1e-5
        or ent.min() < -1e-5 or ent.max() > 1+1e-4):
        raise ValueError("original_model_probability_or_uncertainty_invalid")
    binary=predicted==1
    labels,n=label(binary)
    parts=find_objects(labels)
    ml_per_voxel=abs(float(np.linalg.det(reference.affine[:3,:3])))/1000
    lesions=[]
    for idx,block in enumerate(parts,1):
        if block is None:
            continue
        local=labels[block]==idx
        count=int(local.sum())
        # Centroid by reductions, not a potentially enormous coordinate
        # matrix for large enhancing volumes on a RAM-bounded worker.
        from scipy import ndimage
        origin=np.array([sl.start for sl in block],dtype=np.float64)
        center=np.asarray(ndimage.center_of_mass(local),dtype=np.float64)+origin
        mm=(reference.affine @ np.r_[center,1.])[:3]
        lesions.append({
            "nativeConnectedComponentId":idx,
            "voxels":count,
            "volumeMl":round(count*ml_per_voxel,6),
            "preprocessedVoxelBBox": [[int(s.start),int(s.stop-1)] for s in block],
            "preprocessedRASCentroidMm": [round(float(x),3) for x in mm]
        })
    lesions.sort(key=lambda item:item["voxels"],reverse=True)
    result={
        "sourceGridIsPreprocessedNotRawDicom":True,
        "originalMaskHasBinaryLabels":True,
        "positiveVoxelCount":int(binary.sum()),
        "inferredLesionComponentCount":len(lesions),
        "totalMaskVolumeMl":round(float(binary.sum())*ml_per_voxel,6),
        "lesions":lesions[:250],
        "moreThan250ComponentsNotFullyEnumerated":len(lesions)>250,
        "meanEnsembleUncertainty":round(float(ent.mean()),7),
        "originalExpertMaskAvailable":expert is not None,
        "expertOverlap":None,
    }
    if expert is not None:
        same_grid(reference,expert)
        truth=np.asarray(expert.dataobj)
        if not np.isin(truth,(0,1)).all():
            raise ValueError("only_verified_binary_brain_metastases_expert_mask")
        true=truth==1
        tp=int(np.count_nonzero(binary&true))
        fp=int(np.count_nonzero(binary&~true))
        fn=int(np.count_nonzero(~binary&true))
        result["expertOverlap"]={
            "tpVoxels":tp,"fpVoxels":fp,"fnVoxels":fn,
            "dice":round(2*tp/(2*tp+fp+fn),8) if 2*tp+fp+fn else None,
            "expertMaskIsSamePreprocessedGrid":True,
            "independentHoldoutEstablished":False,
        }
    return result

def verify_original_offline_checkpoints(folder):
    """Check ALL publisher checkpoint hashes observed from genuine original files."""
    import importlib.util
    if folder.is_symlink() or not folder.is_dir():
        raise ValueError("offline_original_vendor_model_dir_required")
    source=Path(__file__).with_name("verify-brain-mets-original-qtim-fivefold.py")
    spec=importlib.util.spec_from_file_location("original_qtim_sha_lock",source)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    expected=module.EXPECTED_FULL_FIVEFOLD_SHA256
    if len(expected)!=15:
        raise ValueError("original_fivefold_registry_incomplete")
    total=0
    for name,digest in expected.items():
        relative=Path(name)
        if len(relative.parts)!=2 or not re.fullmatch(r"Model_[0-4]",relative.parts[0]):
            raise ValueError("invalid_pinned_vendor_checkpoint_path")
        file=folder/relative
        if file.is_symlink() or not file.is_file() or file.stat().st_size>1200*1024**2:
            raise ValueError("original_checkpoint_missing_or_unsafe")
        if sha(file)!=digest:
            raise ValueError("trained_original_QTIM_checkpoint_SHA256_mismatch")
        total+=file.stat().st_size
    if total!=1248034031:
        raise ValueError("original_fivefold_expected_total_bytes_mismatch")
    return total

def docker_call(argv,timeout):
    try:
        res=subprocess.run(argv,timeout=timeout,check=False,
                           stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    except subprocess.TimeoutExpired as e:
        raise RuntimeError("original_pretrained_brain_mets_execution_timeout") from e
    if res.returncode!=0:
        raise RuntimeError("original_pretrained_brain_mets_vendor_execution_failed")

def run(args):
    import nibabel as nib
    source=args.t1ce
    if not args.public_research_consent or not args.license_acknowledged:
        raise ValueError("licensed_deidentified_public_MRI_research_only")
    if (args.output.exists() or args.output.is_symlink()
        or not args.output.parent.is_dir() or args.output.suffix!=".json"):
        raise ValueError("new_numeric_output_JSON_required")
    if not re.fullmatch(r"sha256:[a-f0-9]{64}",args.publisher_image_id):
        raise ValueError("explicit_verified_local_original_vendor_image_ID_required")
    if not re.fullmatch(r"[a-z0-9._/-]+:[a-zA-Z0-9_.-]+",args.publisher_image):
        raise ValueError("local_pinned_publisher_Docker_image_tag_required")
    validate_volume(source)
    provenance=parse_public_manifest(args.manifest,source)
    if args.expert:
        expert=nib.load(str(args.expert))
        same_grid(nib.load(str(source)),expert)
    offline_total=(verify_original_offline_checkpoints(args.checkpoints_dir)
                   if args.checkpoints_dir else None)
    if not shutil.which("docker"):
        raise RuntimeError("isolated_Docker_GPU_worker_not_available")
    image_id=subprocess.run(["docker","image","inspect",args.publisher_image,
                            "--format","{{.Id}}"],capture_output=True,text=True,timeout=30)
    if (image_id.returncode!=0 or image_id.stdout.strip()!=args.publisher_image_id):
        raise ValueError("unverified_or_changed_original_vendor_Docker_image")
    # Publisher's exact 5 TensorFlow checkpoint pairs must be present in image.
    folders=" ".join(f"/workspace/brain_mets_seg/trained_models/Model_{i}" for i in range(5))
    # Checked at execution without printing trained weight bytes or source data.
    verify="; ".join(
        f"test -s /workspace/brain_mets_seg/trained_models/Model_{i}/checkpoint && "
        f"test -n \"$(find /workspace/brain_mets_seg/trained_models/Model_{i} "
        f"-maxdepth 1 -name '*.index' -size +1k -print -quit)\" && "
        f"test -n \"$(find /workspace/brain_mets_seg/trained_models/Model_{i} "
        f"-maxdepth 1 -name '*.data-*' -size +1M -print -quit)\""
        for i in range(5))
    if offline_total is None:
        docker_call(["docker","run","--rm","--network","none","--read-only",
                     "--cap-drop","ALL","--security-opt","no-new-privileges",
                     "--entrypoint","/bin/sh",args.publisher_image,"-c",verify],90)
    with tempfile.TemporaryDirectory(prefix="opus-qtim-brain-mets-") as d:
        path=Path(d)
        shutil.copyfile(source,path/INPUT_NAME)
        # Publisher script expects this exact CSV inside /workspace/brain_mets_seg/data.
        (path/"files_to_segment.csv").write_text(
            "Full_Patient_File_Path,T1_CE_Volume_Name\n"
            "/workspace/brain_mets_seg/data/,t1ce_preprocessed.nii.gz\n")
        # No extra privileges, no internet, and only the ephemeral research
        # scratch directory is mounted. Never mount user DICOM collection.
        command=["docker","run","--rm","--gpus","all","--network","none",
                 "--read-only","--cap-drop","ALL","--pids-limit","512",
                 "--security-opt","no-new-privileges","--memory","28g",
                 "--shm-size","8g","--tmpfs","/tmp:rw,noexec,nosuid,size=2g",
                 "-e","HOME=/tmp","-e","TF_CPP_MIN_LOG_LEVEL=3",
                 "--mount",f"type=bind,source={path.resolve()},target=/workspace/brain_mets_seg/data",
                 "--workdir","/workspace/brain_mets_seg",
                 args.publisher_image,"python","predict.py"]
        if offline_total is not None:
            if "," in str(args.checkpoints_dir.resolve()):
                raise ValueError("unsafe_original_weight_mount_path")
            # A read-only pinned host folder overlays the publisher's
            # unpinned Docker-image checkpoint directory, without network.
            command[command.index("--workdir"):command.index("--workdir")] = [
                "--mount",f"type=bind,source={args.checkpoints_dir.resolve()},target=/workspace/brain_mets_seg/trained_models,readonly"]
        docker_call(command,args.timeout_seconds)
        artifacts=[path/z for z in (OUTPUT_MASK,OUTPUT_PROB,OUTPUT_UNCERTAINTY)]
        if any(not z.is_file() or z.is_symlink() for z in artifacts):
            raise RuntimeError("genuine_original_five_model_ensemble_outputs_missing")
        volume=nib.load(str(path/INPUT_NAME))
        pred=nib.load(str(artifacts[0]))
        prob=nib.load(str(artifacts[1]))
        entropy=nib.load(str(artifacts[2]))
        expert=nib.load(str(args.expert)) if args.expert else None
        findings=summarize_prediction(volume,pred,prob,entropy,expert)
        report={
            "schema":SCHEMA,
            "task":"brain_metastasis_enhancing_T1CE_research",
            "originalPublisher":PUBLISHER,
            "publisherPinnedSourceCommit":PUBLISHER_SHA,
            "publisherCodeAndWeightsLicense":MODEL_LICENSE,
            "localOriginalFiveFoldDockerImageSha256":args.publisher_image_id,
            "trainedFiveFoldOriginalPublisherEnsembleExecutionCompleted":True,
            "offlineFiveFoldOriginalWeightsShaVerified":offline_total is not None,
            "offlineOriginalWeightBytes":offline_total,
            "sourcePreprocessedMRI_SHA256":sha(source),
            "sourcePublicLicense":provenance["publicLicense"],
            "sourceInputImageOriginalMetadataProvenanceVerifiedByOpus":False,
            "originalRawDicomRegistrationIndependentlyVerified":False,
            "sourceTrainingOverlapIndependentlyExcluded":False,
            "originalExpertMaskSha256":sha(args.expert) if args.expert else None,
            "outputSegmentationSha256":sha(artifacts[0]),
            "outputProbabilitySha256":sha(artifacts[1]),
            "outputUncertaintySha256":sha(artifacts[2]),
            "result":findings,
            "researchOnly":True,"patientUseAllowed":False,
            "clinicalGeneralizationValidated":False,
            "limitations":[
                "Original trained ensemble inference only after local GPU Docker checkpoint verification.",
                "Input is correctly preprocessed T1CE NIfTI; raw DICOM-to-MRI mapping unverified.",
                "Brain metastasis segmentation is not a definitive diagnosis or treatment decision.",
                "Patient studies/cloud integration are blocked; research MRI datasets only.",
                "Vendor's five checkpoint files are present but vendor SHA signatures not independently attested.",
                "No independence from original model training cohort unless separately established."
            ]
        }
        args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
        print(json.dumps({"genuineFiveFoldCompleted":True,
                          "positiveVoxels":findings["positiveVoxelCount"],
                          "candidateComponents":findings["inferredLesionComponentCount"],
                          "expertDice":findings["expertOverlap"]["dice"] if findings["expertOverlap"] else None,
                          "clinicalValidation":False}))

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--t1ce",required=True,type=Path)
    p.add_argument("--manifest",required=True,type=Path)
    p.add_argument("--expert",type=Path)
    p.add_argument("--output",required=True,type=Path)
    p.add_argument("--publisher-image",required=True)
    p.add_argument("--publisher-image-id",required=True)
    p.add_argument("--checkpoints-dir",type=Path,help="Optional 15 original QTIM weights SHA pinned in private offline directory")
    p.add_argument("--timeout-seconds",type=int,default=2400)
    p.add_argument("--license-acknowledged",action="store_true")
    p.add_argument("--public-research-consent",action="store_true")
    a=p.parse_args()
    if not 120<=a.timeout_seconds<=7200:
        raise ValueError("bounded_original_GPU_inference_timeout_required")
    run(a)

if __name__=="__main__":
    main()
