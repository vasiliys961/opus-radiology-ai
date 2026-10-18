import {NextRequest,NextResponse} from "next/server";
import {freemem} from "node:os";
import {parseLocalLungFacts,parseLocalLungReview} from "../../../../lib/local-lung-review";
import {createSyntheticTrialLimiter} from "../../../../lib/synthetic-live-research";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=40;
const ENDPOINT="http://127.0.0.1:1234/v1";
const LOCAL=/^(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$/;
const HEADERS={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const limiter=createSyntheticTrialLimiter(2,10*60_000);
function local(req:NextRequest,post=false){
 const host=req.headers.get("host")??"";
 return process.env.NODE_ENV==="development"&&LOCAL.test(host)&&
   ["localhost","127.0.0.1"].includes(req.nextUrl.hostname)&&!req.nextUrl.search&&
   (req.headers.get("sec-fetch-site")===null||req.headers.get("sec-fetch-site")==="same-origin")&&
   (!post||req.headers.get("origin")==="http://"+host);
}
function reply(status:number,error:string){return NextResponse.json({error},{status,headers:HEADERS});}
type ModelRef={id:string};
async function availableModels(signal:AbortSignal):Promise<ModelRef[]>{
 const response=await fetch(ENDPOINT+"/models",{signal,cache:"no-store",redirect:"error"});
 if(!response.ok)throw Error("local_lm_studio_unavailable");
 const size=Number(response.headers.get("content-length")??0);
 if(size>32*1024)throw Error("local_model_catalog_too_large");
 const text=await response.text();if(text.length>32*1024)throw Error("local_model_catalog_too_large");
 const models:unknown=JSON.parse(text);
 if(!models||typeof models!=="object"||!Array.isArray((models as {data?:unknown}).data))
   throw Error("invalid_local_model_catalog");
 const m=(models as {data:unknown[]}).data.slice(0,20);
 return m.flatMap(v=>{
   const id=(v&&typeof v==="object"?(v as {id?:unknown}).id:null);
   return typeof id==="string"&&/^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,159}$/.test(id)?[{id}]:[];
 });
}
export async function GET(request:NextRequest){
 if(!local(request))return reply(404,"Local development workstation only");
 try{
   const models=await availableModels(AbortSignal.timeout(3_000));
   return NextResponse.json({schema:"opus-local-lm-studio-models/v1",models,
       transport:"loopback-only",clinicalUse:false},{headers:HEADERS});
 }catch{return reply(503,"Local LM Studio server not available at 127.0.0.1:1234");}
}
export async function POST(request:NextRequest){
 if(!local(request,true))return reply(404,"Local development workstation only");
 if(!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get("content-type")??""))
   return reply(415,"JSON required");
 const size=Number(request.headers.get("content-length")??0);
 if(!Number.isSafeInteger(size)||size<0||size>1024)return reply(413,"Request too large");
 let body:unknown;
 try{
   const reader=request.body?.getReader();if(!reader)return reply(400,"No body");
   let total=0;const parts:Uint8Array[]=[];
   while(true){const {value,done}=await reader.read();if(done)break;
     if(value){total+=value.byteLength;if(total>1024){await reader.cancel();return reply(413,"Request too large");}parts.push(value);}}
   const bytes=new Uint8Array(total);let offset=0;
   for(const p of parts){bytes.set(p,offset);offset+=p.byteLength;}
   body=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
 }catch{return reply(400,"Invalid JSON");}
 if(!body||typeof body!=="object"||Array.isArray(body))return reply(400,"Invalid request");
 const raw=body as Record<string,unknown>;
 if(Object.keys(raw).length!==3||raw.acknowledgeLocalInference!==true||
    typeof raw.modelId!=="string"||!raw.facts)return reply(400,"Invalid local LLM request");
 let facts;
 try{facts=parseLocalLungFacts(raw.facts);}catch{return reply(400,"Only bounded R231 measurements allowed");}
 if(freemem()<768*1024*1024)return reply(507,"Not enough free system memory to request local LLM");
 const release=limiter.acquire();if(!release)return reply(429,"Local LLM request rate limit");
 try{
   const models=await availableModels(AbortSignal.timeout(3_000));
   if(!models.some(m=>m.id===raw.modelId))return reply(422,"Model not available in local LM Studio");
   const response=await fetch(ENDPOINT+"/chat/completions",{
     method:"POST",redirect:"error",cache:"no-store",
     headers:{"Content-Type":"application/json"},
     body:JSON.stringify({
       model:raw.modelId,temperature:0.1,max_tokens:700,stream:false,
       messages:[
         {role:"system",content:"You are a LOCAL clinical research QA assistant. The input contains ONLY right and left lung anatomical SEGMENTATION MASK VOLUMES from a user-declared Lungmask R231 run, not CT pixels. Do not diagnose, suggest an unseen CT finding, call the lungs normal, or infer fibrosis, tumor, pneumonia or embolism. Values may cover only some slices; source completeness is NOT known. Produce exactly JSON {schema:'opus-local-lung-llm-review/v1',summary:string,qualityQuestions:string[],limitations:string[]}. Focus on technical mask asymmetry, coverage, plausibility, and needed physician verification. Mention uncertain measurement and no autonomous diagnosis."},
         {role:"user",content:JSON.stringify(facts)},
       ],
     }),
     signal:AbortSignal.any([request.signal,AbortSignal.timeout(24_000)]),
   });
   if(!response.ok)return reply(502,"Local LM Studio model request failed");
   const responseSize=Number(response.headers.get("content-length")??0);
   if(responseSize>16*1024)return reply(502,"Local model response too large");
   const text=await response.text();if(text.length>16*1024)return reply(502,"Local model response too large");
   const v:unknown=JSON.parse(text);
   const choices=(v&&typeof v==="object"?(v as {choices?:unknown}).choices:null);
   if(!Array.isArray(choices)||choices.length!==1||choices[0]?.finish_reason!=="stop"||
      typeof choices[0]?.message?.content!=="string")throw Error("Invalid local model response");
   const critique=parseLocalLungReview(choices[0].message.content);
   return NextResponse.json({schema:"opus-local-lung-review-response/v1",review:critique,
      device:"user-local-LM-Studio",clinicalStatus:"unverified_research_draft",
      patientPixelsSent:false,externalProvidersCalled:false},{headers:HEADERS});
 }catch{return reply(502,"Local LM Studio failed or returned unvalidated response");}
 finally{release();}
}
