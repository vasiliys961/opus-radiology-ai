import {NextRequest,NextResponse} from "next/server";
import {timingSafeEqual} from "node:crypto";
import {callAiGateway} from "../../../../lib/ai-gateway";
import {HttpBodyTooLarge} from "../../../../lib/limited-body";
import {reviewSanitizedSamples} from "../../../../lib/sanitized-cloud-review";
import {createSyntheticTrialLimiter} from "../../../../lib/synthetic-live-research";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=90;
const HEADERS={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const LOCAL_HOST=/^(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$/;
const BODY_LIMIT=2_350_000;
const limiter=createSyntheticTrialLimiter(2,20*60_000);
/** Separate pixel-sized bounded reader. Global readLimitedText is intentionally
 * capped at 64 KiB for clinical metadata and must not be weakened for images. */
async function readPixelJson(req:NextRequest):Promise<unknown>{
  const reader=req.body?.getReader();
  if(!reader)throw Error("missing");
  const parts:Uint8Array[]=[];let length=0;
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      if(value){
        length+=value.byteLength;
        if(length>BODY_LIMIT)throw new HttpBodyTooLarge();
        parts.push(value);
      }
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(length);let at=0;
  for(const part of parts){bytes.set(part,at);at+=part.byteLength;}
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
}
const reply=(status:number,error:string)=>NextResponse.json({error},{status,headers:HEADERS});

function allowedLocalBrowser(req:NextRequest,post=false):boolean {
  const host=req.headers.get("host")??"";
  const site=req.headers.get("sec-fetch-site");
  return process.env.NODE_ENV==="development"&&
    LOCAL_HOST.test(host)&&["localhost","127.0.0.1"].includes(req.nextUrl.hostname)&&
    !req.nextUrl.search&&(site===null||site==="same-origin")&&
    (!post||req.headers.get("origin")==="http://"+host);
}
function configurationReady():boolean {
  return process.env.RADIOLOGY_ENABLE_DEIDENTIFIED_OPENROUTER_PILOT==="1" &&
    process.env.RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED==="1" &&
    typeof process.env.RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN==="string" &&
    process.env.RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN!.length>=24 &&
    !!process.env.OPENROUTER_API_KEY?.trim();
}
function validOperator(received:string|null):boolean {
  const expected=process.env.RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN;
  if(!expected||expected.length<24||!received||received.length>512)return false;
  const a=Buffer.from(received,"utf8"),b=Buffer.from(expected,"utf8");
  return a.length===b.length&&timingSafeEqual(a,b);
}
export async function GET(req:NextRequest){
  if(!allowedLocalBrowser(req))return reply(404,"Local clinician pilot only");
  return NextResponse.json({
    schema:"opus-deidentified-openrouter-pilot-readiness/v1",
    enabled:configurationReady(),
    provider:"openrouter",
    models:["google/gemini-3.8-flash","anthropic/claude-opus-5.5"],
    framesMaximum:4,sourceMustBePixelReviewed:true,
    stillRequiresLawfulDisclosureAndOperatorApproval:true,
    independentDeidentificationCertification:false,
    productionPatientCloudRelease:false,
  },{headers:HEADERS});
}
export async function POST(req:NextRequest){
  if(!allowedLocalBrowser(req,true))return reply(404,"Local clinician pilot only");
  if(!configurationReady())return reply(503,"Deidentified OpenRouter clinician research pilot not authorized on this server");
  if(!validOperator(req.headers.get("x-opus-local-operator-token")))
    return reply(401,"Local operator authorization failed");
  if(!/^application\/json(?:\s*;.*)?$/i.test(req.headers.get("content-type")??""))
    return reply(415,"JSON only");
  const announced=Number(req.headers.get("content-length")??0);
  if(!Number.isSafeInteger(announced)||announced<0||announced>BODY_LIMIT)
    return reply(413,"Image sample too large");
  let raw:unknown;
  try{raw=await readPixelJson(req);}
  catch(e){return reply(e instanceof HttpBodyTooLarge?413:400,"Invalid or oversized data");}
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return reply(400,"Invalid request");
  const v=raw as Record<string,unknown>;
  const allowed=["packet","acknowledgeClinicianLawfulDisclosure","acknowledgeProviderHealthDataTerms",
    "acknowledgePixelIdentityReviewed","acknowledgeTwoPaidCalls"];
  const keys=Object.keys(v);
  const specialistProvided=Object.hasOwn(v,"specialistFacts");
  const detectorProvided=Object.hasOwn(v,"detectorEvidence");
  const cxrProvided=Object.hasOwn(v,"cxrModelEvidence");
  if(keys.length!==allowed.length+(specialistProvided?1:0)+(detectorProvided?1:0)+(cxrProvided?1:0)||
     !keys.every(k=>allowed.includes(k)||(specialistProvided&&k==="specialistFacts")||
       (detectorProvided&&k==="detectorEvidence")||
       (cxrProvided&&k==="cxrModelEvidence"))||
     !allowed.every(k=>Object.hasOwn(v,k))||
     v.acknowledgeClinicianLawfulDisclosure!==true||
     v.acknowledgeProviderHealthDataTerms!==true||
     v.acknowledgePixelIdentityReviewed!==true||
     v.acknowledgeTwoPaidCalls!==true)
    return reply(400,"Study-level clinician, image privacy, provider, and two-call approvals required");
  // Review packet validation happens BEFORE a paid remote call in the model
  // executor. Failure is closed. These declarations are NOT an independent
  // deidentification certificate or legal authority; clinical production is off.
  const release=limiter.acquire();
  if(!release)return reply(429,"One active request; maximum two starts in twenty minutes");
  let attempted=0,completed=0;
  try{
    const trackedCall:typeof callAiGateway=async(request,signal)=>{
      attempted++;
      const output=await callAiGateway(request,signal);
      completed++;
      return output;
    };
    const result=await reviewSanitizedSamples(
      v.packet,trackedCall,AbortSignal.any([req.signal,AbortSignal.timeout(75_000)]),
      specialistProvided?v.specialistFacts:null,
      detectorProvided?v.detectorEvidence:null,
      cxrProvided?v.cxrModelEvidence:null);
    return NextResponse.json(result,{headers:HEADERS});
  }catch(error){
    // This diagnostic is scoped to ONE unmerged synthetic-only workflow branch.
    // Never log model output, pixels, prompt, headers, health data or credentials.
    if(process.env.NODE_ENV==="development"&&process.env.OPUS_SYNTHETIC_LIVE_TEST_APPROVED==="true"){
      const name=error instanceof Error?error.name:"unknown";
      const message=error instanceof Error?error.message:"unknown";
      const knownCodes=["Vision result contract mismatch","Expected JSON text",
        "Model JSON exceeds limit","Invalid vision JSON","Unexpected JSON envelope"];
      const category=/^AI provider returned HTTP [0-9]{3}$/.test(message)?message:
        knownCodes.includes(message)?message:error instanceof SyntaxError?"Model JSON syntax":
        message==="physician_cancelled_before_opus"?"Cancelled before Opus":"Other contract error";
      console.error("SYNTHETIC_PILOT_DIAGNOSTIC",JSON.stringify({attempted,completed,name,category}));
    }
    return reply(502,"Image privacy contract, source review or remote model result failed");
  }finally{release();}
}
