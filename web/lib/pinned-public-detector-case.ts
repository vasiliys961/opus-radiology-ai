/**
 * Immutable public MRI/CT-free evidence selection. This reads only the
 * already-executed, source-checked PUBLIC CT model outputs bundled with app.
 * Never read arbitrary upload paths or build patient summaries from browsers.
 */
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {assemblePublicCase,isPublicCaseId,type PublicCaseId} from "./public-case-evidence.ts";

const FILES:Record<PublicCaseId,readonly [string,string|null]>={
  "lung-nodule":["luna16-monai-cpu-run-38436406805.json","luna16-monai-expert-center-run-38724788094.json"],
  "head-hemorrhage":["ianpan-ich-real-figshare-run-38734338486.json","ich-genuine-independent-totalseg-ianpan-run-38747034560.json"],
  "chest-effusion":["task315-real-public-lctsc-run-39152510396.json",null],
};
export async function loadPinnedPublicDetectorCase(caseId:unknown){
  if(!isPublicCaseId(caseId))throw Error("unknown_public_case");
  const [a,b]=FILES[caseId];
  const read=async(file:string)=>{
    const raw=await readFile(join(process.cwd(),"public","examples",file),"utf-8");
    if(raw.length>128*1024)throw Error("public_model_evidence_too_large");
    return JSON.parse(raw) as unknown;
  };
  const [first,second]=await Promise.all([read(a),b?read(b):Promise.resolve(null)]);
  return assemblePublicCase(caseId,first,second);
}
