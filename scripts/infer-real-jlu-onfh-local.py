#!/usr/bin/env python3
"""Local CPU ONFH subject-level MRI research inference using actual trained NPZ.

Accepts only original-style directories of 2..300 PNG MR slices (NOT DICOM/NIfTI).
No network, pickle, provider API, image uploads, or learned segmentation.
Clinical-style narrative is a preliminary AI interpretation with limitations.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
import numpy as np
from PIL import Image

SOURCE_SHA="18d1d5a72c350dfc1db836f6d9ae4b0c8c852e50"
FEATURE_DIM=2056

def sha256(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):
            h.update(chunk)
    return h.hexdigest()

def extract_subject(folder):
    if folder.is_symlink() or not folder.is_dir():
        raise ValueError("original_MRI_subject_PNG_directory_required")
    files=sorted(folder.glob("*.png"))
    if not 2<=len(files)<=300:
        raise ValueError("subject_must_contain_2_to_300_original_PNG_slices")
    measurements=[]
    for path in files:
        if path.is_symlink() or not path.is_file() or path.stat().st_size>15*1024**2:
            raise ValueError("unsafe_or_unbounded_original_MRI_slice")
        with Image.open(path) as im:
            if im.width>4096 or im.height>4096:
                raise ValueError("unbounded_MRI_pixel_dimensions")
            pixels=np.asarray(im.convert("L").resize((32,32)),dtype=np.float32)/255
        measurements.append(np.r_[pixels.ravel(),
                                  np.percentile(pixels,[10,50,90]),pixels.std()])
    data=np.stack(measurements)
    features=np.r_[data.mean(axis=0),data.std(axis=0)]
    if features.shape!=(FEATURE_DIM,) or not np.isfinite(features).all():
        raise ValueError("invalid_original_MRI_subject_features")
    return features,len(files)

def load_model(weights,expected_sha):
    if not re.fullmatch("[a-f0-9]{64}",expected_sha):
        raise ValueError("original_trained_weights_SHA256_required")
    if (weights.is_symlink() or not weights.is_file() or
        not 1024<weights.stat().st_size<1024*1024 or
        sha256(weights)!=expected_sha):
        raise ValueError("real_trained_ONFH_checkpoint_missing_or_hash_mismatch")
    with np.load(weights,allow_pickle=False) as z:
        if set(z.files)!={"coef","intercept","center","scale","source_sha"}:
            raise ValueError("unexpected_ONFH_checkpoint_schema")
        if str(z["source_sha"].item())!=SOURCE_SHA:
            raise ValueError("original_model_training_source_changed")
        coef=np.asarray(z["coef"],dtype=np.float64)
        intercept=np.asarray(z["intercept"],dtype=np.float64)
        center=np.asarray(z["center"],dtype=np.float64)
        scale=np.asarray(z["scale"],dtype=np.float64)
    if (coef.shape!=(1,FEATURE_DIM) or intercept.shape!=(1,)
        or center.shape!=(FEATURE_DIM,) or scale.shape!=(FEATURE_DIM,)
        or not all(np.isfinite(a).all() for a in (coef,intercept,center,scale))
        or (scale<=0).any()):
        raise ValueError("unsafe_real_checkpoint_tensors")
    return coef[0],intercept[0],center,scale

def classify(features,model):
    coef,intercept,center,scale=model
    logit=float(np.dot((features-center)/scale,coef)+intercept)
    prob=float(np.exp(-np.logaddexp(0.,-logit)))
    if not np.isfinite(prob):raise ValueError("nonfinite_model_probability")
    return prob

def make_report(prob,images,weights_hash):
    raised=prob>=0.5
    statement=("Алгоритмическая оценка МРТ: выявлен повышенный показатель признаков, "
               "ассоциированных с остеонекрозом головки бедренной кости (ONFH)."
               if raised else
               "Алгоритмическая оценка МРТ: показатель признаков ONFH ниже "
               "исследовательского порога модели; исключить остеонекроз нельзя.")
    return {
        "schema":"opus-onfh-local-preliminary-impression/v1",
        "task":"femoral_head_osteonecrosis_MRI",
        "model":"genuine-JLU-ONFH-subject-pooled-logistic-baseline",
        "trainedCheckpointSHA256":weights_hash,
        "originalTrainingRepository":"sole12343/JLU-ONFH-Dataset",
        "originalTrainingRevision":SOURCE_SHA,
        "inputFormat":"original-subject-PNG-MRI-slices",
        "analyzedSliceCount":images,
        "researchONFHScore":round(prob,6),
        "scoreIsCalibratedClinicalProbability":False,
        "researchDecisionThreshold":0.5,
        "researchAboveThreshold":raised,
        "preliminaryClinicalImpression":statement,
        "clinicalRecommendations":"Сопоставить с симптомами, МР-последовательностями, изображениями и заключением рентгенолога. При клиническом подозрении на ONFH необходим полноценный визуальный пересмотр независимо от результата модели.",
        "limitations":[
            "Предварительная исследовательская оценка, не окончательный диагноз.",
            "Не обучалась для полноценного DICOM/NIfTI и не проверена на иной МР-последовательности.",
            "Нет локализации очага, стадии ARCO, оценки коллапса головки или исключения другой патологии.",
            "На внутренней выборке 35 исследований: 8 TP, 3 FN, 2 FP, 22 TN; независимой валидации нет.",
            "Численный score не является калиброванной вероятностью заболевания.",
            "Результат не должен самостоятельно определять лечение или исключать ONFH."
        ],
        "independentClinicalValidation":False,
        "diagnosisConfirmed":False,
        "imageOrPatientDataUploaded":False
    }

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--subject-png-dir",type=Path,required=True)
    p.add_argument("--weights",type=Path,required=True)
    p.add_argument("--weights-sha256",required=True)
    p.add_argument("--report",type=Path,required=True)
    args=p.parse_args()
    if args.report.exists() or args.report.is_symlink():
        raise ValueError("numeric_and_clinical_report_must_be_new")
    model=load_model(args.weights,args.weights_sha256)
    data,n=extract_subject(args.subject_png_dir)
    report=make_report(classify(data,model),n,args.weights_sha256)
    args.report.parent.mkdir(parents=True,exist_ok=True)
    args.report.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n")
    print(json.dumps({"researchONFHScore":report["researchONFHScore"],
        "preliminaryClinicalImpression":report["preliminaryClinicalImpression"],
        "diagnosisConfirmed":False},ensure_ascii=False))
if __name__=="__main__":main()
