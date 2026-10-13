#!/usr/bin/env python3
"""Pin one REAL LUNA16-positive public CT from a fixed HF revision.

Default --plan needs only 137 kB published annotations + HF directory listing.
--download is for an explicitly permitted external GPU worker ONLY.
NEVER accepts patient paths; never calls a medical model; never exports identifiers.
"""
import argparse
import csv
import hashlib
import json
import math
import re
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import quote

ANNOTATIONS_URL=("https://huggingface.co/datasets/MedOtter/LUNA16/resolve/"
                 "fb396557c4e23feaf9c432cea7fc8426214648fb/annotations.csv")
ANNOTATIONS_SHA="db9adb75b381f3e95b1f601d9b63f2e42bd6536ab5a06dc539c5ec8a4005cec7"
DATASET="Yousra0x0/LUNA16_RAW"
REV="af8fdf04c27dcaa97ccfd755043d8096299d6a40"
TREE_URL=f"https://huggingface.co/api/datasets/{DATASET}/tree/{REV}/subset0?limit=1000&expand=true"
UID=re.compile(r"^1\.3\.6\.1\.4\.1\.14519\.5\.2\.1\.6279\.6001\.[0-9]{12,30}$")
MAX_RAW=450*1024*1024
MIN_RAW=8*1024*1024

def sha256(blob):
    h=hashlib.sha256()
    if isinstance(blob,bytes):
        return hashlib.sha256(blob).hexdigest()
    with Path(blob).open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):
            h.update(chunk)
    return h.hexdigest()

def parse_annotations(data):
    if len(data)>512000 or sha256(data)!=ANNOTATIONS_SHA:
        raise ValueError("pinned_annotations_sha_mismatch")
    positive={}
    reader=csv.DictReader(data.decode("utf-8-sig").splitlines())
    if reader.fieldnames!=["seriesuid","coordX","coordY","coordZ","diameter_mm"]:
        raise ValueError("invalid_luna_reference")
    for row in reader:
        uid=row["seriesuid"]
        if not UID.fullmatch(uid):
            raise ValueError("unsupported_reference_uid")
        values=[float(row[k]) for k in ("coordX","coordY","coordZ","diameter_mm")]
        if not all(math.isfinite(v) for v in values) or not 3<=values[3]<=150:
            raise ValueError("invalid_gt")
        positive[uid]=positive.get(uid,0)+1
    return positive

def plan_case(positive,tree):
    if not isinstance(tree,list) or len(tree)>1000:
        raise ValueError("invalid_public_listing")
    paths={}
    for item in tree:
        if not isinstance(item,dict):raise ValueError("invalid_listing_entry")
        path=item.get("path")
        if not isinstance(path,str) or not path.startswith("subset0/"):
            continue
        name=path.split("/")[-1]
        stem,sep,ext=name.rpartition(".")
        if not sep or not UID.fullmatch(stem) or ext not in ("mhd","raw"):
            continue
        if path!=f"subset0/{stem}.{ext}" or path in paths:
            raise ValueError("ambiguous_source_paths")
        size=item.get("size")
        if type(size) is not int or size<1:
            raise ValueError("invalid_source_size")
        digest=item.get("lfs",{}).get("sha256") if isinstance(item.get("lfs"),dict) else None
        paths[path]={"size":size,"sha256":digest if isinstance(digest,str) and re.fullmatch("[0-9a-f]{64}",digest) else None}
    options=[]
    for uid,nodules in positive.items():
        mhd=paths.get(f"subset0/{uid}.mhd")
        raw=paths.get(f"subset0/{uid}.raw")
        if mhd and raw and 100<=mhd["size"]<=2000 and MIN_RAW<=raw["size"]<=MAX_RAW:
            options.append((raw["size"],uid,nodules,mhd,raw))
    if not options:
        raise ValueError("no_pinned_positive_public_ct_available")
    raw_size,uid,nodules,mhd,raw=min(options)
    return {"schema":"opus-monai-public-gpu-case/v1",
            "datasetRevision":REV,
            "sourceSeriesIdSha256":sha256(uid.encode("ascii")),
            "positiveExpertReferenceNodules":nodules,
            "files":[{"relativePath":f"subset0/{uid}.{ext}",
                      "sizeBytes":info["size"],"lfsSha256":info["sha256"]}
                     for ext,info in (("mhd",mhd),("raw",raw))],
            "selection":"smallest-positive-raw-ct-from-pinned-subset0",
            "modelInferencePerformed":False,"clinicalStatus":"public_research_only",
            "sourceUidForEphemeralDownload":uid}

def public_summary(plan):
    """Only aggregate metadata and a SHA pseudonym are emitted in CI logs."""
    return {key:value for key,value in plan.items()
            if key not in ("sourceUidForEphemeralDownload","files")}

def fetch_bytes(url,max_bytes):
    with urlopen(url,timeout=35) as response:
        length=response.headers.get("Content-Length")
        if length and int(length)>max_bytes:
            raise ValueError("oversize_public_metadata")
        blob=response.read(max_bytes+1)
    if len(blob)>max_bytes:raise ValueError("oversize_public_metadata")
    return blob

def fetch_listing():
    return json.loads(fetch_bytes(TREE_URL,800000))

def validate_mhd(path,raw_path):
    # No path traversal, compressed payload, multiple channels, or unknown type.
    text=Path(path).read_text(encoding="ascii")
    if len(text)>2048 or "\x00" in text:
        raise ValueError("unsafe_mhd_header")
    entries={}
    for line in text.splitlines():
        if not line.strip():continue
        key,sep,value=line.partition("=")
        if not sep:raise ValueError("invalid_mhd_header")
        entries[key.strip()]=value.strip()
    if (entries.get("NDims")!="3" or entries.get("ElementType")!="MET_SHORT" or
        entries.get("CompressedData","False").lower()!="false" or
        entries.get("ElementNumberOfChannels","1")!="1" or
        entries.get("BinaryData","True").lower()!="true" or
        entries.get("ElementDataFile")!=Path(raw_path).name or
        entries.get("ElementByteOrderMSB","False").lower()!="false"):
        raise ValueError("incompatible_public_ct_mhd")
    dims=[int(n) for n in entries["DimSize"].split()]
    if len(dims)!=3 or any(n<8 or n>1024 for n in dims) or math.prod(dims)*2!=Path(raw_path).stat().st_size:
        raise ValueError("mhd_raw_dimensions_mismatch")
    spacing=[float(n) for n in entries["ElementSpacing"].split()]
    if len(spacing)!=3 or any(not 0.1<=n<=10 for n in spacing):
        raise ValueError("unsupported_public_spacing")
    return {"dimensions":dims,"spacingMm":spacing}

def run(args):
    if args.annotations:
        annotations=Path(args.annotations).read_bytes()
    else:
        annotations=fetch_bytes(ANNOTATIONS_URL,512000)
    positive=parse_annotations(annotations)
    tree=json.loads(Path(args.tree_json).read_text()) if args.tree_json else fetch_listing()
    plan=plan_case(positive,tree)
    uid=plan.pop("sourceUidForEphemeralDownload")
    if not args.download:
        print(json.dumps(public_summary(plan),sort_keys=True))
        return
    if args.external_gpu_confirm!="PUBLIC-LUNA16-GPU-OK":
        raise ValueError("external_gpu_explicit_confirmation_required")
    from huggingface_hub import hf_hub_download
    root=args.output.resolve()
    if root.exists() and any(root.iterdir()):
        raise ValueError("output_directory_not_empty")
    root.mkdir(parents=True,exist_ok=True,mode=0o700)
    loaded={}
    for item in plan["files"]:
        path=item["relativePath"]
        located=Path(hf_hub_download(repo_id=DATASET,repo_type="dataset",revision=REV,
                                    filename=path,local_dir=str(root)))
        if not located.is_file() or located.stat().st_size!=item["sizeBytes"]:
            raise ValueError("downloaded_source_size_mismatch")
        digest=sha256(located)
        if item["lfsSha256"] is not None and digest!=item["lfsSha256"]:
            raise ValueError("downloaded_source_sha_mismatch")
        item["actualSha256"]=digest
        loaded[located.suffix]=located
    if set(loaded)!={".mhd",".raw"}:raise ValueError("missing_public_ct_pair")
    plan["sourceGeometry"]=validate_mhd(loaded[".mhd"],loaded[".raw"])
    plan["downloadVerified"]=True
    plan["sourceUidNotPublished"]=True
    (root/"verified-case.json").write_text(json.dumps(plan,indent=2))
    print(json.dumps({k:v for k,v in plan.items() if k!="files"},sort_keys=True))

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--annotations",type=Path)
    p.add_argument("--tree-json",type=Path)
    p.add_argument("--download",action="store_true")
    p.add_argument("--external-gpu-confirm",default="")
    p.add_argument("--output",type=Path,default=Path("public-ct"))
    run(p.parse_args())
if __name__=="__main__":main()
