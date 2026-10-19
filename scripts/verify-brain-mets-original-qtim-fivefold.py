#!/usr/bin/env python3
"""Original QTIM Brain-Mets-Seg source-pinned five-fold checkpoint acquisition.

Downloads all 15 actual TensorFlow publisher-linked artifacts, measures SHA256,
checks checkpoint pointers and gross file structure, removes original weights
unless --keep-weights is explicitly requested on an isolated secure worker.
This is genuine model-provenance evidence, NOT brain MRI inference or clinical Dice.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import urllib.parse
import urllib.request

PUBLISHER_SOURCE_SHA="02d100e106b7076c66293ebcf6e122f8eb8e6e9e"
PUBLISHER_URL="https://github.com/QTIM-Lab/Brain-Mets-Seg"
# The following 15 URLs were extracted in full from the exact pinned vendor Dockerfile.
LINKS = [{"model":0,"filename":"checkpoint","url":"https://www.dropbox.com/scl/fi/3i951l43jxy653bcurrz0/checkpoint?rlkey=mt23dsd3axjbadncabcdi0anf&st=zypk1njw&dl=0"},{"model":0,"filename":"ckpt-best-978.data-00000-of-00001","url":"https://www.dropbox.com/scl/fi/n3kr6edpxvfw900tf080q/ckpt-best-978.data-00000-of-00001?rlkey=1lhl3y9z6u57n27vxtqwvh1g6&st=mb94841u&dl=0"},{"model":0,"filename":"ckpt-best-978.index","url":"https://www.dropbox.com/scl/fi/fc39vcxfdqp0owp445o67/ckpt-best-978.index?rlkey=bczxks3bczwe50g325f7yd021&st=mklcax7x&dl=0"},{"model":1,"filename":"checkpoint","url":"https://www.dropbox.com/scl/fi/g39cdzw43i8tsbbqdyhv7/checkpoint?rlkey=ki8z8erjszvw8p4b21tm4jjsb&st=m5vob3q6&dl=0"},{"model":1,"filename":"ckpt-best-974.data-00000-of-00001","url":"https://www.dropbox.com/scl/fi/jr3159u1s2z0gocj45qya/ckpt-best-974.data-00000-of-00001?rlkey=166i8w8zp8qojurqqm5nw613v&st=wkg4o68h&dl=0"},{"model":1,"filename":"ckpt-best-974.index","url":"https://www.dropbox.com/scl/fi/9u1u9549pr2q4kgpzhm9q/ckpt-best-974.index?rlkey=mliu0ac1ietcg58kut5ttvwkn&st=ob7gtdmr&dl=0"},{"model":2,"filename":"checkpoint","url":"https://www.dropbox.com/scl/fi/93biajhxj07z74glh4cuo/checkpoint?rlkey=lcut88qc86hitw8mc70xahu10&st=4xkh3gcw&dl=0"},{"model":2,"filename":"ckpt-best-986.data-00000-of-00001","url":"https://www.dropbox.com/scl/fi/8jxti5esuy5rv7al7eu24/ckpt-best-986.data-00000-of-00001?rlkey=y2il7bcpi69zhfbebd3vehqie&st=6j7acico&dl=0"},{"model":2,"filename":"ckpt-best-986.index","url":"https://www.dropbox.com/scl/fi/qt34l0h2qja6fq6xb11cj/ckpt-best-986.index?rlkey=bsmjig1o23rq01csdif426avx&st=9nlxglrz&dl=0"},{"model":3,"filename":"checkpoint","url":"https://www.dropbox.com/scl/fi/90c3unaosxvknlmw62s8z/checkpoint?rlkey=08s2v9hev9ywt3kakuw326tay&st=rse8rszf&dl=0"},{"model":3,"filename":"ckpt-best-966.data-00000-of-00001","url":"https://www.dropbox.com/scl/fi/8u0qexg5qxf548zmqxfy8/ckpt-best-966.data-00000-of-00001?rlkey=evldhxl05ijs0ng2apkvskyp1&st=p8xipj4u&dl=0"},{"model":3,"filename":"ckpt-best-966.index","url":"https://www.dropbox.com/scl/fi/rix3n5v55j3aujpymly4d/ckpt-best-966.index?rlkey=brtclv3qsm32hu4v20l3wz5n7&st=iskn593j&dl=0"},{"model":4,"filename":"checkpoint","url":"https://www.dropbox.com/scl/fi/3hk9purhdy3eee8l4dorv/checkpoint?rlkey=zb5t31ffwmc73untv110z71tk&st=ixvdonw3&dl=0"},{"model":4,"filename":"ckpt-best-980.data-00000-of-00001","url":"https://www.dropbox.com/scl/fi/cv6ar0yan8ljvjvglihok/ckpt-best-980.data-00000-of-00001?rlkey=b2c3nzu93jhnpebsqenhy2b22&st=0yfgbu9x&dl=0"},{"model":4,"filename":"ckpt-best-980.index","url":"https://www.dropbox.com/scl/fi/maor96gwcn2e9rfxdlzbc/ckpt-best-980.index?rlkey=fdzotevqmduhvynnmk0h7vnv1&st=y9zefkhb&dl=0"}]
EXPECTED_FOLD0={
 "checkpoint":"25b41153c66d1d5361cc4ab47d1edc6b11bac4074195a0324e5dc62594cdbd3d",
 "ckpt-best-978.index":"111df853fa83eae83cf7f2521ba82987643ec9b5d2f8a622c23d9d7c8b014da1",
 "ckpt-best-978.data-00000-of-00001":"cd156fdf6b361149a96821992511063cc43373c18a78460406a86a7a6bda68a5"
}
MAX_PART_BYTES=1200*1024**2

def trusted_dropbox(url):
    p=urllib.parse.urlsplit(url)
    h=p.hostname or ""
    return p.scheme=="https" and (h=="dropbox.com" or h.endswith(".dropbox.com")
        or h=="dropboxusercontent.com" or h.endswith(".dropboxusercontent.com"))

def download(original, path, fold, filename):
    url=original.replace("&dl=0","&dl=1")
    if not trusted_dropbox(url):
        raise ValueError("vendor_checkpoint_link_outside_Dropbox")
    request=urllib.request.Request(url,headers={"User-Agent":"Opus-QTIM-BrainMets-Original/1"})
    size=0
    h=hashlib.sha256()
    with urllib.request.urlopen(request,timeout=130) as response:
        if response.status!=200 or not trusted_dropbox(response.url):
            raise ValueError("publisher_link_redirect_outside_original_Dropbox")
        with path.open("xb") as f:
            while buf:=response.read(2*1024**2):
                size+=len(buf)
                if size>MAX_PART_BYTES:
                    raise ValueError("publisher_tensorflow_model_part_exceeds_resource_limit")
                h.update(buf)
                f.write(buf)
    with path.open("rb") as f:
        first=f.read(512)
    if b"<html" in first.lower() or b"<!doctype" in first.lower():
        raise ValueError("received_Dropbox_HTML_not_model_weights")
    limit=15 if filename=="checkpoint" else (1000 if filename.endswith(".index") else 1024**2)
    if size<limit:
        raise ValueError("publisher_checkpoint_missing_or_truncated")
    if filename=="checkpoint":
        expected={0:"978",1:"974",2:"986",3:"966",4:"980"}[fold]
        if (b"model_checkpoint_path" not in first or
            f"ckpt-best-{expected}".encode() not in first):
            raise ValueError("vendor_TensorFlow_checkpoint_pointer_not_matching_fold")
    digest=h.hexdigest()
    if fold==0 and digest!=EXPECTED_FOLD0[filename]:
        raise ValueError("previously_verified_fold0_publisher_checkpoint_bytes_changed")
    return {"fold":fold,"vendorFilename":filename,"originalBytes":size,
            "observedSha256":digest}

def run(output,models,keep):
    if output.exists() or output.is_symlink() or output.suffix!=".json":
        raise ValueError("new_numeric_output_required")
    if models.exists() or models.is_symlink():
        raise ValueError("new_ephemeral_checkpoint_dir_required")
    models.mkdir(parents=True,mode=0o700)
    try:
        result=[]
        for row in LINKS:
            fold=row["model"]
            folder=models/f"Model_{fold}"
            folder.mkdir(mode=0o700,exist_ok=True)
            item=download(row["url"],folder/row["filename"],fold,row["filename"])
            result.append(item)
        if len(result)!=15 or any(sum(z["fold"]==i for z in result)!=3 for i in range(5)):
            raise ValueError("not_all_original_five_vendor_TensorFlow_fold_checkpoints")
        report={
            "schema":"opus-brain-mets-original-qtim-full-fivefold-checkpoints/v1",
            "originalPublisher":"QTIM-Lab/Brain-Mets-Seg",
            "vendorCodeCommit":PUBLISHER_SOURCE_SHA,
            "vendorModelLicenseClaim":"Apache-2.0",
            "originalTensorflowWeightParts":result,
            "allFivePublishedFoldWeightsDownloaded":True,
            "publisherSignaturesIndependentlyVerified":False,
            "tensorflowModelCheckpointLoaded":False,
            "realPretrainedBrainMRIInferencePerformed":False,
            "independentExpertDice":None,
            "publicClinicalValidation":False,
            "patientDataProcessed":False,
            "originalWeightsRetainedOutsideCI":keep
        }
        output.write_text(json.dumps(report,indent=2)+"\n")
        print(json.dumps({"realPublisherFiles":len(result),
                          "totalOriginalTrainedCheckpointBytes":sum(x["originalBytes"] for x in result),
                          "allFiveFoldWeightsAcquired":True,
                          "originalTrainedModelMRIInferencePerformed":False,
                          "observedDigests":[f"Model_{x['fold']}/{x['vendorFilename']}: {x['observedSha256']}" for x in result]},indent=2))
    finally:
        if not keep:
            shutil.rmtree(models,ignore_errors=True)

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--model-dir",type=Path,required=True)
    p.add_argument("--keep-weights",action="store_true",
                   help="Only in a secured authorized offline GPU research directory")
    a=p.parse_args()
    run(a.output,a.model_dir,a.keep_weights)
