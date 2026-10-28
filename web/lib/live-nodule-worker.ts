/** Trigger an actually installed original MONAI 0.6.9 RetinaNet model.
 * The approved public source CT is already on an isolated Linux worker;
 * browser uploads exactly 64 hex hash characters, NEVER CT pixels.
 */
import {sha256} from "@noble/hashes/sha2.js";
import {call,smallJson,pause,type WorkerSession} from "./local-worker.ts";
import {parseBoundNoduleReport,readNoduleNiftiHeader,
  type BoundNoduleReport,type NoduleNativeSource,MAX_MONAI_CT_BYTES}
  from "./live-nodule-report.ts";

const MODEL="monai-lung-nodule-ct-retinanet";
const CHECKPOINT="b5e79231466adae93a6fe8e8594029e9add142914e223b879aa0343bb2402d01";
const REVISION="7226a40a4c3713f7d5469559b7f2fc296fd54825";
const JOBID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function readyOriginalNoduleWorker(cap:unknown):boolean {
 if(!cap||typeof cap!=="object"||Array.isArray(cap))return false;
 const c=cap as Record<string,unknown>;
 return c.schema==="opus-monai-live-worker/v1"&&c.modelId===MODEL&&
  c.modelVersion==="0.6.9"&&c.checkpointSha256===CHECKPOINT&&
  c.modelRevision===REVISION&&c.originalWeightsVerified===true&&
  c.mode==="local"&&c.sourceFormat==="original-nifti-uncompressed"&&
  c.dataPolicy==="approved-public-reference-only"&&
  c.patientMode===false&&typeof c.imageUpload==="boolean"&&c.ready===true&&
  c.unvalidatedResearch===true;
}

export async function originalNiftiSha256(source:Blob,signal?:AbortSignal):Promise<string>{
 if(source.size<352||source.size>MAX_MONAI_CT_BYTES)
   throw Error("Требуется исходная КТ NIfTI допустимого размера.");
 const hash=sha256.create(),reader=source.stream().getReader();
 let bytes=0;
 try{
  for(;;){
   if(signal?.aborted)throw Error("Хеширование отменено.");
   const chunk=await reader.read();if(chunk.done)break;
   bytes+=chunk.value.byteLength;
   if(bytes>MAX_MONAI_CT_BYTES)throw Error("Источник КТ превышает допустимый объём.");
   hash.update(chunk.value);
  }
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 if(signal?.aborted||bytes!==source.size)throw Error("Исходная КТ изменилась при проверке.");
 return Array.from(hash.digest(),b=>b.toString(16).padStart(2,"0")).join("");
}

async function boundedReport(response:Response):Promise<string>{
 const reader=response.body?.getReader();
 if(!reader)throw Error("Настоящий MONAI worker вернул пустой ответ.");
 const chunks:Uint8Array[]=[];let size=0;
 try{
  for(;;){
   const x=await reader.read();if(x.done)break;
   size+=x.value.byteLength;
   if(size>1024*1024)throw Error("Слишком большой ответ MONAI.");
   chunks.push(x.value);
  }
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const data=new Uint8Array(size);let i=0;
 for(const part of chunks){data.set(part,i);i+=part.length;}
 return new TextDecoder().decode(data);
}

export async function executeRealNodule(
 session:WorkerSession,source:File,signal:AbortSignal,
 onProgress?:(text:string)=>void,
):Promise<{source:NoduleNativeSource;report:BoundNoduleReport}> {
 if(signal.aborted)throw Error("Задание отменено.");
 const native=await readNoduleNiftiHeader(source);
 onProgress?.("Проверяем исходную КТ и подлинные MONAI-веса...");
 const cap=await smallJson(await call(session,"/v1/nodule/capabilities",{signal}));
 if(!readyOriginalNoduleWorker(cap))
   throw Error("MONAI RetinaNet ещё не установлен/не готов на выделенном Linux-worker.");
 const fileHash=await originalNiftiSha256(source,signal);
 const uploadEnabled=cap.imageUpload===true;
 let jobId:string|null=null;
 try{
  const answer=await smallJson(await call(session,uploadEnabled?"/v1/nodule/upload":"/v1/nodule/jobs",{
   method:"POST",signal,headers:uploadEnabled?{
    "Content-Type":"application/octet-stream","X-Opus-Source-Sha256":fileHash
   }:{"Content-Type":"application/json"},
   body:uploadEnabled?source:JSON.stringify({schema:"opus-monai-nodule-request/v1",
    sourceSha256:fileHash,dataPolicy:"approved-public-reference-only"}),
  }));
  if(answer.schema!=="opus-monai-job/v1"||typeof answer.jobId!=="string"||
     !JOBID.test(answer.jobId)||answer.state!=="running")
    throw Error("MONAI worker не подтвердил запуск настоящей модели.");
  jobId=answer.jobId;
  for(;;){
   if(signal.aborted)throw Error("Анализ MONAI отменён.");
   const state=await smallJson(await call(session,`/v1/nodule/jobs/${jobId}`,{signal}));
   if(state.schema!=="opus-monai-job/v1"||state.jobId!==jobId)
    throw Error("Несовместимый ответ MONAI-worker.");
   if(state.state==="failed")throw Error("MONAI не завершил настоящий инференс: "+String(state.reason??"ошибка"));
   if(state.state==="succeeded")break;
   if(state.state!=="running")throw Error("Недостоверный статус MONAI-worker.");
   onProgress?.("Настоящая MONAI RetinaNet обрабатывает исходную КТ на Linux CPU...");
   await pause(signal);
  }
  const raw=await boundedReport(await call(session,`/v1/nodule/jobs/${jobId}/report`,{signal}));
  const verified=parseBoundNoduleReport(raw,native);
  if(verified.source.sha256!==fileHash)
    throw Error("MONAI-срезы не принадлежат открытому исходному исследованию.");
  onProgress?.("Настоящий инференс завершён; показываем кандидатов на исходной КТ.");
  return {source:native,report:verified};
 }finally{
  if(jobId)await call(session,`/v1/nodule/jobs/${jobId}`,{
   method:"DELETE",signal:AbortSignal.timeout(10000),
  }).catch(()=>{});
 }
}
