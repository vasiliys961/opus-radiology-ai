/** Existing original Raidionics ONNX mediastinal nodes with original R231 lungs as
 * automatic anatomical prerequisite; not a duplicated pathology detector.
 */
import {call,type WorkerSession} from "./local-worker.ts";
import {originalNiftiSha256} from "./live-nodule-worker.ts";
import {readNoduleNiftiHeader} from "./live-nodule-report.ts";

export type MediastinalNode={
 nativeBoundsIJK:[[number,number],[number,number],[number,number]];
 sourceCentroidIJK:[number,number,number];sourceRASmm:[number,number,number];
 candidateVoxels:number;candidateVolumeMl:number;nodeMalignancyAssessed:false;
};
export type MediastinalNodeReport={
 schema:"opus-original-raidionics-mediastinal-nodes-native-ct/v1";
 task:"mediastinal_lymph_nodes";
 sourceNiftiSHA256:string;sourceNativeShapeXYZ:[number,number,number];
 originalModelArchiveSHA256:string;originalLungmaskSHA256:string;
 sourceAlignedLungmaskSHA256:string;modelPredictionNativeMaskSHA256:string;
 actualOriginalRaidionicsInferenceCompleted:true;actualOriginalR231InferenceCompleted:true;
 modelPositiveVoxels:number;candidates:MediastinalNode[];
 nodeMalignancyConfirmed:false;clinicalValidation:false;
 negativeLymphadenopathyConclusionPermitted:false;sourceDICOMFrameRegistrationVerified:false;
 limitations:string[];
};
const hash=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const triple=(v:unknown):v is number[]=>Array.isArray(v)&&v.length===3&&
 v.every(x=>typeof x==="number"&&Number.isFinite(x));
function obj(v:unknown):Record<string,unknown>{
 if(!v||typeof v!=="object"||Array.isArray(v))throw Error("Неверный ответ Raidionics.");
 return v as Record<string,unknown>;
}
export function raidionicsOriginalReady(v:unknown):boolean{
 try{
  const c=obj(v);
  return c.schema==="opus-raidionics-mediastinal-direct-worker/v1"&&
   c.model==="Raidionics CT_LymphNodes ONNX v13"&&
   c.modelArchiveSHA256==="922c0e99cb637a872d18b83300a648eb0d782b1ef874c5d33a551285e52ccb08"&&
   c.lungmaskWeightSHA256==="d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f"&&
   c.modelArchiveVerified===true&&c.lungmaskVerified===true&&
   c.raidionicssegVersion==="1.5.2"&&c.lungmaskVersion==="0.2.20"&&
   c.ready===true&&c.mode==="isolated-private-linux-cpu-research"&&
   c.protocol==="contrast-enhanced-chest-CT-confirmed-by-physician"&&
   c.patientMode===false&&c.dataPolicy==="public-nonpatient-only";
 }catch{return false;}
}
export function parseMediastinalNodeReport(value:unknown,sourceSha:string,
 dims:number[]):MediastinalNodeReport{
 const x=obj(value);
 if(x.schema!=="opus-original-raidionics-mediastinal-nodes-native-ct/v1"||
    x.task!=="mediastinal_lymph_nodes"||x.sourceNiftiSHA256!==sourceSha||
    x.originalModelArchiveSHA256!=="922c0e99cb637a872d18b83300a648eb0d782b1ef874c5d33a551285e52ccb08"||
    x.originalLungmaskSHA256!=="d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f"||
    !hash(x.sourceAlignedLungmaskSHA256)||!hash(x.modelPredictionNativeMaskSHA256)||
    x.actualOriginalRaidionicsInferenceCompleted!==true||
    x.actualOriginalR231InferenceCompleted!==true||
    x.nodeMalignancyConfirmed!==false||x.clinicalValidation!==false||
    x.negativeLymphadenopathyConclusionPermitted!==false||
    x.sourceDICOMFrameRegistrationVerified!==false||
    !triple(x.sourceNativeShapeXYZ)||
    !x.sourceNativeShapeXYZ.every((v:number,i:number)=>v===dims[i])||
    !Number.isSafeInteger(x.modelPositiveVoxels)||Number(x.modelPositiveVoxels)<0||
    !Array.isArray(x.candidates)||x.candidates.length>256||
    !Array.isArray(x.limitations)||x.limitations.length<3)
  throw Error("Не подтверждено происхождение оригинального Raidionics-результата.");
 let total=0;
 for(const raw of x.candidates as unknown[]){
  const c=obj(raw),box=c.nativeBoundsIJK;
  if(!Array.isArray(box)||box.length!==3||
     !box.every((pair:unknown,i:number)=>Array.isArray(pair)&&pair.length===2&&
       pair.every((v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0)&&
       pair[0]<=pair[1]&&pair[1]<dims[i])||
     !triple(c.sourceCentroidIJK)||
     !c.sourceCentroidIJK.every((v:number,i:number)=>v>=box[i][0]&&v<=box[i][1])||
     !triple(c.sourceRASmm)||!Number.isSafeInteger(c.candidateVoxels)||
     Number(c.candidateVoxels)<3||
     typeof c.candidateVolumeMl!=="number"||!Number.isFinite(c.candidateVolumeMl)||
     c.candidateVolumeMl<=0||c.nodeMalignancyAssessed!==false)
    throw Error("Неподтверждённая геометрия кандидата лимфоузла.");
  total+=c.candidateVoxels as number;
 }
 if(total>Number(x.modelPositiveVoxels))throw Error("Объёмы кандидатов не соответствуют маске.");
 return x as unknown as MediastinalNodeReport;
}
/** Server-held token; fixed same-origin route only for public nonpatient research. */
export async function automaticNodesRequest(path:"/v1/nodes/capabilities"|"/v1/nodes/analyze",init:RequestInit={}):Promise<Response>{
 const response=await fetch("/api/local-nodes",{
  ...init,method:path.endsWith("/capabilities")?"GET":"POST",
  credentials:"same-origin",redirect:"error",cache:"no-store",
 });
 if(!response.ok)throw Error("Оригинальный Raidionics недоступен (HTTP "+response.status+").");
 return response;
}
export async function checkAutomaticNodesReady(signal?:AbortSignal):Promise<boolean>{
 try{
  const response=await automaticNodesRequest("/v1/nodes/capabilities",{signal});
  return raidionicsOriginalReady(await response.json());
 }catch{return false;}
}

export async function runOriginalRaidionicsNodes(
 session:WorkerSession|null,source:File,enhancedChestConfirmed:boolean,
 signal:AbortSignal,onStatus:(s:string)=>void=()=>{},
):Promise<MediastinalNodeReport>{
 if(!enhancedChestConfirmed)
  throw Error("Нельзя запускать Raidionics без подтверждённой контрастной КТ средостения.");
 const invoke=(path:"/v1/nodes/capabilities"|"/v1/nodes/analyze",init:RequestInit={})=>
  session?call(session,path,init):automaticNodesRequest(path,init);
 const native=await readNoduleNiftiHeader(source);
 onStatus("Проверяем оригинальные ONNX Raidionics и Lungmask R231...");
 const cap=await (await invoke("/v1/nodes/capabilities",{signal})).json() as unknown;
 if(!raidionicsOriginalReady(cap))
  throw Error("Оригинальные Raidionics / Lungmask веса или память worker недоступны.");
 const hash=await originalNiftiSha256(source,signal);
 onStatus("R231 → настоящая Raidionics CT_LymphNodes на выбранной исходной КТ...");
 const response=await invoke("/v1/nodes/analyze",{
  method:"POST",signal,headers:{
   "Content-Type":"application/octet-stream","X-Opus-Source-Sha256":hash,
   "X-Opus-Enhanced-CT-Confirmed":"yes",
   ...(session?{}:{"X-Opus-Public-Research-Authorization":"approved-nonpatient-source"})},body:source});
 const raw=await response.text();
 if(raw.length>512*1024)throw Error("Слишком большой Raidionics отчёт.");
 return parseMediastinalNodeReport(JSON.parse(raw),hash,native.dimensions);
}
