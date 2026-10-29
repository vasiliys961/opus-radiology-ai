/** No XRV token in browser. Node localhost proxy -> SHA-pinned, offline
 * original pretrained NIH CXR worker. Public nonpatient research only.
 */
import {NextRequest,NextResponse} from "next/server";
import {createHash} from "node:crypto";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
const MAX_PNG=25*1024*1024;
const HOST=/^(?:127\.0\.0\.1|localhost):[0-9]{1,5}$/;
const WORKER="http://127.0.0.1:8779";
const HEAD={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const error=(status:number,message:string)=>
 NextResponse.json({error:message},{status,headers:HEAD});
function localhost(req:NextRequest){
 const host=req.headers.get("host")??"";
 const origin=req.headers.get("origin");
 return process.env.NODE_ENV==="development"&&HOST.test(host)&&
  ["127.0.0.1","localhost"].includes(req.nextUrl.hostname)&&
  (origin===null||origin==="http://"+host)&&
  (req.headers.get("sec-fetch-site")??"same-origin")==="same-origin"&&
  !req.nextUrl.search;
}
function backend(){
 const token=process.env.OPUS_XRV_WORKER_TOKEN??"";
 if(!/^[A-Za-z0-9_-]{32,128}$/.test(token))return null;
 return token;
}
async function workerRequest(path:string,init:RequestInit,token:string){
 return fetch(WORKER+path,{...init,cache:"no-store",redirect:"error",
  headers:{...init.headers,Authorization:"Bearer "+token,
   Origin:"http://127.0.0.1:3000"}});
}
function expectedCap(v:unknown):boolean{
 if(!v||typeof v!=="object"||Array.isArray(v))return false;
 const x=v as Record<string,unknown>;
 return x.schema==="opus-original-xrv-cxr-worker/v1"&&
  x.model==="densenet121-res224-nih"&&
  x.packageVersion==="1.5.7"&&
  x.weightSha256==="31a5475c6b1383a7edbfcaf96af9ce302eb9969cfe28b6b8b5859afc6f274fdf"&&
  x.originalCheckpointVerified===true&&x.ready===true&&x.patientMode===false&&
  x.mode==="isolated-linux-cpu-research"&&
  x.sourcePolicy==="approved-public-nonpatient-only"&&
  Array.isArray(x.modelLabels)&&x.modelLabels.join(",")==="Pneumothorax,Cardiomegaly,Effusion,Pneumonia,Edema,Mass";
}
export async function GET(req:NextRequest){
 if(!localhost(req))return error(404,"Private local research only");
 const token=backend();
 if(!token)return NextResponse.json({ready:false,reason:"worker_token_not_configured"},{headers:HEAD});
 try{
  const r=await workerRequest("/v1/cxr/capabilities",{
   method:"GET",signal:AbortSignal.timeout(2500)},token);
  if(!r.ok)return NextResponse.json({ready:false,reason:"worker_unavailable"},{headers:HEAD});
  const v:unknown=await r.json();
  return NextResponse.json({ready:expectedCap(v),reason:expectedCap(v)?"ready":"original_model_unverified"},{headers:HEAD});
 }catch{
  return NextResponse.json({ready:false,reason:"worker_unavailable"},{headers:HEAD});
 }
}
export async function POST(req:NextRequest){
 if(!localhost(req)||req.headers.get("origin")!=="http://"+req.headers.get("host"))
  return error(404,"Private local research only");
 if(req.headers.get("content-type")!=="image/png")
  return error(415,"PNG raster only");
 if(req.headers.get("x-opus-public-research-authorized")!=="yes")
  return error(403,"Research and original public image rights not confirmed");
 const sourceUrl=req.headers.get("x-opus-public-source-url")??"";
 if(!/^https:\/\/[^@?#\s]{4,1024}$/.test(sourceUrl))
  return error(422,"Public nonpatient CXR source URL required");
 const token=backend();
 if(!token)return error(503,"Research worker is not configured");
 const declared=Number(req.headers.get("content-length")??0);
 if(!Number.isSafeInteger(declared)||declared>MAX_PNG)
  return error(413,"Research PNG exceeds bounded size");
 let bytes:Uint8Array;
 try{
  const reader=req.body?.getReader();
  if(!reader)return error(400,"Image missing");
  const pieces:Uint8Array[]=[];let size=0;
  try{
   for(;;){
    const {value,done}=await reader.read();if(done)break;
    if(value){size+=value.length;if(size>MAX_PNG)throw Error("oversized");
     pieces.push(value);}
   }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  bytes=new Uint8Array(size);let at=0;
  for(const c of pieces){bytes.set(c,at);at+=c.length;}
 }catch{return error(413,"Research PNG exceeds bounded size");}
 if(bytes.length<1024||![137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b))
  return error(422,"Invalid source PNG");
 const digest=createHash("sha256").update(bytes).digest("hex");
 try{
  const cap=await workerRequest("/v1/cxr/capabilities",{
   method:"GET",signal:AbortSignal.timeout(3000)},token);
  if(!cap.ok||!expectedCap(await cap.json()))
   return error(503,"Original model missing or not verified");
  const result=await workerRequest("/v1/cxr/analyze",{
   method:"POST",signal:AbortSignal.any([req.signal,AbortSignal.timeout(275000)]),
   headers:{"Content-Type":"image/png","X-Opus-PNG-SHA256":digest,
    "X-Opus-Public-Source-URL":sourceUrl},body:Buffer.from(bytes)},token);
  if(!result.ok)return error(422,"Original model unable to assess this image");
  const text=await result.text();
  if(text.length>16384)return error(422,"Unexpected original research report size");
  const data:unknown=JSON.parse(text);
  if(!data||typeof data!=="object"||Array.isArray(data))
   return error(422,"Invalid research model response");
  const x=data as Record<string,unknown>;
  const names=["Pneumothorax","Cardiomegaly","Effusion","Pneumonia","Edema","Mass"];
  const labels=x.labels;
  if(x.schema!=="opus-original-xrv-cxr-six-head/v1"||
     x.sourcePngSha256!==digest||
     x.modelWeightSha256!=="31a5475c6b1383a7edbfcaf96af9ce302eb9969cfe28b6b8b5859afc6f274fdf"||
     x.actualPretrainedModelForwardCompleted!==true||
     x.clinicalValidation!==false||
     x.patientMode!==false||
     x.negativeDiagnosisPermitted!==false||
     !labels||typeof labels!=="object"||Array.isArray(labels)||
     Object.keys(labels).sort().join(",")!==[...names].sort().join(",")||
     !Object.values(labels).every(v=>typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=1))
   return error(422,"Source/model mismatch or unsupported scores");
  // Never return source URL, DICOM identifiers, server auth or file path.
  return NextResponse.json({schema:x.schema,sourcePngSha256:digest,
   model:x.model,modelWeightSha256:x.modelWeightSha256,
   actualPretrainedModelForwardCompleted:true,labels,
   clinicalValidation:false,scoresAreCalibratedProbabilities:false,
   spatialLocalizationSupported:false,negativeDiagnosisPermitted:false,
   patientMode:false,limitations:x.limitations},{headers:HEAD});
 }catch{
  return error(503,"Original XRV worker unavailable; no diagnosis generated");
 }
}
