/** Private original ianpan worker bridge. Hashes only: no patient DICOM transfer. */
import {NextRequest,NextResponse} from "next/server";
import {validatedPublicIchCapabilities} from "../../../../lib/public-ich-worker";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=800;
const URL="http://127.0.0.1:8766";
const HEAD={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const JOB=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const fail=(s:number,e:string)=>NextResponse.json({error:e},{status:s,headers:HEAD});
function allowed(req:NextRequest,method:string){
 const host=req.headers.get("host")??"",origin=req.headers.get("origin");
 return process.env.NODE_ENV==="development"&&/^(127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(host)&&
  ["127.0.0.1","localhost"].includes(req.nextUrl.hostname)&&!req.nextUrl.search&&
  (method==="GET"?(origin===null||origin==="http://"+host):origin==="http://"+host)&&
  (req.headers.get("sec-fetch-site")??"same-origin")==="same-origin";
}
function credentials(){
 const token=process.env.OPUS_ICH_WORKER_TOKEN??"";
 const origin=process.env.OPUS_LOCAL_WORKER_ORIGIN??"http://127.0.0.1:3000";
 return /^[A-Za-z0-9_-]{32,128}$/.test(token)&&
 /^http:\/\/(127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(origin)?{token,origin}:null;
}
function endpoint(parts:string[],method:string):string|null{
 if(parts.join("/")==="v1/ich/capabilities"&&method==="GET")return "/v1/ich/capabilities";
 if(parts.join("/")==="v1/ich/jobs"&&method==="POST")return "/v1/ich/jobs";
 if(parts.length>=4&&parts[0]==="v1"&&parts[1]==="ich"&&parts[2]==="jobs"&&JOB.test(parts[3])){
  if(parts.length===4&&["GET","DELETE"].includes(method))return "/"+parts.join("/");
  if(parts.length===5&&parts[4]==="evidence"&&method==="GET")return "/"+parts.join("/");
 }
 return null;
}
async function bounded(resp:Response,limit:number){
 const reader=resp.body?.getReader();if(!reader)throw Error("empty");
 let bytes=0;const chunks:Uint8Array[]=[];
 try{for(;;){const part=await reader.read();if(part.done)break;
  bytes+=part.value.length;if(bytes>limit)throw Error("oversized");
  chunks.push(part.value);
 }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const data=new Uint8Array(bytes);let pos=0;
 for(const c of chunks){data.set(c,pos);pos+=c.length;}
 return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(data));
}
async function capability(c:{token:string;origin:string},signal:AbortSignal){
 const response=await fetch(URL+"/v1/ich/capabilities",{
  headers:{Authorization:"Bearer "+c.token,Origin:c.origin},
  signal:AbortSignal.any([signal,AbortSignal.timeout(3500)]),
  cache:"no-store",redirect:"error",
 });
 if(!response.ok)throw Error("unavailable");
 const cap=await bounded(response,16384);
 if(!validatedPublicIchCapabilities(cap))throw Error("unverified-original");
 return cap;
}
async function handle(req:NextRequest,ctx:{params:Promise<{parts:string[]}>},method:"GET"|"POST"|"DELETE"){
 const path=endpoint((await ctx.params).parts,method);
 if(!path||!allowed(req,method))return fail(404,"Local public research only");
 const c=credentials();if(!c)return fail(503,"Original ICH service not configured");
 let body:string|undefined;
 if(method==="POST"){
  if(req.headers.get("content-type")!=="application/json"||
    req.headers.get("x-opus-public-research-authorization")!=="approved-nonpatient-source")
   return fail(403,"Research authorization required");
  const n=Number(req.headers.get("content-length")??"0");
  if(!Number.isSafeInteger(n)||n>8192||n<0)return fail(413,"Invalid job input");
  try{
   const raw=await req.text();
   if(raw.length>8192)return fail(413,"Invalid job input");
   const v=JSON.parse(raw);
   if(v?.schema!=="opus-public-ich-job/v1"||v.dataPolicy!=="public-reference-only"||
     !Array.isArray(v.originalDicomSha256)||v.originalDicomSha256.length<8||
     v.originalDicomSha256.length>64||!v.originalDicomSha256.every((x:unknown)=>typeof x==="string"&&SHA.test(x))||
     new Set(v.originalDicomSha256).size!==v.originalDicomSha256.length)
    return fail(422,"Only exact authorized original DICOM hashes accepted");
   body=raw;
  }catch{return fail(422,"Invalid ICH hash-only request");}
 }
 try{
  const cap=await capability(c,req.signal);
  if(path==="/v1/ich/capabilities")return NextResponse.json(cap,{headers:HEAD});
  const response=await fetch(URL+path,{method,
    headers:{Authorization:"Bearer "+c.token,Origin:c.origin,...(body?{"Content-Type":"application/json"}:{})},
    ...(body?{body}:{}),cache:"no-store",redirect:"error",
    signal:AbortSignal.any([req.signal,AbortSignal.timeout(30000)]),
  });
  if(!response.ok)return fail(503,"Original ICH model unavailable");
  const result=await bounded(response,1048576);
  if(!result||typeof result!=="object"||Array.isArray(result))return fail(422,"Invalid original worker response");
  return NextResponse.json(result,{headers:HEAD});
 }catch{return fail(503,"Original ICH model unavailable or cancelled");}
}
export async function GET(req:NextRequest,ctx:{params:Promise<{parts:string[]}>}){return handle(req,ctx,"GET");}
export async function POST(req:NextRequest,ctx:{params:Promise<{parts:string[]}>}){return handle(req,ctx,"POST");}
export async function DELETE(req:NextRequest,ctx:{params:Promise<{parts:string[]}>}){return handle(req,ctx,"DELETE");}
