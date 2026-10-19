import {NextRequest,NextResponse} from "next/server";
import {callAiGateway,isAiProvider} from "../../../../lib/ai-gateway";
import {readLimitedText,HttpBodyTooLarge} from "../../../../lib/limited-body";
import {loadPinnedPublicDetectorCase} from "../../../../lib/pinned-public-detector-case";
import {reviewPublicDetectorsWithTwoLlms} from "../../../../lib/dual-public-detector-review";
import {createSyntheticTrialLimiter} from "../../../../lib/synthetic-live-research";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=90;
const HEADERS={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const LOCAL=/^(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$/;
const limiter=createSyntheticTrialLimiter(2,10*60_000);
const CASES=["lung-nodule","head-hemorrhage","chest-effusion"];
function local(request:NextRequest,post:boolean){
  const host=request.headers.get("host")??"";
  const site=request.headers.get("sec-fetch-site");
  return process.env.NODE_ENV==="development" &&
    LOCAL.test(host) && ["localhost","127.0.0.1"].includes(request.nextUrl.hostname) &&
    !request.nextUrl.search && (!site || site==="same-origin") &&
    (!post || request.headers.get("origin")==="http://"+host);
}
function failure(code:number,message:string){
  return NextResponse.json({error:message},{status:code,headers:HEADERS});
}
export async function GET(request:NextRequest){
  if(!local(request,false))return failure(404,"Local public research only");
  try {
    const cases=await Promise.all(CASES.map(id=>loadPinnedPublicDetectorCase(id)));
    return NextResponse.json({schema:"opus-dual-public-detector-index/v1",
      cases:cases.map(e=>({caseId:e.caseId,title:e.title,modelNames:e.modelNames,
        factCount:e.facts.length,clinicalValidation:false})),
      enabled:process.env.RADIOLOGY_ENABLE_DUAL_PUBLIC_DETECTOR_LLM==="1",
      patientStudyAccepted:false,callerUploadsAccepted:false},
      {headers:HEADERS});
  } catch {return failure(503,"Pinned public evidence unavailable");}
}
export async function POST(request:NextRequest){
  if(!local(request,true))return failure(404,"Local public research only");
  if(!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get("content-type")??""))
    return failure(415,"JSON only");
  const len=Number(request.headers.get("content-length")??0);
  if(!Number.isSafeInteger(len)||len<0||len>256)return failure(413,"Request too large");
  let body:unknown;
  try{body=JSON.parse(await readLimitedText(request,256));}
  catch(e){return failure(e instanceof HttpBodyTooLarge?413:400,"Invalid bounded JSON");}
  if(!body||typeof body!=="object"||Array.isArray(body))return failure(400,"Invalid request");
  const v=body as Record<string,unknown>;
  if(Object.keys(v).length!==3||
     !["caseId","provider","acknowledgePaidPublicResearch"].every(k=>Object.hasOwn(v,k))||
     !CASES.includes(String(v.caseId))||!isAiProvider(v.provider)||
     v.acknowledgePaidPublicResearch!==true)
    return failure(400,"Only pinned public case, provider and explicit cost acknowledgement accepted");
  if(process.env.RADIOLOGY_ENABLE_DUAL_PUBLIC_DETECTOR_LLM!=="1")
    return failure(503,"Paid public dual review disabled");
  const apiKey=v.provider==="polza"?"POLZA_API_KEY":"OPENROUTER_API_KEY";
  if(!process.env[apiKey])return failure(503,"Provider key not configured");
  const release=limiter.acquire();
  if(!release)return failure(429,"One active review and maximum two starts per ten minutes");
  try{
    const study=await loadPinnedPublicDetectorCase(v.caseId);
    const reviewed=await reviewPublicDetectorsWithTwoLlms(
      study,v.provider,callAiGateway,AbortSignal.any([request.signal,AbortSignal.timeout(75_000)]));
    return NextResponse.json(reviewed,{headers:HEADERS});
  }catch {
    return failure(502,"Remote provider unavailable or strict source-fact model output validation failed");
  }finally{release();}
}
