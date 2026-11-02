/** Private same-origin MONAI RetinaNet bridge for permitted public chest CT research.
 * The browser never receives worker credentials. Local or private SSH tunnel,
 * with every created job bound to exactly one authentic original executor.
 */
import {NextRequest,NextResponse} from "next/server";
import {selectMonaiExecutor,boundMonaiExecutor,monaiJobBinding,
 monaiExecutorHeaders,boundedMonaiJson} from "../../../../lib/monai-executor-selection";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=800;
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
async function handle(req:NextRequest,ctx:{params:Promise<{parts:string[]}>},method:"GET"|"POST"|"DELETE"){
 const {parts}=await ctx.params;
 const target=path(parts,method);
 if(!target||!approved(req,method))return fail(404,"Local research only");
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
  // Only admission probes readiness. Poll/report/delete must remain available
  // after the original job consumes RAM or another executor becomes ready.
  const isJob=parts[2]==="jobs";
  const selection=isJob?null:await selectMonaiExecutor(process.env,req.signal);
  const executor=isJob?boundMonaiExecutor(process.env,
    req.headers.get("x-opus-monai-job-binding"),parts[3]):selection?.executor;
  if(target==="/v1/nodule/capabilities"){
   const safe:Record<string,unknown>={};
   for(const key of ["schema","modelId","modelVersion","checkpointSha256","modelRevision",
     "originalWeightsVerified","mode","dataPolicy","sourceFormat","patientMode",
     "imageUpload","ready","unvalidatedResearch"])
     if(selection?.capability)safe[key]=selection.capability[key];
   return NextResponse.json({...(selection?.capability?safe:{schema:"opus-monai-executor-selection/v1",ready:false}),
    automaticExecution:{location:executor?.id??null,attempts:selection?.attempts??[]}}, {headers:HEAD});
  }
  if(!executor)return fail(isJob?401:503,isJob?"Original MONAI job binding required":"No compatible original MONAI executor ready");
  let size=0;
  const body=isUpload?req.body!.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
   transform(chunk,controller){size+=chunk.byteLength;if(size>LIMIT)throw Error("CT too large");controller.enqueue(chunk);}
  })):undefined;
  const init:RequestInit&{duplex?:"half"}={
   method,headers:{...monaiExecutorHeaders(executor),
    ...(isUpload?{"Content-Type":"application/octet-stream",
     "X-Opus-Source-Sha256":req.headers.get("x-opus-source-sha256")!}: {})},
   redirect:"error",cache:"no-store",
   signal:AbortSignal.any([req.signal,AbortSignal.timeout(isUpload?750000:30000)]),
   ...(isUpload?{body,duplex:"half" as const}:{}),
  };
  const res=await fetch(executor.url+target,init);
  if(!res.ok)return fail([404,409,413,507].includes(res.status)?res.status:503,"Original MONAI worker did not complete operation");
  const parsed=await boundedMonaiJson(res,1048576);
  if(isUpload){
   if(parsed.schema!=="opus-monai-job/v1"||typeof parsed.jobId!=="string"||
      !JOB.test(parsed.jobId)||parsed.state!=="running")return fail(422,"Original MONAI did not confirm a job");
   return NextResponse.json({schema:parsed.schema,jobId:parsed.jobId,state:parsed.state,
    executorLocation:executor.id,executorBinding:monaiJobBinding(executor,parsed.jobId)},{status:201,headers:HEAD});
  }
  if(target.endsWith("/report")&&parsed.schema!=="opus-monai-bound-nodule-inference/v1")
   return fail(422,"Invalid MONAI original report");
  return NextResponse.json(parsed,{headers:HEAD});
 }catch{return fail(503,"Original MONAI model unavailable or cancelled");}
}
export async function GET(req:NextRequest,ctx:{params:Promise<{parts:string[]}>}){return handle(req,ctx,"GET");}
export async function POST(req:NextRequest,ctx:{params:Promise<{parts:string[]}>}){return handle(req,ctx,"POST");}
export async function DELETE(req:NextRequest,ctx:{params:Promise<{parts:string[]}>}){return handle(req,ctx,"DELETE");}
