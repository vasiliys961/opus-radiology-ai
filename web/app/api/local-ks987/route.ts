import {NextRequest,NextResponse} from "next/server";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=800;
const fail=(s:number,e:string)=>NextResponse.json({error:e},{status:s});
function gate(req:NextRequest){
 const host=req.headers.get("host")??"";
 return process.env.NODE_ENV==="development"&&/^(localhost|127\.0\.0\.1):\d{1,5}$/.test(host)&&["localhost","127.0.0.1"].includes(req.nextUrl.hostname)&&req.headers.get("origin")==="http://"+host;
}
function secret(){const t=process.env.OPUS_KS987_WORKER_TOKEN??"";return /^[A-Za-z0-9_-]{32,128}$/.test(t)?t:null;}
export async function POST(req:NextRequest){
 const token=secret();
 if(!gate(req)||!token)return fail(403,"private_research_only");
 const sha=req.headers.get("x-opus-source-sha256")??"";
 if(!/^[a-f0-9]{64}$/.test(sha)||!req.body||req.headers.get("content-type")!=="application/octet-stream"||
 req.headers.get("x-opus-research-authorized")!=="authorized-nonpatient")return fail(422,"original_source_or_authorization_required");
 let count=0;const source=req.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(p,c){count+=p.length;if(count>1600*1024**2)throw Error("too_large");c.enqueue(p);}}));
 try{
  const r=await fetch("http://127.0.0.1:8783/v1/ks987/analyze",{method:"POST",body:source,duplex:"half",redirect:"error",cache:"no-store",signal:AbortSignal.any([req.signal,AbortSignal.timeout(7800000)]),
  headers:{"Authorization":"Bearer "+token,"Content-Type":"application/octet-stream","X-Opus-Source-Sha256":sha,"X-Opus-Research-Authorized":"authorized-nonpatient"}} as RequestInit&{duplex:"half"});
  if(!r.ok)return fail(503,"genuine_KS987_unavailable");
  const raw=await r.text();if(raw.length>1024*1024)return fail(422,"oversized_evidence");
  const x=JSON.parse(raw);if(x.schema!=="opus-ks987-native-kidney-forward/v1"||x.sourceNiftiSha256!==sha||x.originalModelForwardCompleted!==true)return fail(422,"unverified_evidence");
  return NextResponse.json(x,{headers:{"Cache-Control":"no-store"}});
 }catch{return fail(503,"real_KS987_execution_failed");}
}
