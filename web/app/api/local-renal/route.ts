/** Fixed localhost original renal MONAI relay; the worker bearer stays server-side. */
import {NextRequest,NextResponse} from "next/server";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=800;
const WORKER="http://127.0.0.1:8782";
const NO_STORE={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
function allowed(req:NextRequest,post:boolean){
 const host=req.headers.get("host")??"",origin=req.headers.get("origin");
 return process.env.NODE_ENV==="development"&&/^(127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(host)&&
 ["localhost","127.0.0.1"].includes(req.nextUrl.hostname)&&
 (post?origin==="http://"+host:!origin||origin==="http://"+host)&&
 (req.headers.get("sec-fetch-site")??"same-origin")==="same-origin"&&!req.nextUrl.search;
}
const bad=(status:number,error:string)=>NextResponse.json({error},{status,headers:NO_STORE});
function credential(){
 const t=process.env.OPUS_RENAL_MONAI_TOKEN??"";
 return /^[A-Za-z0-9_-]{32,128}$/.test(t)?t:null;
}
async function upstream(path:string,init:RequestInit={}){
 const token=credential();if(!token)throw Error("worker_token_missing");
 return fetch(WORKER+path,{...init,redirect:"error",cache:"no-store",
 headers:{...init.headers,Authorization:"Bearer "+token},
 signal:AbortSignal.any([init.signal??new AbortController().signal,AbortSignal.timeout(750000)])});
}
export async function GET(req:NextRequest){
 if(!allowed(req,false))return bad(404,"local_research_only");
 try{
  const r=await upstream("/v1/renal/capabilities",{signal:req.signal});
  if(!r.ok)return bad(503,"model_not_installed");
  const text=await r.text();if(text.length>8192)return bad(422,"invalid_capabilities");
  const x=JSON.parse(text);
  if(x.schema!=="opus-real-renal-monai-worker/v1"||x.ready!==true||
     x.originalWeightsVerified!==true||!(/^[a-f0-9]{64}$/.test(x.modelCheckpointSha256)))
   return bad(503,"original_checkpoint_not_verified");
  return NextResponse.json(x,{headers:NO_STORE});
 }catch{return bad(503,"original_renal_worker_offline");}
}
export async function POST(req:NextRequest){
 if(!allowed(req,true))return bad(404,"local_research_only");
 if(req.headers.get("content-type")!=="application/zip"||
  req.headers.get("x-opus-three-phase-research")!=="authorized-registered-kidney-roi")
  return bad(403,"three_phase_research_not_approved");
 const hash=req.headers.get("x-opus-source-sha256")??"";
 if(!/^[a-f0-9]{64}$/.test(hash))return bad(422,"source_digest_required");
 const n=Number(req.headers.get("content-length")??"-1");
 if(!Number.isSafeInteger(n)||n<1024||n>1201*1024*1024||!req.body)
  return bad(413,"three_phase_archive_out_of_budget");
 try{
  let total=0;
  const body=req.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
   transform(part,ctrl){total+=part.length;if(total>1201*1024*1024)throw Error("too_big");ctrl.enqueue(part);}
  }));
  const init:RequestInit&{duplex:"half"}={method:"POST",body,duplex:"half",signal:req.signal,
   headers:{"Content-Type":"application/zip","X-Opus-Source-Sha256":hash,
    "X-Opus-Three-Phase-Research":"authorized-registered-kidney-roi"}};
  const r=await upstream("/v1/renal/analyze",init);
  if(!r.ok)return bad(r.status===422?422:503,"original_renal_model_unavailable_or_incompatible");
  const text=await r.text();if(text.length>512*1024)return bad(422,"unbounded_model_result");
  const x=JSON.parse(text);
  if(x.schema!=="opus-renal-monai-http-result/v1"||x.sourceArchiveSHA256!==hash||
   x.report?.schema!=="opus-original-MONAI-renal-CECT-neoplasm-3phase/v1"||
   x.report?.originalPretrainedInferenceCompleted!==true)
   return bad(422,"source_or_forward_evidence_invalid");
  return NextResponse.json(x,{headers:NO_STORE});
 }catch{return bad(503,"renal_model_execution_failed");}
}
