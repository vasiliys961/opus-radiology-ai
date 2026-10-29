/** Original pretrained PE CTPA model on EXACT native DICOM-derived HU volume.
 * No lung-nodule detector duplication, no automatic non-CTPA inference.
 */
import {call,type WorkerSession} from "./local-worker.ts";
import {originalNiftiSha256} from "./live-nodule-worker.ts";
import {readNoduleNiftiHeader} from "./live-nodule-report.ts";

export type PeSourceCandidate={
 nativeVoxelBoundsIJK:[[number,number],[number,number],[number,number]];
 sourceCentroidIJK:[number,number,number];
 sourceRASmm:[number,number,number];
 modelCandidateVoxels:number;
 modelCandidateMl:number;
 confirmedEmbolism:false;
};
export type PeCtpSourceReport={
 schema:"opus-original-mazurowski-ctpa-pe-source/v1";
 task:"pulmonary_embolism_ctpa";
 sourceNiftiSHA256:string;
 observedModelWeightFileSHA256:string;
 sourceNativeShapeXYZ:[number,number,number];
 sourceNativeVoxelPositiveCount:number;
 realOriginalPretrainedForwardCompleted:true;
 protocolConfirmedByOperatorNotDICOM:true;
 clinicalValidation:false;
 negativeDiagnosisPermitted:false;
 independentHoldout:false;
 sourceSOPRegistrationVerified:false;
 lesions:PeSourceCandidate[];
 limitations:string[];
};
const sha=(x:unknown):x is string=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x);
const triple=(x:unknown):x is number[]=>Array.isArray(x)&&x.length===3&&
 x.every(v=>typeof v==="number"&&Number.isFinite(v));
function rec(x:unknown):Record<string,unknown>{
 if(!x||typeof x!=="object"||Array.isArray(x))throw Error("Неверный объект отчёта ТЭЛА.");
 return x as Record<string,unknown>;
}
export function readyOriginalPeCtpWorker(cap:unknown):boolean{
 try{
  const x=rec(cap);
  return x.schema==="opus-original-pe-ctpa-worker/v1"&&
   x.model==="Mazurowski PE nnUNet ResidualEncoderUNet"&&
   x.publisherCodeRevision==="b4c50008bbbf825282ccf10767f819276e320fb9"&&
   x.modelReleaseReference==="7ce235f"&&
   sha(x.weightFileSha256)&&x.originalWeightFileObserved===true&&
   x.ready===true&&x.protocol==="CTPA-only"&&
   x.mode==="isolated-linux-cpu-research"&&
   x.patientMode===false&&x.dataPolicy==="approved-public-nonpatient-only"&&
   x.vendorActiveParametersCryptographicallyProven===false;
 }catch{return false;}
}
export function parseOriginalPeCtpReport(value:unknown,sourceSha:string,
 weightSha:string,dims:number[]):PeCtpSourceReport{
 const x=rec(value);
 if(x.schema!=="opus-original-mazurowski-ctpa-pe-source/v1"||
    x.task!=="pulmonary_embolism_ctpa"||
    x.sourceNiftiSHA256!==sourceSha||
    x.observedModelWeightFileSHA256!==weightSha||
    x.realOriginalPretrainedForwardCompleted!==true||
    x.protocolConfirmedByOperatorNotDICOM!==true||
    x.clinicalValidation!==false||x.negativeDiagnosisPermitted!==false||
    x.independentHoldout!==false||x.sourceSOPRegistrationVerified!==false||
    !triple(x.sourceNativeShapeXYZ)||
    !x.sourceNativeShapeXYZ.every((v:number,i:number)=>v===dims[i])||
    !Number.isSafeInteger(x.sourceNativeVoxelPositiveCount)||
    Number(x.sourceNativeVoxelPositiveCount)<0||
    !Array.isArray(x.lesions)||x.lesions.length>512||
    !Array.isArray(x.limitations)||x.limitations.length<3)
   throw Error("Нет подтверждённого исходного CTPA и настоящего PE-инференса.");
 let count=0;
 for(const item of x.lesions as unknown[]){
  const c=rec(item),bounds=c.nativeVoxelBoundsIJK;
  if(!Array.isArray(bounds)||bounds.length!==3||
     !bounds.every((pair:unknown,i:number)=>Array.isArray(pair)&&pair.length===2&&
       pair.every((n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0)&&
       pair[0]<=pair[1]&&pair[1]<dims[i])||
     !triple(c.sourceCentroidIJK)||
     !c.sourceCentroidIJK.every((n:number,i:number)=>n>=bounds[i][0]&&n<=bounds[i][1])||
     !triple(c.sourceRASmm)||
     !Number.isSafeInteger(c.modelCandidateVoxels)||Number(c.modelCandidateVoxels)<3||
     typeof c.modelCandidateMl!=="number"||!Number.isFinite(c.modelCandidateMl)||
     c.modelCandidateMl<=0||c.confirmedEmbolism!==false)
    throw Error("Исходные координаты кандидата ТЭЛА недостоверны.");
  count+=c.modelCandidateVoxels as number;
 }
 if(count>Number(x.sourceNativeVoxelPositiveCount))
   throw Error("Воксели кандидатов ТЭЛА превышают модельный источник.");
 return x as unknown as PeCtpSourceReport;
}
export async function executeOriginalPeCtp(
 session:WorkerSession,source:File,confirmedCtpa:boolean,signal:AbortSignal,
 progress:(text:string)=>void=()=>{},
):Promise<PeCtpSourceReport>{
 if(!confirmedCtpa)throw Error("Врач ещё не подтвердил, что открыта именно КТ-ангиография лёгочных артерий.");
 const native=await readNoduleNiftiHeader(source);
 progress("Проверяем установленные оригинальные веса и версию CTPA-модели...");
 const cap=await (await call(session,"/v1/pe/capabilities",{signal})).json() as unknown;
 if(!readyOriginalPeCtpWorker(cap))
   throw Error("Оригинальный PE nnU-Net worker недоступен или недостаточно RAM.");
 const originalSha=await originalNiftiSha256(source,signal);
 progress("Настоящий nnU-Net анализирует подтверждённую исходную CTPA на Linux CPU...");
 const response=await call(session,"/v1/pe/analyze",{method:"POST",signal,
  headers:{"Content-Type":"application/octet-stream",
   "X-Opus-Source-Sha256":originalSha,
   "X-Opus-CTPA-Protocol-Confirmed":"yes"},body:source});
 const text=await response.text();
 if(text.length>512*1024)throw Error("Слишком большой отчёт nnU-Net ТЭЛА.");
 const result=parseOriginalPeCtpReport(JSON.parse(text),originalSha,
   String(rec(cap).weightFileSha256),native.dimensions);
 progress("PE nnU-Net выполнен; каждый модельный кандидат требует экспертной оценки.");
 return result;
}
