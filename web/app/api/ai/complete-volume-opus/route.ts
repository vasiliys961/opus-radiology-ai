import {NextRequest,NextResponse} from "next/server";
import {timingSafeEqual} from "node:crypto";
import {callAiGateway} from "../../../../lib/ai-gateway";
import {createSyntheticTrialLimiter} from "../../../../lib/synthetic-live-research";
import {synthesizeSafeFullVolumeOpus} from "../../../../lib/full-volume-opus-synthesis";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=180;
const HEADERS={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const HOST=/^(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$/;
const limiter=createSyntheticTrialLimiter(2,20*60_000);
const reply=(status:number,error:string)=>NextResponse.json({error},{status,headers:HEADERS});
function authorized(req:NextRequest):boolean{
 const host=req.headers.get("host")??"";
 const token=req.headers.get("x-opus-local-operator-token");
 const expected=process.env.RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN;
 if(process.env.NODE_ENV!=="development"||!HOST.test(host)||
    !["localhost","127.0.0.1"].includes(req.nextUrl.hostname)||
    req.nextUrl.search||req.headers.get("origin")!=="http://"+host||
    ![null,"same-origin"].includes(req.headers.get("sec-fetch-site"))||
    process.env.RADIOLOGY_ENABLE_DEIDENTIFIED_OPENROUTER_PILOT!=="1"||
    process.env.RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED!=="1"||
    !process.env.OPENROUTER_API_KEY||!expected||expected.length<24||
    !token||token.length>512)return false;
 const a=Buffer.from(token),b=Buffer.from(expected);
 return a.length===b.length&&timingSafeEqual(a,b);
}
export async function POST(req:NextRequest){
 if(!authorized(req))return reply(404,"Local approved Opus research only");
 if(!/^application\/json(?:\s*;.*)?$/i.test(req.headers.get("content-type")??""))
   return reply(415,"JSON only");
 const len=Number(req.headers.get("content-length")??0);
 if(!Number.isSafeInteger(len)||len<0||len>120000)return reply(413,"Synthesis input too large");
 let raw:unknown;
 try{
   const reader=req.body?.getReader();if(!reader)throw Error("Missing body");
   const bytes:Uint8Array[]=[];let size=0;
   try{
     while(true){
       const {value,done}=await reader.read();if(done)break;
       if(value){size+=value.byteLength;if(size>120000)throw Error("Oversized");
         bytes.push(value);}
     }
   }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   const all=new Uint8Array(size);let offset=0;
   for(const part of bytes){all.set(part,offset);offset+=part.byteLength;}
   raw=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(all));
 }catch{return reply(400,"Invalid bounded summary");}
 const release=limiter.acquire();
 if(!release)return reply(429,"Opus request already running or limited");
 try{
   const result=await synthesizeSafeFullVolumeOpus(raw,callAiGateway,
      AbortSignal.any([req.signal,AbortSignal.timeout(165000)]));
   return NextResponse.json(result,{headers:HEADERS});
 }catch{
   return reply(502,"Text-only Opus report failed validation or provider execution");
 }finally{release();}
}
