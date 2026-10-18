import {NextRequest,NextResponse} from "next/server";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {callAiGateway,isAiProvider} from "../../../../lib/ai-gateway";
import {readCompletionText} from "../../../../lib/vision-orchestra";
import {createSyntheticTrialLimiter} from "../../../../lib/synthetic-live-research";
import {assemblePublicCase,isPublicCaseId,parsePublicLLMReview,type PublicCaseId} from "../../../../lib/public-case-evidence";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
const MODEL="anthropic/claude-sonnet-5.5";
const HEADERS={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const LOCAL=/^(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$/;
const limiter=createSyntheticTrialLimiter(2,10*60_000);
const FILES:Record<PublicCaseId,[string,string]>={
  "lung-nodule":["luna16-monai-cpu-run-38436406805.json","luna16-monai-expert-center-run-38724788094.json"],
  "head-hemorrhage":["ianpan-ich-real-figshare-run-38734338486.json","ich-genuine-independent-totalseg-ianpan-run-38747034560.json"],
};
function localOnly(req:NextRequest){
  const host=req.headers.get("host")??"";
  const site=req.headers.get("sec-fetch-site");
  return process.env.NODE_ENV==="development"&&LOCAL.test(host)&&
    ["localhost","127.0.0.1"].includes(req.nextUrl.hostname)&&
    req.headers.get("origin")==="http://"+host&&
    (site===null||site==="same-origin")&&!req.nextUrl.search;
}
async function caseData(id:PublicCaseId){
  const [left,right]=FILES[id];
  const read=async(name:string)=>{
    const raw=await readFile(join(process.cwd(),"public","examples",name),"utf8");
    if(raw.length>128*1024)throw Error("public_evidence_too_large");
    return JSON.parse(raw) as unknown;
  };
  const [a,b]=await Promise.all([read(left),read(right)]);
  return assemblePublicCase(id,a,b);
}
function failure(status:number,message:string){
  return NextResponse.json({error:message},{status,headers:HEADERS});
}
export async function POST(request:NextRequest){
  if(!localOnly(request))return failure(404,"Local development public research only");
  if(!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get("content-type")??""))
    return failure(415,"JSON required");
  let raw="";
  try{
    const declared=Number(request.headers.get("content-length")??0);
    if(!Number.isSafeInteger(declared)||declared<0||declared>256)return failure(413,"Body too large");
    // Bounded body read even when Transfer-Encoding omits Content-Length.
    const reader=request.body?.getReader();
    if(!reader)return failure(400,"Missing body");
    let length=0;
    const chunks:Uint8Array[]=[];
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      if(value){length+=value.byteLength;if(length>256){await reader.cancel();return failure(413,"Body too large");}chunks.push(value);}
    }
    const buffer=new Uint8Array(length);let off=0;
    for(const chunk of chunks){buffer.set(chunk,off);off+=chunk.byteLength;}
    raw=new TextDecoder("utf-8",{fatal:true}).decode(buffer);
  }catch{return failure(400,"Invalid request");}
  let obj:Record<string,unknown>;
  try{
    const parsed:unknown=JSON.parse(raw);
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw Error();
    obj=parsed as Record<string,unknown>;
  }catch{return failure(400,"Invalid JSON");}
  if(Object.keys(obj).length!==3||!["caseId","provider","acknowledgePaidPublicResearch"].every(k=>Object.hasOwn(obj,k))||
     !isPublicCaseId(obj.caseId)||!isAiProvider(obj.provider)||obj.acknowledgePaidPublicResearch!==true)
    return failure(400,"Only a pinned public case, provider and explicit cost acknowledgement are accepted");
  if(process.env.RADIOLOGY_ENABLE_PUBLIC_EVIDENCE_LLM!=="1")
    return failure(503,"Research-only LLM review disabled by default");
  const key=obj.provider==="polza"?"POLZA_API_KEY":"OPENROUTER_API_KEY";
  if(!process.env[key])return failure(503,"Selected provider key unavailable");
  const release=limiter.acquire();
  if(!release)return failure(429,"One active request; maximum two starts per ten minutes");
  try{
    const evidence=await caseData(obj.caseId);
    // Patient images, browser files, filenames, arbitrary prompts and clinical
    // narratives are never accepted, assembled or sent to the remote model.
    const facts=evidence.facts.map(f=>({id:f.id,observation:f.detail}));
    const result=await callAiGateway({
      provider:obj.provider,role:"reasoning",model:MODEL,maxTokens:950,
      messages:[
        {role:"system",content:"You are reviewing a fixed PUBLIC research case, not a patient. You have only the supplied numerical model evidence, NO source pixels, NO patient history, NO independent clinical validation. Do not diagnose, state absence of disease, suggest a lesion location not in facts, or infer unobserved regions. Select only provided fact IDs. Return exactly JSON schema opus-public-llm-review/v1 with rankedFacts:[{factId,priority:high|medium|low,reason}], unresolvedQuestions:[string], summary:string. Keep summary explicitly research-only, identify limitations."},
        {role:"user",content:JSON.stringify({caseId:evidence.caseId,anatomy:evidence.anatomy,facts,limitations:evidence.limitations,clinicalValidation:false,patientStudyAnalyzed:false})}
      ],
    },AbortSignal.any([request.signal,AbortSignal.timeout(45_000)]));
    const review=parsePublicLLMReview(readCompletionText(result),evidence);
    return NextResponse.json({schema:"opus-public-llm-response/v1",caseData:evidence,
      review,model:MODEL,provider:obj.provider,remoteInferencePerformed:true,
      patientDataSubmitted:false,clinicalStatus:"unverified_research_draft"},{headers:HEADERS});
  }catch{
    return failure(502,"Provider unavailable or response failed strict source-fact validation");
  }finally{release();}
}
export async function GET(request:NextRequest){
  if(!localOnly(request))return failure(404,"Local development public research only");
  try{
    const cases=await Promise.all([caseData("lung-nodule"),caseData("head-hemorrhage")]);
    return NextResponse.json({schema:"opus-public-case-index/v1",cases,
      paidLlmEnabled:process.env.RADIOLOGY_ENABLE_PUBLIC_EVIDENCE_LLM==="1",model:MODEL},
      {headers:HEADERS});
  }catch{return failure(503,"Pinned research evidence unavailable or inconsistent");}
}
