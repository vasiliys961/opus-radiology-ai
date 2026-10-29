/** Pure original pathology worker readiness; never handles DICOM, pixels or patient data. */
import {readyOriginalNoduleWorker} from "./live-nodule-worker.ts";
import {readyEffusionTask315} from "./real-effusion-worker.ts";
import {readyOriginalAbdominalWorker} from "./real-abdominal-worker.ts";
import {readyOriginalPeCtpWorker} from "./pe-ctpa-direct-worker.ts";
import {raidionicsOriginalReady} from "./mediastinal-raidionics-worker.ts";
import {readyOriginalBrainTask} from "./brain-multisequence-original-worker.ts";
import {validatedPublicIchCapabilities} from "./public-ich-worker.ts";


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
 const allowedOrigin:string=safeOrigin;
 const memo=new Map<string,Promise<{status:Status;body?:unknown}>>();
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
       headers:{Origin:allowedOrigin,Authorization:"Bearer "+token},
     });
     if(!response.ok)return {status:"unreachable" as Status};
     return {status:"ready" as Status,body:await boundedJson(response)};
    }catch{return {status:"unreachable" as Status};}
   })());
  }
  const probe=await memo.get(key)!;
  if(probe.status!=="ready")return probe.status;
  // Brain stroke and glioma MUST validate separate real checkpoint digests,
  // but reuse the SAME actual worker response instead of two network calls.
  return w.ready(probe.body)?"ready":"original_model_unverified";
 }

 const entries=await Promise.all(WORKERS.map(async w=>({
  id:w.id,status:await one(w),researchOnly:true as const,clinicalValidation:false as const,
 })));
 return entries;
}
