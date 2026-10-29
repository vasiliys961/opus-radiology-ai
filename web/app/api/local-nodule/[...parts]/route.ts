/** Private same-origin MONAI RetinaNet bridge for permitted public chest CT research.
 * The browser never receives the Linux worker token. Fixed loopback target only.
 */
import {NextRequest,NextResponse} from "next/server";
import {readyOriginalNoduleWorker} from "../../../../lib/live-nodule-worker";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=800;
const WORKER="http://127.0.0.1:8768";
const HEAD={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const HOST=/^(127\.0\.0\.1|localhost):[0-9]{1,5}$/;
const JOB=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const LIMIT=352+512*512*300*4;
const fail=(status:number,error:string)=>NextResponse.json({error},{status,headers:HEAD});
function approved(req:NextRequest,method:string){
 const host=req.headers.get("host")??"";
 const origin=req.headers.get("origin");
 return process.env.NODE_ENV==="development"&&HOST.test(host)&&
  ["127.0.0.1","localhost"].includes(req.nextUrl.hostname)&&
  !req.nextUrl.search&&
  (method==="GET"?(origin===null||origin==="http://"+host):origin==="http://"+host)&&
  (req.headers.get("sec-fetch-site")??"same-origin")==="same-origin";
}
function credentials(){
 const token=process.env.OPUS_MONAI_WORKER_TOKEN??"";
 const origin=process.env.OPUS_LOCAL_WORKER_ORIGIN??"http://127.0.0.1:3000";
 return /^[a-zA-Z0-9_-]{32,128}$/.test(token)&&
  /^http:\/\/(127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(origin)?
  {token,origin}:null;
}
function path(parts:string[],method:string):string|null{
 if(parts.length===2&&parts[0]==="v1"&&parts[1]==="nodule" )return null;
 if(parts.length===3&&parts[0]==="v1"&&parts[1]==="nodule"&&parts[2]==="capabilities"&&method==="GET")
  return "/v1/nodule/capabilities";
 if(parts.length===3&&parts[0]==="v1"&&parts[1]==="nodule"&&parts[2]==="upload"&&method==="POST")
  return "/v1/nodule/upload";
 if(parts.length>=4&&parts[0]==="v1"&&parts[1]==="nodule"&&parts[2]==="jobs"&&JOB.test(parts[3])&&
  ((parts.length===4&&(method==="GET"||method==="DELETE"))||
   (parts.length===5&&parts[4]==="report"&&method==="GET")))
  return "/"+parts.join("/");
 return null;
}
async function bounded(resp:Response,max:number):Promise<Uint8Array>{
 const reader=resp.body?.getReader();if(!reader)throw Error("empty");
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;
  size+=value.byteLength;if(size>max)throw Error("oversized");chunks.push(value);
 }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const result=new Uint8Array(size);let off=0;
 for(const c of chunks){result.set(c,off);off+=c.byteLength;}
 return result;
}
async function capability(c:{token:string;origin:string},signal:AbortSignal){
 const res=await fetch(WORKER+"/v1/nodule/capabilities",{
  method:"GET",cache:"no-store",redirect:"error",
  signal:AbortSignal.any([signal,AbortSignal.timeout(3500)]),
  headers:{Authorization:"Bearer "+c.token,Origin:c.origin},
 });
 if(!res.ok)throw Error("not-ready");
 const cap=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(await bounded(res,16384)));
 // Arbitrary opened DICOM requires a worker supporting uploaded original HU NIfTI.
 if(!readyOriginalNoduleWorker(cap)||cap.imageUpload!==true)throw Error("upload-unavailable");
 return cap;
}
async function handle(req:NextRequest,ctx:{params:Promise<{parts:string[]}>},method:"GET"|"POST"|"DELETE"){
 const {parts}=await ctx.params;
 const target=path(parts,method);
 if(!target||!approved(req,method))return fail(404,"Local research only");
 const c=credentials();
 if(!c)return fail(503,"MONAI server credentials not configured");
 const isUpload=method==="POST";
 if(isUpload&&(req.headers.get("content-type")!=="application/octet-stream"||
  req.headers.get("x-opus-public-research-authorization")!=="approved-nonpatient-source"||
  !SHA.test(req.headers.get("x-opus-source-sha256")??"")))
  return fail(403,"Authorized public research CT and source SHA required");
 if(isUpload){
  const len=req.headers.get("content-length");
  if(len!==null&&(!Number.isSafeInteger(Number(len))||Number(len)<352||Number(len)>LIMIT))
   return fail(413,"CT exceeds bounded upload size");
  if(!req.body)return fail(400,"Empty CT");
 }
 try{
  const cap=await capability(c,req.signal);
  if(target==="/v1/nodule/capabilities")return NextResponse.json(cap,{headers:HEAD});
  let size=0;
  const body=isUpload?req.body!.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
   transform(chunk,controller){size+=chunk.byteLength;if(size>LIMIT)throw Error("CT too large");controller.enqueue(chunk);}
  })):undefined;
  const init:RequestInit&{duplex?:"half"}={
   method,headers:{Authorization:"Bearer "+c.token,Origin:c.origin,
    ...(isUpload?{"Content-Type":"application/octet-stream",
     "X-Opus-Source-Sha256":req.headers.get("x-opus-source-sha256")!}: {})},
   redirect:"error",cache:"no-store",
   signal:AbortSignal.any([req.signal,AbortSignal.timeout(isUpload?750000:30000)]),
   ...(isUpload?{body,duplex:"half" as const}:{}),
  };
  const res=await fetch(WORKER+target,init);
  if(!res.ok)return fail(res.status===413?413:503,"Original MONAI worker did not complete operation");
  const bytes=await bounded(res,1048576);
  const parsed=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return fail(422,"Invalid MONAI response");
  if(target.endsWith("/report")&&parsed.schema!=="opus-monai-bound-nodule-inference/v1")
   return fail(422,"Invalid MONAI original report");
  return NextResponse.json(parsed,{headers:HEAD});
 }catch{return fail(503,"Original MONAI model unavailable or cancelled");}
}
export async function GET(req:NextRequest,ctx:{params:Promise<{parts:string[]}>}){return handle(req,ctx,"GET");}
export async function POST(req:NextRequest,ctx:{params:Promise<{parts:string[]}>}){return handle(req,ctx,"POST");}
export async function DELETE(req:NextRequest,ctx:{params:Promise<{parts:string[]}>}){return handle(req,ctx,"DELETE");}
