/** Fixed loopback LungSCAPE bridge. No arbitrary host, no browser-visible worker token. */
import {NextRequest,NextResponse} from "next/server";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=800;
const WORKER="http://127.0.0.1:8784";
const HEAD={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const JOB=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const LIMIT=352+512*512*300*4;
const fail=(status:number)=>NextResponse.json({error:"LungSCAPE local worker unavailable"},{status,headers:HEAD});
async function handler(req:NextRequest,ctx:{params:Promise<{parts:string[]}>},method:"GET"|"POST"|"DELETE"){
 const {parts}=await ctx.params;
 const path="/"+parts.join("/");
 const allowed=(path==="/v1/lungscape/capabilities"&&method==="GET")||
  (path==="/v1/lungscape/upload"&&method==="POST")||
  (parts.length>=4&&parts.length<=5&&parts[0]==="v1"&&parts[1]==="lungscape"&&parts[2]==="jobs"&&
   JOB.test(parts[3])&&((parts.length===4&&(method==="GET"||method==="DELETE"))||
    (parts.length===5&&parts[4]==="report"&&method==="GET")));
 const host=req.headers.get("host")??"";
 const origin=req.headers.get("origin");
 if(!allowed||process.env.NODE_ENV!=="development"||
   !/^(127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(host)||
   !["127.0.0.1","localhost"].includes(req.nextUrl.hostname)||
   !!req.nextUrl.search||
   (origin!==null&&origin!=="http://"+host)||
   (method==="POST"&&origin!=="http://"+host)||
   (req.headers.get("sec-fetch-site")??"same-origin")!=="same-origin")
  return fail(404);
 const token=process.env.OPUS_LungSCAPE_WORKER_TOKEN??"";
 const workerOrigin=process.env.OPUS_LungSCAPE_WORKER_ORIGIN??"http://127.0.0.1:3000";
 if(!/^[a-zA-Z0-9_-]{32,128}$/.test(token)||workerOrigin!=="http://"+host)return fail(503);
 if(method==="POST"&&(req.headers.get("content-type")!=="application/octet-stream"||
    req.headers.get("x-opus-public-research-authorization")!=="approved-nonpatient-source"||
    !HASH.test(req.headers.get("x-opus-source-sha256")??"")))return fail(403);
 try{
  let count=0;
  const body=method==="POST"?req.body?.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
   transform(chunk,controller){count+=chunk.byteLength;
    if(count>LIMIT)throw Error("oversized");controller.enqueue(chunk);}
  })):undefined;
  if(method==="POST"&&!body)return fail(400);
  const upstream=await fetch(WORKER+path,{method,redirect:"error",cache:"no-store",
   signal:AbortSignal.any([req.signal,AbortSignal.timeout(method==="POST"?750000:10000)]),
   headers:{Authorization:"Bearer "+token,Origin:workerOrigin,
    ...(method==="POST"?{"Content-Type":"application/octet-stream",
     "X-Opus-Source-Sha256":req.headers.get("x-opus-source-sha256")!,
     "X-Opus-Public-Research-Authorization":"approved-nonpatient-source"}:{})},
   ...(body?{body,duplex:"half" as const}:{})});
  if(!upstream.ok)return fail(upstream.status===413?413:503);
  const size=Number(upstream.headers.get("content-length")??0);
  if(size>1024*1024)return fail(413);
  const text=await upstream.text();
  if(text.length>1024*1024)return fail(413);
  return NextResponse.json(JSON.parse(text),{headers:HEAD});
 }catch{return fail(503);}
}
export async function GET(req:NextRequest,ctx:{params:Promise<{parts:string[]}>}){return handler(req,ctx,"GET")}
export async function POST(req:NextRequest,ctx:{params:Promise<{parts:string[]}>}){return handler(req,ctx,"POST")}
export async function DELETE(req:NextRequest,ctx:{params:Promise<{parts:string[]}>}){return handler(req,ctx,"DELETE")}
