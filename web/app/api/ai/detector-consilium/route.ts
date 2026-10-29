import {NextRequest,NextResponse} from "next/server";
import {callAiGateway,isAiProvider} from "../../../../lib/ai-gateway";
import {runNumericGeminiOpusConsilium} from "../../../../lib/detector-gemini-opus-numeric";
import {validateSanitizedDetectorBundle} from "../../../../lib/detector-consilium-evidence";
import {createSyntheticTrialLimiter} from "../../../../lib/synthetic-live-research";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=120;

const HEADERS={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
 "Referrer-Policy":"no-referrer"};
const HOST=/^(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$/;
const limiter=createSyntheticTrialLimiter(2,10*60_000);
const fail=(code:number,msg:string)=>NextResponse.json({error:msg},{status:code,headers:HEADERS});
function allowLocal(req:NextRequest){
 const host=req.headers.get("host")??"";
 const site=req.headers.get("sec-fetch-site");
 return process.env.NODE_ENV==="development"&&
  HOST.test(host)&&["localhost","127.0.0.1"].includes(req.nextUrl.hostname)&&
  req.headers.get("origin")==="http://"+host&&
  (site===null||site==="same-origin")&&!req.nextUrl.search;
}
async function readBounded(req:NextRequest):Promise<unknown>{
 const declared=Number(req.headers.get("content-length")??0);
 if(!Number.isSafeInteger(declared)||declared<0||declared>8192)
  throw Error("too_large");
 const reader=req.body?.getReader();
 if(!reader)throw Error("missing_body");
 let bytes=0;
 const chunks:Uint8Array[]=[];
 try{
  for(;;){const {value,done}=await reader.read();if(done)break;
   if(value){bytes+=value.byteLength;if(bytes>8192)throw Error("too_large");chunks.push(value);}
  }
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const joined=new Uint8Array(bytes);let offset=0;
 for(const c of chunks){joined.set(c,offset);offset+=c.length;}
 return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(joined)) as unknown;
}
export async function POST(request:NextRequest){
 if(!allowLocal(request))return fail(404,"Private local research API only");
 if(!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get("content-type")??""))
  return fail(415,"JSON only");
 if(process.env.RADIOLOGY_ENABLE_DETECTOR_CONSILIUM!=="1")
  return fail(503,"Gemini/Opus numeric consilium disabled by default");
 let parsed:unknown;
 try{parsed=await readBounded(request);}catch(e){
  return fail(e instanceof Error&&e.message==="too_large"?413:400,"Bounded detector evidence required");
 }
 if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))
  return fail(400,"Invalid research request");
 const v=parsed as Record<string,unknown>;
 if(Object.keys(v).sort().join(",")!==
   ["schema","provider","bundle","acknowledgeAuthorizedDeidentifiedNumericEvidence",
    "acknowledgeExternalPaidCalls"].sort().join(",")||
   v.schema!=="opus-authorized-detector-consilium-request/v1"||
   !isAiProvider(v.provider)||
   v.acknowledgeAuthorizedDeidentifiedNumericEvidence!==true||
   v.acknowledgeExternalPaidCalls!==true||
   !validateSanitizedDetectorBundle(v.bundle)||
   !v.bundle.facts.some(f=>f.status==="completed"))
  return fail(400,"Research-only completed-model evidence and physician/cost authorization required");
 const required=v.provider==="polza"?"POLZA_API_KEY":"OPENROUTER_API_KEY";
 const geminiModel=process.env.RADIOLOGY_GEMINI_NUMERIC_MODEL??"";
 const opusModel=process.env.RADIOLOGY_OPUS_NUMERIC_MODEL??"";
 if(!process.env[required]||!geminiModel||!opusModel)
  return fail(503,"Server provider API key and Gemini/Opus model IDs not configured");
 const release=limiter.acquire();
 if(!release)return fail(429,"Paid provider requests are rate-limited");
 try{
  const result=await runNumericGeminiOpusConsilium({
    bundle:v.bundle,provider:v.provider,geminiModel,opusModel,
    call:callAiGateway,signal:AbortSignal.any([request.signal,AbortSignal.timeout(110_000)]),
  });
  // Do not return source images, identifiers, SHA, model raw responses, keys or prompts.
  return NextResponse.json(result,{headers:HEADERS});
 }catch{
  return fail(502,"Gemini or Opus unavailable; no verified research draft generated");
 }finally{release();}
}
