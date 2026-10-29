/** Original task315 live executor on the exact same DICOM-derived HU NIfTI as MONAI.
 * Research-only; no patient clouds, no mocked inference and no zero-mask negatives.
 */
import {call,type WorkerSession} from "./local-worker.ts";
import {originalNiftiSha256} from "./live-nodule-worker.ts";
import {readNoduleNiftiHeader} from "./live-nodule-report.ts";
import {parseImportedTask315,type ImportedTask315} from "./chest-effusion-execution.ts";

export type OriginalEffusionRun={sourceSha256:string;report:ImportedTask315};
const hash=(x:unknown)=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x);
export function readyEffusionTask315(cap:unknown):boolean{
 if(!cap||typeof cap!=="object"||Array.isArray(cap))return false;
 const c=cap as Record<string,unknown>;
 return c.schema==="opus-original-task315-loopback/v1"&&
  c.task==="pleural_pericard_effusion"&&c.model==="TotalSegmentator"&&
  c.packageVersion==="2.18.0"&&hash(c.checkpointFileSha256)&&
  c.checkpointFileVerified===true&&c.originalPretrainedTaskAvailable===true&&
  c.checkpointActiveVendorLoaderVerified===false&&
  c.ready===true&&c.mode==="local-linux-cpu-research"&&
  c.patientMode===false&&c.dataPolicy==="public-nonpatient-research-only"&&
  c.sourceFormat==="original-HU-NIfTI";
}
async function readBoundedReport(response:Response):Promise<string>{
 const reader=response.body?.getReader();
 if(!reader)throw Error("Task315 вернул пустой ответ.");
 let count=0;const chunks:Uint8Array[]=[];
 try{
  while(true){const part=await reader.read();if(part.done)break;
   count+=part.value.byteLength;
   if(count>512*1024)throw Error("Слишком большой результат task315.");
   chunks.push(part.value);
  }
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const all=new Uint8Array(count);let offset=0;
 for(const x of chunks){all.set(x,offset);offset+=x.length;}
 return new TextDecoder("utf-8",{fatal:true}).decode(all);
}
export async function runOriginalEffusionTask315(
 session:WorkerSession,source:File,signal:AbortSignal,
 progress:(message:string)=>void=()=>{},
):Promise<OriginalEffusionRun>{
 const native=await readNoduleNiftiHeader(source);
 progress("Проверяем наличие настоящей модели выпотов task315 на Linux...");
 const cap=await (await call(session,"/v1/effusion/capabilities",{signal})).json() as unknown;
 if(!readyEffusionTask315(cap))
  throw Error("Настоящий TotalSegmentator task315 не установлен или worker не располагает достаточной RAM.");
 const sha=await originalNiftiSha256(source,signal);
 progress("Task315: передаём именно исходную HU-КТ на приватный Linux-worker...");
 const response=await call(session,"/v1/effusion/analyze",{
  method:"POST",signal,headers:{
   "Content-Type":"application/octet-stream","X-Opus-Source-Sha256":sha,
  },body:source,
 });
 const raw=await readBoundedReport(response);
 const obj=JSON.parse(raw) as Record<string,unknown>;
 if(obj.sourceNiftiSha256!==sha||
   obj.observedInstalledWeightFileSha256!==(cap as {checkpointFileSha256:string}).checkpointFileSha256)
  throw Error("Task315 вернул результат другой КТ или checkpoint.");
 const report=parseImportedTask315(raw);
 const ev=report.evidence;
 if(report.execution!=="reported-pretrained-execution"||
   ev.originalChestCtSha256!==sha||
   ev.originalCTDimensionsXYZ.some((n,i)=>n!==native.dimensions[i]))
  throw Error("Настоящий task315 не подтвердил исходную КТ, сетку и завершённый инференс.");
 progress("Task315 завершил исходную модель: плевральный и перикардиальный классы готовы к оценке.");
 return {sourceSha256:sha,report};
}
