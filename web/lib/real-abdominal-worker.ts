/** Two DISTICT original TotalSegmentator pathology tasks, one DICOM-native CT.
 * Browser verifies task model, source SHA, geometry, label identity and actual
 * reported pretrained forward. No patient cloud or synthetic runtime.
 */
import {call,type WorkerSession} from "./local-worker.ts";
import {originalNiftiSha256} from "./live-nodule-worker.ts";
import {readNoduleNiftiHeader} from "./live-nodule-report.ts";

export type AbdominalTask="kidney_cysts"|"liver_lesions";
export type NativeAbdominalProposal={
 labelId:number;pathologyClass:string;modelCandidateVoxels:number;
 modelCandidateVolumeMl:number;nativeSliceIndicesK:number[];
 nativeBoundsMinXYZ:[number,number,number]|null;
 nativeBoundsMaxXYZ:[number,number,number]|null;
 worldRasBoundsMm:null|{rasMinMm:[number,number,number];rasMaxMm:[number,number,number]};
 physicianVerified:false;negativeIfEmptyPermitted:false;
};
export type AbdominalBoundReport={
 schema:"opus-real-abdominal-ct-pathology-proposals/v1";
 task:AbdominalTask;model:"TotalSegmentator";version:"2.18.0";
 sourceNiftiSha256:string;outputNativeMaskSha256:string;
 observedCheckpointFileSha256:string;
 checkpointActuallyUsedByVendorProven:false;
 sourceDimensionsXYZ:[number,number,number];
 proposals:NativeAbdominalProposal[];clinicallyValidated:false;
 negativeDiagnosisPermitted:false;
 execution:{actualPretrainedInferenceClaimed:true;mode:"isolated-original-model"};
 limitations:string[];
};
export type AbdominalTaskState={status:"completed";report:AbdominalBoundReport}|
 {status:"unavailable"|"failed";reason:string};
export type AbdominalStudyResults={
 sourceNiftiSha256:string;
 tasks:Record<AbdominalTask,AbdominalTaskState>;
};
const sha=(s:unknown):s is string=>typeof s==="string"&&/^[a-f0-9]{64}$/.test(s);
const positiveInt=(s:unknown):s is number=>Number.isSafeInteger(s)&&Number(s)>=0;
const triple=(x:unknown):x is number[]=>Array.isArray(x)&&x.length===3&&
 x.every(v=>typeof v==="number"&&Number.isFinite(v));
const allowed:Record<AbdominalTask,Record<number,string>>={
 kidney_cysts:{1:"kidney_cyst_left",2:"kidney_cyst_right"},
 liver_lesions:{1:"liver_lesions"},
};
function record(x:unknown):Record<string,unknown>{
 if(!x||typeof x!=="object"||Array.isArray(x))throw Error("Неверный объект результата модели.");
 return x as Record<string,unknown>;
}
export function readyOriginalAbdominalWorker(cap:unknown):boolean{
 if(!cap||typeof cap!=="object"||Array.isArray(cap))return false;
 const x=cap as Record<string,unknown>;
 if(x.schema!=="opus-original-abdominal-pathology-worker/v1"||
   x.model!=="TotalSegmentator"||x.packageVersion!=="2.18.0"||
   x.ready!==true||x.mode!=="local-linux-cpu-research"||
   x.sourceFormat!=="original-HU-NIfTI"||
   x.patientMode!==false||x.dataPolicy!=="public-nonpatient-research-only"||
   x.vendorCheckpointUseCryptographicallyProven!==false)return false;
 try{
  const tasks=record(x.installedTasks);
  return (Object.keys(tasks).length>0&&Object.keys(tasks).every(k=>
   (k==="kidney_cysts"||k==="liver_lesions")&&
   sha(record(tasks[k]).checkpointSha256)&&record(tasks[k]).observedFileVerified===true));
 }catch{return false;}
}
function validateReport(report:unknown,task:AbdominalTask,expectedSha:string,
 expectedCheckpoint:string,dims:number[]):AbdominalBoundReport{
 const x=record(report),e=record(x.execution),p=x.proposals;
 if(x.schema!=="opus-real-abdominal-ct-pathology-proposals/v1"||
    x.task!==task||x.model!=="TotalSegmentator"||x.version!=="2.18.0"||
    x.sourceNiftiSha256!==expectedSha||!sha(x.outputNativeMaskSha256)||
    x.observedCheckpointFileSha256!==expectedCheckpoint||
    x.checkpointActuallyUsedByVendorProven!==false||
    !triple(x.sourceDimensionsXYZ)||!(x.sourceDimensionsXYZ as number[]).every((d,i)=>d===dims[i])||
    x.clinicallyValidated!==false||x.negativeDiagnosisPermitted!==false||
    e.actualPretrainedInferenceClaimed!==true||e.mode!=="isolated-original-model"||
    !Array.isArray(x.limitations)||x.limitations.length<2||
    !Array.isArray(p)||p.length!==Object.keys(allowed[task]).length)
   throw Error("Не подтверждены модель, источник или завершённый реальный инференс "+task);
 let observed=new Set<number>();
 for(const raw of p as unknown[]){
  const candidate=record(raw),id=candidate.labelId;
  if(!positiveInt(id)||observed.has(id)||
     candidate.pathologyClass!==allowed[task][id]||
     !positiveInt(candidate.modelCandidateVoxels)||
     typeof candidate.modelCandidateVolumeMl!=="number"||
     !Number.isFinite(candidate.modelCandidateVolumeMl)||
     candidate.modelCandidateVolumeMl<0||
     !Array.isArray(candidate.nativeSliceIndicesK)||
     candidate.nativeSliceIndicesK.length>dims[2]||
     !candidate.nativeSliceIndicesK.every((n:unknown)=>positiveInt(n)&&Number(n)<dims[2])||
     !candidate.nativeSliceIndicesK.every((n:number,i:number,a:number[])=>i===0||n>a[i-1])||
     candidate.physicianVerified!==false||candidate.negativeIfEmptyPermitted!==false)
   throw Error("Недостоверная метка поражения в "+task);
  const count=candidate.modelCandidateVoxels as number;
  const boxMin=candidate.nativeBoundsMinXYZ,boxMax=candidate.nativeBoundsMaxXYZ;
  if(count===0){
   if(boxMin!==null||boxMax!==null||candidate.worldRasBoundsMm!==null||
      candidate.nativeSliceIndicesK.length!==0||candidate.modelCandidateVolumeMl!==0)
    throw Error("Пустая маска не может создавать находку.");
  }else{
   if(!triple(boxMin)||!triple(boxMax)||
      !boxMin.every((n,i)=>positiveInt(n)&&n<=boxMax[i])||
      !boxMax.every((n,i)=>positiveInt(n)&&n<dims[i])||
      candidate.nativeSliceIndicesK.length===0||
      candidate.nativeSliceIndicesK[0]!==boxMin[2]||
      candidate.nativeSliceIndicesK.at(-1)!==boxMax[2])
    throw Error("Исходные координаты кандидата не подтверждены.");
   const world=record(candidate.worldRasBoundsMm);
   if(!triple(world.rasMinMm)||!triple(world.rasMaxMm)||
      !world.rasMinMm.every((v,i)=>v<=world.rasMaxMm[i]))
    throw Error("Физическая сетка кандидата некорректна.");
  }
  observed.add(id as number);
 }
 if(observed.size!==Object.keys(allowed[task]).length)
   throw Error("Неполные классы оригинальной модели.");
 return x as unknown as AbdominalBoundReport;
}
async function textBounded(response:Response):Promise<string>{
 const reader=response.body?.getReader();if(!reader)throw Error("Пустой ответ модели.");
 let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){const p=await reader.read();if(p.done)break;
   size+=p.value.byteLength;if(size>1024*1024)throw Error("Слишком большой JSON модели.");
   chunks.push(p.value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const buffer=new Uint8Array(size);let i=0;
 for(const part of chunks){buffer.set(part,i);i+=part.length;}
 return new TextDecoder("utf-8",{fatal:true}).decode(buffer);
}
export async function runOriginalAbdominalModels(
 session:WorkerSession,source:File,signal:AbortSignal,
 progress:(message:string)=>void=()=>{},
):Promise<AbdominalStudyResults>{
 const native=await readNoduleNiftiHeader(source);
 progress("Проверяем оригинальные модели для кист почек и очагов печени...");
 const cap=await (await call(session,"/v1/abdomen/capabilities",{signal})).json() as unknown;
 if(!readyOriginalAbdominalWorker(cap))
  throw Error("Настоящие модели брюшной полости не установлены или недоступна RAM.");
 const known=record(record(cap).installedTasks);
 const sourceSha=await originalNiftiSha256(source,signal);
 progress("Запускаем две разные патологические модели последовательно на одной HU-КТ...");
 const raw=await textBounded(await call(session,"/v1/abdomen/analyze",{
   method:"POST",signal,headers:{"Content-Type":"application/octet-stream",
    "X-Opus-Source-Sha256":sourceSha,
    "X-Opus-Public-Research-Authorization":"approved-nonpatient-source"},body:source,
 }));
 const x=record(JSON.parse(raw)),tasks=record(x.tasks);
 if(x.schema!=="opus-original-abdominal-ct-pathology-batch/v1"||
    x.sourceNiftiSha256!==sourceSha||x.clinicalValidation!==false||
    x.noNegativeDiagnosis!==true||
    Object.keys(tasks).length!==2)
   throw Error("Исходная КТ и исполненные модели не подтверждены.");
 const done={} as Record<AbdominalTask,AbdominalTaskState>;
 for(const task of ["kidney_cysts","liver_lesions"] as const){
  const state=record(tasks[task]),status=state.status;
  if(status==="completed"){
    if(!(task in known))throw Error("Исполнитель возвратил необъявленную модель.");
    done[task]={status,report:validateReport(state.report,task,sourceSha,
     String(record(known[task]).checkpointSha256),native.dimensions)};
  }else if((status==="unavailable"||status==="failed")&&
           typeof state.reason==="string"&&state.reason.length<128){
    done[task]={status,reason:state.reason};
  }else throw Error("Исполнитель не подтвердил статус "+task);
 }
 return {sourceNiftiSha256:sourceSha,tasks:done};
}
