#!/usr/bin/env python3
"""Genuine, reproducible ONFH subject-level MRI PNG baseline, research only.

Learns linear weights from actual JLU original MRI pixels, not ImageNet or mock
logits. Group duplicate content together; validation is author-dataset internal,
not an independent clinical sensitivity estimate. Save only safe NPZ weights.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score,balanced_accuracy_score,confusion_matrix
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.preprocessing import StandardScaler

SOURCE_SHA="18d1d5a72c350dfc1db836f6d9ae4b0c8c852e50"
CLASSES=("HEALTH","ONFH")
def extract_studies(root):
    out=[]
    for label in CLASSES:
        for folder in sorted((root/label).iterdir()):
            if not folder.is_dir():continue
            images=sorted(folder.glob("*.png"))
            if not 2<=len(images)<=300:raise ValueError("bad_original_study_slices")
            # Fold slices to a subject feature; do NOT split by slice.
            features=[]
            digest=hashlib.sha256()
            for path in images:
                if path.is_symlink() or path.stat().st_size>15*1024**2:raise ValueError("bad_public_slice")
                digest.update(hashlib.sha256(path.read_bytes()).digest())
                with Image.open(path) as im:
                    im=im.convert("L").resize((32,32))
                    pix=np.asarray(im,dtype=np.float32)/255
                features.append(np.r_[pix.ravel(),np.percentile(pix,[10,50,90]),pix.std()])
            data=np.stack(features)
            vec=np.r_[data.mean(axis=0),data.std(axis=0)]
            out.append((label,folder.name,digest.hexdigest(),vec,len(images)))
    if min(sum(z[0]==label for z in out) for label in CLASSES)<10:
        raise ValueError("insufficient_real_original_studies")
    return out

def train(studies,output,seed=2026):
    if output.exists() or output.is_symlink():raise ValueError("new_checkpoint_destination_required")
    vectors=np.stack([z[3] for z in studies]).astype(np.float32)
    labels=np.array([int(z[0]=="ONFH") for z in studies],dtype=int)
    groups=np.array([z[2] for z in studies])
    # Reject duplicates across labels: inconsistent expert truth.
    by_hash={}
    for z in studies:
        if z[2] in by_hash and by_hash[z[2]]!=z[0]:
            raise ValueError("cross_label_duplicate_original_MRI_conflict")
        by_hash[z[2]]=z[0]
    train_i,val_i=next(StratifiedGroupKFold(n_splits=4,shuffle=True,random_state=seed).split(vectors,labels,groups))
    if set(groups[train_i])&set(groups[val_i]):raise ValueError("leaked_original_duplicate_subject")
    if len(set(labels[train_i]))!=2 or len(set(labels[val_i]))!=2:
        raise ValueError("non_stratified_split_lacks_either_class")
    scaler=StandardScaler()
    x_train=scaler.fit_transform(vectors[train_i])
    x_val=scaler.transform(vectors[val_i])
    clf=LogisticRegression(max_iter=600,class_weight="balanced",C=.01,random_state=seed)
    clf.fit(x_train,labels[train_i])
    prob=clf.predict_proba(x_val)[:,1]
    pred=(prob>=.5).astype(int)
    tn,fp,fn,tp=confusion_matrix(labels[val_i],pred,labels=[0,1]).ravel()
    metrics={"schema":"opus-real-onfh-study-weights-v1","dataset":"sole12343/JLU-ONFH-Dataset",
             "sourceCommitSha":SOURCE_SHA,"trainedOnOriginalPatientGroupedMRI":True,
             "architecture":"subject-pooled 32x32 grayscale pixels mean/std + regularized logistic regression",
             "genuineTrainingComplete":True,"trainingStudies":int(len(train_i)),
             "internalValidationStudies":int(len(val_i)),
             "trainPositive":int(labels[train_i].sum()),
             "validationPositive":int(labels[val_i].sum()),
             "heldOutOriginalGroupHashesDisjoint":True,
             "validationTP":int(tp),"validationFP":int(fp),
             "validationTN":int(tn),"validationFN":int(fn),
             "internalStudyAUC":round(float(roc_auc_score(labels[val_i],prob)),6),
             "internalBalancedAccuracy":round(float(balanced_accuracy_score(labels[val_i],pred)),6),
             "independentExternalValidation":False,
             "diagnosisPermitted":False,"clinicalSensitivity":None}
    output.parent.mkdir(parents=True,exist_ok=True)
    np.savez_compressed(output,coef=clf.coef_.astype(np.float32),
        intercept=clf.intercept_.astype(np.float32),
        center=scaler.mean_.astype(np.float32),
        scale=scaler.scale_.astype(np.float32),
        source_sha=np.asarray(SOURCE_SHA))
    report=output.with_suffix(".json")
    report.write_text(json.dumps(metrics,indent=2)+"\n")
    print(json.dumps(metrics))
    return metrics

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--source-root",type=Path,required=True)
    p.add_argument("--checkpoint",type=Path,required=True)
    a=p.parse_args()
    train(extract_studies(a.source_root),a.checkpoint)
if __name__=="__main__":main()
