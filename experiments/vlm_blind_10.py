#!/usr/bin/env python3
"""10 paired chest X-rays -> independent JSON descriptions -> blind package-level Opus review.
Research only. Local files must be PUBLIC, deidentified, and licensed for external API transfer.
No images, descriptions or patient data are committed to GitHub.
"""
import argparse, base64, hashlib, json, os, pathlib, random, urllib.request, urllib.error, time

URL="https://openrouter.ai/api/v1/chat/completions"
VISION="""Describe this chest radiograph IN RUSSIAN from visible evidence only.
Return JSON with keys: projection, technical_quality, findings (array of {anatomy,
observation,laterality,certainty}), impression (array), uncertainties (array),
limitations (array). Do not invent clinical history or pathology. Be concise."""
JUDGE="""You are a blinded medical-report QUALITY reviewer. Compare PACKAGE A and
PACKAGE B: ten paired JSON radiograph descriptions with matching case IDs.
No original images are provided. Therefore you CANNOT verify diagnostic truth,
sensitivity, specificity or actual hallucinations. Assess clarity, coverage,
internal coherence, uncertainty handling, specificity and possible unsupported
assertions. Return a valid JSON object with: preferred ("A","B","tie"),
package_a_score (integer 0..100), package_b_score (integer 0..100),
case_comparisons (array of 10 {id,preferred,reason}), overall_reason,
unverifiable_claims (array of strings), required_image_ground_truth_review (true).
Do NOT infer model identity, and do NOT reward verbosity alone."""
def request(key, model, messages, max_tokens):
    payload={"model":model,"messages":messages,"temperature":0,"max_tokens":max_tokens}
    req=urllib.request.Request(URL,data=json.dumps(payload).encode(),headers={
        "Authorization":f"Bearer {key}","Content-Type":"application/json",
        "X-Title":"Opus blind radiology research"})
    try:
        with urllib.request.urlopen(req,timeout=180) as r: data=json.load(r)
    except urllib.error.HTTPError as ex:
        raise RuntimeError(f"OpenRouter HTTP {ex.code}; no sensitive content printed") from None
    msg=data["choices"][0]["message"]["content"]
    if isinstance(msg,list): msg="".join(v.get("text","") for v in msg if isinstance(v,dict))
    return msg,data.get("usage",{})
def as_json(raw):
    raw=raw.strip()
    if raw.startswith("$(("): raise ValueError("Unexpected response")
    try: return json.loads(raw)
    except json.JSONDecodeError:
        start=raw.find("{");end=raw.rfind("}")
        if start<0 or end<start: raise ValueError("Model returned non-JSON")
        return json.loads(raw[start:end+1])
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--manifest",required=True,help="JSON list of 10 {id,path,cloud_transfer_allowed:true}")
    p.add_argument("--out",default="comparison_private.json")
    a=p.parse_args()
    key=os.environ.get("OPENROUTER_API_KEY")
    if not key: raise SystemExit("OPENROUTER_API_KEY missing")
    ma=os.environ.get("MODEL_A","google/gemini-3.8-flash")
    mb=os.environ.get("MODEL_B","nvidia/nemotron-3.5-super-vl")
    judge=os.environ.get("JUDGE_MODEL","anthropic/claude-opus-5.5")
    root=pathlib.Path(a.manifest).resolve().parent
    entries=json.loads(pathlib.Path(a.manifest).read_text())
    if not isinstance(entries,list) or len(entries)!=10: raise SystemExit("Exactly 10 images required")
    ids=[x["id"] for x in entries]
    if len(set(ids))!=10 or not all(isinstance(i,str) and i for i in ids):
        raise SystemExit("Case IDs must be ten unique strings")
    rows=[]
    # Run 10 images through Gemini, then the SAME 10 images through Nemotron.
    for model_tag,model in (("model_a",ma),("model_b",mb)):
        for e in entries:
            if e.get("cloud_transfer_allowed") is not True:
                raise SystemExit(f"Cloud transfer not approved for case {e['id']}")
            path=(root/e["path"]).resolve()
            if not path.is_relative_to(root): raise SystemExit("Image path outside manifest folder")
            ext=path.suffix.lower()
            if ext not in (".png",".jpg",".jpeg"): raise SystemExit("Only PNG/JPEG allowed")
            data=path.read_bytes()
            if len(data)>8_000_000: raise SystemExit("Image larger than 8 MB")
            mime="image/png" if ext==".png" else "image/jpeg"
            image="data:"+mime+";base64,"+base64.b64encode(data).decode()
            msg=[{"role":"user","content":[{"type":"text","text":VISION},
                {"type":"image_url","image_url":{"url":image}}]}]
            raw,usage=request(key,model,msg,1500)
            rows.append({"model_tag":model_tag,"model":model,"id":e["id"],
                         "image_sha256":hashlib.sha256(data).hexdigest(),
                         "description":as_json(raw),"usage":usage})
    # Blind package identities by a reproducible pseudorandom mapping.
    flip=bool(int(hashlib.sha256(("|".join(ids)).encode()).hexdigest(),16)%2)
    labels={"A":"model_b","B":"model_a"} if flip else {"A":"model_a","B":"model_b"}
    packages={label:[{"id":e["id"],"json":next(
        r["description"] for r in rows if r["id"]==e["id"] and r["model_tag"]==tag)}
        for e in entries] for label,tag in labels.items()}
    prompt=json.dumps(packages,ensure_ascii=False)
    raw,judge_usage=request(key,judge,[{"role":"system","content":JUDGE},
                                      {"role":"user","content":prompt}],5500)
    report={"models":{"model_a":ma,"model_b":mb,"judge":judge},
            "blind_mapping":labels,"descriptions":rows,"judge":as_json(raw),
            "judge_usage":judge_usage,
            "disclaimer":"Opus only reviewed texts, not original images. Clinical accuracy unverified."}
    output=pathlib.Path(a.out)
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(f"Saved {len(rows)} descriptions and blinded batch judgment to {output}")
    print("Review must be compared with image-ground-truth before any clinical accuracy claim.")
if __name__=="__main__": main()
