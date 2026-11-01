import {NextRequest,NextResponse} from "next/server";
import {timingSafeEqual} from "node:crypto";
import {callAiGateway} from "../../../../lib/ai-gateway";
import {createSyntheticTrialLimiter} from "../../../../lib/synthetic-live-research";
import {reviewApprovedVolumeGeminiBatch} from "../../../../lib/approved-volume-batch-review";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=120;
const LOCAL_HOST=/^(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$/;
const HEADERS={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const BODY_LIMIT=2_350_000;
// Per-process guard, NOT an aggregate cloud budget. Each batch needs a fresh
// physician-checked packet and explicit paid-call authorization.
const limiter=createSyntheticTrialLimiter(32,60*60_000);
const reply=(status:number,error:string)=>NextResponse.json({error},{status,headers:HEADERS});
function allowedLocal(req:NextRequest):boolean{
  const host=req.headers.get("host")??"";
  return process.env.NODE_ENV==="development"&&LOCAL_HOST.test(host)&&
    ["localhost","127.0.0.1"].includes(req.nextUrl.hostname)&&
    !req.nextUrl.search()&&
    [null,"same-origin"].includes(req.headers.get("sec-fetch-site"))&&
    req.headers.get("origin")==="http://"+host;
}
function ready():boolean{
  return process.env.RADIOLOGY_ENABLE_DEIDENTIFIED_OPENROUTER_PILOT==="1"&&
    process.env.RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED==="1"&&
    !!process.env.OPENROUTER_API_KEY?.trim()&&
    (process.env.RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN?.length??0)>=24;
}
function operator(expected:string|undefined,provided:string|null):boolean{
  if(!expected||expected.length<24||!provided||provided.length>512)return false;
  const a=Buffer.from(expected),b=Buffer.from(provided);
  return a.length===b.length&&timingSafeEqual(a,b);
}
async function readBounded(req:NextRequest):Promise<unknown>{
  const reader=req.body?.getReader();
  if(!reader)throw Error("missing");
  const pieces:Uint8Array[]=[];let size=0;
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      if(value){
        size+=value.byteLength;
        if(size>BODY_LIMIT)throw Error("oversized");
        pieces.push(value);
      }
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let pos=0;
  for(const part of pieces){bytes.set(part,pos);pos+=part.byteLength;}
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
}
export async function POST(req:NextRequest){
  if(!allowedLocal(req))return reply(404,"Local research endpoint only");
  if(!ready())return reply(503,"Deidentified OpenRouter research permission is not configured");
  if(!operator(process.env.RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN,
     req.headers.get("x-opus-local-operator-token")))
    return reply(401,"Operator authorization failed");
  if(!/^application\/json(?:\s*;.*)?$/i.test(req.headers.get("content-type")??""))
    return reply(415,"JSON required");
  const announced=Number(req.headers.get("content-length")??0);
  if(!Number.isSafeInteger(announced)||announced<0||announced>BODY_LIMIT)
    return reply(413,"Oversized request");
  let raw:unknown;
  try{raw=await readBounded(req);}catch{return reply(400,"Invalid or oversized reviewed PNG packet");}
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
    return reply(400,"Invalid request");
  const v=raw as Record<string,unknown>;
  if(Object.keys(v).sort().join(",")!==
      ["packet","acknowledgeClinicianLawfulDisclosure","acknowledgeProviderHealthDataTerms",
       "acknowledgePixelIdentityReviewed","acknowledgeOnePaidGeminiBatch"].sort().join(",")||
     v.acknowledgeClinicianLawfulDisclosure!==true||
     v.acknowledgeProviderHealthDataTerms!==true||
     v.acknowledgePixelIdentityReviewed!==true||
     v.acknowledgeOnePaidGeminiBatch!==true)
    return reply(400,"Explicit consent for this single paid PNG batch required");
  const release=limiter.acquire();
  if(!release)return reply(429,"Another batch active or hourly research limit reached");
  try{
    const result=await reviewApprovedVolumeGeminiBatch(v.packet,callAiGateway,
      AbortSignal.any([req.signal,AbortSignal.timeout(90_000)]));
    return NextResponse.json(result,{headers:HEADERS});
  }catch{
    // Do not expose model output, uploaded pixels, sensitive errors or headers.
    return reply(502,"Approved batch validation, provider inference, or usage receipt failed");
  }finally{release();}
}
