/** Real original CLN lung-tumor inference on the same converted HU NIfTI as MONAI.
 * Only auto-ready original checkpoints; no mock results.
 */
import {originalNiftiSha256} from "./live-nodule-worker.ts";
import {pause} from "./local-worker.ts";
/** SHA-256 of the original publisher checkpoint measured on verified positive MSD CT. */
export const CLN_ORIGINAL_CHECKPOINT_SHA256="8c08ec796fa2b786fe99ddfad4fe6314e98fdd8820c59527be3c4105f7955d87";
export type ClnReport={
 schema:"opus-original-cln-upload-result/v1";
 sourceNiftiSha256:string;realOriginalModelForwardCompleted:true;
 checkpointSha256:string;candidateCount:number;
 nativeCandidates:Array<{candidateVolumeMl:number;modelComponentId?:number;sourceVoxelCentroidIJK?:number[]}>;
 researchOnly:true;clinicalValidation:false;negativeDiagnosisPermitted:false;
};
const JOB=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
async function call(path:string,init:RequestInit={}){
 const res=await fetch("/api/local-cln"+path,{...init,credentials:"same-origin",cache:"no-store",redirect:"error"});
 if(!res.ok)throw Error("CLN worker HTTP "+res.status);
 return res.json() as Promise<Record<string,unknown>>;
}
export async function checkAutomaticClnReady(signal?:AbortSignal){
 try{
  const c=await call("/v1/cln/capabilities",{signal});
  return c.schema==="opus-original-cln-upload-worker/v1"&&
    c.modelId==="Lab-Rasool/CLN-Segmenter-MSD-fold0"&&
    c.originalWeightsVerified===true&&c.imageUpload===true&&
    c.researchOnly===true&&c.patientMode===false&&
    c.checkpointSha256===CLN_ORIGINAL_CHECKPOINT_SHA256;
 }catch{return false;}
}
export async function executeOriginalCln(source:File,signal:AbortSignal,onProgress:(message:string)=>void):Promise<ClnReport>{
 const cap=await call("/v1/cln/capabilities",{signal});
 if(cap.schema!=="opus-original-cln-upload-worker/v1"||
    cap.modelId!=="Lab-Rasool/CLN-Segmenter-MSD-fold0"||
    cap.checkpointSha256!==CLN_ORIGINAL_CHECKPOINT_SHA256||
    cap.originalWeightsVerified!==true||cap.patientMode!==false||
    cap.researchOnly!==true||cap.imageUpload!==true)
  throw Error("Оригинальный CLN worker не готов");
 const sha=await originalNiftiSha256(source,signal);
 onProgress("CLN: передаём исходный HU-объём на приватный исполнитель...");
 const start=await call("/v1/cln/upload",{method:"POST",signal,body:source,headers:{
  "Content-Type":"application/octet-stream","X-Opus-Source-Sha256":sha,
  "X-Opus-Public-Research-Authorization":"approved-nonpatient-source"}});
 if(start.schema!=="opus-cln-job/v1"||typeof start.jobId!=="string"||!JOB.test(start.jobId))
  throw Error("CLN не подтвердил запуск");
 const jobId=start.jobId;
 try{
  for(;;){
   if(signal.aborted)throw Error("CLN отменён");
   const status=await call("/v1/cln/jobs/"+jobId,{signal});
   if(status.state==="failed")throw Error("CLN модель не завершила инференс: "+status.reason);
   if(status.state==="succeeded")break;
   if(status.state!=="running")throw Error("Недостоверное состояние CLN");
   onProgress("Оригинальная CLN анализирует КТ на CPU...");
   await pause(signal);
  }
  const raw=await call("/v1/cln/jobs/"+jobId+"/report",{signal});
  if(raw.schema!=="opus-original-cln-upload-result/v1"||
    raw.sourceNiftiSha256!==sha||raw.realOriginalModelForwardCompleted!==true||
    raw.researchOnly!==true||raw.clinicalValidation!==false||
    raw.negativeDiagnosisPermitted!==false||!Array.isArray(raw.nativeCandidates)||
    !Number.isSafeInteger(raw.candidateCount)||Number(raw.candidateCount)!==raw.nativeCandidates.length||
    raw.checkpointSha256!==CLN_ORIGINAL_CHECKPOINT_SHA256||
    raw.nativeCandidates.some((x:unknown)=>!x||typeof x!=="object"||
      !Number.isFinite((x as {candidateVolumeMl?:number}).candidateVolumeMl)||
      Number((x as {candidateVolumeMl?:number}).candidateVolumeMl)<0))
    throw Error("CLN не вернул подтверждённую модельную маску");
  return raw as ClnReport;
 }finally{
  await call("/v1/cln/jobs/"+jobId,{method:"DELETE",signal:AbortSignal.timeout(5000)}).catch(()=>{});
 }
}
