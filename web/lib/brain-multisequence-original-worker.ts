/** One original pretrained pathology model for one selected MRI task.
 * Source roles are doctor-confirmed, NEVER derived from unreliable MR DICOM tags.
 */
import {call,type WorkerSession} from "./local-worker.ts";
import {originalNiftiSha256} from "./live-nodule-worker.ts";
import {readNoduleNiftiHeader} from "./live-nodule-report.ts";
import type {MrRole} from "./brain-native-mr-dicom.ts";
export type BrainTask="stroke"|"glioma";
export const BRAIN_ROLES:Record<BrainTask,readonly MrRole[]>={
 stroke:["dwi","adc","flair"],glioma:["t1ce","t1","t2","flair"],
};
export type BrainCandidate={
 nativeBoundsIJK:[[number,number],[number,number],[number,number]];
 nativeCenterIJK:[number,number,number];nativeCenterRASmm:[number,number,number];
 candidateVoxels:number;candidateVolumeMl:number;expertDiagnosisConfirmed:false;
};
export type BrainRegion={sourcePositiveVoxels:number;components:BrainCandidate[]};
export type BrainModelReport={
 schema:"opus-original-brain-real-pathology-result/v1";
 task:BrainTask;originalCheckpointSha256:string;
 originalSequenceSha256:Record<string,string>;
 sourceReferenceRole:"dwi"|"t1ce";sourceReferenceShapeXYZ:[number,number,number];
 outputNativeSourceGridVerified:true;actualPretrainedModelForwardCompleted:true;
 modelRegions:Record<string,BrainRegion>;
 clinicalValidation:false;negativeDiagnosisPermitted:false;
 originalDICOM_SOPRegistrationVerified:false;
 operatorConfirmedSequenceNamesNotDerivedFromDICOM:true;
 limitations:string[];
};
const hash=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const trip=(v:unknown):v is number[]=>Array.isArray(v)&&v.length===3&&
 v.every(x=>typeof x==="number"&&Number.isFinite(x));
const records=(v:unknown):Record<string,unknown>=>{
 if(!v||typeof v!=="object"||Array.isArray(v))throw Error("Неизвестный ответ оригинальной MRI модели.");
 return v as Record<string,unknown>;
};
const CHECKPOINTS:Record<BrainTask,string>={
 stroke:"f9023888c7fe616ff271559acb82addd2496581fddd0a94e2d3c80bada5bb7e9",
 glioma:"860ccb3f1c21c99d0410ad8a1ac4ef6b8fab60cec0a503b0ba42675741a750ae",
};
export function readyOriginalBrainTask(cap:unknown,task:BrainTask):boolean{
 try{
  const c=records(cap);
  if(c.schema!=="opus-original-brain-multisequence-worker/v1"||
    c.mode!=="isolated-linux-cpu-research"||c.patientMode!==false||
    c.dataPolicy!=="public-nonpatient-only"||
    c.originalDICOMWeightingAutoInferred!==false||c.ready!==true)return false;
  const model=records(records(c.installedTasks)[task]);
  return model.checkpointSha256===CHECKPOINTS[task]&&
    model.installedAndHashVerified===true;
 }catch{return false;}
}
export function parseOriginalBrainReport(value:unknown,task:BrainTask,
 hashes:Record<string,string>,nativeDimensions:number[]):BrainModelReport{
 const x=records(value),regions=records(x.modelRegions);
 const expected=task==="stroke"?["ischemic_stroke"]:
   ["tumor_core","whole_tumor","enhancing_tumor"];
 if(x.schema!=="opus-original-brain-real-pathology-result/v1"||
   x.task!==task||x.originalCheckpointSha256!==CHECKPOINTS[task]||
   x.sourceReferenceRole!==(task==="stroke"?"dwi":"t1ce")||
   !trip(x.sourceReferenceShapeXYZ)||
   !x.sourceReferenceShapeXYZ.every((v:number,i:number)=>v===nativeDimensions[i])||
   x.outputNativeSourceGridVerified!==true||
   x.actualPretrainedModelForwardCompleted!==true||
   x.clinicalValidation!==false||x.negativeDiagnosisPermitted!==false||
   x.originalDICOM_SOPRegistrationVerified!==false||
   x.operatorConfirmedSequenceNamesNotDerivedFromDICOM!==true||
   !Array.isArray(x.limitations)||x.limitations.length<4||
   Object.keys(regions).sort().join(",")!==expected.sort().join(","))
  throw Error("Неверная оригинальная MRI модель, физическая сетка или исследовательский протокол.");
 const source=records(x.originalSequenceSha256);
 if(Object.keys(source).sort().join(",")!==Object.keys(hashes).sort().join(",")||
    Object.entries(hashes).some(([k,sha])=>!hash(sha)||source[k]!==sha))
  throw Error("MRI модель не соответствует переданным исходным последовательностям.");
 for(const key of expected){
  const r=records(regions[key]);
  if(!Number.isSafeInteger(r.sourcePositiveVoxels)||Number(r.sourcePositiveVoxels)<0||
    !Array.isArray(r.components)||r.components.length>256)
   throw Error("Недостоверные количества MRI очагов.");
  let sum=0;
  for(const value of r.components as unknown[]){
   const c=records(value),box=c.nativeBoundsIJK;
   if(!Array.isArray(box)||box.length!==3||
     !box.every((pair:unknown,i:number)=>Array.isArray(pair)&&pair.length===2&&
       pair.every((v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0)&&
       pair[0]<=pair[1]&&pair[1]<nativeDimensions[i])||
     !trip(c.nativeCenterIJK)||
     !c.nativeCenterIJK.every((v:number,i:number)=>v>=box[i][0]&&v<=box[i][1])||
     !trip(c.nativeCenterRASmm)||
     !Number.isSafeInteger(c.candidateVoxels)||Number(c.candidateVoxels)<3||
     typeof c.candidateVolumeMl!=="number"||!Number.isFinite(c.candidateVolumeMl)||
     c.candidateVolumeMl<=0||c.expertDiagnosisConfirmed!==false)
    throw Error("Неподтверждённая локализация очага МРТ.");
   sum+=Number(c.candidateVoxels);
  }
  if(sum>Number(r.sourcePositiveVoxels))throw Error("Объём MRI кандидатов не соответствует исходной маске.");
 }
 return x as unknown as BrainModelReport;
}
/** One fixed private server route for either original multi-sequence model. */
export async function automaticBrainRequest(path:"/v1/brain/capabilities"|"/v1/brain/analyze",init:RequestInit={}):Promise<Response>{
 const response=await fetch("/api/local-brain",{
  ...init,method:path.endsWith("/capabilities")?"GET":"POST",
  credentials:"same-origin",cache:"no-store",redirect:"error",
 });
 if(!response.ok)throw Error("Оригинальные MRI модели недоступны (HTTP "+response.status+").");
 return response;
}
export async function checkAutomaticBrainReady(task:BrainTask,signal?:AbortSignal):Promise<boolean>{
 try{
  const response=await automaticBrainRequest("/v1/brain/capabilities",{signal});
  return readyOriginalBrainTask(await response.json(),task);
 }catch{return false;}
}
export async function executeOriginalBrain(
 session:WorkerSession|null,task:BrainTask,files:Record<string,File>,
 confirmed:boolean,signal:AbortSignal,onProgress:(s:string)=>void=()=>{},
):Promise<BrainModelReport>{
 if(!confirmed)throw Error("Типы МР-последовательностей не подтверждены врачом.");
 const invoke=(path:"/v1/brain/capabilities"|"/v1/brain/analyze",init:RequestInit={})=>
   session?call(session,path,init):automaticBrainRequest(path,init);
 const roles=BRAIN_ROLES[task];
 if(Object.keys(files).sort().join(",")!==[...roles].sort().join(","))
  throw Error("Неполные или дублированные обязательные МР-последовательности.");
 onProgress("Проверяем настоящие исходные веса "+(task==="stroke"?"ISLES22":"BraTS")+"...");
 const cap=await (await invoke("/v1/brain/capabilities",{signal})).json() as unknown;
 if(!readyOriginalBrainTask(cap,task))
  throw Error("Оригинальная модель "+task+" не установлена на Linux worker.");
 const manifestFiles: {role:MrRole;bytes:number;sha256:string}[]=[];
 for(const role of roles){
  const file=files[role];
  await readNoduleNiftiHeader(file);
  manifestFiles.push({role,bytes:file.size,sha256:await originalNiftiSha256(file,signal)});
 }
 const manifest=new TextEncoder().encode(JSON.stringify({
  schema:"opus-native-dicom-brain-mri-batch/v1",task,files:manifestFiles,
 }));
 if(manifest.length>8192)throw Error("Чрезмерный паспорт исходной МРТ.");
 const header=new Uint8Array(4);
 new DataView(header.buffer).setUint32(0,manifest.length,true);
 const packet=new Blob([header,manifest,...roles.map(role=>files[role])],
  {type:"application/octet-stream"});
 const native=await readNoduleNiftiHeader(files[task==="stroke"?"dwi":"t1ce"]);
 onProgress("Последовательно передаём подлинные MR DICOM объёмы приватному worker...");
 const response=await invoke("/v1/brain/analyze",{
  method:"POST",signal,headers:{"Content-Type":"application/octet-stream",
   "X-Opus-MRI-Source-Authorized":"approved-public-nonpatient",
   ...(session?{}:{"X-Opus-Public-Research-Authorization":"approved-nonpatient-source"})},body:packet,
 });
 const raw=await response.text();
 if(raw.length>512*1024)throw Error("Слишком большой отчёт настоящей MRI модели.");
 return parseOriginalBrainReport(JSON.parse(raw),task,
  Object.fromEntries(manifestFiles.map(x=>[x.role,x.sha256])),native.dimensions);
}
