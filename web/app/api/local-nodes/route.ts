/** Bound public-research original chest nodes worker; NEVER expose its token to the browser.
 * Fixed localhost port/path, no arbitrary SSRF/redirect, not public patient service.
 */
import {NextRequest,NextResponse} from "next/server";
import {raidionicsOriginalReady} from "../../../lib/mediastinal-raidionics-worker";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=800;
const HEAD={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const HOST=/^(?:127\.0\.0\.1|localhost):[0-9]{1,5}$/;
const MAX_SOURCE_BYTES=352+512*512*300*4;
const MAX_REPORT_BYTES=1024*1024;
const WORKER="http://127.0.0.1:8777";
const fail=(status:number,reason:string)=>NextResponse.json({error:reason},
 {status,headers:HEAD});

function allowed(req:NextRequest,post:boolean){
 const host=req.headers.get("host")??"";
 const origin=req.headers.get("origin");
 return process.env.NODE_ENV==="development"&&HOST.test(host)&&
   ["127.0.0.1","localhost"].includes(req.nextUrl.hostname)&&
   (post?origin==="http://"+host:(origin===null||origin==="http://"+host))&&
   (req.headers.get("sec-fetch-site")??"same-origin")==="same-origin"&&
   !req.nextUrl.search;
}
function secret(){
 const token=process.env.OPUS_NODES_WORKER_TOKEN??"";
 return /^[a-zA-Z0-9_-]{32,128}$/.test(token)?token:null;
}
function serviceOrigin(){
 const v=process.env.OPUS_LOCAL_WORKER_ORIGIN??"http://127.0.0.1:3000";
 return /^http:\/\/(?:127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(v)?v:null;
}
async function boundedJson(resp:Response,maxBytes:number):Promise<unknown>{
 const reader=resp.body?.getReader();
 if(!reader)throw Error("empty");
 let total=0;const parts:Uint8Array[]=[];
 try{for(;;){const {value,done}=await reader.read();if(done)break;
   total+=value.byteLength;if(total>maxBytes)throw Error("oversized");
   parts.push(value);
 }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(total);let off=0;
 for(const part of parts){bytes.set(part,off);off+=part.length;}
 return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
}
async function provenCapabilities(token:string,origin:string,signal:AbortSignal){
 const result=await fetch(WORKER+"/v1/nodes/capabilities",{
  method:"GET",cache:"no-store",redirect:"error",
  signal:AbortSignal.any([signal,AbortSignal.timeout(3500)]),
  headers:{Origin:origin,Authorization:"Bearer "+token},
 });
 if(!result.ok)throw Error("worker_not_ready");
 const cap=await boundedJson(result,16384);
 if(!raidionicsOriginalReady(cap))throw Error("checkpoint_not_verified");
 return cap;
}
export async function GET(req:NextRequest){
 if(!allowed(req,false))return fail(404,"Local research only");
 const token=secret(),origin=serviceOrigin();
 if(!token||!origin)return fail(503,"Original nodes service not configured");
 try{
  const cap=await provenCapabilities(token,origin,req.signal);
  // No PHI and no worker token in vendor capability; not a clinical clearance.
  return NextResponse.json(cap,{headers:HEAD});
 }catch{return fail(503,"Original nodes model not yet ready");}
}
export async function POST(req:NextRequest){
 if(!allowed(req,true))return fail(404,"Local research only");
 if(req.headers.get("content-type")!=="application/octet-stream"||
    req.headers.get("x-opus-public-research-authorization")!=="approved-nonpatient-source"||
    req.headers.get("x-opus-enhanced-ct-confirmed")!=="yes")
   return fail(403,"Only authorized public nonpatient CT research is allowed");
 const claimed=req.headers.get("x-opus-source-sha256")??"";
 if(!/^[a-f0-9]{64}$/.test(claimed))return fail(422,"Exact CT source SHA required");
 const declared=Number(req.headers.get("content-length")??"0");
 if(!Number.isSafeInteger(declared)||declared<0||declared>MAX_SOURCE_BYTES)
   return fail(413,"Original CT exceeds source budget");
 const token=secret(),origin=serviceOrigin();
 if(!token||!origin)return fail(503,"Original nodes service not configured");
 if(!req.body)return fail(400,"Original source body required");
 try{
  await provenCapabilities(token,origin,req.signal);
  let count=0;
  const streamed=req.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
    transform(value,controller){
     count+=value.byteLength;
     if(count>MAX_SOURCE_BYTES)throw Error("original_CT_too_large");
     controller.enqueue(value);
    },
  }));
  const init:RequestInit&{duplex:"half"}={
    method:"POST",body:streamed,duplex:"half",cache:"no-store",redirect:"error",
    headers:{"Content-Type":"application/octet-stream",
      "X-Opus-Source-Sha256":claimed,
      "X-Opus-Public-Research-Authorization":"approved-nonpatient-source",
      "X-Opus-Enhanced-CT-Confirmed":"yes",
      Origin:origin,Authorization:"Bearer "+token},
    signal:AbortSignal.any([req.signal,AbortSignal.timeout(750000)]),
  };
  const result=await fetch(WORKER+"/v1/nodes/analyze",init);
  if(!result.ok)return fail(result.status===413?413:422,
    "Original nodes worker did not complete verified research inference");
  const parsed=await boundedJson(result,MAX_REPORT_BYTES);
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||
      (parsed as Record<string,unknown>).schema!=="opus-original-raidionics-mediastinal-nodes-native-ct/v1"||
      (parsed as Record<string,unknown>).sourceNiftiSHA256!==claimed||
      (parsed as Record<string,unknown>).actualOriginalRaidionicsInferenceCompleted!==true)
    return fail(422,"Original PE model response is not source bound");
  return NextResponse.json(parsed,{headers:HEAD});
 }catch{return fail(503,"Original nodes worker unavailable or request cancelled");}
}
