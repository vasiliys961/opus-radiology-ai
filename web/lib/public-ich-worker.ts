/** Genuine original ianpan public-reference worker; NEVER uploads DICOM pixels.
 * The worker already possesses an authorized byte-identical public source study.
 * This client sends only local SHA-256 digests then waits for real inference.
 */
import type {DicomSeries} from "./dicom-series.ts";
import type {EvidenceJson} from "./evidence-json.ts";
import {validateEvidenceJson} from "./evidence-json.ts";
import {call,smallJson,pause,type WorkerSession} from "./local-worker.ts";

const ARTIFACTS:Readonly<Record<string,string>>=Object.freeze({
  "inference.py":"9792e50ad1d863e80a549d391ee53c5031d490abb75acba42d471b02a83fbafb",
  "classifier/model.safetensors":"525b5fc1731dab82fcdb1eb878570f4cf4b0fed483e307bc65e312a4d91c1489",
  "sequence/model.safetensors":"9421066cb5c6882087730b367b578f0fb8b6935391c2611bbc4bc2241c8ee487",
  "segmentation/fold0.safetensors":"d299e204c640bdc124829b5cc2e6d5e08973b8c17698a5bffdd565baa46ec786",
  "segmentation/fold1.safetensors":"1dbad6ad4dfd21e963e01a71f4486558287fe32e3acdcf47ad601ad8a3132c3e",
  "segmentation/fold2.safetensors":"e814b8e398b7c879c22663187d7c58ff88ee0fcaf11ea4e76859c35488b4d052",
  "segmentation/fold3.safetensors":"971bfe1163797c3587c045ef013475e6cd5973aa7116f8b01f8305725777910d",
  "segmentation/fold4.safetensors":"f1913ce8d7f9cacbb948615a7690cfad568fe0f713c1f11de9ac3199ff060e8f",
});
export const IANPAN_MODEL_ID="ianpan/ct-head-hemorrhage-detection";
export const IANPAN_MODEL_REVISION="e6d89c2";

/** Compare every real asset digest, not just a caller's boolean "ready". */
export function validatedPublicIchCapabilities(value:unknown):boolean {
  if(!value||typeof value!=="object")return false;
  const v=value as Record<string,unknown>, hashes=v.modelAssetsSha256;
  if(v.schema!=="opus-public-ich-worker/v1"||v.mode!=="local"||
     v.modelId!==IANPAN_MODEL_ID||v.modelRevision!==IANPAN_MODEL_REVISION||
     v.modelReady!==true||v.resourceReady!==true||
     v.dataPolicy!=="public-reference-only"||v.patientMode!==false||
     v.inputTransfer!=="hashes-only-preapproved-public-study"||
     v.unvalidatedResearch!==true||v.maxSlices!==64||
     v.minFreeRamBytes!==10*1024**3||
     !hashes||typeof hashes!=="object"||Array.isArray(hashes))return false;
  const obj=hashes as Record<string,unknown>, keys=Object.keys(ARTIFACTS);
  return Object.keys(obj).length===keys.length &&
    keys.every(key=>obj[key]===ARTIFACTS[key]);
}

/** Fixed same-origin original ICH bridge, no DICOM pixels or browser token. */
export async function ichRequest(session:WorkerSession|null,path:string,init:RequestInit={}):Promise<Response>{
 if(session)return call(session,path,init);
 if(!/^\/v1\/ich\/(capabilities|jobs(?:\/[a-f0-9-]{36}(?:\/evidence)?)?)$/.test(path))
  throw Error("Недопустимый путь оригинального ICH worker.");
 const response=await fetch("/api/local-ich"+path,{
  ...init,credentials:"same-origin",redirect:"error",cache:"no-store",
 });
 if(!response.ok)throw Error("Оригинальный ICH worker недоступен (HTTP "+response.status+").");
 return response;
}
export async function checkAutomaticIchReady(signal?:AbortSignal):Promise<boolean>{
 try{
  const response=await ichRequest(null,"/v1/ich/capabilities",{signal});
  return validatedPublicIchCapabilities(await smallJson(response));
 }catch{return false;}
}

export async function checkPublicIchWorker(session:WorkerSession|null,signal?:AbortSignal):Promise<void>{
  const cap=await smallJson(await ichRequest(session,"/v1/ich/capabilities",{signal}));
  if(!validatedPublicIchCapabilities(cap))
    throw Error("Отдельный Linux ICH-worker не готов: требуются оригинальные проверенные веса, 10 ГиБ RAM и разрешённая публичная КТ.");
}

const HEX=/^[0-9a-f]{64}$/;
export async function originalDicomDigests(series:DicomSeries,files:ReadonlyMap<string,File|Blob>,signal?:AbortSignal):Promise<string[]>{
  if(series.modality!=="CT"||!series.volumeReady||!series.spatiallySorted||
     series.members.length<8||series.members.length>64||
     series.members.some(m=>m.metadata.bodyRegion!=="HEAD"||
       m.metadata.imageRole==="LOCALIZER"||m.metadata.imageRole==="DERIVED"||
       !m.metadata.sopInstanceUid||m.metadata.numberOfFrames!==null&&m.metadata.numberOfFrames!==1))
    throw Error("ICH: требуется одна исходная осевая серия КТ головы (8–64 среза).");
  const hashes:string[]=[];let total=0;
  for(const member of series.members){
    if(signal?.aborted)throw Error("ICH отменён до хеширования DICOM.");
    const f=files.get(member.id);
    if(!f||f.size<128||f.size>16*1024**2)throw Error("Неподдерживаемый или отсутствующий исходный файл КТ.");
    total+=f.size;
    if(total>128*1024**2)throw Error("Серия превышает предел исследовательского ICH worker.");
    // Hash one DICOM at a time; no pixel data or original file name leaves browser.
    const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",await f.arrayBuffer()));
    if(signal?.aborted)throw Error("ICH отменён во время проверки исходной КТ.");
    const hex=Array.from(digest,byte=>byte.toString(16).padStart(2,"0")).join("");
    if(!HEX.test(hex))throw Error("Не удалось вычислить SHA-256 исходного DICOM.");
    hashes.push(hex);
  }
  return hashes.sort();
}

async function boundedEvidence(response:Response):Promise<unknown>{
  const reader=response.body?.getReader();
  if(!reader)throw Error("ICH worker вернул пустой ответ.");
  const chunks:Uint8Array[]=[];let size=0;
  try{
    for(;;){
      const item=await reader.read();if(item.done)break;
      size+=item.value.byteLength;
      if(size>1024*1024)throw Error("Слишком большой ответ модели ICH.");
      chunks.push(item.value);
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const data=new Uint8Array(size);let off=0;
  for(const chunk of chunks){data.set(chunk,off);off+=chunk.byteLength;}
  return JSON.parse(new TextDecoder().decode(data));
}

const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export async function runPublicIchWorker(
  session:WorkerSession|null,series:DicomSeries,files:ReadonlyMap<string,File|Blob>,
  signal:AbortSignal,onStatus?:(value:string)=>void,
):Promise<EvidenceJson>{
  await checkPublicIchWorker(session,signal);
  onStatus?.("Сверяем SHA-256 публичной КТ без передачи DICOM...");
  const digests=await originalDicomDigests(series,files,signal);
  let jobId:string|null=null;
  try{
    const start=await smallJson(await ichRequest(session,"/v1/ich/jobs",{
      method:"POST",signal,headers:{"Content-Type":"application/json",
        ...(session?{}:{"X-Opus-Public-Research-Authorization":"approved-nonpatient-source"})},
      body:JSON.stringify({schema:"opus-public-ich-job/v1",dataPolicy:"public-reference-only",
        originalDicomSha256:digests}),
    }));
    if(start.schema!=="opus-public-ich-job-status/v1"||
       typeof start.jobId!=="string"||!ID.test(start.jobId)||start.state!=="running")
      throw Error("ICH worker вернул неверный идентификатор задания.");
    jobId=start.jobId;
    for(;;){
      if(signal.aborted)throw Error("Задание ICH отменено.");
      const progress=await smallJson(await ichRequest(session,`/v1/ich/jobs/${jobId}`,{signal}));
      if(progress.schema!=="opus-public-ich-job-status/v1"||progress.jobId!==jobId)
        throw Error("Неверный ответ ICH worker.");
      if(progress.state==="failed")throw Error("Настоящий ICH-инференс не выполнен: "+String(progress.reason??"worker_failed"));
      if(progress.state==="succeeded")break;
      if(progress.state!=="running")throw Error("Неизвестное состояние ICH worker.");
      onStatus?.("Настоящий ICH-инференс выполняется на изолированном Linux worker...");
      await pause(signal);
    }
    const evidence=await boundedEvidence(await ichRequest(session,`/v1/ich/jobs/${jobId}/evidence`,{signal}));
    if(!validateEvidenceJson(evidence)||evidence.modality!=="CT"||
       evidence.coverage==="assessed"||
       evidence.findings.some(f=>f.model.id!==IANPAN_MODEL_ID||
         f.model.version!==IANPAN_MODEL_REVISION||f.model.provider!=="local"))
      throw Error("ICH Evidence не соответствует оригинальной модели или исходной КТ.");
    onStatus?.("ICH завершён: исследовательские находки привязаны к исходным срезам.");
    return evidence;
  }finally{
    if(jobId)await ichRequest(session,`/v1/ich/jobs/${jobId}`,{
      method:"DELETE",signal:AbortSignal.timeout(10000),
    }).catch(()=>{});
  }
}
