import {followupStudyReport,validStudyFollowup} from '../../../../lib/study-report-followup';
import {NextRequest,NextResponse} from "next/server";
import {createOpusReportRecovery,opusReportFailure} from '../../../../lib/opus-report-recovery';
import {createHash,timingSafeEqual} from "node:crypto";
import {callAiGateway} from "../../../../lib/ai-gateway";
import {createSyntheticTrialLimiter} from "../../../../lib/synthetic-live-research";
import {synthesizeSafeFullVolumeOpus} from "../../../../lib/full-volume-opus-synthesis";
import {localResearchEnabled,validateVolumeSession,VOLUME_SESSION_COOKIE} from "../../../../lib/volume-operator-session";
import {validReviewedFrameSession,REVIEWED_FRAME_COOKIE} from "../../../../lib/reviewed-frame-session";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
const BODY_LIMIT=9_600_000;
const HEADERS={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const HOST=/^(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$/;
const recovery=createOpusReportRecovery();
const limiter=createSyntheticTrialLimiter(2,20*60_000);
const followupLimiter=createSyntheticTrialLimiter(8,20*60_000);
const reply=(status:number,error:string)=>NextResponse.json({error},{status,headers:HEADERS});
function authorized(req:NextRequest):boolean{
 const host=req.headers.get("host")??"";
 const token=req.headers.get("x-opus-local-operator-token");
 const expected=process.env.RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN;
 const autoSession=req.headers.get("x-opus-auto-public-volume")==="1"&&
   localResearchEnabled()&&
   validateVolumeSession(req.cookies.get(VOLUME_SESSION_COOKIE)?.value??null);
 if(process.env.NODE_ENV!=="development"||!HOST.test(host)||
    !["localhost","127.0.0.1"].includes(req.nextUrl.hostname)||
    req.nextUrl.search||req.headers.get("origin")!=="http://"+host||
    ![null,"same-origin"].includes(req.headers.get("sec-fetch-site"))||
    process.env.RADIOLOGY_ENABLE_DEIDENTIFIED_OPENROUTER_PILOT!=="1"||
    process.env.RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED!=="1"||
    !process.env.OPENROUTER_API_KEY)return false;
 if(autoSession)return true;
 if(req.headers.get("x-opus-reviewed-volume")==="1"&&
    validReviewedFrameSession(req.cookies.get(REVIEWED_FRAME_COOKIE)?.value))return true;
 if(!expected||expected.length<24)return false;
 if(!token||token.length>512)return false;
 const a=Buffer.from(token),b=Buffer.from(expected);
 return a.length===b.length&&timingSafeEqual(a,b);
}
export async function POST(req:NextRequest){
 if(!authorized(req))return reply(404,"Local approved Opus research only");
 if(!/^application\/json(?:\s*;.*)?$/i.test(req.headers.get("content-type")??""))
   return reply(415,"JSON only");
 const len=Number(req.headers.get("content-length")??0);
 if(!Number.isSafeInteger(len)||len<0||len>BODY_LIMIT)return reply(413,"Synthesis input too large");
 let raw:unknown;
 try{
   const reader=req.body?.getReader();if(!reader)throw Error("Missing body");
   const bytes:Uint8Array[]=[];let size=0;
   try{
     while(true){
       const {value,done}=await reader.read();if(done)break;
       if(value){size+=value.byteLength;if(size>BODY_LIMIT)throw Error("Oversized");
         bytes.push(value);}
     }
   }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   const all=new Uint8Array(size);let offset=0;
   for(const part of bytes){all.set(part,offset);offset+=part.byteLength;}
   raw=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(all));
 }catch{return reply(400,"Invalid bounded summary");}
 const followup=!!raw&&typeof raw==='object'&&'mode' in raw;
 if(followup&&!validStudyFollowup(raw))return reply(400,'Invalid reviewed report/question');
 const recoveryKey=createHash('sha256').update(req.cookies.get(REVIEWED_FRAME_COOKIE)?.value??req.cookies.get(VOLUME_SESSION_COOKIE)?.value??req.headers.get('x-opus-local-operator-token')??'').update(JSON.stringify(raw)).digest('hex');
 const checkpoint=followup?undefined:recovery.get(recoveryKey);
 if(checkpoint?.result)return NextResponse.json(checkpoint.result,{headers:{...HEADERS,"X-Opus-Report-Reused":"1"}});
 const release=(followup?followupLimiter:limiter).acquire();
 if(!release)return reply(429,"Opus request already running or limited");
 try{
   const signal=AbortSignal.any([req.signal,AbortSignal.timeout(270000)]);
   const result=followup?await followupStudyReport(raw,callAiGateway,signal):await synthesizeSafeFullVolumeOpus(raw,callAiGateway,signal,{visual:checkpoint?.visual,onVisual:visual=>recovery.put(recoveryKey,{visual})});
   if(!followup)recovery.put(recoveryKey,{visual:'visualReview' in result?result.visualReview:undefined,result:result as import('../../../../lib/full-volume-opus-synthesis').FullVolumeOpusResult});
   return NextResponse.json(result,{headers:HEADERS});
 }catch(error){
   const failure=opusReportFailure(error);
   console.error("[opus-report]",failure.code,"visualPreserved="+(recovery.get(recoveryKey)?.visual?.status==='completed'));
   return NextResponse.json({...failure,error:failure.code,visualReviewPreserved:recovery.get(recoveryKey)?.visual?.status==='completed'},{status:502,headers:HEADERS});
 }finally{release();}
}
