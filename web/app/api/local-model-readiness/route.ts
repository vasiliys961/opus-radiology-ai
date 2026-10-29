/** Server-only, PHI-free research original weight/worker status for clinician.
 * Never trusts "ready" by itself: require the exact original model capability.
 * No DICOM, model weight bytes, source hashes, tokens or cloud API calls.
 */
import {NextRequest,NextResponse} from "next/server";
import {readyOriginalNoduleWorker} from "../../../lib/live-nodule-worker";
import {readyEffusionTask315} from "../../../lib/real-effusion-worker";
import {readyOriginalAbdominalWorker} from "../../../lib/real-abdominal-worker";
import {readyOriginalPeCtpWorker} from "../../../lib/pe-ctpa-direct-worker";
import {raidionicsOriginalReady} from "../../../lib/mediastinal-raidionics-worker";
import {readyOriginalBrainTask} from "../../../lib/brain-multisequence-original-worker";
import {validatedPublicIchCapabilities} from "../../../lib/public-ich-worker";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const HEAD={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const HOST=/^(?:127\.0\.0\.1|localhost):[0-9]{1,5}$/;
type Status="ready"|"not_configured"|"unreachable"|"original_model_unverified";
type Entry={id:string;status:Status;researchOnly:true;clinicalValidation:false};
type Worker={
 id:string;port:number;path:string;env:string;
 ready:(cap:unknown)=>boolean;
};
const capXrv=(v:unknown)=>{
 if(!v||typeof v!=="object"||Array.isArray(v))return false;
 const c=v as Record<string,unknown>;
 return c.schema==="opus-original-xrv-cxr-worker/v1"&&
  c.model==="densenet121-res224-nih"&&c.ready===true&&
  c.weightSha256==="31a5475c6b1383a7edbfcaf96af9ce302eb9969cfe28b6b8b5859afc6f274fdf"&&
  c.originalCheckpointVerified===true&&c.packageVersion==="1.5.7"&&
  c.patientMode===false&&c.mode==="isolated-linux-cpu-research"&&
  c.sourcePolicy==="approved-public-nonpatient-only"&&
  Array.isArray(c.modelLabels)&&
  c.modelLabels.join(",")==="Pneumothorax,Cardiomegaly,Effusion,Pneumonia,Edema,Mass";
};
const capWmh=(v:unknown)=>{
 if(!v||typeof v!=="object"||Array.isArray(v))return false;
 const c=v as Record<string,unknown>;
 return c.schema==="opus-direct-wmh-worker/v1"&&
   c.modelId==="jinghangli98/wmh_seg"&&
   c.originalModelReady===true&&c.patientMode===false&&
   c.dataPolicy==="approved-public-research-only"&&
   typeof c.checkpointSha256==="string"&&
   /^[a-f0-9]{64}$/.test(c.checkpointSha256);
};
export const WORKERS:readonly Worker[]=[
 {id:"chest_nodules",port:8768,path:"/v1/nodule/capabilities",
  env:"OPUS_NODULE_WORKER_TOKEN",ready:readyOriginalNoduleWorker},
 {id:"chest_effusion",port:8774,path:"/v1/effusion/capabilities",
  env:"OPUS_EFFUSION_WORKER_TOKEN",ready:readyEffusionTask315},
 {id:"chest_pe",port:8776,path:"/v1/pe/capabilities",
  env:"OPUS_PE_WORKER_TOKEN",ready:readyOriginalPeCtpWorker},
 {id:"chest_nodes",port:8777,path:"/v1/nodes/capabilities",
  env:"OPUS_NODES_WORKER_TOKEN",ready:raidionicsOriginalReady},
 {id:"abdomen",port:8775,path:"/v1/abdomen/capabilities",
  env:"OPUS_ABDOMEN_WORKER_TOKEN",ready:readyOriginalAbdominalWorker},
 {id:"brain_hemorrhage",port:8766,path:"/v1/ich/capabilities",
  env:"OPUS_ICH_WORKER_TOKEN",ready:validatedPublicIchCapabilities},
 {id:"brain_wmh",port:8772,path:"/v1/wmh/capabilities",
  env:"OPUS_WMH_WORKER_TOKEN",ready:capWmh},
 {id:"brain_stroke",port:8778,path:"/v1/brain/capabilities",
  env:"OPUS_BRAIN_WORKER_TOKEN",ready:c=>readyOriginalBrainTask(c,"stroke")},
 {id:"brain_glioma",port:8778,path:"/v1/brain/capabilities",
  env:"OPUS_BRAIN_WORKER_TOKEN",ready:c=>readyOriginalBrainTask(c,"glioma")},
 {id:"chest_xray_six",port:8779,path:"/v1/cxr/capabilities",
  env:"OPUS_XRV_WORKER_TOKEN",ready:capXrv},
] as const;
const loopOrigin=(val:string)=>{
 if(!/^http:\/\/(?:127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(val))
   return null;
 return val;
};
export function allowedHost(req:NextRequest){
 const host=req.headers.get("host")??"";
 const origin=req.headers.get("origin");
 return process.env.NODE_ENV==="development"&&
   HOST.test(host)&&["localhost","127.0.0.1"].includes(req.nextUrl.hostname)&&
   (origin===null||origin==="http://"+host)&&
   (req.headers.get("sec-fetch-site")??"same-origin")==="same-origin"&&
   !req.nextUrl.search;
}
async function boundedJson(response:Response):Promise<unknown>{
 const stream=response.body?.getReader();
 if(!stream)throw Error("no_capabilities");
 let n=0;const data:Uint8Array[]=[];
 try{
  for(;;){const {value,done}=await stream.read();if(done)break;
   n+=value.length;if(n>16384)throw Error("large_untrusted_capabilities");
   data.push(value);
  }
 }finally{await stream.cancel().catch(()=>{});stream.releaseLock();}
 const bytes=new Uint8Array(n);let offset=0;
 for(const part of data){bytes.set(part,offset);offset+=part.length;}
 return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
}
export async function probeOriginalFleet(
 secrets:Record<string,string|undefined>,origin:string,
 call:typeof fetch=fetch,
):Promise<Entry[]>{
 const safeOrigin=loopOrigin(origin);
 if(!safeOrigin)throw Error("Unsafe internal research origin");
 const memo=new Map<string,Promise<Status>>();
 async function one(w:Worker):Promise<Status>{
  const token=secrets[w.env]??"";
  if(!/^[a-zA-Z0-9_\-]{32,128}$/.test(token))return "not_configured";
  const key=w.port+"|"+w.path+"|"+w.env;
  if(!memo.has(key)){
   memo.set(key,(async()=>{
    try{
     const response=await call("http://127.0.0.1:"+w.port+w.path,{
       method:"GET",redirect:"error",cache:"no-store",
       signal:AbortSignal.timeout(2500),
       headers:{Origin:safeOrigin,Authorization:"Bearer "+token},
     });
     if(!response.ok)return "unreachable";
     const body=await boundedJson(response);
     return w.ready(body)?"ready":"original_model_unverified";
    }catch{return "unreachable";}
   })());
  }
  // Shared brain worker is fetched once but each distinct pretrained task
  // must be validated separately. A returned "ready" for one is NOT enough.
  if(w.id==="brain_stroke"||w.id==="brain_glioma"){
   // No shared memo here because readiness validation is task-specific.
   try{
    const response=await call("http://127.0.0.1:"+w.port+w.path,{
      method:"GET",redirect:"error",cache:"no-store",
      signal:AbortSignal.timeout(2500),
      headers:{Origin:safeOrigin,Authorization:"Bearer "+token},
    });
    if(!response.ok)return "unreachable";
    return w.ready(await boundedJson(response))?"ready":"original_model_unverified";
   }catch{return "unreachable";}
  }
  return await memo.get(key)!;
 }
 const entries=await Promise.all(WORKERS.map(async w=>({
  id:w.id,status:await one(w),researchOnly:true as const,clinicalValidation:false as const,
 })));
 return entries;
}
export async function GET(req:NextRequest){
 if(!allowedHost(req))return NextResponse.json({error:"Private research local-only"},
   {status:404,headers:HEAD});
 const secrets=Object.fromEntries(WORKERS.map(w=>[w.env,process.env[w.env]]));
 const origin=process.env.OPUS_LOCAL_WORKER_ORIGIN??"http://127.0.0.1:3000";
 if(!loopOrigin(origin))return NextResponse.json({error:"Invalid local origin"},
   {status:503,headers:HEAD});
 const entries=await probeOriginalFleet(secrets,origin);
 return NextResponse.json({schema:"opus-original-worker-fleet/v1",
  activeCapabilitiesProbed:true,
  entries,externalLLMStatus:"not_checked",patientMode:false,
  originalWeightsMayStillRequireInstallation:true,clinicalValidation:false},
  {headers:HEAD});
}
