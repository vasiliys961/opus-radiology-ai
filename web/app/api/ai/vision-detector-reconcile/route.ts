/** A consent-gated single text-only Opus reconciliation when genuine detectors
 * finish AFTER an earlier authorized Gemini/Opus image review.
 * No image pixels, DICOM or source SHA are forwarded to the remote LLM.
 */
import {NextRequest,NextResponse} from "next/server";
import {timingSafeEqual} from "node:crypto";
import {callAiGateway} from "../../../../lib/ai-gateway";
import {reconcileLateDetectorEvidence} from "../../../../lib/late-detector-opus-reconcile";
import {createSyntheticTrialLimiter} from "../../../../lib/synthetic-live-research";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=90;
const LOCAL=/^(?:127\.0\.0\.1|localhost)(?::[0-9]{1,5})?$/;
const HEADERS={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const limit=createSyntheticTrialLimiter(2,20*60_000);
const fail=(status:number,error:string)=>NextResponse.json({error},{status,headers:HEADERS});
function allowed(req:NextRequest){
 const host=req.headers.get("host")??"",site=req.headers.get("sec-fetch-site");
 return process.env.NODE_ENV==="development"&&LOCAL.test(host)&&
  ["localhost","127.0.0.1"].includes(req.nextUrl.hostname)&&
  req.headers.get("origin")==="http://"+host&&!req.nextUrl.search&&
  (site===null||site==="same-origin");
}
function enabled(){
 return process.env.RADIOLOGY_ENABLE_DEIDENTIFIED_OPENROUTER_PILOT==="1"&&
  process.env.RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED==="1"&&
  !!process.env.OPENROUTER_API_KEY?.trim()&&
  (process.env.RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN?.length??0)>=24;
}
function authorized(presented:string|null){
 const expected=process.env.RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN;
 if(!expected||expected.length<24||!presented||presented.length>512)return false;
 const a=Buffer.from(expected),b=Buffer.from(presented);
 return a.length===b.length&&timingSafeEqual(a,b);
}
async function smallJson(req:NextRequest){
 const announced=Number(req.headers.get("content-length")??0);
 if(!Number.isSafeInteger(announced)||announced<0||announced>35000)throw Error("oversized");
 const read=req.body?.getReader();if(!read)throw Error("no_body");
 let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){const {done,value}=await read.read();if(done)break;
  if(value){size+=value.length;if(size>35000)throw Error("oversized");chunks.push(value);}
 }}finally{await read.cancel().catch(()=>{});read.releaseLock();}
 const joined=new Uint8Array(size);let pos=0;
 for(const chunk of chunks){joined.set(chunk,pos);pos+=chunk.length;}
 return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(joined)) as unknown;
}
export async function POST(req:NextRequest){
 if(!allowed(req))return fail(404,"Private local research API only");
 if(!enabled())return fail(503,"Clinician OpenRouter pilot disabled");
 if(!authorized(req.headers.get("x-opus-local-operator-token")))
  return fail(401,"Local operator authorization required");
 if(!/^application\/json(?:\s*;.*)?$/i.test(req.headers.get("content-type")??""))
  return fail(415,"JSON only");
 let body:unknown;
 try{body=await smallJson(req);}catch(e){return fail(e instanceof Error&&e.message==="oversized"?413:400,"Invalid bounded request");}
 if(!body||typeof body!=="object"||Array.isArray(body))
  return fail(400,"Invalid request");
 const v=body as Record<string,unknown>;
 if(Object.keys(v).sort().join(",")!==[
    "schema","priorReview","detectorEvidence","acknowledgeSinglePaidOpusCall",
    "acknowledgeLawfulNumericDisclosure"].sort().join(",")||
    v.schema!=="opus-authorized-late-detector-reconciliation-request/v1"||
    v.acknowledgeSinglePaidOpusCall!==true||
    v.acknowledgeLawfulNumericDisclosure!==true)
  return fail(400,"Explicit one-call cost and model disclosure approval required");
 const release=limit.acquire();
 if(!release)return fail(429,"Opus calls are rate limited");
 try{
  const result=await reconcileLateDetectorEvidence(v.priorReview,v.detectorEvidence as never,
   callAiGateway,AbortSignal.any([req.signal,AbortSignal.timeout(75_000)]));
  return NextResponse.json(result,{headers:HEADERS});
 }catch{
  // Never log or return model text, source fingerprints, private token, or clinical data.
  return fail(502,"Source evidence or single Opus reconciliation failed");
 }finally{release();}
}
