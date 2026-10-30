/** Real original LungSCAPE lung-tumor inference on the same converted HU NIfTI as MONAI.
 * Only auto-ready original checkpoints; no mock results.
 */
import {originalNiftiSha256} from "./live-nodule-worker.ts";
import {pause} from "./local-worker.ts";
export type LungscapeReport={
 schema:"opus-lungscape-original-CT-result/v1";
 sourceNiftiSha256:string;realOriginalModelForwardCompleted:true;
 checkpointSha256:string;candidateCount:number;
 nativeCandidates:Array<{candidateVolumeMl:number}>;
 researchOnly:true;clinicalValidation:false;negativeDiagnosisPermitted:false;
};
const JOB=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
async function call(path:string,init:RequestInit={}){
 const res=await fetch("/api/local-lungscape"+path,{...init,credentials:"same-origin",cache:"no-store",redirect:"error"});
 if(!res.ok)throw Error("LungSCAPE worker HTTP "+res.status);
 return res.json() as Promise<Record<string,unknown>>;
}
export async function checkAutomaticLungscapeReady(signal?:AbortSignal){
 try{
  const c=await call("/v1/lungscape/capabilities",{signal});
  return c.schema==="opus-lungscape-original-worker/v1"&&
    c.modelId==="LungSCAPE Dataset191"&&
    c.originalWeightsVerified===true&&c.imageUpload===true&&
    c.researchOnly===true&&c.patientMode===false&&
    typeof c.checkpointSha256==="string"&&/^[a-f0-9]{64}$/.test(c.checkpointSha256);
 }catch{return false;}
}
export async function executeOriginalLungscape(source:File,signal:AbortSignal,onProgress:(message:string)=>void):Promise<LungscapeReport>{
 const cap=await call("/v1/lungscape/capabilities",{signal});
 if(cap.originalWeightsVerified!==true||cap.patientMode!==false||cap.imageUpload!==true)
  throw Error("Оригинальный LungSCAPE worker не готов");
 const sha=await originalNiftiSha256(source,signal);
 onProgress("LungSCAPE: передаём исходный HU-объём на приватный исполнитель...");
 const start=await call("/v1/lungscape/upload",{method:"POST",signal,body:source,headers:{
  "Content-Type":"application/octet-stream","X-Opus-Source-Sha256":sha,
  "X-Opus-Public-Research-Authorization":"approved-nonpatient-source"}});
 if(start.schema!=="opus-lungscape-job/v1"||typeof start.jobId!=="string"||!JOB.test(start.jobId))
  throw Error("LungSCAPE не подтвердил запуск");
 const jobId=start.jobId;
 try{
  for(;;){
   if(signal.aborted)throw Error("LungSCAPE отменён");
   const status=await call("/v1/lungscape/jobs/"+jobId,{signal});
   if(status.state==="failed")throw Error("LungSCAPE модель не завершила инференс: "+status.reason);
   if(status.state==="succeeded")break;
   if(status.state!=="running")throw Error("Недостоверное состояние LungSCAPE");
   onProgress("Оригинальная LungSCAPE анализирует КТ на CPU...");
   await pause(signal);
  }
  const raw=await call("/v1/lungscape/jobs/"+jobId+"/report",{signal});
  if(raw.schema!=="opus-lungscape-original-CT-result/v1"||
    raw.sourceNiftiSha256!==sha||raw.realOriginalModelForwardCompleted!==true||
    raw.researchOnly!==true||raw.clinicalValidation!==false||
    raw.negativeDiagnosisPermitted!==false||!Array.isArray(raw.nativeCandidates)||
    !Number.isSafeInteger(raw.candidateCount)||Number(raw.candidateCount)!==raw.nativeCandidates.length||
    !/^[a-f0-9]{64}$/.test(String(raw.checkpointSha256))||
    raw.nativeCandidates.some((x:unknown)=>!x||typeof x!=="object"||
      !Number.isFinite((x as {candidateVolumeMl?:number}).candidateVolumeMl)))
    throw Error("LungSCAPE не вернул подтверждённую модельную маску");
  return raw as LungscapeReport;
 }finally{
  await call("/v1/lungscape/jobs/"+jobId,{method:"DELETE",signal:AbortSignal.timeout(5000)}).catch(()=>{});
 }
}
