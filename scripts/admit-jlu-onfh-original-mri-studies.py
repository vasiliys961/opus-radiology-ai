#!/usr/bin/env python3
"""Original JLU ONFH MRI study inventory. No model, image download or diagnosis.

Input is the actual GitHub recursive git tree JSON from the pinned source commit.
Grouping is by ORIGINAL study folder, never by PNG slice or derived 2D split.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

SOURCE="sole12343/JLU-ONFH-Dataset"
PREFIX="orginal_dataset"
CLASSES=("HEALTH","ONFH")

def inspect_tree(tree, source_revision):
    if not re.fullmatch(r"[0-9a-f]{40}",source_revision):
        raise ValueError("original_source_commit_sha_required")
    if not isinstance(tree,dict) or tree.get("truncated") is not False:
        raise ValueError("complete_original_git_tree_required")
    if not isinstance(tree.get("tree"),list) or len(tree["tree"])>30000:
        raise ValueError("unbounded_or_missing_public_source_tree")
    studies={}
    included_paths=set()
    for entry in tree["tree"]:
        if not isinstance(entry,dict) or not isinstance(entry.get("path"),str):
            raise ValueError("invalid_source_entry")
        path=entry["path"]
        segments=path.split("/")
        if segments[0]!=PREFIX or len(segments)!=4:
            continue
        _,label,study,filename=segments
        if label not in CLASSES or entry.get("type")!="blob" or not filename.lower().endswith(".png"):
            continue
        if not re.fullmatch(r"[a-f0-9]{40}",entry.get("sha","")):
            raise ValueError("original_png_git_blob_sha_required")
        if not study or "/" in study or len(study)>120:
            raise ValueError("invalid_original_study_folder")
        key=(label,study)
        if path in included_paths:raise ValueError("duplicate_source_slice_path")
        included_paths.add(path)
        studies.setdefault(key,[]).append((filename,entry["sha"]))
    if not studies or not all(any(k[0]==cls for k in studies) for cls in CLASSES):
        raise ValueError("both_positive_and_negative_original_studies_required")
    if any(len(files)<2 or len(files)>300 for files in studies.values()):
        raise ValueError("unexpected_original_study_slice_count")
    # A folder, not each slice, is an indivisible evaluation unit.
    fingerprints={}
    duplicate_groups=[]
    summaries=[]
    for (label,study),files in sorted(studies.items()):
        names=[f[0] for f in files]
        if len(set(names))!=len(names):raise ValueError("duplicated_study_slice")
        fingerprint=hashlib.sha256(
            json.dumps(sorted(files),separators=(",",":")).encode()).hexdigest()
        if fingerprint in fingerprints and fingerprints[fingerprint]!=(label,study):
            duplicate_groups.append({"firstStudy":list(fingerprints[fingerprint]),"secondStudy":[label,study]})
        fingerprints[fingerprint]=(label,study)
        summaries.append({"label":label,"originalStudyFolder":study,
                          "sliceCount":len(files),"sliceBlobFingerprint":fingerprint})
    counts={cls:sum(item["label"]==cls for item in summaries) for cls in CLASSES}
    return {"schema":"opus-onfh-original-mri-study-admission/v1",
            "sourceRepository":SOURCE,"sourceRevisionSha":source_revision,
            "sourceMedia":"author-published deidentified PNG MRI slices",
            "originalStudyGrouping":"orginal_dataset/{HEALTH,ONFH}/{study-folder}",
            "originalStudyCount":len(summaries),"studyCountsByAuthorLabel":counts,
            "originalPngSliceCount":len(included_paths),"studies":summaries,
            "duplicateStudyContentGroups":duplicate_groups[:100],
            "duplicateStudyContentGroupCount":len(duplicate_groups),
            "safeForStudyLevelTrainTestSplit":not bool(duplicate_groups),
            "sourceDerivedSplitNotIndependent":True,
            "dicomSpatialGeometryAvailable":False,
            "genuineOsteonecrosisModelWeightsVerified":False,
            "pathologyInferenceCompleted":False,
            "clinicalSensitivity":None,"clinicalValidation":False}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--tree-json",type=Path,required=True)
    p.add_argument("--source-commit",required=True)
    p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    if a.tree_json.is_symlink() or not a.tree_json.is_file() or a.tree_json.stat().st_size>8*1024**2:
        raise ValueError("bounded_original_git_tree_metadata_required")
    if a.output.exists() or a.output.is_symlink():
        raise ValueError("new_output_required")
    result=inspect_tree(json.loads(a.tree_json.read_text()),a.source_commit)
    a.output.write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps({k:result[k] for k in ("originalStudyCount","studyCountsByAuthorLabel","originalPngSliceCount","pathologyInferenceCompleted")}))
if __name__=="__main__":main()
